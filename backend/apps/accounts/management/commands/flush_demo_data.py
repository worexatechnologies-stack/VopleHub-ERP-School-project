from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.schools.models import School
from apps.accounts.models import User


class Command(BaseCommand):
    help = 'Permanently delete is_demo=True schools and their school-linked user accounts plus cascaded data.'

    def add_arguments(self, parser):
        parser.add_argument('--yes-i-am-sure', action='store_true', help='Required because demo schools and all related data are permanently deleted.')

    def handle(self, *args, **options):
        if not options['yes_i_am_sure']:
            raise CommandError('Refusing to delete data without --yes-i-am-sure.')
        with transaction.atomic():
            schools = School.objects.select_for_update().filter(is_demo=True)
            names = list(schools.values_list('name', flat=True))
            count = schools.count()
            # User.school is deliberately SET_NULL for normal school lifecycle;
            # demo cleanup explicitly deletes these disposable identities first.
            User.objects.filter(school__in=schools).delete()
            schools.delete()
        self.stdout.write(self.style.SUCCESS(f'Deleted {count} demo school(s): {", ".join(names) if names else "none"}.'))
