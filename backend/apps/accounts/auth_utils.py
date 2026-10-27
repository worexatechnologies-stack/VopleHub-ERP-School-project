"""JWT helpers for native mobile clients and legacy credential cleanup.

Security decisions
------------------
* Browser clients authenticate with Django's server-side session framework.
* Native clients use short-lived access JWTs and random opaque refresh tokens.
  Only a SHA-256 digest of each mobile refresh token is stored in the DB.
* Refresh rotation: every call to /auth/refresh/ issues a new refresh token,
  revokes the old record, and creates a new hashed record. If a revoked token
  is ever reused, we revoke all of that user's sessions.
"""
import hashlib
import secrets
import uuid
from datetime import timedelta
from http.cookies import Morsel

from django.conf import settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from .models import RefreshTokenRecord

#: Names of the HttpOnly cookies used by browser clients.
REFRESH_COOKIE_NAME = 'refresh_token_cookie'
ACCESS_COOKIE_NAME = 'access_token_cookie'

#: 30-day refresh lifetime, configurable via Django settings.
REFRESH_TOKEN_LIFETIME_DAYS = getattr(settings, 'REFRESH_TOKEN_LIFETIME_DAYS', 30)


def hash_refresh_token(raw_token: str) -> str:
    """Store only the SHA-256 digest of the high-entropy opaque refresh token."""
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


def _client_ip(request):
    """Client IP extraction with trusted-proxy awareness.

    Prioritizes HTTP_X_REAL_IP set by the reverse proxy. If falling back to
    HTTP_X_FORWARDED_FOR with trusted upstream proxy (NUM_PROXIES=1), uses the
    rightmost IP to prevent spoofing via prepended client headers.
    """
    real_ip = request.META.get('HTTP_X_REAL_IP')
    if real_ip:
        return real_ip.strip()
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        parts = [p.strip() for p in forwarded.split(',') if p.strip()]
        if parts:
            return parts[-1]
    return request.META.get('REMOTE_ADDR')


def _device_label(request) -> str:
    """Short human-readable device label from the User-Agent header."""
    ua = request.META.get('HTTP_USER_AGENT', '')
    if not ua:
        return ''
    parts = ua.split()
    return ' '.join(parts[:3])[:255]


def issue_token_pair(user, request):
    """Create access + refresh token pair and persist the hashed refresh.

    Returns a dict with ``access``, ``refresh`` (raw, for the mobile client)
    and the database record ``record`` containing only the refresh hash.
    """
    access = str(AccessToken.for_user(user))
    raw_refresh = secrets.token_urlsafe(48)
    jti = uuid.uuid4()

    record = RefreshTokenRecord.objects.create(
        jti=jti,
        user=user,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=timezone.now() + timedelta(days=REFRESH_TOKEN_LIFETIME_DAYS),
        device=_device_label(request),
        ip_address=_client_ip(request),
    )
    return {'access': access, 'refresh': raw_refresh, 'record': record}


def rotate_refresh_token(user, old_record: RefreshTokenRecord, request):
    """Revoke the old record and issue a fresh pair (rotation)."""
    now = timezone.now()
    old_record.last_used_at = now
    old_record.save(update_fields=['last_used_at'])
    old_record.revoke()
    return issue_token_pair(user, request)


def revoke_refresh_token(record: RefreshTokenRecord | None) -> None:
    """Revoke a single device session on logout."""
    if record is not None:
        record.revoke()


def revoke_all_user_sessions(user) -> None:
    """Revoke every active session for a user (reuse-detection)."""
    from django.utils import timezone
    RefreshTokenRecord.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=timezone.now(),
    )


def read_refresh_cookie(request) -> str | None:
    """Read a refresh cookie left by the legacy browser JWT flow."""
    return request.COOKIES.get(REFRESH_COOKIE_NAME)


def clear_refresh_cookie(response) -> None:
    """Expire legacy browser JWT cookies during migration and logout."""
    def expire_paths(cookie_name, paths, secure, httponly):
        unique_paths = list(dict.fromkeys(paths))
        for index, path in enumerate(unique_paths):
            # SimpleCookie keys by cookie name, so put additional same-name
            # deletions under internal dict keys while retaining the real key
            # in each Morsel. This emits distinct Set-Cookie headers per path.
            cookie_key = cookie_name if index == 0 else f'{cookie_name}_legacy_path_{index}'
            morsel = Morsel()
            morsel.set(cookie_name, '', '')
            morsel['path'] = path
            morsel['max-age'] = 0
            morsel['expires'] = 'Thu, 01 Jan 1970 00:00:00 GMT'
            morsel['samesite'] = 'Lax'
            if secure:
                morsel['secure'] = True
            if httponly:
                morsel['httponly'] = True
            domain = settings.SESSION_COOKIE_DOMAIN
            if domain:
                morsel['domain'] = domain
            response.cookies[cookie_key] = morsel

    expire_paths(
        REFRESH_COOKIE_NAME,
        [getattr(settings, 'REFRESH_COOKIE_PATH', '/api/v1/auth/'), '/'],
        getattr(settings, 'REFRESH_COOKIE_SECURE', not settings.DEBUG),
        True,
    )
    expire_paths(
        ACCESS_COOKIE_NAME,
        [getattr(settings, 'ACCESS_COOKIE_PATH', '/'), '/api/v1/'],
        getattr(settings, 'ACCESS_COOKIE_SECURE', not settings.DEBUG),
        True,
    )
