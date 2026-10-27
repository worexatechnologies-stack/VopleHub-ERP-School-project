from unittest.mock import patch
from io import BytesIO

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import ParentProfile, StudentProfile, User
from apps.accounts.serializers import UserCreateSerializer
from apps.schools.models import School
from apps.sis.models import Student, StudentDocument
from apps.common.validators import validate_school_logo, validate_student_document
from apps.academics.models import AcademicYear, Class, Section
from apps.staff.models import Teacher


@override_settings(SECURE_SSL_REDIRECT=False)
class StudentAdmissionLoginProvisioningTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Volpehub School', code='volpehub')
        self.admin = User.objects.create_user(
            username='school-admin',
            email='admin@example.com',
            password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN,
            school=self.school,
        )
        self.teacher = User.objects.create_user(
            username='teacher',
            email='teacher@example.com',
            password='StrongPass123!',
            role=User.Role.TEACHER,
            school=self.school,
        )
        AcademicYear.objects.create(
            school=self.school, name='2026-27', starts_on='2026-04-01',
            ends_on='2027-03-31', is_active=True,
        )
        AcademicYear.objects.create(
            school=self.school, name='2027-28', starts_on='2027-04-01',
            ends_on='2028-03-31', is_active=False,
        )
        classroom = Class.objects.create(school=self.school, name='8', code='class-8')
        self.section = Section.objects.create(school=self.school, class_room=classroom, name='A')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def payload(self, admission_no='ADM001', parent_phone='9999999999', parent_email='parent@example.com', section_id=None):
        return {
            'admissionNo': admission_no,
            'name': f'Student {admission_no}',
            'class_': '8',
            'section': 'A',
            'sectionId': section_id or self.section.id,
            'rollNo': 1,
            'parentName': 'Parent One',
            'parentPhone': parent_phone,
            'parentEmail': parent_email,
            'dob': '2012-01-01',
            'gender': 'Female',
            'address': 'Main Road',
            'medical_conditions': '',
            'status': Student.Status.ACTIVE,
            'academicYear': '2026-27',
        }

    def admit(self, **kwargs):
        return self.client.post('/api/v1/students/', self.payload(**kwargs), format='json')

    def test_school_admin_admission_creates_student_parent_and_student_logins_once(self):
        response = self.admit()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Student.objects.count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.STUDENT).count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.PARENT).count(), 1)
        self.assertEqual(StudentProfile.objects.count(), 1)
        self.assertEqual(ParentProfile.objects.count(), 1)

        student = Student.objects.get()
        self.assertEqual(student.login_profile.user.role, User.Role.STUDENT)
        self.assertTrue(student.login_profile.user.must_change_password)
        self.assertTrue(student.parent_profiles.get().user.must_change_password)
        self.assertEqual(student.parent_profiles.get().students.count(), 1)

        credentials = response.data['loginCredentials']
        self.assertIn('temporaryPassword', credentials['student'])
        self.assertIn('temporaryPassword', credentials['parent'])
        self.assertTrue(credentials['parent']['created'])

    def test_admission_rejects_an_academic_year_not_created_by_the_admin(self):
        payload = self.payload(admission_no='BAD-YEAR')
        payload['academicYear'] = 'Unconfigured year'
        response = self.client.post('/api/v1/students/', payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('academicYear', response.data)

    def test_student_photo_bytes_are_stored_in_the_database(self):
        image = BytesIO()
        Image.new('RGB', (1, 1), color='navy').save(image, format='WEBP', quality=86)
        payload = self.payload(admission_no='PHOTO-001')
        payload['photo'] = SimpleUploadedFile('portrait.webp', image.getvalue(), content_type='image/webp')

        response = self.client.post('/api/v1/students/', payload, format='multipart')

        self.assertEqual(response.status_code, 201)
        student = Student.objects.get(pk=response.data['id'])
        self.assertTrue(student.photo_data)
        self.assertEqual(student.photo_content_type, 'image/webp')
        self.assertEqual(response.data['photoUrl'], f'/api/v1/students/{student.id}/photo/')
        image_response = self.client.get(response.data['photoUrl'])
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response['Content-Type'], 'image/webp')

    def test_account_directory_returns_exact_linked_login_ids(self):
        admission = self.admit(admission_no='ADM-DIRECTORY')
        self.assertEqual(admission.status_code, 201)
        student = Student.objects.get(admission_no='ADM-DIRECTORY')

        directory = self.client.get('/api/v1/auth/users/')
        self.assertEqual(directory.status_code, 200)
        student_account = next(item for item in directory.data if item['role'] == User.Role.STUDENT)
        parent_account = next(item for item in directory.data if item['role'] == User.Role.PARENT)
        self.assertEqual(student_account['studentId'], str(student.id))
        self.assertIn(str(student.id), parent_account['parentStudentIds'])

    def test_second_child_reuses_existing_parent_login(self):
        first = self.admit(admission_no='ADM001')
        second = self.admit(admission_no='ADM002')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(Student.objects.count(), 2)
        self.assertEqual(User.objects.filter(role=User.Role.STUDENT).count(), 2)
        self.assertEqual(User.objects.filter(role=User.Role.PARENT).count(), 1)
        self.assertEqual(ParentProfile.objects.get().students.count(), 2)
        self.assertFalse(second.data['loginCredentials']['parent']['created'])

    def test_matching_parent_phone_at_another_school_is_never_linked(self):
        other_school = School.objects.create(name='Other School', code='other-school')
        other_admin = User.objects.create_user(
            username='other-school-admin',
            email='other-admin@example.com',
            password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN,
            school=other_school,
        )
        other_client = APIClient()
        other_client.force_authenticate(other_admin)
        AcademicYear.objects.create(
            school=other_school, name='2026-27', starts_on='2026-04-01',
            ends_on='2027-03-31', is_active=True,
        )
        other_classroom = Class.objects.create(school=other_school, name='8', code='class-8')
        other_section = Section.objects.create(school=other_school, class_room=other_classroom, name='A')

        first = self.admit(admission_no='ADM-LOCAL', parent_phone='9111111111')
        self.assertEqual(first.status_code, 201)

        payload = self.payload(admission_no='ADM-OTHER', parent_phone='9111111111', section_id=other_section.id)
        second = other_client.post('/api/v1/students/', payload, format='json')

        self.assertEqual(second.status_code, 201)
        self.assertTrue(second.data['loginCredentials']['parent']['created'])
        self.assertEqual(ParentProfile.objects.filter(phone='9111111111').count(), 2)
        other_student = Student.objects.get(admission_no='ADM-OTHER')
        self.assertEqual(other_student.school, other_school)
        self.assertEqual(other_student.parent_profiles.get().user.school, other_school)

    def test_duplicate_ui_admission_number_is_advanced_to_the_next_available_number(self):
        self.assertEqual(self.admit(admission_no='ADM-2026-001').status_code, 201)

        response = self.admit(admission_no='ADM-2026-001', parent_phone='9888888888', parent_email='another-parent@example.com')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['admissionNo'], 'ADM-2026-002')
        self.assertTrue(response.data['admissionNumberAdjusted'])

    def test_direct_user_create_serializer_rejects_student_and_parent_roles(self):
        for role in [User.Role.STUDENT, User.Role.PARENT]:
            serializer = UserCreateSerializer(data={
                'email': f'{role}@example.com',
                'username': role,
                'role': role,
                'school': self.school.id,
            })
            self.assertFalse(serializer.is_valid())
            self.assertIn('role', serializer.errors)

    def test_non_school_admin_cannot_admit_student(self):
        self.client.force_authenticate(self.teacher)

        response = self.admit()

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Student.objects.count(), 0)
        self.assertEqual(User.objects.filter(role=User.Role.STUDENT).count(), 0)
        self.assertEqual(User.objects.filter(role=User.Role.PARENT).count(), 0)

    def test_admission_creates_separate_parent_login_when_contact_email_belongs_to_another_role(self):
        User.objects.create_user(
            username='existing-teacher-email', email='teacher-email@example.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=self.school,
        )

        response = self.admit(parent_email='teacher-email@example.com')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Student.objects.count(), 1)
        credentials = response.data['loginCredentials']['parent']
        self.assertTrue(credentials['created'])
        self.assertEqual(credentials['email'], 'parent@parents.volpehub.volpehub.education')
        self.assertTrue(User.objects.filter(email='teacher-email@example.com', role=User.Role.TEACHER).exists())
        self.assertTrue(User.objects.filter(email=credentials['email'], role=User.Role.PARENT).exists())

    def test_transaction_rolls_back_if_parent_creation_fails(self):
        self.client.raise_request_exception = False

        with patch('apps.sis.views.create_or_link_parent_login', side_effect=RuntimeError('forced parent failure')):
            response = self.admit()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(Student.objects.count(), 0)
        self.assertEqual(User.objects.filter(role=User.Role.STUDENT).count(), 0)
        self.assertEqual(User.objects.filter(role=User.Role.PARENT).count(), 0)
        self.assertEqual(StudentProfile.objects.count(), 0)
        self.assertEqual(ParentProfile.objects.count(), 0)

    def test_student_update_or_promotion_does_not_duplicate_logins(self):
        created = self.admit()
        student_id = created.data['id']

        response = self.client.patch(f'/api/v1/students/{student_id}/', {
            'class_': '9',
            'academicYear': '2027-28',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Student.objects.count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.STUDENT).count(), 1)
        self.assertEqual(User.objects.filter(role=User.Role.PARENT).count(), 1)

    def test_delete_removes_student_login_and_only_orphaned_parent_login(self):
        first = self.admit(admission_no='ADM001')
        second = self.admit(admission_no='ADM002')
        first_student = Student.objects.get(pk=first.data['id'])
        first_student_user_id = first_student.login_profile.user_id
        parent_user_id = first_student.parent_profiles.get().user_id

        response = self.client.delete(f'/api/v1/students/{first_student.id}/')

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Student.objects.filter(pk=first_student.id).exists())
        self.assertFalse(User.objects.filter(pk=first_student_user_id).exists())
        self.assertTrue(User.objects.filter(pk=parent_user_id).exists())

        response = self.client.delete(f'/api/v1/students/{second.data["id"]}/')

        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=parent_user_id).exists())

    def test_tc_deactivation_keeps_parent_active_until_last_active_child_leaves(self):
        first = self.admit(admission_no='ADM001')
        second = self.admit(admission_no='ADM002')
        parent_user = ParentProfile.objects.get().user

        first_tc = self.client.patch(f'/api/v1/students/{first.data["id"]}/', {'status': Student.Status.TC_ISSUED}, format='json')
        parent_user.refresh_from_db()
        first_student_user = Student.objects.get(id=first.data['id']).login_profile.user
        first_student_user.refresh_from_db()

        self.assertEqual(first_tc.status_code, 200)
        self.assertFalse(first_student_user.is_active)
        self.assertTrue(parent_user.is_active)

        second_tc = self.client.patch(f'/api/v1/students/{second.data["id"]}/', {'status': Student.Status.TC_ISSUED}, format='json')
        parent_user.refresh_from_db()
        second_student_user = Student.objects.get(id=second.data['id']).login_profile.user
        second_student_user.refresh_from_db()

        self.assertEqual(second_tc.status_code, 200)
        self.assertFalse(second_student_user.is_active)
        self.assertFalse(parent_user.is_active)


@override_settings(SECURE_SSL_REDIRECT=False)
class StudentTenantIsolationTests(TestCase):
    """Regression tests for guessed-ID cross-tenant access."""

    def setUp(self):
        self.school_a = School.objects.create(name='School A', code='school-a')
        self.school_b = School.objects.create(name='School B', code='school-b')
        self.admin_a = User.objects.create_user(
            username='admin-a', email='admin-a@example.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN, school=self.school_a,
        )
        self.student_b = Student.objects.create(
            school=self.school_b, admission_no='B-001', name='School B Student',
            class_name='8', section='A', roll_no=1, parent_name='Parent B',
            parent_phone='9000000000', parent_email='parent-b@example.com',
            dob='2012-01-01', gender='Female', academic_year='2026-27',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin_a)

    def test_school_admin_cannot_read_student_from_another_school_by_id(self):
        response = self.client.get(f'/api/v1/students/{self.student_b.id}/')
        self.assertEqual(response.status_code, 404)

    def test_school_admin_cannot_mutate_student_from_another_school_by_id(self):
        response = self.client.patch(
            f'/api/v1/students/{self.student_b.id}/', {'name': 'Compromised'}, format='json',
        )
        self.assertEqual(response.status_code, 404)
        self.student_b.refresh_from_db()
        self.assertEqual(self.student_b.name, 'School B Student')

    def test_super_admin_can_read_but_cannot_change_cross_school_students(self):
        super_admin = User.objects.create_superuser(
            username='student-read-super', email='student-read-super@example.com',
            password='StrongPass123!', role=User.Role.SUPER_ADMIN,
        )
        self.client.force_authenticate(super_admin)

        self.assertEqual(self.client.get('/api/v1/students/').status_code, 200)
        self.assertEqual(self.client.patch(
            f'/api/v1/students/{self.student_b.id}/', {'name': 'Blocked'}, format='json',
        ).status_code, 403)


@override_settings(SECURE_SSL_REDIRECT=False)
class StudentDocumentAccessTests(TestCase):
    png = b'\x89PNG\r\n\x1a\n' + b'valid-content'

    def setUp(self):
        self.school = School.objects.create(name='Document School', code='document-school')
        self.other_school = School.objects.create(name='Other Document School', code='other-document-school')
        self.student = self.make_student(self.school, 'DOC-1', 'Target Student')
        self.other_student = self.make_student(self.school, 'DOC-2', 'Other Student')
        self.document = StudentDocument.objects.create(
            student=self.student, name='identity.png', file_data=self.png, file_content_type='image/png', file_name='identity.png', file_type='PNG', status='Uploaded',
        )
        self.client = APIClient()

    def make_student(self, school, admission, name):
        return Student.objects.create(school=school, admission_no=admission, name=name, class_name='8', section='A', roll_no=1, parent_name='Parent', parent_phone=f'9{admission[-1]}00000000', parent_email=f'{admission}@example.com', dob='2012-01-01', gender='Female', academic_year='2026-27')

    def url(self):
        return f'/api/v1/students/{self.student.id}/documents/{self.document.id}/'

    def collection_url(self):
        return f'/api/v1/students/{self.student.id}/documents/'

    def test_school_admin_uploads_pdf_bytes_to_database_and_can_download_them(self):
        admin = User.objects.create_user(username='document-admin', email='document-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.client.force_authenticate(admin)
        payload = b'%PDF-1.4\nsecure-document-content'
        response = self.client.post(self.collection_url(), {
            'name': 'Transfer Certificate',
            'file': SimpleUploadedFile('transfer-certificate.pdf', payload, content_type='application/pdf'),
        }, format='multipart')
        self.assertEqual(response.status_code, 201)
        document = StudentDocument.objects.get(pk=response.data['id'])
        self.assertEqual(bytes(document.file_data), payload)
        self.assertEqual(document.file_content_type, 'application/pdf')
        self.assertEqual(document.file_name, 'transfer-certificate.pdf')
        self.assertEqual(response.data['downloadUrl'], f'/api/v1/students/{self.student.id}/documents/{document.id}/')

        download = self.client.get(response.data['downloadUrl'])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b''.join(download.streaming_content), payload)

    def test_only_school_admin_can_upload_or_delete_documents(self):
        teacher = User.objects.create_user(username='document-teacher', email='document-teacher@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school)
        self.client.force_authenticate(teacher)
        response = self.client.post(self.collection_url(), {
            'name': 'Blocked',
            'file': SimpleUploadedFile('blocked.pdf', b'%PDF-1.4\nblocked', content_type='application/pdf'),
        }, format='multipart')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.delete(self.url()).status_code, 403)

    def test_unauthenticated_document_request_is_rejected(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)

    def test_cross_school_admin_and_teacher_cannot_access_document(self):
        for role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER]:
            user = User.objects.create_user(username=f'foreign-{role}', email=f'foreign-{role}@example.com', password='StrongPass123!', role=role, school=self.other_school)
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_unrelated_parent_and_student_cannot_access_document(self):
        parent = User.objects.create_user(username='unrelated-parent', email='unrelated-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=self.school)
        profile = ParentProfile.objects.create(user=parent, phone='9800000000')
        profile.students.add(self.other_student)
        self.client.force_authenticate(parent)
        self.assertEqual(self.client.get(self.url()).status_code, 404)

        learner = User.objects.create_user(username='other-student-login', email='other-student-login@example.com', password='StrongPass123!', role=User.Role.STUDENT, school=self.school)
        StudentProfile.objects.create(user=learner, student=self.other_student)
        self.client.force_authenticate(learner)
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_linked_parent_and_student_can_download_own_document(self):
        parent = User.objects.create_user(username='linked-parent', email='linked-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=self.school)
        parent_profile = ParentProfile.objects.create(user=parent, phone='9800000001')
        parent_profile.students.add(self.student)
        learner = User.objects.create_user(username='linked-student', email='linked-student@example.com', password='StrongPass123!', role=User.Role.STUDENT, school=self.school)
        StudentProfile.objects.create(user=learner, student=self.student)
        for user in [parent, learner]:
            self.client.force_authenticate(user)
            response = self.client.get(self.url())
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Content-Disposition'], 'attachment; filename="identity.png"')

    def test_student_can_upload_document_and_admin_can_verify_or_reject(self):
        learner = User.objects.create_user(username='uploading-student', email='uploading-student@example.com', password='StrongPass123!', role=User.Role.STUDENT, school=self.school)
        StudentProfile.objects.create(user=learner, student=self.student)
        admin = User.objects.create_user(username='verifying-admin', email='verifying-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)

        # 1. Student uploads their Aadhaar card
        self.client.force_authenticate(learner)
        payload = b'%PDF-1.4\naadhaar-proof'
        upload_resp = self.client.post(self.collection_url(), {
            'name': 'Aadhaar Card (Front & Back)',
            'category': 'Aadhaar Card',
            'file': SimpleUploadedFile('aadhaar.pdf', payload, content_type='application/pdf'),
        }, format='multipart')
        self.assertEqual(upload_resp.status_code, 201)
        doc_id = upload_resp.data['id']
        self.assertEqual(upload_resp.data['status'], 'Pending')
        self.assertEqual(upload_resp.data['category'], 'Aadhaar Card')

        # 2. Student cannot verify document
        verify_url = f'/api/v1/students/{self.student.id}/documents/{doc_id}/'
        forbidden_resp = self.client.patch(verify_url, {'status': 'Verified'}, format='json')
        self.assertEqual(forbidden_resp.status_code, 403)

        # 3. Admin verifies document
        self.client.force_authenticate(admin)
        verify_resp = self.client.patch(verify_url, {
            'status': 'Verified',
            'remarks': 'Approved by Admin',
        }, format='json')
        self.assertEqual(verify_resp.status_code, 200)
        self.assertEqual(verify_resp.data['status'], 'Verified')
        self.assertEqual(verify_resp.data['remarks'], 'Approved by Admin')
        self.assertIsNotNone(verify_resp.data['verifiedAt'])

        doc = StudentDocument.objects.get(pk=doc_id)
        self.assertEqual(doc.status, 'Verified')
        self.assertEqual(doc.verified_by, admin)

        # 4. Admin rejects document with feedback
        reject_resp = self.client.patch(verify_url, {
            'status': 'Rejected',
            'remarks': 'Scan is blurry. Please re-upload.',
        }, format='json')
        self.assertEqual(reject_resp.status_code, 200)
        self.assertEqual(reject_resp.data['status'], 'Rejected')
        self.assertEqual(reject_resp.data['remarks'], 'Scan is blurry. Please re-upload.')

    def test_upload_validators_reject_mismatched_and_oversized_files(self):
        with self.assertRaises(ValidationError):
            validate_student_document(SimpleUploadedFile('renamed.pdf', self.png, content_type='application/pdf'))
        with self.assertRaises(ValidationError):
            validate_student_document(SimpleUploadedFile('malware.exe', self.png, content_type='image/png'))
        with self.assertRaises(ValidationError):
            validate_student_document(SimpleUploadedFile('too-large.pdf', b'%PDF-' + b'x' * (5 * 1024 * 1024), content_type='application/pdf'))
        with self.assertRaises(ValidationError):
            validate_school_logo(SimpleUploadedFile('too-large.png', self.png + b'x' * (2 * 1024 * 1024), content_type='image/png'))


@override_settings(SECURE_SSL_REDIRECT=False)
class CanonicalSectionAssignmentTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Section School', code='section-school')
        self.other_school = School.objects.create(name='Other Section School', code='other-section-school')
        AcademicYear.objects.create(
            school=self.school, name='2026-27', starts_on='2026-04-01',
            ends_on='2027-03-31', is_active=True,
        )
        class_8 = Class.objects.create(school=self.school, name='Class 8', code='class-8')
        class_9 = Class.objects.create(school=self.school, name='Class 9', code='class-9')
        other_class_8 = Class.objects.create(school=self.other_school, name='Class 8', code='class-8')
        self.section_8a = Section.objects.create(school=self.school, class_room=class_8, name='A')
        self.section_9a = Section.objects.create(school=self.school, class_room=class_9, name='A')
        self.foreign_section_8a = Section.objects.create(school=self.other_school, class_room=other_class_8, name='A')
        self.admin = User.objects.create_user(
            username='section-admin', email='section-admin@example.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.teacher_user = User.objects.create_user(
            username='section-teacher', email='section-teacher@example.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=self.school,
        )
        self.teacher = Teacher.objects.create(
            school=self.school, user=self.teacher_user, joining_date='2026-08-05', phone='9000000900',
        )
        self.teacher.sections.add(self.section_8a)
        self.student_8a = self.make_student('SEC-8A', self.section_8a)
        self.student_9a = self.make_student('SEC-9A', self.section_9a)
        self.foreign_student_8a = self.make_student(
            'FOREIGN-SEC-8A', self.foreign_section_8a, school=self.other_school,
        )
        self.client = APIClient()

    def make_student(self, admission_no, section, *, school=None):
        school = school or self.school
        return Student.objects.create(
            school=school, admission_no=admission_no, name=admission_no,
            class_name=section.class_room.name, section=section.name, section_record=section,
            roll_no=1, parent_name='Parent', parent_phone='9000000901',
            parent_email=f'{admission_no.lower()}@example.com', dob='2012-01-01',
            gender='Female', academic_year='2026-27',
        )

    def test_student_admission_uses_tenant_owned_section_id(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/v1/students/', {
            'admissionNo': 'SEC-NEW', 'name': 'New Section Student',
            'class_': 'Incorrect Class', 'section': 'Z', 'sectionId': self.section_8a.id,
            'rollNo': 2, 'parentName': 'Parent', 'parentPhone': '9000000902',
            'parentEmail': 'section-new@example.com', 'dob': '2012-01-01',
            'gender': 'Female', 'academicYear': '2026-27', 'status': 'Active',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        student = Student.objects.get(pk=response.data['id'])
        self.assertEqual(student.section_record, self.section_8a)
        self.assertEqual((student.class_name, student.section), ('Class 8', 'A'))

        response = self.client.post('/api/v1/students/', {
            'admissionNo': 'SEC-BLOCK', 'name': 'Blocked Student', 'sectionId': self.foreign_section_8a.id,
            'rollNo': 3, 'parentName': 'Parent', 'parentPhone': '9000000903',
            'parentEmail': 'section-block@example.com', 'dob': '2012-01-01',
            'gender': 'Female', 'academicYear': '2026-27', 'status': 'Active',
        }, format='json')
        self.assertEqual(response.status_code, 400)

    def test_teacher_access_is_exact_class_and_section(self):
        self.client.force_authenticate(self.teacher_user)
        response = self.client.get('/api/v1/students/')
        self.assertEqual(response.status_code, 200)
        rows = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual({row['id'] for row in rows}, {self.student_8a.id})
        self.assertEqual(self.client.get(f'/api/v1/students/{self.student_9a.id}/').status_code, 404)

    def test_teacher_profile_is_read_only_and_privacy_minimized(self):
        StudentDocument.objects.create(
            student=self.student_8a, name='private.pdf', file_data=b'%PDF-private',
            file_content_type='application/pdf', file_name='private.pdf', file_type='PDF',
        )
        self.student_8a.address = 'Private home address'
        self.student_8a.medical_conditions = 'Private diagnosis'
        self.student_8a.fee_total = 50000
        self.student_8a.fee_paid = 10000
        self.student_8a.save()
        self.client.force_authenticate(self.teacher_user)

        response = self.client.get(f'/api/v1/students/{self.student_8a.id}/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {
            'id', 'admissionNo', 'name', 'photoUrl', 'class', 'section',
            'sectionId', 'rollNo', 'dob', 'gender', 'status', 'academicYear',
            'parentName', 'parentPhone',
        })
        self.assertEqual(response.data['class'], 'Class 8')
        self.assertEqual(response.data['academicYear'], '2026-27')
        self.assertEqual(response.data['parentName'], 'Parent')
        self.assertEqual(response.data['parentPhone'], '9000000901')
        for private_field in [
            'parentEmail', 'address', 'medicalConditions', 'attendancePercentage',
            'feeTotal', 'feePaid', 'gpa', 'documents', 'history', 'loginCredentials',
        ]:
            self.assertNotIn(private_field, response.data)

        update = self.client.patch(
            f'/api/v1/students/{self.student_8a.id}/', {'name': 'Changed'}, format='json',
        )
        self.assertEqual(update.status_code, 403)
        self.student_8a.refresh_from_db()
        self.assertEqual(self.student_8a.name, 'SEC-8A')

    def test_teacher_cannot_download_even_an_assigned_students_documents(self):
        document = StudentDocument.objects.create(
            student=self.student_8a, name='private.pdf', file_data=b'%PDF-private',
            file_content_type='application/pdf', file_name='private.pdf', file_type='PDF',
        )
        self.client.force_authenticate(self.teacher_user)

        response = self.client.get(
            f'/api/v1/students/{self.student_8a.id}/documents/{document.id}/',
        )

        self.assertEqual(response.status_code, 404)

    def test_canonical_relation_cannot_grant_cross_tenant_student_access(self):
        # Even a corrupt/malicious cross-school M2M row must not widen access.
        self.teacher.sections.add(self.foreign_section_8a)
        self.client.force_authenticate(self.teacher_user)

        response = self.client.get('/api/v1/students/')
        rows = response.data if isinstance(response.data, list) else response.data['results']

        self.assertEqual({row['id'] for row in rows}, {self.student_8a.id})
        self.assertEqual(
            self.client.get(f'/api/v1/students/{self.foreign_student_8a.id}/').status_code,
            404,
        )

    def test_inactive_teacher_cannot_read_assigned_students(self):
        self.teacher.status = Teacher.Status.INACTIVE
        self.teacher.save(update_fields=['status'])
        self.client.force_authenticate(self.teacher_user)

        response = self.client.get('/api/v1/students/')
        rows = response.data if isinstance(response.data, list) else response.data['results']

        self.assertEqual(rows, [])
        self.assertEqual(
            self.client.get(f'/api/v1/students/{self.student_8a.id}/').status_code,
            404,
        )

    def test_admin_parent_and_student_keep_their_existing_scopes(self):
        parent_user = User.objects.create_user(
            username='section-parent', email='section-parent@example.com', password='StrongPass123!',
            role=User.Role.PARENT, school=self.school,
        )
        parent_profile = ParentProfile.objects.create(user=parent_user, phone='9000000998')
        parent_profile.students.add(self.student_8a)
        student_user = User.objects.create_user(
            username='section-student', email='section-student@example.com', password='StrongPass123!',
            role=User.Role.STUDENT, school=self.school,
        )
        StudentProfile.objects.create(user=student_user, student=self.student_8a)

        self.client.force_authenticate(self.admin)
        admin_response = self.client.get('/api/v1/students/')
        admin_rows = admin_response.data if isinstance(admin_response.data, list) else admin_response.data['results']
        self.assertEqual({row['id'] for row in admin_rows}, {self.student_8a.id, self.student_9a.id})
        self.assertIn('documents', admin_rows[0])

        for user in [parent_user, student_user]:
            self.client.force_authenticate(user)
            response = self.client.get('/api/v1/students/')
            rows = response.data if isinstance(response.data, list) else response.data['results']
            self.assertEqual({row['id'] for row in rows}, {self.student_8a.id})
            self.assertEqual(
                self.client.get(f'/api/v1/students/{self.student_9a.id}/').status_code,
                404,
            )

    def test_legacy_section_letter_alone_never_grants_cross_class_access(self):
        legacy_user = User.objects.create_user(
            username='legacy-section-teacher', email='legacy-section-teacher@example.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=self.school,
        )
        Teacher.objects.create(
            school=self.school, user=legacy_user, joining_date='2026-08-05', phone='9000000904',
            assigned_sections=['A'],
        )
        self.client.force_authenticate(legacy_user)
        response = self.client.get('/api/v1/students/')
        rows = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual(rows, [])

    def test_compact_legacy_class_section_is_not_an_authorization_source(self):
        compact_user = User.objects.create_user(
            username='compact-section-teacher', email='compact-section-teacher@example.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=self.school,
        )
        Teacher.objects.create(
            school=self.school, user=compact_user, joining_date='2026-08-05', phone='9000000905',
            assigned_sections=['8A'],
        )
        self.client.force_authenticate(compact_user)
        response = self.client.get('/api/v1/students/')
        rows = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual(rows, [])


@override_settings(SECURE_SSL_REDIRECT=False)
class StudentBulkImportTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Global Academy', code='global-acad')
        self.admin = User.objects.create_user(
            username='admin-bulk',
            email='admin@globalacad.edu',
            password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN,
            school=self.school,
        )
        self.teacher = User.objects.create_user(
            username='teacher-bulk',
            email='teacher@globalacad.edu',
            password='StrongPass123!',
            role=User.Role.TEACHER,
            school=self.school,
        )
        self.ay = AcademicYear.objects.create(
            school=self.school, name='2026-2027', starts_on='2026-04-01',
            ends_on='2027-03-31', is_active=True,
        )
        self.classroom = Class.objects.create(school=self.school, name='Class 10', code='class-10')
        self.section = Section.objects.create(school=self.school, class_room=self.classroom, name='A')
        self.client = APIClient()

    def test_bulk_import_json_students(self):
        self.client.force_authenticate(self.admin)
        payload = {
            'academicYear': '2026-2027',
            'students': [
                {
                    'name': 'Aarav Patel',
                    'class_name': 'Class 10',
                    'section': 'A',
                    'roll_no': 1,
                    'parent_name': 'Vikram Patel',
                    'parent_phone': '9876543210',
                    'parent_email': 'vikram.patel@example.com',
                    'dob': '2010-05-14',
                    'gender': 'Male',
                },
                {
                    'name': 'Diya Sharma',
                    'class_name': 'Class 10',
                    'section': 'A',
                    'parent_name': 'Ananya Sharma',
                    'parent_phone': '9876543211',
                    'parent_email': 'ananya.sharma@example.com',
                    'dob': '2010-08-22',
                    'gender': 'Female',
                },
            ]
        }
        response = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(response.status_code, 201)
        data = response.data
        self.assertTrue(data['success'])
        self.assertEqual(data['createdCount'], 2)
        self.assertEqual(data['skippedCount'], 0)
        self.assertEqual(len(data['credentials']), 2)

        # Verify students in DB
        aarav = Student.objects.get(school=self.school, name='Aarav Patel')
        self.assertEqual(aarav.roll_no, 1)
        self.assertEqual(aarav.class_name, 'Class 10')
        self.assertEqual(aarav.section, 'A')

        diya = Student.objects.get(school=self.school, name='Diya Sharma')
        self.assertEqual(diya.roll_no, 2)  # Auto-allocated next roll
        self.assertTrue(diya.admission_no.startswith('ADM'))

    def test_bulk_import_csv_students(self):
        self.client.force_authenticate(self.admin)
        csv_content = (
            "Banner Title - School Roster\n"
            "\n"
            "Student Name,Grade,Sec,Roll #,Father's Name,Parent Mobile,Date of Birth,Gender\n"
            "Rohan Verma,Class 9,B,1,Rajesh Verma,9811223344,2011-03-15,Boy\n"
            "Sita Rao,Class 9,B,2,Sunil Rao,9822334455,2011-09-20,Girl\n"
        )
        file_obj = SimpleUploadedFile("students.csv", csv_content.encode('utf-8'), content_type="text/csv")
        response = self.client.post('/api/v1/students/bulk-import/', data={'file': file_obj}, format='multipart')
        self.assertEqual(response.status_code, 201)
        data = response.data
        self.assertEqual(data['createdCount'], 2)

        rohan = Student.objects.get(school=self.school, name='Rohan Verma')
        self.assertEqual(rohan.gender, 'Male')
        self.assertEqual(rohan.class_name, 'Class 9')
        self.assertEqual(rohan.section, 'B')

        sita = Student.objects.get(school=self.school, name='Sita Rao')
        self.assertEqual(sita.gender, 'Female')

    def test_bulk_import_forbidden_for_teacher(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.post('/api/v1/students/bulk-import/', data={'students': []}, format='json')
        self.assertEqual(response.status_code, 403)

    @patch('apps.common.tasks.process_import_batch.delay')
    def test_queued_student_import_returns_scoped_status(self, enqueue):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/v1/students/bulk-import/', data={
            'async_import': True,
            'jobId': 'student-queue-test-1',
            'batchNumber': 1,
            'students': [{'name': 'Queued Student'}],
        }, format='json')
        self.assertEqual(response.status_code, 202)
        enqueue.assert_called_once()

        status_response = self.client.get(
            '/api/v1/students/bulk-import/status/',
            {'jobId': 'student-queue-test-1', 'batchNumber': 1},
        )
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.data['status'], 'pending')

        self.client.force_authenticate(self.teacher)
        forbidden = self.client.get(
            '/api/v1/students/bulk-import/status/',
            {'jobId': 'student-queue-test-1', 'batchNumber': 1},
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_worker_processes_queued_student_batch(self):
        from apps.common.tasks import process_import_batch
        from apps.common.import_queue import encrypt_import_payload, import_status_key
        from django.core.cache import cache

        process_import_batch.apply(kwargs={
            'entity': 'students',
            'school_id': self.school.pk,
            'user_id': self.admin.pk,
            'job_id': 'student-worker-test-1',
            'batch_number': 1,
            'encrypted_payload': encrypt_import_payload({
                'jobId': 'student-worker-test-1',
                'batchNumber': 1,
                'students': [{'name': 'Worker Imported Student', 'class_name': 'Class 10', 'section': 'A'}],
            }),
        })
        result = cache.get(import_status_key(
            entity='students', school_id=self.school.pk, user_id=self.admin.pk,
            job_id='student-worker-test-1', batch_number=1,
        ))
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['result']['createdCount'], 1)
        self.assertTrue(Student.objects.filter(school=self.school, name='Worker Imported Student').exists())

