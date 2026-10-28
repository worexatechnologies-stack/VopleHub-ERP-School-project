from .base import *
from urllib.parse import urlsplit
from django.core.exceptions import ImproperlyConfigured

DEBUG = False
# Demo checkout is deliberately unavailable in production.  A real school
# must configure its Razorpay credentials through the authenticated admin UI.
RAZORPAY_DUMMY_MODE = False
# Never return developer OTPs or allow the fixed development code in production by default.
# Can be enabled explicitly in .env for staging verification.
MFA_DEVELOPMENT_MODE = env.bool('MFA_DEVELOPMENT_MODE', default=False)
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

# Strict Production Allowed Hosts (Prevent Host Header Injection)
_configured_hosts = env.list('ALLOWED_HOSTS', default=[
    'volpehub.in',
    '.volpehub.in',
    'www.volpehub.in',
    'volpehub.education',
    '.volpehub.education',
    'www.volpehub.education',
    'worexa.com',
    '.worexa.com',
    'www.worexa.com',
    'localhost',
    '127.0.0.1',
    'api',
    'web',
])
ALLOWED_HOSTS = list(set(_configured_hosts + [
    'volpehub.in',
    '.volpehub.in',
    'www.volpehub.in',
    'volpehub.education',
    '.volpehub.education',
    'www.volpehub.education',
    'localhost',
    '127.0.0.1',
    'api',
    'web',
]))

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
        if origin.startswith('https://*.') and len(origin) > 10:
            if origin not in cleaned:
                cleaned.append(origin)
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
        netloc_origin = f"https://{parsed.netloc}"
        if netloc_origin not in cleaned:
            cleaned.append(netloc_origin)
    # Always guarantee production domains are included even if .env defines a custom subset
    for domain in (
        'https://volpehub.in',
        'https://www.volpehub.in',
        'https://*.volpehub.in',
        'https://volpehub.education',
        'https://www.volpehub.education',
        'https://*.volpehub.education',
        'https://worexa.com',
        'https://www.worexa.com',
        'https://*.worexa.com',
    ):
        if domain not in cleaned:
            cleaned.append(domain)
    return cleaned


_all_prod_origins = _normalize_and_validate_origins(
    'ORIGINS',
    env.list('CORS_ALLOWED_ORIGINS', default=[
        'https://volpehub.in',
        'https://www.volpehub.in',
        'https://*.volpehub.in',
        'https://volpehub.education',
        'https://www.volpehub.education',
        'https://*.volpehub.education',
        'https://worexa.com',
        'https://www.worexa.com',
        'https://*.worexa.com',
    ])
)
# django-cors-headers requires exact origins in CORS_ALLOWED_ORIGINS and regexes for subdomains
CORS_ALLOWED_ORIGINS = [origin for origin in _all_prod_origins if '*' not in origin]
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https://([a-zA-Z0-9-]+\.)?volpehub\.in$",
    r"^https://([a-zA-Z0-9-]+\.)?volpehub\.education$",
    r"^https://([a-zA-Z0-9-]+\.)?worexa\.com$",
]
# Django CSRF middleware natively supports wildcard subdomains like https://*.volpehub.in
CSRF_TRUSTED_ORIGINS = _all_prod_origins
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

