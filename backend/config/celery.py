import os
from celery import Celery

if not os.environ.get('DJANGO_SETTINGS_MODULE'):
    raise RuntimeError('DJANGO_SETTINGS_MODULE must be explicitly set before starting Celery.')
app = Celery('school_erp')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
