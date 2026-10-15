from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.models import ParentProfile, StudentProfile
from apps.attendance.models import AttendanceRecord, AttendanceAuditLog
from apps.academics.models import Class, Section, Subject, AcademicYear
from apps.schools.models import School
from apps.sis.models import Student
from apps.staff.models import Teacher
from apps.timetable.models import TimetableSlot


@override_settings(SECURE_SSL_REDIRECT=False)
class AttendanceRoleAccessTests(TestCase):
    def test_parent_cannot_mark_attendance(self):
        school = School.objects.create(name='Attendance School', code='attendance-school')
        parent = User.objects.create_user(username='attendance-parent', email='attendance-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=school)
        student = Student.objects.create(school=school, admission_no='ATT-001', name='Attendance Student', class_name='8', section='A', roll_no=1, parent_name='Parent', parent_phone='9300000000', parent_email='attendance-parent@example.com', dob='2012-01-01', gender='Female', academic_year='2026-27')
        client = APIClient()
        client.force_authenticate(parent)

        response = client.put('/api/v1/attendance/mark/', {'studentId': student.id, 'date': str(date.today()), 'period': 1, 'status': 'Present'}, format='json')

        self.assertEqual(response.status_code, 403)

    def test_roles_only_receive_permitted_attendance_records(self):
        school = School.objects.create(name='Attendance Scope', code='attendance-scope')
        other_school = School.objects.create(name='Other Attendance Scope', code='other-attendance-scope')
        student = Student.objects.create(school=school, admission_no='ATT-S-1', name='Own Student', class_name='8', section='A', roll_no=1, parent_name='Parent', parent_phone='9300000001', parent_email='scope-parent@example.com', dob='2012-01-01', gender='Female', academic_year='2026-27')
        other_student = Student.objects.create(school=school, admission_no='ATT-S-2', name='Other Student', class_name='9', section='B', roll_no=2, parent_name='Other Parent', parent_phone='9300000002', parent_email='other-parent@example.com', dob='2012-01-01', gender='Female', academic_year='2026-27')
        foreign_student = Student.objects.create(school=other_school, admission_no='ATT-S-3', name='Foreign Student', class_name='8', section='A', roll_no=1, parent_name='Foreign Parent', parent_phone='9300000003', parent_email='foreign-parent@example.com', dob='2012-01-01', gender='Female', academic_year='2026-27')
        AttendanceRecord.objects.create(school=school, student=student, date=date.today(), period=1, status='Present')
        AttendanceRecord.objects.create(school=school, student=other_student, date=date.today(), period=1, status='Absent')
        AttendanceRecord.objects.create(school=other_school, student=foreign_student, date=date.today(), period=1, status='Present')
        parent = User.objects.create_user(username='scope-parent', email='scope-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=school)
        parent_profile = ParentProfile.objects.create(user=parent, phone='9400000001')
        parent_profile.students.add(student)
        learner = User.objects.create_user(username='scope-student', email='scope-student@example.com', password='StrongPass123!', role=User.Role.STUDENT, school=school)
        StudentProfile.objects.create(user=learner, student=student)
        client = APIClient()
        for user in [parent, learner]:
            client.force_authenticate(user)
            response = client.get('/api/v1/attendance/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.data['results']), 1)
            self.assertEqual(response.data['results'][0]['studentId'], student.id)

    def test_teacher_can_read_and_mark_only_canonically_assigned_section(self):
        school = School.objects.create(name='Canonical Attendance', code='canonical-attendance')
        classroom = Class.objects.create(school=school, name='Grade 8', code='grade-8')
        assigned_section = Section.objects.create(school=school, class_room=classroom, name='A')
        outside_section = Section.objects.create(school=school, class_room=classroom, name='B')
        assigned_student = Student.objects.create(
            school=school, admission_no='CAN-ATT-1', name='Assigned Student',
            class_name=classroom.name, section=assigned_section.name,
            section_record=assigned_section, roll_no=1, parent_name='Parent One',
            parent_phone='9300000011', parent_email='assigned-attendance@example.com',
            dob='2012-01-01', gender='Female', academic_year='2026-27',
        )
        outside_student = Student.objects.create(
            school=school, admission_no='CAN-ATT-2', name='Outside Student',
            class_name=classroom.name, section=outside_section.name,
            section_record=outside_section, roll_no=2, parent_name='Parent Two',
            parent_phone='9300000012', parent_email='outside-attendance@example.com',
            dob='2012-01-01', gender='Male', academic_year='2026-27',
        )
        AttendanceRecord.objects.create(
            school=school, student=assigned_student, date=date.today(), period=1, status='Present',
        )
        AttendanceRecord.objects.create(
            school=school, student=outside_student, date=date.today(), period=1, status='Absent',
        )
        teacher_user = User.objects.create_user(
            username='canonical-attendance-teacher',
            email='canonical-attendance-teacher@example.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=school,
        )
        teacher = Teacher.objects.create(
            school=school, user=teacher_user, joining_date=date.today(),
            phone='9300000013', assigned_sections=['Grade 8-B'],
        )
        teacher.sections.add(assigned_section)
        client = APIClient()
        client.force_authenticate(teacher_user)

        listing = client.get('/api/v1/attendance/')
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(
            [row['studentId'] for row in listing.data['results']],
            [assigned_student.id],
        )

        permitted = client.put('/api/v1/attendance/mark/', {
            'studentId': assigned_student.id, 'date': str(date.today()), 'period': 1, 'status': 'Late',
        }, format='json')
        self.assertEqual(permitted.status_code, 200)
        denied = client.put('/api/v1/attendance/mark/', {
            'studentId': outside_student.id, 'date': str(date.today()), 'period': 1, 'status': 'Present',
        }, format='json')
        self.assertEqual(denied.status_code, 403)

    def test_multiple_periods_and_timetable_slot_teacher_authorization(self):
        school = School.objects.create(name='Period School', code='period-school')
        year = AcademicYear.objects.create(school=school, name='2026-27', starts_on=date(2026, 6, 1), ends_on=date(2027, 5, 31))
        classroom = Class.objects.create(school=school, name='Class 10', code='c10')
        sec = Section.objects.create(school=school, class_room=classroom, name='A')
        student = Student.objects.create(
            school=school, admission_no='P-001', name='Rahul',
            class_name='Class 10', section='A', section_record=sec, roll_no=1,
            parent_name='Parent', parent_phone='9000000000', parent_email='p@example.com',
            dob='2010-01-01', gender='Male', academic_year='2026-27',
        )

        english = Subject.objects.create(school=school, name='English')
        kannada = Subject.objects.create(school=school, name='Kannada')

        u_gagan = User.objects.create_user(username='gagan', email='gagan@school.edu', password='Pass123!', role=User.Role.TEACHER, school=school)
        t_gagan = Teacher.objects.create(school=school, user=u_gagan, phone='9000000001', joining_date=date.today())
        t_gagan.sections.add(sec)

        u_schain = User.objects.create_user(username='schain', email='schain@school.edu', password='Pass123!', role=User.Role.TEACHER, school=school)
        t_schain = Teacher.objects.create(school=school, user=u_schain, phone='9000000002', joining_date=date.today())
        t_schain.sections.add(sec)

        today_day = date.today().strftime('%A')

        # Slot 1: Period 1 -> English -> Teacher Gagan
        slot1 = TimetableSlot.objects.create(
            school=school, academic_year=year, section=sec, subject=english, teacher=t_gagan,
            day=today_day, period=1, time_label='8:30 AM - 9:15 AM', published=True,
        )

        # Slot 2: Period 2 -> Kannada -> Teacher Schain
        slot2 = TimetableSlot.objects.create(
            school=school, academic_year=year, section=sec, subject=kannada, teacher=t_schain,
            day=today_day, period=2, time_label='9:15 AM - 10:00 AM', published=True,
        )

        client = APIClient()

        # 1. Gagan marks Period 1 (English) -> Allowed
        client.force_authenticate(u_gagan)
        r1 = client.put('/api/v1/attendance/mark/', {
            'studentId': student.id, 'date': str(date.today()), 'period': 1, 'status': 'Present',
        }, format='json')
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.data['period'], 1)
        self.assertEqual(r1.data['subjectName'], 'English')

        # 2. Gagan attempts to mark Period 2 (Schain's Kannada class) -> Denied 403 Forbidden!
        r2 = client.put('/api/v1/attendance/mark/', {
            'studentId': student.id, 'date': str(date.today()), 'period': 2, 'status': 'Present',
        }, format='json')
        self.assertEqual(r2.status_code, 403)

        # 3. Schain marks Period 2 (Kannada) -> Allowed
        client.force_authenticate(u_schain)
        r3 = client.put('/api/v1/attendance/mark/', {
            'studentId': student.id, 'date': str(date.today()), 'period': 2, 'status': 'Absent',
        }, format='json')
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.data['period'], 2)
        self.assertEqual(r3.data['subjectName'], 'Kannada')

        # 4. Verify multiple period records exist for Rahul on the same date!
        records = AttendanceRecord.objects.filter(student=student, date=date.today()).order_by('period')
        self.assertEqual(records.count(), 2)
        self.assertEqual(records[0].period, 1)
        self.assertEqual(records[0].status, 'Present')
        self.assertEqual(records[1].period, 2)
        self.assertEqual(records[1].status, 'Absent')
