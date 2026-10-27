from .base import *
from urllib.parse import urlsplit
from django.core.exceptions import ImproperlyConfigured

DEBUG = False
# Demo checkout is deliberately unavailable in production.  A real school
# must configure its Razorpay credentials through the authenticated admin UI.
RAZORPAY_DUMMY_MODE = False
# Never return developer OTPs or allow the fixed development code in production,
# even if a caller overrides DEBUG in a test or management command.
MFA_DEVELOPMENT_MODE = False
LEGACY_PUBLIC_FEE_READS = False
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = env.bool('DJANGO_SECURE_SSL_REDIRECT', default=True)
SECURE_REDIRECT_EXEMPT = [r'^api/health/?$', r'^healthz/?$']
SESSION_COOKIE_SECURE = env.bool('DJANGO_SESSION_COOKIE_SECURE', default=True)
CSRF_COOKIE_SECURE = env.bool('DJANGO_CSRF_COOKIE_SECURE', default=True)
SECURE_HSTS_SECONDS = env.int('DJANGO_HSTS_SECONDS', default=31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# Strict Production CORS & Cross-Origin Isolation
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True


def _normalize_and_validate_origins(setting_name, origins):
    """Normalize and validate production CORS and CSRF origins."""
    cleaned = []
    for raw in origins:
        origin = str(raw).strip().rstrip('/')
        if not origin:
            continue
        parsed = urlsplit(origin)
        if (
            parsed.scheme != 'https'
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or (parsed.path and parsed.path != '/')
            or parsed.query
            or parsed.fragment
            or '*' in origin
        ):
            continue
        cleaned.append(f"https://{parsed.netloc}")
    if not cleaned:
        cleaned = [
            'https://volpehub.education',
            'https://www.volpehub.education',
            'https://worexa.com',
            'https://www.worexa.com',
        ]
    return cleaned


CORS_ALLOWED_ORIGINS = _normalize_and_validate_origins(
    'CORS_ALLOWED_ORIGINS',
    env.list('CORS_ALLOWED_ORIGINS', default=[
        'https://volpehub.education',
        'https://www.volpehub.education',
        'https://worexa.com',
        'https://www.worexa.com',
    ])
)
# Production browser access is limited to explicitly configured origins. This
# prevents an untrusted/compromised sibling subdomain from reading the CSRF
# bootstrap response through credentialed CORS.
CORS_ALLOWED_ORIGIN_REGEXES = []
CSRF_TRUSTED_ORIGINS = _normalize_and_validate_origins(
    'CSRF_TRUSTED_ORIGINS',
    env.list('CSRF_TRUSTED_ORIGINS', default=CORS_ALLOWED_ORIGINS)
)
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {'hosts': [env('REDIS_URL')]},
    }
}

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': env('REDIS_CACHE_URL', default=env('REDIS_URL', default='redis://redis:6379/1')),
        'TIMEOUT': 300,
        'KEY_PREFIX': 'volpehub',
    }
}

