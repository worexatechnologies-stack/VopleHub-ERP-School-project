"""Production-grade JWT authentication helpers.

Security decisions
------------------
* Access tokens are short-lived (15 minutes) and are NEVER stored in the DB.
* Refresh tokens are long-lived (30 days) and are sent ONLY as HttpOnly,
  Secure (in prod), SameSite=Lax cookies. The raw value is never stored:
  we persist a bcrypt hash keyed by the JWT ``jti`` claim.
* Refresh rotation: every call to /auth/refresh/ issues a new refresh token,
  revokes the old record, and creates a new hashed record. If a revoked token
  is ever reused, we revoke all of that user's sessions.
"""
import bcrypt
import hashlib
import uuid
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from .models import RefreshTokenRecord

#: Name of the HttpOnly cookie that carries the refresh token.
REFRESH_COOKIE_NAME = 'refresh_token_cookie'

#: 30-day refresh lifetime, configurable via Django settings.
REFRESH_TOKEN_LIFETIME_DAYS = getattr(settings, 'REFRESH_TOKEN_LIFETIME_DAYS', 30)


def hash_refresh_token(raw_token: str) -> str:
    """Return a bcrypt hash of the SHA256-hashed raw JWT refresh token.

    Pre-hashing with SHA-256 avoids bcrypt's 72-byte input length limitation
    while maintaining bcrypt's work factor protection against offline brute-force.
    """
    token_bytes = hashlib.sha256(raw_token.encode('utf-8')).hexdigest().encode('utf-8')
    return bcrypt.hashpw(token_bytes, bcrypt.gensalt()).decode('utf-8')


def _client_ip(request):
    """Best-effort client IP extraction (X-Forwarded-For aware)."""
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
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

    Returns a dict with ``access``, ``refresh`` (raw, for the cookie) and
    the DB record ``record``.
    """
    refresh = RefreshToken.for_user(user)
    jti = uuid.uuid4()
    refresh['jti'] = str(jti)

    raw_refresh = str(refresh)
    access = str(refresh.access_token)

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
    """Read the HttpOnly refresh-token cookie safely, with request data fallback."""
    cookie_token = request.COOKIES.get(REFRESH_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    if hasattr(request, 'data') and isinstance(request.data, dict):
        return request.data.get('refresh')
    return None


def set_refresh_cookie(response, raw_refresh: str) -> None:
    """Set the refresh-token cookie on the response.

    * HttpOnly=True  -> JavaScript cannot read it (XSS safe).
    * Secure=not DEBUG -> sent only over HTTPS in production.
    * SameSite='Lax' -> CSRF-safe while preserving same-site navigation.
    """
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_refresh,
        max_age=REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=not settings.DEBUG,
        samesite='Lax',
        path='/api/v1/auth/',
    )


def clear_refresh_cookie(response) -> None:
    """Expire the refresh-token cookie immediately."""
    response.delete_cookie(REFRESH_COOKIE_NAME, path='/api/v1/auth/')
