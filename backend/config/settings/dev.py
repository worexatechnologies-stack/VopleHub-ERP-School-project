import os
from pathlib import Path

_DEV_BASE_DIR = Path(__file__).resolve().parents[2]

import environ
environ.Env.read_env(_DEV_BASE_DIR / '.env')

# Development only: production settings never receive this fallback.
os.environ.setdefault('DJANGO_SECRET_KEY', 'development-only-insecure-key-at-least-32-bytes')
os.environ.setdefault('DATABASE_URL', 'postgres://volpehub_education:worexa@123@localhost:5432/volpehub_education')

from .base import *

# Permit this development machine to serve the API to devices on local network.
ALLOWED_HOSTS = ['*']
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = [
    *CORS_ALLOWED_ORIGINS,
    'http://192.168.1.4:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]
CORS_ALLOWED_ORIGIN_REGEXES = [
    *CORS_ALLOWED_ORIGIN_REGEXES,
    r"^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$",
]

DEBUG = True
# Keep the development OTP path available while Django's test runner temporarily
# forces ``DEBUG=False``.  This flag is deliberately overridden by production
# settings below, so it can never expose OTPs in a deployed environment.
MFA_DEVELOPMENT_MODE = True
# Compatibility switch for the pre-authenticated local finance acceptance
# tests. Production settings explicitly disable this; all deployed finance
# endpoints remain authenticated and tenant-scoped.
LEGACY_PUBLIC_FEE_READS = True
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Local development commonly uses one IP for repeated UI/API tests. Retain a
# throttle to catch accidental request loops, but avoid a five-attempt lockout.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    'DEFAULT_THROTTLE_RATES': {
        **REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'],
        'login': os.environ.get('LOGIN_THROTTLE_RATE', '60/min'),
    },
}

redis_cache_url = os.environ.get('REDIS_CACHE_URL', os.environ.get('REDIS_URL', ''))
default_backend = 'django.core.cache.backends.redis.RedisCache' if redis_cache_url else 'django.core.cache.backends.locmem.LocMemCache'
default_location = redis_cache_url if redis_cache_url else 'dev-cache'

CACHES = {
    'default': {
        'BACKEND': os.environ.get('DJANGO_CACHE_BACKEND', default_backend),
        'LOCATION': default_location,
        'TIMEOUT': 300,
        'KEY_PREFIX': 'volpehub',
    }
}

# Run asynchronous Celery tasks in-process for development without requiring Redis/workers
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True


