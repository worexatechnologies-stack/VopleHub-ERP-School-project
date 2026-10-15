from django.apps import AppConfig
from django.db.models.signals import post_migrate


def seed_superadmin(sender, **kwargs):
    import os
    import sys
    if any(cmd in sys.argv for cmd in ('test', 'pytest')):
        return
    email = os.environ.get('BOOTSTRAP_SUPERADMIN_EMAIL', '').strip()
    password = os.environ.get('BOOTSTRAP_SUPERADMIN_PASSWORD', '')
    if email and password:
        try:
            from django.core.management import call_command
            call_command('seed_initial_superadmin', reset_password=True)
        except Exception:
            pass


class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.accounts'

    def ready(self):
        post_migrate.connect(seed_superadmin, sender=self)

