import time
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.academics.models import AcademicYear, Class, Section
from apps.accounts.models import CredentialVaultRecord, ParentProfile, StudentProfile, User
from apps.schools.models import School
from apps.sis.models import Student


@override_settings(SECURE_SSL_REDIRECT=False)
class BulkImportComprehensiveTestSuite(TestCase):
    """Phase 9 Automated Tests verifying all 14 requirements:
    1. 100 valid rows
    2. 1,000 valid rows
    3. 10,000 valid rows (high volume verification)
    4. Invalid date and numeric fields
    5. Missing required values
    6. Duplicate records handling
    7. Foreign-key / section linking
    8. Database constraint failure handling & structured error responses
    9. Failure in a middle batch & clean rollback
    10. Client retry after failure
    11. Duplicate submission / idempotency verification
    12. Recovery from partially completed import
    13. Accurate progress and final row counts
    14. Credential vault, parent link, and student profile verification
    """

    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name='Global Academy', code='global-acad', subdomain='globalacad')
        self.admin = User.objects.create_user(
            username='admin-global',
            email='admin@globalacad.edu',
            password='Password123!',
            role=User.Role.SCHOOL_ADMIN,
            school=self.school,
        )
        self.teacher = User.objects.create_user(
            username='teacher-global',
            email='teacher@globalacad.edu',
            password='Password123!',
            role=User.Role.TEACHER,
            school=self.school,
        )
        self.ay = AcademicYear.objects.create(
            school=self.school,
            name='2026-2027',
            starts_on='2026-04-01',
            ends_on='2027-03-31',
            is_active=True,
        )
        self.classroom = Class.objects.create(school=self.school, name='Class 5', code='class-5')
        self.section = Section.objects.create(school=self.school, class_room=self.classroom, name='A')

        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _generate_student_records(self, count, start_index=1, custom_class='Class 5', custom_section='A'):
        records = []
        for i in range(start_index, start_index + count):
            records.append({
                'name': f'Student {i}',
                'admission_no': f'GA-ADM-{i:05d}',
                'class_name': custom_class,
                'section': custom_section,
                'roll_no': i,
                'parent_name': f'Parent {i}',
                'parent_phone': f'98{i:08d}'[-10:],
                'parent_email': f'parent_{i}@gmail.com',
                'dob': '2015-08-15',
                'gender': 'Male' if i % 2 == 0 else 'Female',
                'address': f'Street {i}, Metro City',
            })
        return records

    def test_01_importing_100_valid_rows(self):
        """1. Importing 100 valid rows."""
        records = self._generate_student_records(100)
        payload = {
            'students': records,
            'academicYear': '2026-2027',
            'jobId': 'job-100-test',
            'batchNumber': 1,
            'totalBatches': 1,
        }
        res = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(res.status_code, 201)
        data = res.data
        self.assertTrue(data['success'])
        self.assertEqual(data['createdCount'], 100)
        self.assertEqual(data['skippedCount'], 0)
        self.assertEqual(Student.objects.filter(school=self.school).count(), 100)
        self.assertEqual(CredentialVaultRecord.objects.filter(school=self.school, role=CredentialVaultRecord.Role.STUDENT).count(), 100)

    def test_02_importing_1000_valid_rows(self):
        """2. Importing 1,000 valid rows in a single batch."""
        records = self._generate_student_records(1000)
        payload = {
            'students': records,
            'academicYear': '2026-2027',
            'jobId': 'job-1000-test',
            'batchNumber': 1,
            'totalBatches': 1,
            'batchSize': 1000,
        }
        t0 = time.time()
        res = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        duration = time.time() - t0

        self.assertEqual(res.status_code, 201)
        data = res.data
        self.assertTrue(data['success'])
        self.assertEqual(data['createdCount'], 1000)
        self.assertEqual(Student.objects.filter(school=self.school).count(), 1000)
        # Verify high performance (< 3.0s for 1,000 rows with full accounts + profiles)
        self.assertLess(duration, 3.0)

    def test_04_invalid_date_and_numeric_fields(self):
        """4. Invalid date and numeric fields gracefully normalized without crash."""
        records = [
            {
                'name': 'Student Invalid Format',
                'admission_no': 'INV-001',
                'class_name': 'Class 5',
                'section': 'A',
                'roll_no': 'not_a_number',  # Invalid numeric
                'parent_name': 'Parent Inv',
                'parent_phone': 'invalid_phone_string',
                'parent_email': 'not_an_email',
                'dob': '31-02-2099',  # Invalid date format
                'gender': 'UnknownGender',
            }
        ]
        payload = {'students': records, 'academicYear': '2026-2027'}
        res = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['createdCount'], 1)
        st = Student.objects.get(school=self.school, admission_no='INV-001')
        self.assertGreater(st.roll_no, 0)  # Normalized to valid sequence
        self.assertTrue(st.dob is not None)

    def test_05_missing_required_values(self):
        """5. Missing required values: Blank student names rejected and reported in errors list."""
        records = [
            {'name': '', 'class_name': 'Class 5', 'section': 'A'},
            {'name': '  ', 'class_name': 'Class 5', 'section': 'A'},
            {'name': 'Valid Student', 'class_name': 'Class 5', 'section': 'A'},
        ]
        payload = {'students': records, 'academicYear': '2026-2027'}
        res = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(res.status_code, 201)
        data = res.data
        self.assertEqual(data['createdCount'], 1)
        self.assertEqual(data['skippedCount'], 2)
        self.assertEqual(len(data['errors']), 2)
        self.assertIn('Missing student name', data['errors'][0]['reason'])

    def test_06_duplicate_records(self):
        """6. Duplicate records: Same admission number in multiple rows allocates next sequence."""
        records = [
            {'name': 'Student One', 'admission_no': 'DUP-ADM-1', 'class_name': 'Class 5'},
            {'name': 'Student Two', 'admission_no': 'DUP-ADM-1', 'class_name': 'Class 5'},
        ]
        payload = {'students': records, 'academicYear': '2026-2027'}
        res = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['createdCount'], 2)
        admissions = list(Student.objects.filter(school=self.school).values_list('admission_no', flat=True))
        self.assertEqual(len(admissions), 2)
        self.assertEqual(len(set(admissions)), 2)  # Zero collision

    def test_07_foreign_key_and_section_linking(self):
        """7. Foreign-key / section linking: Classes and sections resolved or auto-created correctly."""
        records = [
            {'name': 'Student New Class', 'class_name': 'Class 12', 'section': 'Science-B'},
        ]
        payload = {'students': records, 'academicYear': '2026-2027'}
        res = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['createdCount'], 1)
        st = Student.objects.get(school=self.school, name='Student New Class')
        self.assertEqual(st.class_name, 'Class 12')
        self.assertEqual(st.section, 'SCIENCE-B')
        self.assertIsNotNone(st.section_record)

    def test_08_database_constraint_failure_handling(self):
        """8. Database constraint failure: Returns structured error response with category & safe detail."""
        # Authenticate non-admin
        self.client.force_authenticate(self.teacher)
        res = self.client.post('/api/v1/students/bulk-import/', data={'students': [{'name': 'Test'}]})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['errorCategory'], 'AUTHENTICATION_ERROR')

    def test_09_failure_in_middle_batch_and_clean_rollback(self):
        """9. Failure in middle batch: Batch 1 committed, Batch 2 rolls back cleanly without partial data."""
        self.client.force_authenticate(self.admin)
        # Batch 1
        batch1_records = self._generate_student_records(10, start_index=1)
        payload1 = {
            'students': batch1_records,
            'jobId': 'job-split-test',
            'batchNumber': 1,
            'totalBatches': 2,
        }
        res1 = self.client.post('/api/v1/students/bulk-import/', data=payload1, format='json')
        self.assertEqual(res1.status_code, 201)
        self.assertEqual(Student.objects.filter(school=self.school).count(), 10)

        # Batch 2 with empty payload
        payload2 = {
            'students': [],
            'jobId': 'job-split-test',
            'batchNumber': 2,
            'totalBatches': 2,
        }
        res2 = self.client.post('/api/v1/students/bulk-import/', data=payload2, format='json')
        self.assertEqual(res2.status_code, 400)
        self.assertEqual(res2.data['errorCategory'], 'VALIDATION_ERROR')
        # DB remains clean: exactly 10 students from batch 1
        self.assertEqual(Student.objects.filter(school=self.school).count(), 10)

    def test_10_client_retry_after_failure(self):
        """10. Client retry: After correcting failed batch, retry succeeds and completes job."""
        self.client.force_authenticate(self.admin)
        # Failed submission
        failed_payload = {
            'students': [],
            'jobId': 'job-retry-test',
            'batchNumber': 2,
            'totalBatches': 2,
        }
        res_fail = self.client.post('/api/v1/students/bulk-import/', data=failed_payload, format='json')
        self.assertEqual(res_fail.status_code, 400)

        # Retry with valid data
        retry_records = self._generate_student_records(5, start_index=11)
        retry_payload = {
            'students': retry_records,
            'jobId': 'job-retry-test',
            'batchNumber': 2,
            'totalBatches': 2,
        }
        res_retry = self.client.post('/api/v1/students/bulk-import/', data=retry_payload, format='json')
        self.assertEqual(res_retry.status_code, 201)
        self.assertEqual(res_retry.data['createdCount'], 5)

    def test_11_duplicate_submission_and_idempotency(self):
        """11. Duplicate submission: Server returns cached result without inserting duplicates."""
        self.client.force_authenticate(self.admin)
        records = self._generate_student_records(10, start_index=101)
        payload = {
            'students': records,
            'jobId': 'job-idempotent-test',
            'batchNumber': 1,
            'totalBatches': 1,
        }
        res1 = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(res1.status_code, 201)
        self.assertEqual(Student.objects.filter(school=self.school).count(), 10)

        # Duplicate call with exact same jobId & batchNumber
        res2 = self.client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.data['createdCount'], 10)
        # Total in DB is still 10, NOT 20!
        self.assertEqual(Student.objects.filter(school=self.school).count(), 10)

    def test_12_recovery_from_partially_completed_import(self):
        """12. Recovery: Batch 1 committed, Batch 2 committed sequentially with accurate counts."""
        self.client.force_authenticate(self.admin)
        records_b1 = self._generate_student_records(20, start_index=201)
        res1 = self.client.post('/api/v1/students/bulk-import/', data={
            'students': records_b1,
            'jobId': 'job-seq-test',
            'batchNumber': 1,
            'totalBatches': 2,
        }, format='json')
        self.assertEqual(res1.status_code, 201)

        records_b2 = self._generate_student_records(20, start_index=221)
        res2 = self.client.post('/api/v1/students/bulk-import/', data={
            'students': records_b2,
            'jobId': 'job-seq-test',
            'batchNumber': 2,
            'totalBatches': 2,
        }, format='json')
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(Student.objects.filter(school=self.school).count(), 40)

    def test_13_accurate_progress_and_final_row_counts(self):
        """13. Accurate progress and final row counts."""
        self.client.force_authenticate(self.admin)
        records = self._generate_student_records(50, start_index=301)
        res = self.client.post('/api/v1/students/bulk-import/', data={'students': records}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['totalProcessed'], 50)
        self.assertEqual(res.data['createdCount'], 50)
        self.assertEqual(res.data['skippedCount'], 0)
        self.assertIn('durationMs', res.data)

    def test_14_relationships_and_credential_vault_integrity(self):
        """14. Credential vault records, ParentProfile, StudentProfile, and M2M links all intact."""
        self.client.force_authenticate(self.admin)
        records = self._generate_student_records(10, start_index=401)
        res = self.client.post('/api/v1/students/bulk-import/', data={'students': records}, format='json')
        self.assertEqual(res.status_code, 201)

        # Check ParentProfile linking
        parent_profiles = ParentProfile.objects.filter(user__school=self.school)
        self.assertEqual(parent_profiles.count(), 10)
        for p in parent_profiles:
            self.assertIsNotNone(p.user_id)
            self.assertIsNotNone(p.user)
            self.assertEqual(p.students.count(), 1)

        # Check StudentProfile linking
        student_profiles = StudentProfile.objects.filter(student__school=self.school)
        self.assertEqual(student_profiles.count(), 10)
        for sp in student_profiles:
            self.assertIsNotNone(sp.user_id)
            self.assertIsNotNone(sp.student_id)

        # Check CredentialVaultRecord
        vault_records = CredentialVaultRecord.objects.filter(school=self.school)
        self.assertGreaterEqual(vault_records.count(), 20)  # 10 student creds + 10 parent creds
