from datetime import date

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import ParentProfile, StudentProfile, User
from apps.academics.models import AcademicYear, Class, Section, Subject
from apps.schools.models import School
from apps.sis.models import Student
from apps.staff.models import Teacher


class Command(BaseCommand):
    help = 'Create an idempotent two-school demo dataset for manual tenant and role verification.'

    password = 'DemoPass123!'

    def add_arguments(self, parser):
        parser.add_argument('--allow-production-demo-data', action='store_true', help='Allow demo data creation when DEBUG=False.')
        parser.add_argument('--yes-i-am-sure', action='store_true', help='Required with the production override because fixed-password accounts are created.')

    def _user(self, *, email, role, school=None, first_name='Demo'):
        user, created = User.objects.get_or_create(
            email=email,
            defaults={'username': email, 'role': role, 'school': school, 'first_name': first_name},
        )
        if created:
            user.set_password(self.password)
            user.save(update_fields=['password'])
        return user

    def handle(self, *args, **options):
        if not settings.DEBUG:
            if not options['allow_production_demo_data']:
                raise CommandError('Refusing to create demo accounts while DEBUG=False. Use --allow-production-demo-data --yes-i-am-sure only for an intentional staging/sales environment.')
            if not options['yes_i_am_sure']:
                raise CommandError('Demo account creation in production requires --yes-i-am-sure because it uses a fixed password.')
        for code, name in [('demo-north', 'Demo North School'), ('demo-south', 'Demo South School')]:
            school, created = School.objects.get_or_create(code=code, defaults={'name': name, 'subdomain': code, 'is_demo': True})
            if not created and not school.is_demo:
                school.is_demo = True
                school.save(update_fields=['is_demo'])
            AcademicYear.objects.get_or_create(school=school, name='2026-27', defaults={'starts_on': date(2026, 4, 1), 'ends_on': date(2027, 3, 31), 'is_active': True})
            classroom, _ = Class.objects.get_or_create(school=school, code='class-8', defaults={'name': 'Class 8'})
            section, _ = Section.objects.get_or_create(school=school, class_room=classroom, name='A')
            subject, _ = Subject.objects.get_or_create(school=school, name='Mathematics')
            classroom.subjects.add(subject)

            admin = self._user(email=f'admin@{code}.example.com', role=User.Role.SCHOOL_ADMIN, school=school, first_name='School Admin')
            teacher_user = self._user(email=f'teacher@{code}.example.com', role=User.Role.TEACHER, school=school, first_name='Demo Teacher')
            teacher, _ = Teacher.objects.get_or_create(school=school, user=teacher_user, defaults={'subjects': ['Mathematics'], 'assigned_sections': ['8-A'], 'joining_date': date(2025, 4, 1), 'phone': f'90000{1 if code == "demo-north" else 2}0000'})
            teacher.sections.add(section)
            teacher.subject_records.add(subject)

            for index in (1, 2):
                admission_no = f'{code.upper()}-{index:03d}'
                student, _ = Student.objects.get_or_create(
                    school=school, admission_no=admission_no, academic_year='2026-27',
                    defaults={'name': f'{name} Student {index}', 'class_name': '8', 'section': 'A', 'roll_no': index, 'parent_name': f'Demo Parent {index}', 'parent_phone': f'9100{index}{1 if code == "demo-north" else 2}00000', 'parent_email': f'parent{index}@{code}.example.com', 'dob': date(2012, 1, index), 'gender': 'Female'},
                )
                if student.section_record_id != section.id:
                    student.section_record = section
                    student.class_name = classroom.name
                    student.section = section.name
                    student.save(update_fields=['section_record', 'class_name', 'section'])
                student_user = self._user(email=f'student{index}@{code}.example.com', role=User.Role.STUDENT, school=school, first_name=f'Student {index}')
                StudentProfile.objects.get_or_create(user=student_user, defaults={'student': student})
                parent_user = self._user(email=f'parent{index}@{code}.example.com', role=User.Role.PARENT, school=school, first_name=f'Parent {index}')
                parent, _ = ParentProfile.objects.get_or_create(user=parent_user, defaults={'phone': f'9200{index}{1 if code == "demo-north" else 2}00000'})
                parent.students.add(student)

            self.stdout.write(self.style.SUCCESS(f'Seeded {name}: {admin.email}, {teacher_user.email}, 2 students, and 2 parents.'))
        self.stdout.write(self.style.SUCCESS(f'Demo password for all created accounts: {self.password}'))
