from django.core.management import CommandError, call_command
from django.core.cache import cache
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth.password_validation import validate_password
from .credential_generator import create_user_with_credentials, generate_password
from .credential_vault import sync_school_credential_vault
from .human_verification import _valid_turnstile_login_response

from apps.accounts.models import CredentialVaultRecord, ParentProfile, StudentProfile, User
from apps.schools.models import School
from apps.sis.models import Student
from apps.attendance.models import AttendanceRecord
from apps.exams.models import Exam, ExamResult
from apps.notifications.models import Notification
from datetime import date, time
from apps.staff.models import Teacher
from apps.academics.models import Class, Section, Subject
from apps.sis.models import StudentDocument
from django.core.files.uploadedfile import SimpleUploadedFile
from io import BytesIO
from PIL import Image
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from .auth_utils import issue_token_pair


@override_settings(SECURE_SSL_REDIRECT=False)
class SchoolAdminCreateTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='School A', code='school-a-admin-create')
        self.super_admin = User.objects.create_superuser(
            username='super-admin-create', email='super-admin-create@example.com',
            password='StrongPass123!', role=User.Role.SUPER_ADMIN,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.super_admin)

    def test_super_admin_can_create_school_admin_for_existing_school(self):
        response = self.client.post('/api/v1/auth/school-admins/', {
            'name': 'School Administrator', 'email': 'school-admin-create@example.com',
            'password': 'StrongPass123!', 'schoolId': self.school.id, 'status': 'Active',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(school=self.school, role=User.Role.SCHOOL_ADMIN)
        self.assertEqual(user.email, 'school@admins.school-a-admin-create.volpehub.education')
        self.assertTrue(user.must_change_password)
        self.assertNotEqual(user.password, response.data['loginCredentials']['temporaryPassword'])
        self.assertTrue(user.check_password(response.data['loginCredentials']['temporaryPassword']))

    def test_non_super_admin_cannot_create_school_admin(self):
        user = User.objects.create_user(
            username='regular-admin', email='regular-admin@example.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.client.force_authenticate(user)
        response = self.client.post('/api/v1/auth/school-admins/', {
            'name': 'Blocked', 'email': 'blocked@example.com', 'password': 'StrongPass123!', 'schoolId': self.school.id,
        }, format='json')
        self.assertEqual(response.status_code, 403)

    def test_super_admin_cannot_create_school_admin_for_demo_school(self):
        self.school.is_demo = True
        self.school.save(update_fields=['is_demo'])

        response = self.client.post('/api/v1/auth/school-admins/', {
            'name': 'Demo Administrator', 'schoolId': self.school.id, 'status': 'Active',
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('Demo schools cannot receive production', response.data['detail'])

    def test_school_logo_bytes_are_stored_in_the_database(self):
        image = BytesIO()
        # The frontend converts all selected raster images to WebP before
        # multipart upload, including school logos.
        Image.new('RGB', (1, 1), color='indigo').save(image, format='WEBP', quality=86)

        response = self.client.post('/api/v1/schools/', {
            'schoolName': 'Logo School', 'code': 'logo-school',
            'logoFile': SimpleUploadedFile('logo.webp', image.getvalue(), content_type='image/webp'),
        }, format='multipart')

        self.assertEqual(response.status_code, 201)
        school = School.objects.get(pk=response.data['id'])
        self.assertTrue(school.logo_data)
        self.assertEqual(school.logo_content_type, 'image/webp')
        self.assertEqual(response.data['logoImageUrl'], f'/api/v1/schools/{school.id}/logo/')
        image_response = self.client.get(response.data['logoImageUrl'])
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response['Content-Type'], 'image/webp')


@override_settings(SECURE_SSL_REDIRECT=False)
class GeneratedCredentialPersistenceTests(TestCase):
    """Every generated account must be immediately usable without storing a plaintext secret."""

    def setUp(self):
        self.school = School.objects.create(name='Credential School', code='credential-school')
        self.client = APIClient()

    def tearDown(self):
        # ScopedRateThrottle uses the process-local cache; do not let this
        # multi-login verification affect an unrelated test case.
        cache.clear()

    def test_generated_login_ids_and_hashed_passwords_work_for_every_role(self):
        for role in [
            User.Role.SCHOOL_ADMIN,
            User.Role.TEACHER,
            User.Role.STUDENT,
            User.Role.PARENT,
        ]:
            user, credentials = create_user_with_credentials(
                person=f'Credential {role}', role=role, school=self.school,
            )

            # The login ID and the password hash are durable User fields.  The only
            # plaintext value is the in-memory one-time response payload.
            self.assertEqual(User.objects.get(pk=user.pk).email, credentials['login_id'])
            self.assertNotEqual(user.password, credentials['plaintext_password'])
            self.assertNotEqual(user.password.split('$', 1)[0], 'plaintext')
            self.assertTrue(user.check_password(credentials['plaintext_password']))
            self.assertTrue(user.must_change_password)

            cache.clear()
            response = self.client.post('/api/v1/auth/login/', {
                'email': credentials['login_id'],
                'password': credentials['plaintext_password'],
            }, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['user']['email'], credentials['login_id'])


@override_settings(SECURE_SSL_REDIRECT=False)
class TeacherCreationCredentialResponseTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Teacher Credential School', code='teacher-credential-school')
        self.admin = User.objects.create_user(
            username='teacher-credential-admin', email='teacher-credential-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.subject = Subject.objects.create(school=self.school, name='Mathematics')
        classroom = Class.objects.create(school=self.school, name='8', code='class-8')
        classroom.subjects.add(self.subject)
        self.section = Section.objects.create(school=self.school, class_room=classroom, name='A')

    def test_teacher_creation_returns_the_persisted_login_that_can_authenticate(self):
        response = self.client.post('/api/v1/teachers/', {
            'name': 'Ullas Teacher', 'phone': '9000000000', 'subjectIds': [self.subject.id],
            'assignedSectionIds': [self.section.id], 'joiningDate': '2026-07-20', 'qualification': 'B.Ed.',
            'documents': [], 'status': 'Active',
        }, format='json')
        self.assertEqual(response.status_code, 201)

        credentials = response.data['loginCredentials']
        teacher_user = User.objects.get(pk=credentials['userId'])
        self.assertEqual(response.data['email'], credentials['username'])
        self.assertEqual(teacher_user.email, credentials['username'])
        self.assertTrue(teacher_user.check_password(credentials['password']))
        self.assertTrue(teacher_user.must_change_password)

        self.client.force_authenticate(user=None)
        login = self.client.post('/api/v1/auth/login/', {
            'email': credentials['username'], 'password': credentials['password'],
        }, format='json')
        self.assertEqual(login.status_code, 200)

    def test_teacher_photo_bytes_are_stored_in_the_database(self):
        image = BytesIO()
        # The React image optimiser uploads WebP.  Exercise that exact
        # multipart path rather than only relying on a PNG test fixture.
        Image.new('RGB', (1, 1), color='teal').save(image, format='WEBP', quality=86)

        response = self.client.post('/api/v1/teachers/', {
            'name': 'Photo Teacher', 'phone': '9111111111', 'subjectIds': f'[{self.subject.id}]',
            'assignedSectionIds': f'[{self.section.id}]', 'joiningDate': '2026-07-20',
            'photo': SimpleUploadedFile('teacher.webp', image.getvalue(), content_type='image/webp'),
        }, format='multipart')

        self.assertEqual(response.status_code, 201)
        teacher = Teacher.objects.get(pk=response.data['id'])
        self.assertTrue(teacher.photo_data)
        self.assertEqual(teacher.photo_content_type, 'image/webp')
        self.assertEqual(response.data['photoUrl'], f'/api/v1/teachers/{teacher.id}/photo/')
        image_response = self.client.get(response.data['photoUrl'])
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response['Content-Type'], 'image/webp')


class RealSchoolOnboardingFlowTests(TestCase):
    """Exercise the non-demo API onboarding path without any seed command."""

    def setUp(self):
        self.super_admin = User.objects.create_superuser(
            username='super-admin-real-school', email='super-admin-real-school@example.com',
            password='StrongPass123!', role=User.Role.SUPER_ADMIN,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.super_admin)

    def test_api_created_real_school_is_non_demo_and_tenant_scoped(self):
        school_response = self.client.post('/api/v1/schools/', {
            'schoolName': 'Real Onboarding School',
            'code': 'real-onboarding-school',
            'logoIcon': 'School',
            'primaryColor': '#6366f1',
            'secondaryColor': '#10b981',
            'theme': 'glass-academy',
        }, format='json')
        self.assertEqual(school_response.status_code, 201)
        school = School.objects.get(pk=school_response.data['id'])
        self.assertFalse(school.is_demo)
        self.assertFalse(school_response.data['isDemo'])

        admin_response = self.client.post('/api/v1/auth/school-admins/', {
            'name': 'Real School Admin', 'schoolId': school.id, 'status': 'Active',
        }, format='json')
        self.assertEqual(admin_response.status_code, 201)
        school_admin = User.objects.get(pk=admin_response.data['id'])
        self.assertTrue(school_admin.must_change_password)
        self.assertTrue(school_admin.check_password(admin_response.data['loginCredentials']['temporaryPassword']))

        other_school = School.objects.create(name='Other School', code='other-real-school')
        other_admin = User.objects.create_user(
            username='other-school-admin', email='other-school-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=other_school,
        )
        other_student = Student.objects.create(
            school=other_school, admission_no='OTHER-001', name='Other School Student',
            class_name='8', section='A', roll_no=1, parent_name='Other Parent',
            parent_phone='9000000000', parent_email='other-parent@example.com',
            dob=date(2012, 1, 1), gender='Female', academic_year='2026-27',
        )
        school_student = Student.objects.create(
            school=school, admission_no='REAL-001', name='Real School Student',
            class_name='8', section='A', roll_no=1, parent_name='Real Parent',
            parent_phone='9000000001', parent_email='real-parent@example.com',
            dob=date(2012, 1, 1), gender='Female', academic_year='2026-27',
        )

        self.client.force_authenticate(school_admin)
        response = self.client.get(f'/api/v1/students/{other_student.id}/')
        self.assertEqual(response.status_code, 404)

        self.client.force_authenticate(other_admin)
        response = self.client.get(f'/api/v1/students/{school_student.id}/')
        self.assertEqual(response.status_code, 404)


class SchoolPermanentDeleteTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Delete Target School', code='delete-target-school')
        self.other_school = School.objects.create(name='Keep School', code='keep-school')
        self.super_admin = User.objects.create_superuser(
            username='school-delete-super', email='school-delete-super@example.com',
            password='StrongPass123!', role=User.Role.SUPER_ADMIN,
        )
        self.school_admin = User.objects.create_user(
            username='school-delete-admin', email='school-delete-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.teacher_user = User.objects.create_user(
            username='school-delete-teacher', email='school-delete-teacher@example.com',
            password='StrongPass123!', role=User.Role.TEACHER, school=self.school,
        )
        self.teacher = Teacher.objects.create(
            school=self.school, user=self.teacher_user, subjects=['Math'], assigned_sections=['8-A'],
            joining_date=date.today(), phone='9600000001',
        )
        self.student = Student.objects.create(
            school=self.school, admission_no='DELETE-001', name='Delete Student',
            class_name='8', section='A', roll_no=1, parent_name='Delete Parent',
            parent_phone='9600000002', parent_email='delete-parent@example.com',
            dob=date(2012, 1, 1), gender='Female', academic_year='2026-27',
        )
        self.attendance = AttendanceRecord.objects.create(
            school=self.school, student=self.student, date=date.today(), status='Present', marked_by=self.school_admin,
        )
        self.exam = Exam.objects.create(
            school=self.school, name='Delete Exam', class_name='8', section='A', subject='Math',
            date=date.today(), time=time(9), max_marks=100,
        )
        self.result = ExamResult.objects.create(
            school=self.school, exam=self.exam, student=self.student, marks_obtained=90, entered_by=self.school_admin,
        )
        self.notification = Notification.objects.create(
            school=self.school, sender=self.school_admin, recipient=self.school_admin,
            category='Test', title='Delete', body='Delete', channel='test',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.super_admin)

    def test_permanent_delete_requires_exact_code_and_removes_only_target_tenant(self):
        wrong = self.client.delete(f'/api/v1/schools/{self.school.id}/', {'confirmation': 'wrong-code'}, format='json')
        self.assertEqual(wrong.status_code, 400)
        self.assertTrue(School.objects.filter(pk=self.school.pk).exists())

        response = self.client.delete(
            f'/api/v1/schools/{self.school.id}/', {'confirmation': self.school.code}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(School.objects.filter(pk=self.school.pk).exists())
        self.assertFalse(User.objects.filter(pk=self.school_admin.pk).exists())
        self.assertFalse(User.objects.filter(pk=self.teacher_user.pk).exists())
        self.assertFalse(Teacher.objects.filter(pk=self.teacher.pk).exists())
        self.assertFalse(Student.objects.filter(pk=self.student.pk).exists())
        self.assertFalse(AttendanceRecord.objects.filter(pk=self.attendance.pk).exists())
        self.assertFalse(Exam.objects.filter(pk=self.exam.pk).exists())
        self.assertFalse(ExamResult.objects.filter(pk=self.result.pk).exists())
        self.assertFalse(Notification.objects.filter(pk=self.notification.pk).exists())
        self.assertTrue(School.objects.filter(pk=self.other_school.pk).exists())

    def test_only_super_admin_can_permanently_delete_a_school(self):
        self.client.force_authenticate(self.school_admin)
        response = self.client.delete(
            f'/api/v1/schools/{self.school.id}/', {'confirmation': self.school.code}, format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(School.objects.filter(pk=self.school.pk).exists())

    def test_direct_school_delete_triggers_pre_delete_signal_and_removes_admin(self):
        school = School.objects.create(name='Direct Delete', code='direct-del', subdomain='direct-del')
        admin = User.objects.create_user(
            username='direct-del-admin', email='direct-del-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=school,
        )
        school.delete()
        self.assertFalse(User.objects.filter(pk=admin.pk).exists())

    def test_deactivating_school_deactivates_admin_and_blocks_login(self):
        self.assertTrue(self.school.is_active)
        self.assertTrue(self.school_admin.is_active)

        # Super admin deactivates school
        res = self.client.patch(f'/api/v1/schools/{self.school.id}/', {'is_active': False}, format='json')
        self.assertEqual(res.status_code, 200)
        self.school.refresh_from_db()
        self.school_admin.refresh_from_db()
        self.assertFalse(self.school.is_active)
        self.assertFalse(self.school_admin.is_active)

        # Login attempt by deactivated school admin is blocked
        anon_client = APIClient()
        login_res = anon_client.post('/api/v1/auth/login/', {
            'email': self.school_admin.email,
            'password': 'StrongPass123!',
            'role': 'school_admin',
        }, format='json')
        self.assertEqual(login_res.status_code, 403)

        # Super admin reactivates school
        res = self.client.patch(f'/api/v1/schools/{self.school.id}/', {'is_active': True}, format='json')
        self.assertEqual(res.status_code, 200)
        self.school.refresh_from_db()
        self.school_admin.refresh_from_db()
        self.assertTrue(self.school.is_active)
        self.assertTrue(self.school_admin.is_active)

        # Login succeeds after reactivation
        login_res = anon_client.post('/api/v1/auth/login/', {
            'email': self.school_admin.email,
            'password': 'StrongPass123!',
            'role': 'school_admin',
        }, format='json')
        self.assertEqual(login_res.status_code, 200)


class DemoDataCommandTests(TestCase):
    @override_settings(DEBUG=False)
    def test_seed_demo_data_refuses_production_without_explicit_confirmation(self):
        with self.assertRaises(CommandError):
            call_command('seed_demo_data')

    def test_flush_demo_data_removes_only_explicitly_tagged_schools(self):
        demo = School.objects.create(name='Demo', code='demo-flush', subdomain='demo-flush', is_demo=True)
        real = School.objects.create(name='Real', code='real-flush', subdomain='real-flush')

        call_command('flush_demo_data', '--yes-i-am-sure')

        self.assertFalse(School.objects.filter(pk=demo.pk).exists())
        self.assertTrue(School.objects.filter(pk=real.pk).exists())

    def test_flush_demo_data_removes_every_demo_related_record(self):
        school = School.objects.create(name='Full Demo', code='full-demo-flush', subdomain='full-demo-flush', is_demo=True)
        user = User.objects.create_user(username='full-demo-user', email='full-demo-user@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=school)
        student = Student.objects.create(school=school, admission_no='DEMO-001', name='Demo Student', class_name='8', section='A', roll_no=1, parent_name='Parent', parent_phone='9990000000', parent_email='demo-parent@example.com', dob=date(2012, 1, 1), gender='Female', academic_year='2026-27')
        AttendanceRecord.objects.create(school=school, student=student, date=date.today(), status='Present', marked_by=user)
        exam = Exam.objects.create(school=school, name='Demo Exam', class_name='8', section='A', subject='Math', date=date.today(), time=time(9), max_marks=100)
        ExamResult.objects.create(school=school, exam=exam, student=student, marks_obtained=90, entered_by=user)
        Notification.objects.create(school=school, sender=user, recipient=user, category='Demo', title='Demo', body='Demo', channel='demo')

        call_command('flush_demo_data', '--yes-i-am-sure')

        self.assertFalse(School.objects.filter(pk=school.pk).exists())
        self.assertFalse(User.objects.filter(pk=user.pk).exists())
        self.assertFalse(Student.objects.filter(pk=student.pk).exists())
        self.assertFalse(AttendanceRecord.objects.filter(school_id=school.pk).exists())
        self.assertFalse(Exam.objects.filter(school_id=school.pk).exists())
        self.assertFalse(ExamResult.objects.filter(school_id=school.pk).exists())
        self.assertFalse(Notification.objects.filter(school_id=school.pk).exists())


class SchoolWritePermissionTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Protected School', code='protected-school')
        self.client = APIClient()

    def test_non_super_admin_roles_cannot_mutate_schools(self):
        for role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER, User.Role.PARENT, User.Role.STUDENT]:
            with self.subTest(role=role):
                user = User.objects.create_user(
                    username=f'{role}-school-write', email=f'{role}-school-write@example.com',
                    password='StrongPass123!', role=role, school=self.school,
                )
                self.client.force_authenticate(user)
                self.assertEqual(self.client.post('/api/v1/schools/', {'schoolName': 'Blocked', 'code': f'blocked-{role}'}, format='json').status_code, 403)
                self.assertEqual(self.client.patch(f'/api/v1/schools/{self.school.id}/', {'schoolName': 'Blocked'}, format='json').status_code, 403)
                self.assertEqual(self.client.delete(f'/api/v1/schools/{self.school.id}/').status_code, 403)


class TemporaryPasswordPolicyTests(TestCase):
    def test_temporary_password_blocks_all_but_change_password_and_logout(self):
        user = User.objects.create_user(
            username='temporary-password-user', email='temporary-password-user@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, must_change_password=True,
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user).access_token}')

        self.assertEqual(client.get('/api/v1/auth/me/').status_code, 403)
        self.assertIn(client.post('/api/v1/auth/change-password/', {'password': 'NewStrongPass123!'}, format='json').status_code, [200, 204])
        user.refresh_from_db()
        self.assertFalse(user.must_change_password)


@override_settings(SECURE_SSL_REDIRECT=False)
class CredentialVaultSyncSafetyTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Vault Safety School', code='vault-safety-school')

    def test_sync_does_not_reset_existing_student_teacher_or_parent_passwords(self):
        student_user = User.objects.create_user(
            username='vault-student@example.com', email='vault-student@example.com',
            password='StudentPermanent123!', role=User.Role.STUDENT, school=self.school,
        )
        student = Student.objects.create(
            school=self.school, admission_no='VS-001', name='Vault Student',
            class_name='5', section='A', roll_no=1, parent_name='Vault Parent',
            parent_phone='9000000000', parent_email='vault-parent@example.com',
            dob=date(2015, 1, 1), gender='Other', academic_year='2026-2027',
        )
        StudentProfile.objects.create(user=student_user, student=student)

        teacher_user = User.objects.create_user(
            username='vault-teacher@example.com', email='vault-teacher@example.com',
            password='TeacherPermanent123!', role=User.Role.TEACHER, school=self.school,
        )
        Teacher.objects.create(
            school=self.school, user=teacher_user,
            joining_date=date(2026, 1, 1), phone='9111111111',
        )

        parent_user = User.objects.create_user(
            username='vault-parent@example.com', email='vault-parent@example.com',
            password='ParentPermanent123!', role=User.Role.PARENT, school=self.school,
        )
        parent = ParentProfile.objects.create(user=parent_user, phone='9000000000')
        parent.students.add(student)

        result = sync_school_credential_vault(self.school)

        self.assertEqual(result, {'synced': 3, 'students': 1, 'teachers': 1, 'parents': 1})
        for user, password in (
            (student_user, 'StudentPermanent123!'),
            (teacher_user, 'TeacherPermanent123!'),
            (parent_user, 'ParentPermanent123!'),
        ):
            user.refresh_from_db()
            self.assertTrue(user.check_password(password))
            self.assertFalse(user.must_change_password)
            vault_record = CredentialVaultRecord.objects.get(user=user)
            self.assertEqual(vault_record.plaintext_password, '[User Managed]')
            self.assertFalse(vault_record.must_change_password)

        second_result = sync_school_credential_vault(self.school)
        self.assertEqual(second_result['synced'], 0)
        for user, password in (
            (student_user, 'StudentPermanent123!'),
            (teacher_user, 'TeacherPermanent123!'),
            (parent_user, 'ParentPermanent123!'),
        ):
            user.refresh_from_db()
            self.assertTrue(user.check_password(password))

    def test_super_admin_vault_never_invents_an_admin_password(self):
        admin_with_legacy_record = User.objects.create_user(
            username='vault-admin-legacy@example.com', email='vault-admin-legacy@example.com',
            password='AdminPermanent123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        CredentialVaultRecord.objects.create(
            school=self.school, user=admin_with_legacy_record,
            role=CredentialVaultRecord.Role.ADMIN, name='Legacy Admin',
            login_id=admin_with_legacy_record.email, plaintext_password='Admin@123',
            source='admin_roster', must_change_password=False,
        )
        admin_without_record = User.objects.create_user(
            username='vault-admin-new@example.com', email='vault-admin-new@example.com',
            password='OtherAdminPermanent123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        super_admin = User.objects.create_superuser(
            username='vault-super-admin', email='vault-super-admin@example.com',
            password='SuperAdminPermanent123!', role=User.Role.SUPER_ADMIN,
        )
        client = APIClient()
        client.force_authenticate(super_admin)

        response = client.get('/api/v1/credential-vault/')

        self.assertEqual(response.status_code, 200)
        for admin in (admin_with_legacy_record, admin_without_record):
            record = CredentialVaultRecord.objects.get(user=admin)
            self.assertEqual(record.plaintext_password, '[User Managed]')
            self.assertNotEqual(record.plaintext_password, 'Admin@123')
            admin.refresh_from_db()
            self.assertTrue(admin.check_password(
                'AdminPermanent123!' if admin.pk == admin_with_legacy_record.pk else 'OtherAdminPermanent123!'
            ))
        self.assertTrue(all(item['password'] == '[User Managed]' for item in response.data))

class TemporaryPasswordMiddlewareTests(TestCase):
    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_school_admin_password_change_clears_vault_temporary_marker(self):
        school = School.objects.create(name='Password Change School', code='password-change-school')
        user = User.objects.create_user(
            username='password-change-admin', email='password-change-admin@example.com',
            password='TemporaryPass123!', role=User.Role.SCHOOL_ADMIN,
            school=school, must_change_password=True,
        )
        record = CredentialVaultRecord.objects.create(
            school=school, user=user, role=CredentialVaultRecord.Role.ADMIN,
            name='Password Change Admin', login_id=user.email,
            plaintext_password='TemporaryPass123!', source='admin_creation',
            must_change_password=True,
        )
        client = APIClient()
        client.force_authenticate(user)

        response = client.post(
            '/api/v1/auth/change-password/',
            {'password': 'PermanentPassword123!'}, format='json',
        )

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        record.refresh_from_db()
        self.assertFalse(user.must_change_password)
        self.assertFalse(record.must_change_password)
        self.assertEqual(record.plaintext_password, '[User Managed]')
        self.assertEqual(record.source, 'user_password_change')

        from apps.accounts.views import _enforce_vault_temp_password
        _enforce_vault_temp_password(user)
        user.refresh_from_db()
        self.assertFalse(user.must_change_password)

    def test_users_without_vault_are_not_reprompted_after_first_login(self):
        from django.utils import timezone
        from apps.accounts.views import _enforce_vault_temp_password

        for role in [User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT]:
            user = User.objects.create_user(
                username=f'no-vault-{role}', email=f'no-vault-{role}@example.com',
                password='PermanentPassword123!', role=role,
                must_change_password=False, last_login=timezone.now(),
            )
            _enforce_vault_temp_password(user)
            user.refresh_from_db()
            self.assertFalse(user.must_change_password, role)


class TurnstileLoginResponseTests(TestCase):
    def test_turnstile_requires_success_login_action_and_matching_host(self):
        request = RequestFactory().post('/api/v1/auth/login/', HTTP_HOST='volpehub.in')
        valid = {'success': True, 'action': 'login', 'hostname': 'volpehub.in'}

        self.assertTrue(_valid_turnstile_login_response(valid, request))
        self.assertFalse(_valid_turnstile_login_response({**valid, 'action': 'signup'}, request))
        self.assertFalse(_valid_turnstile_login_response({**valid, 'hostname': 'attacker.example'}, request))
        self.assertFalse(_valid_turnstile_login_response({**valid, 'success': False}, request))


@override_settings(SECURE_SSL_REDIRECT=False)
class LogoutTests(TestCase):
    def test_logout_revokes_the_opaque_refresh_token(self):
        user = User.objects.create_user(
            username='logout-user', email='logout@example.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN,
        )
        tokens = issue_token_pair(user, type('Request', (), {'META': {}})())
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        response = client.post('/api/v1/auth/logout/', {'refresh': tokens['refresh']}, format='json')

        self.assertEqual(response.status_code, 204)
        tokens['record'].refresh_from_db()
        self.assertIsNotNone(tokens['record'].revoked_at)
        client.credentials()
        self.assertEqual(
            client.post('/api/v1/auth/refresh/', {'refresh': tokens['refresh']}, format='json').status_code,
            401,
        )

    @override_settings(REFRESH_COOKIE_PATH='/custom/api/auth/')
    def test_logout_expires_refresh_cookie_at_its_configured_path(self):
        user = User.objects.create_user(
            username='logout-cookie-user', email='logout-cookie@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN,
        )
        client = APIClient()
        client.force_authenticate(user)
        client.cookies['refresh_token_cookie'] = 'opaque-refresh-token'
        client.cookies['access_token_cookie'] = 'access-token'

        response = client.post('/api/v1/auth/logout/', {}, format='json')

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.cookies['refresh_token_cookie']['path'], '/custom/api/auth/')
        self.assertEqual(int(response.cookies['refresh_token_cookie']['max-age']), 0)
        self.assertEqual(response.cookies['access_token_cookie']['path'], '/')


class SuperAdminOperationalAccessTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Boundary School', code='boundary-school')
        self.other = School.objects.create(name='Other Boundary School', code='other-boundary-school')
        self.super_admin = User.objects.create_superuser(username='boundary-super', email='boundary-super@example.com', password='StrongPass123!', role=User.Role.SUPER_ADMIN)
        self.admin = User.objects.create_user(username='boundary-admin', email='boundary-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.teacher = User.objects.create_user(username='boundary-teacher', email='boundary-teacher@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school)
        self.parent = User.objects.create_user(username='boundary-parent', email='boundary-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=self.school)
        self.student_user = User.objects.create_user(username='boundary-student', email='boundary-student@example.com', password='StrongPass123!', role=User.Role.STUDENT, school=self.school)
        self.student = Student.objects.create(school=self.school, admission_no='BOUND-1', name='Boundary Student', class_name='8', section='A', roll_no=1, parent_name='Parent', parent_phone='9710000000', parent_email='parent@example.com', dob=date(2012,1,1), gender='Female', academic_year='2026-27')
        StudentProfile.objects.create(user=self.student_user, student=self.student)
        ParentProfile.objects.create(user=self.parent, phone='9710000001').students.add(self.student)
        self.document = StudentDocument.objects.create(student=self.student, name='document.png', file_data=b'png', file_content_type='image/png', file_name='document.png', file_type='PNG')
        Teacher.objects.create(school=self.school, user=self.teacher, subjects=['Math'], assigned_sections=['8-A'], joining_date=date.today(), phone='9710000002')
        self.client = APIClient(); self.client.force_authenticate(self.super_admin)

    def test_super_admin_student_read_allowed_and_write_denied(self):
        self.assertEqual(self.client.get('/api/v1/students/').status_code, 200); self.assertEqual(self.client.post('/api/v1/students/', {}, format='json').status_code, 403)
    def test_super_admin_teacher_read_and_write_denied(self):
        self.assertEqual(self.client.get('/api/v1/teachers/').status_code, 403); self.assertEqual(self.client.post('/api/v1/teachers/', {}, format='json').status_code, 403)
    def test_super_admin_attendance_read_and_write_denied(self):
        self.assertEqual(self.client.get('/api/v1/attendance/').status_code, 403); self.assertEqual(self.client.put('/api/v1/attendance/mark/', {}, format='json').status_code, 403)
    def test_super_admin_exam_read_and_write_denied(self):
        self.assertEqual(self.client.get('/api/v1/exams/').status_code, 403); self.assertEqual(self.client.post('/api/v1/exams/', {}, format='json').status_code, 403)
    def test_super_admin_academic_read_and_write_denied(self):
        for endpoint in ['academic-years', 'classes', 'sections']:
            self.assertEqual(self.client.get(f'/api/v1/{endpoint}/').status_code, 403); self.assertEqual(self.client.post(f'/api/v1/{endpoint}/', {}, format='json').status_code, 403)
    def test_super_admin_document_download_denied(self):
        self.assertEqual(self.client.get(f'/api/v1/students/{self.student.id}/documents/{self.document.id}/').status_code, 403)
    def test_super_admin_can_reset_school_admin_only(self):
        response = self.client.post(f'/api/v1/auth/users/{self.admin.id}/reset-credentials/'); self.assertEqual(response.status_code, 200)
    def test_super_admin_cannot_reset_operational_roles(self):
        for user in [self.teacher, self.parent, self.student_user]: self.assertEqual(self.client.post(f'/api/v1/auth/users/{user.id}/reset-credentials/').status_code, 403)
    def test_school_admin_can_reset_own_school_operational_roles(self):
        self.client.force_authenticate(self.admin)
        for user in [self.teacher, self.parent, self.student_user]: self.assertEqual(self.client.post(f'/api/v1/auth/users/{user.id}/reset-credentials/').status_code, 200)
    def test_school_admin_cannot_reset_admin_super_or_cross_school(self):
        foreign = User.objects.create_user(username='foreign-teacher', email='foreign-teacher@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.other)
        self.client.force_authenticate(self.admin)
        for user in [self.admin, self.super_admin, foreign]: self.assertEqual(self.client.post(f'/api/v1/auth/users/{user.id}/reset-credentials/').status_code, 403)


class AccountDirectoryAndPasswordValidationTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Directory School', code='directory-school')
        self.other = School.objects.create(name='Other Directory School', code='other-directory-school')
        self.super_admin = User.objects.create_superuser(username='directory-super', email='directory-super@example.com', password='StrongPass123!', role=User.Role.SUPER_ADMIN)
        self.admin = User.objects.create_user(username='directory-admin', email='directory-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.own_teacher = User.objects.create_user(username='directory-teacher', email='directory-teacher@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school)
        self.own_parent = User.objects.create_user(username='directory-parent', email='directory-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=self.school)
        User.objects.create_user(username='directory-foreign', email='directory-foreign@example.com', password='StrongPass123!', role=User.Role.STUDENT, school=self.other)
        self.client = APIClient()

    def test_account_directory_is_role_scoped(self):
        self.client.force_authenticate(self.super_admin)
        self.assertEqual({item['role'] for item in self.client.get('/api/v1/auth/users/').data}, {'school_admin'})
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/v1/auth/users/')
        self.assertEqual({item['role'] for item in response.data}, {'teacher', 'parent'})
        self.assertEqual({item['email'] for item in response.data}, {self.own_teacher.email, self.own_parent.email})

    def test_change_password_enforces_validators(self):
        self.client.force_authenticate(self.admin)
        for password in ['short', '1234567890', 'password123']:
            response = self.client.post('/api/v1/auth/change-password/', {'password': password}, format='json')
            self.assertEqual(response.status_code, 400); self.assertEqual(response.data['errors'][0]['field'], 'password')
        self.assertIn(self.client.post('/api/v1/auth/change-password/', {'password': 'StrongUniquePass!2026'}, format='json').status_code, [200, 204])

    def test_generated_passwords_pass_configured_validators(self):
        for _ in range(100):
            validate_password(generate_password('Li', User.Role.PARENT))


class SchoolAdminLifecycleTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Lifecycle School', code='lifecycle-school')
        self.super_admin = User.objects.create_superuser(username='lifecycle-super', email='lifecycle-super@example.com', password='StrongPass123!', role=User.Role.SUPER_ADMIN)
        self.admin = User.objects.create_user(username='lifecycle-admin', email='lifecycle-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.teacher = User.objects.create_user(username='lifecycle-teacher', email='lifecycle-teacher@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school)
        self.student = Student.objects.create(school=self.school, admission_no='LIFE-001', name='Lifecycle Student', class_name='8', section='A', roll_no=1, parent_name='Parent', parent_phone='9700000000', parent_email='life-parent@example.com', dob=date(2012, 1, 1), gender='Female', academic_year='2026-27')
        Teacher.objects.create(school=self.school, user=self.teacher, subjects=['Math'], assigned_sections=['8-A'], joining_date=date.today(), phone='9700000001')
        AttendanceRecord.objects.create(school=self.school, student=self.student, date=date.today(), status='Present', marked_by=self.admin)
        exam = Exam.objects.create(school=self.school, name='Lifecycle Exam', class_name='8', section='A', subject='Math', date=date.today(), time=time(9), max_marks=100)
        ExamResult.objects.create(school=self.school, exam=exam, student=self.student, marks_obtained=80, entered_by=self.admin)
        self.client = APIClient()

    def deactivate(self):
        self.client.force_authenticate(self.super_admin)
        return self.client.post(f'/api/v1/auth/school-admins/{self.admin.id}/deactivate/')

    def test_deactivate_requires_super_admin_and_target_must_be_school_admin(self):
        for role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER, User.Role.PARENT, User.Role.STUDENT]:
            user = self.admin if role == User.Role.SCHOOL_ADMIN else User.objects.create_user(username=f'lifecycle-requester-{role}', email=f'lifecycle-requester-{role}@example.com', password='StrongPass123!', role=role, school=self.school)
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post(f'/api/v1/auth/school-admins/{self.admin.id}/deactivate/').status_code, 403)
        self.client.force_authenticate(self.super_admin)
        self.assertEqual(self.client.post(f'/api/v1/auth/school-admins/{self.teacher.id}/deactivate/').status_code, 404)

    def test_deactivate_blocks_login_and_existing_token_without_touching_school_data(self):
        refresh = RefreshToken.for_user(self.admin)
        response = self.deactivate()
        self.assertEqual(response.status_code, 200)
        self.admin.refresh_from_db()
        self.assertFalse(self.admin.is_active)
        self.assertTrue(BlacklistedToken.objects.filter(token__user=self.admin).exists())
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post('/api/v1/auth/login/', {'email': self.admin.email, 'password': 'StrongPass123!'}, format='json').status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        self.assertEqual(self.client.get('/api/v1/auth/me/').status_code, 401)
        self.assertEqual(Student.objects.filter(school=self.school).count(), 1)
        self.assertEqual(Teacher.objects.filter(school=self.school).count(), 1)
        self.assertEqual(AttendanceRecord.objects.filter(school=self.school).count(), 1)
        self.assertEqual(ExamResult.objects.filter(school=self.school).count(), 1)

    def test_reactivate_restores_login(self):
        self.deactivate()
        self.client.force_authenticate(self.super_admin)
        self.assertEqual(self.client.post(f'/api/v1/auth/school-admins/{self.admin.id}/reactivate/').status_code, 200)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post('/api/v1/auth/login/', {'email': self.admin.email, 'password': 'StrongPass123!'}, format='json').status_code, 200)

    def test_super_admin_password_override_is_persisted_and_forces_a_change(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(
            self.client.post(
                f'/api/v1/auth/school-admins/{self.admin.id}/set-password/',
                {'password': 'ValidOverridePass9!'}, format='json',
            ).status_code,
            403,
        )

        self.client.force_authenticate(self.super_admin)
        self.assertEqual(
            self.client.post(
                f'/api/v1/auth/school-admins/{self.teacher.id}/set-password/',
                {'password': 'ValidOverridePass9!'}, format='json',
            ).status_code,
            404,
        )
        response = self.client.post(
            f'/api/v1/auth/school-admins/{self.admin.id}/set-password/',
            {'password': 'ValidOverridePass9!'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.check_password('ValidOverridePass9!'))
        self.assertTrue(self.admin.must_change_password)

        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.post(
                '/api/v1/auth/login/',
                {'email': self.admin.email, 'password': 'ValidOverridePass9!'}, format='json',
            ).status_code,
            200,
        )


class SchoolAdminDeleteTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Reset School', code='reset-school')
        self.super_admin = User.objects.create_superuser(username='reset-root', email='reset-root@example.com', password='StrongPass123!', role=User.Role.SUPER_ADMIN)
        self.school_admin = User.objects.create_user(username='reset-school-admin', email='reset-school-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.student = Student.objects.create(school=self.school, admission_no='RESET-001', name='Reset Student', class_name='8', section='A', roll_no=1, parent_name='Parent', parent_phone='9500000000', parent_email='reset-parent@example.com', dob=date(2012, 1, 1), gender='Female', academic_year='2026-27')
        self.client = APIClient()

    def test_only_super_admin_with_exact_email_can_delete_only_selected_admin(self):
        self.client.force_authenticate(self.school_admin)
        self.assertEqual(self.client.post(f'/api/v1/auth/school-admins/{self.school_admin.id}/delete/', {'confirmation': self.school_admin.email}, format='json').status_code, 403)
        self.client.force_authenticate(self.super_admin)
        self.assertEqual(self.client.post(f'/api/v1/auth/school-admins/{self.school_admin.id}/delete/', {'confirmation': 'wrong'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/v1/auth/school-admins/{self.school_admin.id}/delete/', {'confirmation': self.school_admin.email}, format='json').status_code, 200)
        self.assertFalse(User.objects.filter(pk=self.school_admin.pk).exists())
        self.assertTrue(School.objects.filter(pk=self.school.pk).exists())
        self.assertTrue(Student.objects.filter(pk=self.student.pk).exists())
        self.assertEqual(User.objects.count(), 1)
        self.assertTrue(User.objects.filter(pk=self.super_admin.pk, role=User.Role.SUPER_ADMIN).exists())

    def test_login_with_matching_role_succeeds(self):
        self.client.force_authenticate(user=None)
        response = self.client.post('/api/v1/auth/login/', {
            'email': self.school_admin.email,
            'password': 'StrongPass123!',
            'role': 'school_admin',
        }, format='json')
        self.assertEqual(response.status_code, 200)

    def test_login_with_mismatched_role_fails_with_helpful_message(self):
        self.client.force_authenticate(user=None)
        response = self.client.post('/api/v1/auth/login/', {
            'email': self.school_admin.email,
            'password': 'StrongPass123!',
            'role': 'teacher',
        }, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertIn('These credentials belong to a Admin account', response.data['detail'])

