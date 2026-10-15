import os

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User


class Command(BaseCommand):
    help = 'Create the first Super Admin from environment variables.'

    def add_arguments(self, parser):
        parser.add_argument('--reset-password', action='store_true', help='Reset the configured account password if it already exists.')

    def handle(self, *args, **options):
        email = os.environ.get('BOOTSTRAP_SUPERADMIN_EMAIL', '').strip().lower()
        password = os.environ.get('BOOTSTRAP_SUPERADMIN_PASSWORD', '')
        name = os.environ.get('BOOTSTRAP_SUPERADMIN_NAME', 'Initial Super Admin').strip()
        if not email or not password:
            raise CommandError('Set BOOTSTRAP_SUPERADMIN_EMAIL and BOOTSTRAP_SUPERADMIN_PASSWORD in backend/.env.')
        user = User.objects.filter(email=email).first()
        if user:
            if options['reset_password']:
                user.set_password(password)
                user.role = User.Role.SUPER_ADMIN
                user.is_staff = True
                user.is_superuser = True
                user.save(update_fields=['password', 'role', 'is_staff', 'is_superuser'])
                self.stdout.write(self.style.SUCCESS(f'Reset Super Admin password for {email}.'))
                return
            self.stdout.write(self.style.WARNING(f'A user with {email} already exists; nothing was changed.'))
            return
        first_name, _, last_name = name.partition(' ')
        User.objects.create_superuser(
            username=email,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            role=User.Role.SUPER_ADMIN,
        )
        self.stdout.write(self.style.SUCCESS(f'Created initial Super Admin {email}.'))
