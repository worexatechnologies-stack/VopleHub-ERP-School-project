from datetime import date, time

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.schools.models import School
from apps.sis.models import Student
from apps.staff.models import Teacher
from apps.academics.models import Class, Section, Subject

from .models import Exam, ExamResult


@override_settings(SECURE_SSL_REDIRECT=False)
class ExamSubjectValidationTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Exam Subject School', code='exam-subject-school')
        self.admin = User.objects.create_user(
            username='exam-subject-admin', email='exam-subject-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.subject = Subject.objects.create(school=self.school, name='Mathematics')
        classroom = Class.objects.create(school=self.school, name='Grade 8', code='grade-8')
        classroom.subjects.add(self.subject)
        Section.objects.create(school=self.school, class_room=classroom, name='A')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def payload(self, subject):
        return {
            'name': 'Term One', 'class_name': 'Grade 8', 'section': 'A',
            'subject': subject, 'date': date.today(), 'time': '09:00', 'max_marks': 100,
        }

    def test_exam_accepts_only_admin_created_subject(self):
        accepted = self.client.post('/api/v1/exams/', self.payload('mathematics'), format='json')
        self.assertEqual(accepted.status_code, 201)
        self.assertEqual(accepted.data['subject'], 'Mathematics')
        rejected = self.client.post('/api/v1/exams/', self.payload('Invented Subject'), format='json')
        self.assertEqual(rejected.status_code, 400)

        unassigned = Subject.objects.create(school=self.school, name='Unassigned Subject')
        rejected = self.client.post('/api/v1/exams/', self.payload(unassigned.name), format='json')
        self.assertEqual(rejected.status_code, 400)
        self.assertIn('subject', rejected.data)


@override_settings(SECURE_SSL_REDIRECT=False)
class ExamResultsTenantIsolationTests(TestCase):
    """Regression tests for guessed-ID access across school boundaries."""

    def setUp(self):
        self.school_a = School.objects.create(name='School A', code='exam-school-a')
        self.school_b = School.objects.create(name='School B', code='exam-school-b')
        self.admin_a = User.objects.create_user(username='exam-admin-a', email='exam-admin-a@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school_a)
        self.student_b = Student.objects.create(school=self.school_b, admission_no='B-EXAM-1', name='School B Student', class_name='8', section='A', roll_no=1, parent_name='Parent B', parent_phone='9000000100', parent_email='parent-b-exam@example.com', dob='2012-01-01', gender='Female', academic_year='2026-27')
        self.exam_b = Exam.objects.create(school=self.school_b, name='Term One', class_name='8', section='A', subject='Mathematics', date=date.today(), time=time(9, 0), max_marks=100)
        self.entered_by_b = User.objects.create_user(username='exam-teacher-b', email='exam-teacher-b@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school_b)
        ExamResult.objects.create(school=self.school_b, exam=self.exam_b, student=self.student_b, marks_obtained=88, status=ExamResult.Status.SUBMITTED, entered_by=self.entered_by_b)
        self.client = APIClient()
        self.client.force_authenticate(self.admin_a)

    def test_school_admin_cannot_read_exam_results_from_another_school(self):
        response = self.client.get(f'/api/v1/students/{self.student_b.id}/results/')

        self.assertEqual(response.status_code, 404)


@override_settings(SECURE_SSL_REDIRECT=False)
class BulkExamResultsValidationTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Results School', code='bulk-results-school')
        self.teacher_user = User.objects.create_user(username='bulk-results-teacher', email='bulk-results-teacher@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school)
        classroom = Class.objects.create(school=self.school, name='8', code='class-8-results')
        section = Section.objects.create(school=self.school, class_room=classroom, name='A')
        subject = Subject.objects.create(school=self.school, name='Mathematics')
        classroom.subjects.add(subject)
        teacher = Teacher.objects.create(school=self.school, user=self.teacher_user, subjects=['Invented Legacy Subject'], assigned_sections=['9-Z'], joining_date=date.today(), phone='9000000200')
        teacher.sections.add(section)
        teacher.subject_records.add(subject)
        self.student = Student.objects.create(school=self.school, admission_no='R-001', name='Results Student', class_name='8', section='A', section_record=section, roll_no=1, parent_name='Parent', parent_phone='9000000201', parent_email='results-parent@example.com', dob='2012-01-01', gender='Female', academic_year='2026-27')
        self.exam = Exam.objects.create(school=self.school, name='Term One', class_name='8', section='A', subject='Mathematics', date=date.today(), time=time(9, 0), max_marks=100)
        self.client = APIClient()
        self.client.force_authenticate(self.teacher_user)

    def test_bulk_results_returns_row_level_errors_for_invalid_rows(self):
        response = self.client.post(f'/api/v1/exams/{self.exam.id}/results/submit/', {
            'results': [
                {'studentId': self.student.id, 'marksObtained': 101, 'status': 'submitted'},
                {'studentId': 999999, 'marksObtained': 70, 'status': 'submitted'},
            ],
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['errors'], [
            {'row': 1, 'student_id': self.student.id, 'field': 'marks_obtained', 'error': 'exceeds_max_marks'},
            {'row': 2, 'student_id': 999999, 'field': 'student_id', 'error': 'not_found_in_section'},
        ])


@override_settings(SECURE_SSL_REDIRECT=False)
class TeacherExamScopeTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Teacher Exam Scope', code='teacher-exam-scope')
        class_eight = Class.objects.create(school=self.school, name='8', code='exam-scope-8')
        class_nine = Class.objects.create(school=self.school, name='9', code='exam-scope-9')
        self.section_a = Section.objects.create(school=self.school, class_room=class_eight, name='A')
        self.section_b = Section.objects.create(school=self.school, class_room=class_eight, name='B')
        Section.objects.create(school=self.school, class_room=class_nine, name='A')
        mathematics = Subject.objects.create(school=self.school, name='Mathematics')
        science = Subject.objects.create(school=self.school, name='Science')
        class_eight.subjects.add(mathematics, science)
        class_nine.subjects.add(mathematics)
        self.teacher_user = User.objects.create_user(
            username='strict-exam-teacher', email='strict-exam-teacher@example.com',
            password='StrongPass123!', role=User.Role.TEACHER, school=self.school,
        )
        teacher = Teacher.objects.create(
            school=self.school, user=self.teacher_user, subjects=['Science'],
            assigned_sections=['8-B', '9-A'], joining_date=date.today(), phone='9000000300',
        )
        teacher.sections.add(self.section_a)
        teacher.subject_records.add(mathematics)
        self.visible_exam = Exam.objects.create(
            school=self.school, name='Visible Exam', class_name='8', section='A',
            subject='Mathematics', date=date.today(), time=time(9, 0), max_marks=100,
        )
        Exam.objects.create(
            school=self.school, name='Wrong Section', class_name='8', section='B',
            subject='Mathematics', date=date.today(), time=time(10, 0), max_marks=100,
        )
        Exam.objects.create(
            school=self.school, name='Legacy Subject', class_name='8', section='A',
            subject='Science', date=date.today(), time=time(11, 0), max_marks=100,
        )
        Exam.objects.create(
            school=self.school, name='Legacy Section', class_name='9', section='A',
            subject='Mathematics', date=date.today(), time=time(12, 0), max_marks=100,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.teacher_user)

    def test_teacher_exam_list_always_uses_canonical_section_and_subject(self):
        response = self.client.get('/api/v1/exams/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row['id'] for row in response.data['results']],
            [self.visible_exam.id],
        )

    def test_teacher_cannot_retrieve_exam_outside_canonical_assignment(self):
        outside_exam = Exam.objects.get(name='Wrong Section')

        response = self.client.get(f'/api/v1/exams/{outside_exam.id}/')

        self.assertEqual(response.status_code, 404)


@override_settings(SECURE_SSL_REDIRECT=False)
class ExamScheduleCreationAndPublishTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Schedule Test School', code='sched-sch')
        self.admin = User.objects.create_user(
            username='sched-admin', email='sched-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.class_3 = Class.objects.create(school=self.school, name='Class 3', code='c3')
        self.sec_a = Section.objects.create(school=self.school, class_room=self.class_3, name='A')
        self.sec_b = Section.objects.create(school=self.school, class_room=self.class_3, name='B')
        self.sec_c = Section.objects.create(school=self.school, class_room=self.class_3, name='C')

        self.sub_eng = Subject.objects.create(school=self.school, name='English')
        self.sub_math = Subject.objects.create(school=self.school, name='Mathematics')
        self.sub_sci = Subject.objects.create(school=self.school, name='Science')
        self.class_3.subjects.add(self.sub_eng, self.sub_math, self.sub_sci)

        # Create Teacher, Student, Parent
        self.teacher_user = User.objects.create_user(
            username='c3-teacher', email='c3-teacher@example.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=self.school,
        )
        teacher = Teacher.objects.create(school=self.school, user=self.teacher_user, joining_date=date.today(), phone='9000000400')
        teacher.sections.add(self.sec_a)
        teacher.subject_records.add(self.sub_eng)

        self.student_user = User.objects.create_user(
            username='c3-student', email='c3-student@example.com', password='StrongPass123!',
            role=User.Role.STUDENT, school=self.school,
        )
        self.student = Student.objects.create(
            school=self.school, admission_no='C3-001', name='C3 Student', class_name='Class 3',
            section='A', section_record=self.sec_a, roll_no=1, dob='2017-05-10', gender='Male', academic_year='2026-2027',
        )
        from apps.accounts.models import StudentProfile, ParentProfile
        StudentProfile.objects.create(user=self.student_user, student=self.student)

        self.parent_user = User.objects.create_user(
            username='c3-parent', email='c3-parent@example.com', password='StrongPass123!',
            role=User.Role.PARENT, school=self.school,
        )
        parent_profile = ParentProfile.objects.create(user=self.parent_user)
        parent_profile.students.add(self.student)

        self.client = APIClient()

    def test_schedule_creation_validation_and_publish_flow(self):
        # 1. Validation: End time <= Start time should fail
        self.client.force_authenticate(self.admin)
        invalid_payload = {
            'name': 'Term 1 Midterms',
            'classroom': self.class_3.id,
            'items': [
                {
                    'subject_name': 'English',
                    'exam_date': '2026-09-10',
                    'start_time': '10:00',
                    'end_time': '09:00', # INVALID: end before start
                    'max_marks': 100,
                }
            ]
        }
        res_invalid = self.client.post('/api/v1/exam-schedules/', invalid_payload, format='json')
        self.assertEqual(res_invalid.status_code, 400)

        # 2. Valid Draft Creation
        valid_payload = {
            'name': 'Term 1 Midterms',
            'classroom': self.class_3.id,
            'items': [
                {
                    'subject': self.sub_eng.id,
                    'subject_name': 'English',
                    'exam_date': '2026-09-10',
                    'start_time': '09:00',
                    'end_time': '12:00',
                    'max_marks': 100,
                    'order': 0,
                },
                {
                    'subject': self.sub_math.id,
                    'subject_name': 'Mathematics',
                    'exam_date': '2026-09-12',
                    'start_time': '09:00',
                    'end_time': '12:00',
                    'max_marks': 100,
                    'order': 1,
                },
                {
                    'subject': self.sub_sci.id,
                    'subject_name': 'Science',
                    'exam_date': '2026-09-14',
                    'start_time': '10:00',
                    'end_time': '13:00',
                    'max_marks': 100,
                    'order': 2,
                },
            ]
        }
        res_create = self.client.post('/api/v1/exam-schedules/', valid_payload, format='json')
        self.assertEqual(res_create.status_code, 201)
        schedule_id = res_create.data['id']
        self.assertEqual(res_create.data['status'], 'draft')
        self.assertEqual(len(res_create.data['items']), 3)
        self.assertEqual(res_create.data['sections'], ['A', 'B', 'C'])

        # 3. Before Publishing: Teacher, Student, Parent should NOT see the draft schedule
        self.client.force_authenticate(self.student_user)
        res_student_draft = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_student_draft.status_code, 200)
        self.assertEqual(len(res_student_draft.data['results']), 0)

        self.client.force_authenticate(self.parent_user)
        res_parent_draft = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_parent_draft.status_code, 200)
        self.assertEqual(len(res_parent_draft.data['results']), 0)

        self.client.force_authenticate(self.teacher_user)
        res_teacher_draft = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_teacher_draft.status_code, 200)
        self.assertEqual(len(res_teacher_draft.data['results']), 0)

        # 4. Admin publishes the schedule
        self.client.force_authenticate(self.admin)
        res_publish = self.client.post(f'/api/v1/exam-schedules/{schedule_id}/publish/')
        self.assertEqual(res_publish.status_code, 200)
        self.assertEqual(res_publish.data['status'], 'published')

        # 5. Verify Exam records created for all 3 sections (A, B, C) x 3 subjects = 9 Exam records
        from .models import Exam
        exams_created = Exam.objects.filter(school=self.school, schedule_id=schedule_id)
        self.assertEqual(exams_created.count(), 9)
        self.assertEqual(set(exams_created.values_list('section', flat=True)), {'A', 'B', 'C'})

        # 6. After Publishing: Student, Parent, Teacher can now see the published timetable
        self.client.force_authenticate(self.student_user)
        res_student_pub = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_student_pub.status_code, 200)
        self.assertEqual(len(res_student_pub.data['results']), 1)
        self.assertEqual(res_student_pub.data['results'][0]['id'], schedule_id)
        self.assertEqual(len(res_student_pub.data['results'][0]['items']), 3)

        self.client.force_authenticate(self.parent_user)
        res_parent_pub = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_parent_pub.status_code, 200)
        self.assertEqual(len(res_parent_pub.data['results']), 1)

        self.client.force_authenticate(self.teacher_user)
        res_teacher_pub = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_teacher_pub.status_code, 200)
        self.assertEqual(len(res_teacher_pub.data['results']), 1)


@override_settings(SECURE_SSL_REDIRECT=False)
class ExamScheduleMultiTenantIsolationTests(TestCase):
    def setUp(self):
        self.school_1 = School.objects.create(name='School 1', code='SCH-EX-1')
        self.school_2 = School.objects.create(name='School 2', code='SCH-EX-2')

        self.admin_1 = User.objects.create_user(
            username='admin-ex-1', email='admin1@schex.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN, school=self.school_1,
        )
        self.admin_2 = User.objects.create_user(
            username='admin-ex-2', email='admin2@schex.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN, school=self.school_2,
        )

        self.class_1_s1 = Class.objects.create(school=self.school_1, name='Class 1', code='c1-s1')
        self.class_1_s2 = Class.objects.create(school=self.school_2, name='Class 1', code='c1-s2')

        self.client = APIClient()

    def test_tenant_schedule_isolation(self):
        from .models import ExamSchedule, ExamScheduleItem
        sched_1 = ExamSchedule.objects.create(
            school=self.school_1, name='School 1 Exams', classroom=self.class_1_s1,
            class_name='Class 1', status=ExamSchedule.Status.PUBLISHED,
        )
        ExamScheduleItem.objects.create(
            schedule=sched_1, subject_name='Maths', exam_date='2026-09-10',
            start_time='09:00', end_time='12:00', max_marks=100,
        )

        sched_2 = ExamSchedule.objects.create(
            school=self.school_2, name='School 2 Exams', classroom=self.class_1_s2,
            class_name='Class 1', status=ExamSchedule.Status.PUBLISHED,
        )
        ExamScheduleItem.objects.create(
            schedule=sched_2, subject_name='Maths', exam_date='2026-09-10',
            start_time='09:00', end_time='12:00', max_marks=100,
        )

        # Admin 1 sees only sched_1
        self.client.force_authenticate(self.admin_1)
        res_1 = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_1.status_code, 200)
        ids_1 = [item['id'] for item in res_1.data['results']]
        self.assertIn(sched_1.id, ids_1)
        self.assertNotIn(sched_2.id, ids_1)

        # Admin 2 sees only sched_2
        self.client.force_authenticate(self.admin_2)
        res_2 = self.client.get('/api/v1/exam-schedules/')
        self.assertEqual(res_2.status_code, 200)
        ids_2 = [item['id'] for item in res_2.data['results']]
        self.assertIn(sched_2.id, ids_2)
        self.assertNotIn(sched_1.id, ids_2)


@override_settings(SECURE_SSL_REDIRECT=False)
class TeacherMarksEntryDeadlineTests(TestCase):
    def setUp(self):
        from datetime import date, timedelta
        self.school = School.objects.create(name='Deadline Test School', code='deadline-test-school')
        self.admin = User.objects.create_user(
            username='deadline-admin', email='deadline-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.teacher_user = User.objects.create_user(
            username='deadline-teacher', email='deadline-teacher@example.com',
            password='StrongPass123!', role=User.Role.TEACHER, school=self.school,
        )
        self.classroom = Class.objects.create(school=self.school, name='Grade 10', code='grade-10-dl')
        self.section = Section.objects.create(school=self.school, class_room=self.classroom, name='A')
        self.subject = Subject.objects.create(school=self.school, name='Physics')
        self.classroom.subjects.add(self.subject)

        self.teacher = Teacher.objects.create(
            school=self.school, user=self.teacher_user, subjects=['Physics'],
            assigned_sections=['Grade 10-A'], joining_date=date.today(), phone='9123456780',
        )
        self.teacher.sections.add(self.section)
        self.teacher.subject_records.add(self.subject)

        self.student = Student.objects.create(
            school=self.school, admission_no='PHY-001', name='Albert Einstein',
            class_name='Grade 10', section='A', section_record=self.section,
            roll_no=1, parent_name='Hermann', parent_phone='9123456781',
            parent_email='hermann@example.com', dob='2010-03-14', gender='Male',
        )

        self.client = APIClient()

    def test_teacher_can_enter_marks_within_3_days_of_exam_completion(self):
        from datetime import date, timedelta
        from .models import ExamSchedule, ExamScheduleItem, Exam

        # Exam completed yesterday (within 3 days)
        exam_date = date.today() - timedelta(days=1)
        schedule = ExamSchedule.objects.create(
            school=self.school, name='Midterm Exam', classroom=self.classroom,
            class_name='Grade 10', status=ExamSchedule.Status.PUBLISHED,
        )
        ExamScheduleItem.objects.create(
            schedule=schedule, subject=self.subject, subject_name='Physics',
            exam_date=exam_date, start_time='09:00', end_time='12:00', max_marks=100,
        )
        Exam.objects.create(
            school=self.school, schedule=schedule, name='Midterm Exam',
            class_name='Grade 10', section='A', subject='Physics',
            date=exam_date, time='09:00', end_time='12:00', max_marks=100,
        )

        # Teacher saves marks
        self.client.force_authenticate(self.teacher_user)
        save_resp = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/save-marks-sheet/',
            {
                'section': 'A',
                'status': 'submitted',
                'entries': [
                    {'student_id': self.student.id, 'subject_name': 'Physics', 'marks_obtained': 95}
                ],
            },
            format='json'
        )
        self.assertEqual(save_resp.status_code, 200)
        self.assertIn('Marks successfully saved', save_resp.data['detail'])

    def test_teacher_blocked_after_3_days_and_unblocked_after_admin_extension(self):
        from datetime import date, timedelta
        from .models import ExamSchedule, ExamScheduleItem, Exam

        # Exam completed 5 days ago (> 3 days window expired)
        exam_date = date.today() - timedelta(days=5)
        schedule = ExamSchedule.objects.create(
            school=self.school, name='Unit Test 1', classroom=self.classroom,
            class_name='Grade 10', status=ExamSchedule.Status.PUBLISHED,
        )
        ExamScheduleItem.objects.create(
            schedule=schedule, subject=self.subject, subject_name='Physics',
            exam_date=exam_date, start_time='09:00', end_time='12:00', max_marks=100,
        )
        Exam.objects.create(
            school=self.school, schedule=schedule, name='Unit Test 1',
            class_name='Grade 10', section='A', subject='Physics',
            date=exam_date, time='09:00', end_time='12:00', max_marks=100,
        )

        # 1. Teacher attempts to save marks -> Rejected with 403 Forbidden
        self.client.force_authenticate(self.teacher_user)
        save_resp = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/save-marks-sheet/',
            {
                'section': 'A',
                'status': 'submitted',
                'entries': [
                    {'student_id': self.student.id, 'subject_name': 'Physics', 'marks_obtained': 88}
                ],
            },
            format='json'
        )
        self.assertEqual(save_resp.status_code, 403)
        self.assertIn('closed', save_resp.data['detail'].lower())

        # 2. Admin extends the marks entry period by 3 days
        self.client.force_authenticate(self.admin)
        extend_resp = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/extend-marks-entry/',
            {
                'extension_days': 3,
                'reason': 'Teacher was on medical leave',
            },
            format='json'
        )
        self.assertEqual(extend_resp.status_code, 200)
        self.assertTrue(extend_resp.data['marks_entry_extended'])
        self.assertIn('extended', extend_resp.data['detail'].lower())

        # 3. Teacher now attempts to save marks -> Succeeds!
        self.client.force_authenticate(self.teacher_user)
        save_after_ext = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/save-marks-sheet/',
            {
                'section': 'A',
                'status': 'submitted',
                'entries': [
                    {'student_id': self.student.id, 'subject_name': 'Physics', 'marks_obtained': 88}
                ],
            },
            format='json'
        )
        self.assertEqual(save_after_ext.status_code, 200)
        self.assertIn('Marks successfully saved', save_after_ext.data['detail'])

    def test_admin_can_always_save_marks_regardless_of_deadline(self):
        from datetime import date, timedelta
        from .models import ExamSchedule, ExamScheduleItem, Exam

        # Exam completed 10 days ago (long expired)
        exam_date = date.today() - timedelta(days=10)
        schedule = ExamSchedule.objects.create(
            school=self.school, name='Old Exam', classroom=self.classroom,
            class_name='Grade 10', status=ExamSchedule.Status.PUBLISHED,
        )
        ExamScheduleItem.objects.create(
            schedule=schedule, subject=self.subject, subject_name='Physics',
            exam_date=exam_date, start_time='09:00', end_time='12:00', max_marks=100,
        )
        Exam.objects.create(
            school=self.school, schedule=schedule, name='Old Exam',
            class_name='Grade 10', section='A', subject='Physics',
            date=exam_date, time='09:00', end_time='12:00', max_marks=100,
        )

        # Admin saves marks -> Always succeeds
        self.client.force_authenticate(self.admin)
        admin_save = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/save-marks-sheet/',
            {
                'section': 'A',
                'status': 'submitted',
                'entries': [
                    {'student_id': self.student.id, 'subject_name': 'Physics', 'marks_obtained': 100}
                ],
            },
            format='json'
        )
        self.assertEqual(admin_save.status_code, 200)

    def test_section_specific_extension_allows_target_section_only(self):
        from datetime import date, timedelta
        from .models import ExamSchedule, ExamScheduleItem, Exam

        exam_date = date.today() - timedelta(days=5)
        schedule = ExamSchedule.objects.create(
            school=self.school, name='Multi Section Exam', classroom=self.classroom,
            class_name='Grade 10', status=ExamSchedule.Status.PUBLISHED,
        )
        ExamScheduleItem.objects.create(
            schedule=schedule, subject=self.subject, subject_name='Physics',
            exam_date=exam_date, start_time='09:00', end_time='12:00', max_marks=100,
        )
        # Create student and teacher for Section B
        sec_b = self.classroom.sections.create(school=self.school, name='B')
        student_b = Student.objects.create(
            school=self.school, admission_no='STU-10-B', name='Student B', class_name='Grade 10',
            section='B', section_record=sec_b, roll_no=2, dob='2010-02-02', gender='Female', academic_year='2026-2027',
        )
        teacher_b_user = User.objects.create_user(
            username='teacher-b', email='teacher-b@example.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=self.school, first_name='Teacher', last_name='Bravo'
        )
        teacher_b = Teacher.objects.create(school=self.school, user=teacher_b_user, joining_date=date.today(), phone='9000000999')
        teacher_b.sections.add(sec_b)
        teacher_b.subject_records.add(self.subject)

        # Admin extends Section A ONLY
        self.client.force_authenticate(self.admin)
        ext_resp = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/extend-marks-entry/',
            {
                'section': 'A',
                'extension_days': 3,
                'reason': 'Only section A lab reports delayed',
            },
            format='json'
        )
        self.assertEqual(ext_resp.status_code, 200)
        self.assertEqual(ext_resp.data['section'], 'A')

        # Teacher for Section A can save marks
        self.client.force_authenticate(self.teacher_user)
        save_a = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/save-marks-sheet/',
            {
                'section': 'A',
                'status': 'submitted',
                'entries': [{'student_id': self.student.id, 'subject_name': 'Physics', 'marks_obtained': 92}],
            },
            format='json'
        )
        self.assertEqual(save_a.status_code, 200)

        # Teacher for Section B is still blocked because Section B was NOT extended!
        self.client.force_authenticate(teacher_b_user)
        save_b = self.client.post(
            f'/api/v1/exam-schedules/{schedule.id}/save-marks-sheet/',
            {
                'section': 'B',
                'status': 'submitted',
                'entries': [{'student_id': student_b.id, 'subject_name': 'Physics', 'marks_obtained': 85}],
            },
            format='json'
        )
        self.assertEqual(save_b.status_code, 403)
        self.assertIn('closed', save_b.data['detail'].lower())

    def test_get_marks_sheet_returns_assigned_teachers_and_section_info(self):
        from datetime import date
        from .models import ExamSchedule, ExamScheduleItem

        schedule = ExamSchedule.objects.create(
            school=self.school, name='Teacher Visibility Exam', classroom=self.classroom,
            class_name='Grade 10', status=ExamSchedule.Status.PUBLISHED,
        )
        ExamScheduleItem.objects.create(
            schedule=schedule, subject=self.subject, subject_name='Physics',
            exam_date=date.today(), start_time='09:00', end_time='12:00', max_marks=100,
        )

        self.client.force_authenticate(self.admin)
        res = self.client.get(f'/api/v1/exam-schedules/{schedule.id}/marks-sheet/?section=A')
        self.assertEqual(res.status_code, 200)
        self.assertIn('assigned_teachers', res.data)
        self.assertIn('section_teachers', res.data)
        self.assertIn('section_extensions', res.data)
        self.assertEqual(res.data['section'], 'A')
        # Check that subject has teacher_name populated
        for sub in res.data['subjects']:
            self.assertIn('teacher_name', sub)


