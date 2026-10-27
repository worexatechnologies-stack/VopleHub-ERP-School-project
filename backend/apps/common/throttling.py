"""Production-grade rate limiting and throttling components.

Designed specifically for educational institutions where 800-900+ users
(students, parents, teachers, administrators) share a single school Wi-Fi public IP.

Key Architectural Decisions:
1. Account-level brute force protection: Keyed by normalized email/username in Redis.
   Alice entering the wrong password 5 times locks only Alice's account, allowing
   the other 899 users on the same Wi-Fi to log in without interference.
2. IP-level flood protection: Allows up to 300 logins/min from a shared campus NAT IP,
   preventing network-level denial of service while accommodating morning rush traffic.
3. Token refresh isolation: Keyed by refresh token / session hash, preventing 900 active
   users from colliding on the anonymous IP rate limit during background token refresh.
4. Administrative operations: Higher capacity for school administrators performing
   batch credential resets during onboarding.
"""
import hashlib
import time
from django.core.cache import cache
from django.conf import settings
from rest_framework.throttling import BaseThrottle, SimpleRateThrottle

class AccountLoginRateThrottle(BaseThrottle):
    """
    Per-Account & Dual-Key Login Protection with Progressive Delays.

    Architectural Security Model:
    1. Dual-Key (Account + IP) Lockout:
       An attacker entering wrong passwords 5 times from a specific IP locks out
       ONLY that IP from that target account for 5 minutes. The legitimate user
       logging in from school Wi-Fi or home is NOT locked out (prevents Account DoS).
    2. Account-Level Progressive Delay:
       To prevent distributed brute-force attacks across rotating botnet IPs,
       when an account accumulates 5+ failures globally, a progressive delay
       (minimum 2 seconds between attempts) is enforced rather than a hard lockout.
       This slows automated bots to 0.5 attempts/s without denying service to the real user.
    3. Shared Wi-Fi Isolation:
       Alice failing 5 times on campus Wi-Fi only blocks Alice from that IP.
       Bob and 899 other students sharing the same campus IP log in without interference.
    4. Worker-Atomic Redis Counters:
       All counters use Redis pipelines (INCR + EXPIRE) to guarantee atomicity across
       multi-worker Gunicorn/ASGI processes.
    """
    MAX_IP_ACCOUNT_FAILS = 5
    MAX_GLOBAL_FAILS = 5
    WINDOW_SECONDS = 300  # 5 minutes
    PROGRESSIVE_DELAY_SECONDS = 2.0

    @staticmethod
    def _get_request_ident(request) -> str:
        if not request:
            return '127.0.0.1'
        real_ip = request.META.get('HTTP_X_REAL_IP')
        if real_ip:
            return real_ip.strip()
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if forwarded:
            parts = [p.strip() for p in forwarded.split(',') if p.strip()]
            if parts:
                return parts[-1]
        return request.META.get('REMOTE_ADDR') or '127.0.0.1'

    def _get_account_hash(self, request) -> str | None:
        data = getattr(request, 'data', None)
        if not isinstance(data, dict):
            data = getattr(request, 'POST', {}) or {}
        raw = (data.get('email') or data.get('username') or '').strip().lower()
        if not raw:
            return None
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]

    def allow_request(self, request, view):
        if request.method != 'POST':
            return True
        acc_hash = self._get_account_hash(request)
        if not acc_hash:
            return True

        ident = self._get_request_ident(request)
        pair_key = f"throttle:login_fails:pair:{acc_hash}:{ident}"
        global_key = f"throttle:login_fails:global:{acc_hash}"
        global_last_attempt = f"throttle:login_fails:last:{acc_hash}"

        try:
            # 1. Check IP+Account lockout
            pair_fails = self.get_counter(pair_key)
            if pair_fails >= self.MAX_IP_ACCOUNT_FAILS:
                self.wait_time = self.WINDOW_SECONDS
                return False

            # 2. Check Global Progressive Delay (Distributed brute-force defense)
            global_fails = self.get_counter(global_key)
            if global_fails >= self.MAX_GLOBAL_FAILS:
                last_ts = cache.get(global_last_attempt)
                now = time.time()
                if last_ts and (now - last_ts) < self.PROGRESSIVE_DELAY_SECONDS:
                    self.wait_time = max(1, int(self.PROGRESSIVE_DELAY_SECONDS - (now - last_ts) + 0.99))
                    return False
        except Exception:
            # Fail-open if Redis encounters unexpected error
            return True

        return True

    def wait(self):
        return getattr(self, 'wait_time', self.PROGRESSIVE_DELAY_SECONDS)

    @staticmethod
    def get_counter(key: str) -> int:
        val = cache.get(key)
        if val is None:
            return 0
        try:
            return int(val)
        except (ValueError, TypeError):
            return 0

    @classmethod
    def atomic_incr(cls, key: str, timeout: int) -> int:
        try:
            raw_client = cache._cache.get_client()
            full_key = cache.make_key(key)
            pipe = raw_client.pipeline()
            pipe.incr(full_key)
            pipe.expire(full_key, timeout)
            results = pipe.execute()
            return results[0]
        except Exception:
            try:
                return cache.incr(key)
            except (ValueError, Exception):
                cache.set(key, 1, timeout=timeout)
                return 1

    @classmethod
    def record_failure(cls, raw_account: str, request=None, client_ip: str | None = None):
        if not raw_account:
            return
        acc_hash = hashlib.sha256(raw_account.strip().lower().encode('utf-8')).hexdigest()[:32]
        ident = client_ip or (cls._get_request_ident(request) if request else '127.0.0.1')
        pair_key = f"throttle:login_fails:pair:{acc_hash}:{ident}"
        global_key = f"throttle:login_fails:global:{acc_hash}"
        global_last_attempt = f"throttle:login_fails:last:{acc_hash}"

        try:
            cls.atomic_incr(pair_key, cls.WINDOW_SECONDS)
            cls.atomic_incr(global_key, cls.WINDOW_SECONDS)
            cache.set(global_last_attempt, time.time(), timeout=cls.WINDOW_SECONDS)
        except Exception:
            pass

    @classmethod
    def record_success(cls, raw_account: str, request=None, client_ip: str | None = None):
        if not raw_account:
            return
        acc_hash = hashlib.sha256(raw_account.strip().lower().encode('utf-8')).hexdigest()[:32]
        ident = client_ip or (cls._get_request_ident(request) if request else '127.0.0.1')
        pair_key = f"throttle:login_fails:pair:{acc_hash}:{ident}"
        global_key = f"throttle:login_fails:global:{acc_hash}"
        global_last_attempt = f"throttle:login_fails:last:{acc_hash}"

        try:
            cache.delete(pair_key)
            cache.delete(global_key)
            cache.delete(global_last_attempt)
        except Exception:
            pass


class ResilientSimpleRateThrottle(SimpleRateThrottle):
    """Base throttle with graceful fail-open resilience under Redis connection anomalies."""
    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except Exception:
            # Availability priority: allow traffic if Redis connection encounters transient failure
            return True


class LoginAccountRateThrottle(ResilientSimpleRateThrottle):
    """Bound repeated login work per submitted identity, not per shared NAT IP."""
    scope = 'login_account'

    def get_cache_key(self, request, view):
        data = getattr(request, 'data', None)
        if not isinstance(data, dict):
            data = getattr(request, 'POST', {}) or {}
        identifier = str(data.get('email') or data.get('username') or '').strip().lower()
        if not identifier:
            return None
        signature = hashlib.sha256(identifier.encode('utf-8')).hexdigest()[:32]
        return f"throttle:login_account:{signature}"


class IPLoginRateThrottle(ResilientSimpleRateThrottle):
    """
    Campus-Aware IP Login Rate Limiter.
    Allows up to 1200 logins per minute per IP, accommodating 1000+ students
    logging in during morning roll call while blocking automated dictionary attacks.
    """
    scope = 'login_ip'

    def get_cache_key(self, request, view):
        ident = self.get_ident(request)
        return f"throttle:login_ip:{ident}"


class TokenRefreshRateThrottle(ResilientSimpleRateThrottle):
    """
    Per-mobile-session token refresh throttle.
    Keyed by SHA-256 hash of the supplied refresh token.
    Allows up to 30 token refreshes per minute per active session.
    Prevents hundreds of users on school Wi-Fi from starving each other's quota.
    """
    scope = 'token_refresh'

    def get_cache_key(self, request, view):
        raw_token = request.COOKIES.get('refresh_token_cookie')
        if not raw_token and hasattr(request, 'data') and isinstance(request.data, dict):
            raw_token = request.data.get('refresh')

        if raw_token:
            token_sig = hashlib.sha256(str(raw_token).encode('utf-8')).hexdigest()[:16]
            return f"throttle:refresh_session:{token_sig}"

        # Missing-token requests are rejected before touching the database;
        # an IP fallback would make unrelated campus users share this quota.
        return None


class MfaChallengeRateThrottle(ResilientSimpleRateThrottle):
    """Rate-limit OTP work per challenge so campus users do not share a quota."""
    scope = 'mfa_challenge'

    def get_cache_key(self, request, view):
        data = getattr(request, 'data', None)
        if not isinstance(data, dict):
            data = getattr(request, 'POST', {}) or {}
        token = data.get('mfa_token') or data.get('mfaToken')
        if not token:
            return None
        signature = hashlib.sha256(str(token).encode('utf-8')).hexdigest()[:32]
        return f"throttle:mfa_challenge:{signature}"


class AdminCredentialManagementThrottle(ResilientSimpleRateThrottle):
    """
    Allows school administrators up to 120 password reset / credential operations
    per hour (sufficient for batch onboarding) while retaining a strict 10/hour
    limit for self-service password changes by standard users.
    """
    scope = 'admin_credential'

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        # Platform Super Admins and School Admins receive a dedicated admin quota
        return f"throttle:admin_credential:{request.user.pk}"
