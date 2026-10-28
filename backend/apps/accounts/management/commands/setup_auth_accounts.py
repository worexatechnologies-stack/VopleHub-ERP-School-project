from datetime import date
from django.core.management.base import BaseCommand
from apps.accounts.models import User, StudentProfile, ParentProfile
from apps.schools.models import School
from apps.academics.models import AcademicYear, Class, Section, Subject
from apps.staff.models import Teacher
from apps.sis.models import Student
from apps.common.tenancy import with_superadmin_rls_context


class Command(BaseCommand):
    help = 'Idempotently set up and sync all administrative and demo accounts with reliable passwords.'

    @with_superadmin_rls_context
    def handle(self, *args, **options):
        self.stdout.write('Configuring core and demo accounts...')

        # 1. Resolve or create primary school
        school = School.objects.filter(code='river').first() or School.objects.first()
        if not school:
            school = School.objects.create(
                name='River High School',
                code='river',
                subdomain='riverhighschool',
                is_active=True,
            )
            self.stdout.write(self.style.SUCCESS(f'Created primary school: {school.name}'))
        else:
            if not school.is_active:
                school.is_active = True
                school.save(update_fields=['is_active'])
            self.stdout.write(f'Using school: {school.name} (id={school.id}, code={school.code})')

        # Academic structure
        ay = AcademicYear.objects.filter(school=school, is_active=True).first() or AcademicYear.objects.filter(school=school).first()
        if not ay:
            ay = AcademicYear.objects.create(
                school=school, name='2026-27',
                starts_on=date(2026, 4, 1), ends_on=date(2027, 3, 31), is_active=True
            )
        cls, _ = Class.objects.get_or_create(school=school, code='class-10', defaults={'name': 'Class 10'})
        sec, _ = Section.objects.get_or_create(school=school, class_room=cls, name='A')
        subj, _ = Subject.objects.get_or_create(school=school, name='Mathematics')
        cls.subjects.add(subj)

        # 2. Super Admins
        super_admins = [
            ('info.vikasworexatechnologies@gmail.com', 'Worexa@9494', 'Vikas', 'Worexa Technologies'),
            ('platform@volpehub.education', 'Worexa@9494', 'Platform', 'Super Admin'),
        ]
        for email, password, first_name, last_name in super_admins:
            user = User.objects.filter(email__iexact=email).first() or User.objects.filter(username__iexact=email).first()
            if not user:
                user = User.objects.create_superuser(
                    username=email,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                    role=User.Role.SUPER_ADMIN,
                )
                self.stdout.write(self.style.SUCCESS(f'Created Super Admin: {email}'))
            else:
                user.set_password(password)
                user.role = User.Role.SUPER_ADMIN
                user.is_superuser = True
                user.is_staff = True
                user.is_active = True
                user.must_change_password = False
                user.save()
                self.stdout.write(self.style.SUCCESS(f'Updated Super Admin password: {email}'))

        # 3. School Admins
        school_admins = [
            ('admin@volpehub.education', 'Admin@123', 'School', 'Admin'),
            ('sachin@admins.riverhighschool.volpehub.education', 'Admin@123', 'Sachin', 'Admin'),
        ]
        for email, password, first_name, last_name in school_admins:
            user = User.objects.filter(email__iexact=email).first() or User.objects.filter(username__iexact=email).first()
            if not user:
                user = User.objects.create_user(
                    username=email,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                    role=User.Role.SCHOOL_ADMIN,
                    school=school,
                    is_staff=True,
                    is_active=True,
                )
                self.stdout.write(self.style.SUCCESS(f'Created School Admin: {email}'))
            else:
                user.set_password(password)
                user.role = User.Role.SCHOOL_ADMIN
                user.school = school
                user.is_staff = True
                user.is_active = True
                user.must_change_password = False
                user.save()
                self.stdout.write(self.style.SUCCESS(f'Updated School Admin password: {email}'))

        # 4. Teacher
        teacher_email = 'teacher@volpehub.education'
        t_user = User.objects.filter(email__iexact=teacher_email).first() or User.objects.filter(username__iexact=teacher_email).first()
        if not t_user:
            t_user = User.objects.create_user(
                username=teacher_email,
                email=teacher_email,
                password='Teacher@123',
                first_name='Lead',
                last_name='Teacher',
                role=User.Role.TEACHER,
                school=school,
                is_active=True,
            )
            self.stdout.write(self.style.SUCCESS(f'Created Teacher user: {teacher_email}'))
        else:
            t_user.set_password('Teacher@123')
            t_user.role = User.Role.TEACHER
            t_user.school = school
            t_user.is_active = True
            t_user.must_change_password = False
            t_user.save()

        teacher_profile, _ = Teacher.objects.get_or_create(
            school=school,
            user=t_user,
            defaults={
                'subjects': ['Mathematics'],
                'assigned_sections': ['10-A'],
                'joining_date': date(2025, 4, 1),
                'phone': '9888800001',
                'status': 'Active',
            }
        )
        teacher_profile.sections.add(sec)
        teacher_profile.subject_records.add(subj)

        # 5. Student
        student_email = 'student@volpehub.education'
        s_user = User.objects.filter(email__iexact=student_email).first() or User.objects.filter(username__iexact=student_email).first()
        if not s_user:
            s_user = User.objects.create_user(
                username=student_email,
                email=student_email,
                password='Student@123',
                first_name='Rohan',
                last_name='Verma',
                role=User.Role.STUDENT,
                school=school,
                is_active=True,
            )
            self.stdout.write(self.style.SUCCESS(f'Created Student user: {student_email}'))
        else:
            s_user.set_password('Student@123')
            s_user.role = User.Role.STUDENT
            s_user.school = school
            s_user.is_active = True
            s_user.must_change_password = False
            s_user.save()

        student_rec, _ = Student.objects.get_or_create(
            school=school,
            admission_no='RIV-DEMO-01',
            academic_year='2026-27',
            defaults={
                'name': 'Rohan Verma',
                'class_name': 'Class 10',
                'section': 'A',
                'section_record': sec,
                'roll_no': 1,
                'parent_name': 'S. Verma',
                'parent_phone': '9888800002',
                'parent_email': 'parent@volpehub.education',
                'dob': date(2010, 5, 15),
                'gender': 'Male',
                'status': 'Active',
            }
        )
        StudentProfile.objects.get_or_create(user=s_user, defaults={'student': student_rec})

        # 6. Parent
        parent_email = 'parent@volpehub.education'
        p_user = User.objects.filter(email__iexact=parent_email).first() or User.objects.filter(username__iexact=parent_email).first()
        if not p_user:
            p_user = User.objects.create_user(
                username=parent_email,
                email=parent_email,
                password='Parent@123',
                first_name='S.',
                last_name='Verma',
                role=User.Role.PARENT,
                school=school,
                is_active=True,
            )
            self.stdout.write(self.style.SUCCESS(f'Created Parent user: {parent_email}'))
        else:
            p_user.set_password('Parent@123')
            p_user.role = User.Role.PARENT
            p_user.school = school
            p_user.is_active = True
            p_user.must_change_password = False
            p_user.save()

        parent_prof, _ = ParentProfile.objects.get_or_create(
            user=p_user,
            defaults={'phone': '9888800002'}
        )
        parent_prof.students.add(student_rec)

        self.stdout.write(self.style.SUCCESS('Successfully configured all authentication and demo accounts!'))
