from datetime import timedelta
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parents[2]
env = environ.Env(DJANGO_DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / '.env')
SECRET_KEY = env('DJANGO_SECRET_KEY')
DEBUG = env('DJANGO_DEBUG')
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['*'])
INSTALLED_APPS = ['daphne', 'django.contrib.admin', 'django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions', 'django.contrib.messages', 'django.contrib.staticfiles', 'rest_framework', 'rest_framework_simplejwt.token_blacklist', 'drf_spectacular', 'corsheaders', 'django_filters', 'channels', 'apps.common', 'apps.accounts', 'apps.schools', 'apps.sis', 'apps.academics', 'apps.timetable', 'apps.attendance', 'apps.lms', 'apps.finance', 'apps.exams', 'apps.promotion', 'apps.chat', 'apps.library', 'apps.transport', 'apps.superadmin', 'apps.public_learning', 'apps.staff', 'apps.notifications', 'apps.community', 'apps.store']
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.common.middleware.AuthSessionExpiryMiddleware',
    'apps.common.middleware.PerformanceMonitoringMiddleware',
    'apps.common.middleware.JwtTenantSecurityMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
ROOT_URLCONF = 'config.urls'
TEMPLATES = [{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'DIRS': [], 'APP_DIRS': True, 'OPTIONS': {'context_processors': ['django.template.context_processors.request', 'django.contrib.auth.context_processors.auth', 'django.contrib.messages.context_processors.messages']}}]
WSGI_APPLICATION, ASGI_APPLICATION = 'config.wsgi.application', 'config.asgi.application'
DATABASES = {'default': env.db('DATABASE_URL', default='postgres://volpehub_education:change-me@db:5432/volpehub_education')}
if env('DATABASE_HOST', default=''):
    DATABASES['default']['HOST'] = env('DATABASE_HOST')
if env('DATABASE_PORT', default=''):
    DATABASES['default']['PORT'] = env('DATABASE_PORT')
if 'postgresql' in DATABASES['default'].get('ENGINE', ''):
    # Disable prepared statements in psycopg3 when using transaction-poolers/balancers like PgBouncer
    if env.bool('DB_DISABLE_PREPARE', default=True):
        DATABASES['default'].setdefault('OPTIONS', {})['prepare_threshold'] = None

    if env.bool('DB_ENABLE_CLIENT_POOL', default=False):
        DATABASES['default']['CONN_MAX_AGE'] = 0
        DATABASES['default']['OPTIONS']['pool'] = {
            'min_size': env.int('DB_POOL_MIN_SIZE', default=2),
            'max_size': env.int('DB_POOL_MAX_SIZE', default=20),
            'timeout': env.int('DB_POOL_TIMEOUT', default=30),
        }
    else:
        # With PgBouncer transaction balancer, CONN_MAX_AGE=0 allows PgBouncer to manage the connection pool lifecycle
        DATABASES['default']['CONN_MAX_AGE'] = env.int('DB_CONN_MAX_AGE', default=0)
        DATABASES['default']['CONN_HEALTH_CHECKS'] = True
AUTH_USER_MODEL = 'accounts.User'
EMAIL_BACKEND = env('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = env('EMAIL_HOST', default='')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
EMAIL_USE_SSL = env.bool('EMAIL_USE_SSL', default=False)
EMAIL_TIMEOUT = env.int('EMAIL_TIMEOUT', default=10)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='')
CONTACT_INQUIRY_EMAIL = env('CONTACT_INQUIRY_EMAIL', default='volpehub.megevarman@gmail.com')
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
LANGUAGE_CODE, TIME_ZONE, USE_I18N, USE_TZ = 'en-us', 'Asia/Kolkata', True, True
STATIC_URL, STATIC_ROOT = '/static/', BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Object Storage Configuration (S3 / MinIO)
USE_S3_STORAGE = env.bool('USE_S3_STORAGE', default=False)
AWS_ACCESS_KEY_ID = env('AWS_ACCESS_KEY_ID', default='')
AWS_SECRET_ACCESS_KEY = env('AWS_SECRET_ACCESS_KEY', default='')
AWS_STORAGE_BUCKET_NAME = env('AWS_STORAGE_BUCKET_NAME', default='volpehub-media')
AWS_S3_ENDPOINT_URL = env('AWS_S3_ENDPOINT_URL', default=None)  # e.g. http://minio:9000 for MinIO
AWS_S3_REGION_NAME = env('AWS_S3_REGION_NAME', default='us-east-1')
AWS_S3_FILE_OVERWRITE = False
AWS_DEFAULT_ACL = None
AWS_QUERYSTRING_AUTH = True
AWS_QUERYSTRING_EXPIRE = 3600

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# -----------------------------------------------------------------------------
# Tightened CORS (Cross-Origin Resource Sharing) Configuration
# Strict origin matching with credentials; wildcards strictly disallowed.
# -----------------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True

CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=[
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://volpehub.in',
    'https://www.volpehub.in',
    'https://volpehub.education',
    'https://www.volpehub.education',
    'https://worexa.com',
    'https://www.worexa.com',
])

CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https://([a-zA-Z0-9-]+\.)?volpehub\.in$",
    r"^https://([a-zA-Z0-9-]+\.)?volpehub\.education$",
    r"^https://([a-zA-Z0-9-]+\.)?worexa\.com$",
]

CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]

CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-client-type',
    'x-auth-mode',
    'x-requested-with',
]

CORS_EXPOSE_HEADERS = [
    'content-length',
    'content-type',
    'x-csrftoken',
    'x-client-type',
]

CORS_PREFLIGHT_MAX_AGE = 86400  # 24 hours preflight cache
CORS_URLS_REGEX = r'^/api/.*$'   # Strictly limit CORS exposure to API endpoints only

CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://volpehub.in',
    'https://www.volpehub.in',
    'https://volpehub.education',
    'https://www.volpehub.education',
    'https://worexa.com',
    'https://www.worexa.com',
])
CSRF_TRUSTED_ORIGINS = [
    *CSRF_TRUSTED_ORIGINS,
    'https://*.volpehub.in',
    'https://*.volpehub.education',
    'https://*.worexa.com',
]

RAZORPAY_DUMMY_MODE = env.bool('RAZORPAY_DUMMY_MODE', default=False)
RAZORPAY_KEY_ID = env('RAZORPAY_KEY_ID', default='')
RAZORPAY_KEY_SECRET = env('RAZORPAY_KEY_SECRET', default='')

LOGIN_THROTTLE_RATE = env('LOGIN_THROTTLE_RATE', default='10/min')
CLOUDFLARE_TURNSTILE_SECRET_KEY = env('CLOUDFLARE_TURNSTILE_SECRET_KEY', default='')
DATA_UPLOAD_MAX_MEMORY_SIZE = env.int('DATA_UPLOAD_MAX_MEMORY_SIZE', default=100 * 1024 * 1024)  # 100 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = env.int('FILE_UPLOAD_MAX_MEMORY_SIZE', default=100 * 1024 * 1024)  # 100 MB
DATA_UPLOAD_MAX_NUMBER_FIELDS = env.int('DATA_UPLOAD_MAX_NUMBER_FIELDS', default=1000000)

SESSION_ENGINE = 'django.contrib.sessions.backends.cached_db'
SESSION_IDLE_TIMEOUT_SECONDS = env.int('SESSION_IDLE_TIMEOUT_SECONDS', default=60 * 60)  # 1 hour
SESSION_ABSOLUTE_TIMEOUT_SECONDS = env.int('SESSION_ABSOLUTE_TIMEOUT_SECONDS', default=60 * 60 * 12)  # 12 hours
SESSION_COOKIE_AGE = SESSION_IDLE_TIMEOUT_SECONDS
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_PATH = '/'
SESSION_SAVE_EVERY_REQUEST = False
REFRESH_TOKEN_RETRY_GRACE_SECONDS = env.int('REFRESH_TOKEN_RETRY_GRACE_SECONDS', default=30)

CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_PATH = '/'
CSRF_HEADER_NAME = 'HTTP_X_CSRFTOKEN'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
        'apps.accounts.authentication.CachedJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'NUM_PROXIES': 1,  # Exactly one trusted reverse proxy (Nginx) in front of Django ASGI
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.FormParser',
        'rest_framework.parsers.MultiPartParser',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.ScopedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        # Anonymous APIs use a coarse quota; login/OTP use per-account or
        # per-challenge throttles so NAT users do not consume one another's quota.
        'anon': env('ANON_THROTTLE_RATE', default='1200/minute'),
        'user': env('USER_THROTTLE_RATE', default='1200/minute'),                       # 20 req/s per authenticated user account
        # Retained for non-campus endpoints that explicitly choose this class;
        # do not attach it to login, OTP, or CSRF bootstrap endpoints.
        'login_ip': env('CAMPUS_LOGIN_THROTTLE_RATE', default='1200/minute'),
        'login_account': env('LOGIN_ACCOUNT_THROTTLE_RATE', default='12/minute'),
        'token_refresh': env('TOKEN_REFRESH_THROTTLE_RATE', default='30/minute'),       # Per mobile refresh token
        'mfa_challenge': env('MFA_CHALLENGE_THROTTLE_RATE', default='30/minute'),
        'admin_credential': env('ADMIN_CREDENTIAL_THROTTLE_RATE', default='120/hour'),  # Dedicated quota for school administrators
        'credential_management': env('CREDENTIAL_MGMT_THROTTLE_RATE', default='10/hour'), # Strict self-service password changes for standard users
        'parent_chatbot': '60/hour',
        'fcm_device': '60/hour',
        'bulk_operations': '60/hour',
        'exports': '30/hour',
        'enrollment_apply': '20/hour',
        'contact_inquiry': env('CONTACT_INQUIRY_THROTTLE_RATE', default='10/hour'),
    },
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 25,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
}
SPECTACULAR_SETTINGS = {'TITLE': 'Volpehub Education ERP API', 'VERSION': 'v1'}
MFA_ENABLED = env.bool('MFA_ENABLED', default=True)
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}
# Native mobile refresh tokens last 30 days and are persisted only as SHA-256 digests.
REFRESH_TOKEN_LIFETIME_DAYS = 30
# Secure Password Hashers: Argon2id (primary) + PBKDF2/BCrypt/Scrypt fallbacks.
# Insecure algorithms (MD5, SHA1) are strictly rejected.
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.Argon2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
    'django.contrib.auth.hashers.BCryptSHA256PasswordHasher',
    'django.contrib.auth.hashers.ScryptPasswordHasher',
]
REDIS_CHANNEL_URL = env('REDIS_CHANNEL_URL', default=env('REDIS_URL', default=''))
if REDIS_CHANNEL_URL and not env.bool('USE_INMEMORY_CHANNELS', default=False):
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [REDIS_CHANNEL_URL],
            },
        }
    }
else:
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
CELERY_BROKER_URL = env('REDIS_URL', default='redis://redis:6379/0')
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_TASK_DEFAULT_QUEUE = 'default'
CELERY_TASK_ROUTES = {
    'apps.chat.tasks.*': {'queue': 'high_priority'},
    'apps.notifications.tasks.*': {'queue': 'high_priority'},
    '*.generate_report*': {'queue': 'reports'},
}
FIREBASE_ENABLED = env.bool('FIREBASE_ENABLED', default=True)
# Supply exactly one service-account source in deployment. These are server-only
# values; VITE_ Firebase configuration must never be used by Django.
FIREBASE_SERVICE_ACCOUNT_JSON = env('FIREBASE_SERVICE_ACCOUNT_JSON', default='')
FIREBASE_SERVICE_ACCOUNT_FILE = env('FIREBASE_SERVICE_ACCOUNT_FILE', default=str(BASE_DIR / 'secrets' / 'firebase-service-account.json'))
SECURE_SSL_REDIRECT = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

REDIS_CACHE_URL = env('REDIS_CACHE_URL', default=env('REDIS_URL', default='redis://redis:6379/1'))
CACHES = {
    'default': {
        'BACKEND': env('DJANGO_CACHE_BACKEND', default='django.core.cache.backends.redis.RedisCache'),
        'LOCATION': REDIS_CACHE_URL,
        'TIMEOUT': 300,
        'KEY_PREFIX': 'volpehub',
    }
}

# -----------------------------------------------------------------------------
# Anti-XSS (Cross-Site Scripting) & Browser Content Defense
# -----------------------------------------------------------------------------
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'SAMEORIGIN'
