import os
from pathlib import Path

_DEV_BASE_DIR = Path(__file__).resolve().parents[2]

import environ
environ.Env.read_env(_DEV_BASE_DIR / '.env')

# Development only: production settings never receive this fallback.
os.environ.setdefault('DJANGO_SECRET_KEY', 'development-only-insecure-key-at-least-32-bytes')
os.environ.setdefault('DATABASE_URL', f'sqlite:///{_DEV_BASE_DIR / "db.sqlite3"}')

from .base import *

# Permit this development machine to serve the API to devices on local network.
ALLOWED_HOSTS = ['*']
CORS_ALLOWED_ORIGINS = [*CORS_ALLOWED_ORIGINS, 'http://192.168.1.4:3000']

DEBUG = True
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

CACHES = {
    'default': {
        'BACKEND': os.environ.get('DJANGO_CACHE_BACKEND', 'django.core.cache.backends.locmem.LocMemCache'),
        'LOCATION': 'dev-cache',
    }
}

# Run asynchronous Celery tasks in-process for development without requiring Redis/workers
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True


