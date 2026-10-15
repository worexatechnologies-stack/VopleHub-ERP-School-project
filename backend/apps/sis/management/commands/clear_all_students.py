from django.core.management.base import BaseCommand
from apps.sis.models import Student, StudentDocument, EnrollmentApplication
from apps.accounts.models import User, StudentProfile, ParentProfile


class Command(BaseCommand):
    help = 'Safely wipe all student records, student user accounts, and links.'

    def handle(self, *args, **options):
        self.stdout.write('Deleting all student users and profiles...')
        u_count, _ = User.objects.filter(role=User.Role.STUDENT).delete()
        self.stdout.write(f'Deleted {u_count} student user accounts.')

        sp_count, _ = StudentProfile.objects.all().delete()
        self.stdout.write(f'Deleted {sp_count} student profiles.')

        for p in ParentProfile.objects.all():
            p.students.clear()

        s_count, _ = Student.objects.all().delete()
        self.stdout.write(f'Deleted {s_count} student and cascading records.')

        ea_count, _ = EnrollmentApplication.objects.all().delete()
        self.stdout.write(f'Deleted {ea_count} enrollment applications.')

        self.stdout.write(self.style.SUCCESS(
            f'Complete: 0 students remain. (Database student count: {Student.objects.count()})'
        ))
