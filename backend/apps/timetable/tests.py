from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import ParentProfile, StudentProfile, User
from apps.academics.models import AcademicYear, Class, Section, Subject
from apps.schools.models import School
from apps.sis.models import Student
from apps.staff.models import Teacher

from .models import TimetableSlot


@override_settings(SECURE_SSL_REDIRECT=False)
class TimetableSlotAPITests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Timetable School', code='timetable-school')
        self.other_school = School.objects.create(
            name='Other Timetable School', code='other-timetable-school',
        )
        self.admin = self.user('admin', User.Role.SCHOOL_ADMIN, self.school)
        self.other_admin = self.user('other-admin', User.Role.SCHOOL_ADMIN, self.other_school)
        self.year = AcademicYear.objects.create(
            school=self.school, name='2026-27', starts_on=date(2026, 4, 1),
            ends_on=date(2027, 3, 31), is_active=True,
        )
        self.other_year = AcademicYear.objects.create(
            school=self.other_school, name='2026-27', starts_on=date(2026, 4, 1),
            ends_on=date(2027, 3, 31), is_active=True,
        )
        self.classroom = Class.objects.create(
            school=self.school, name='Grade 9', code='grade-9',
        )
        self.other_classroom = Class.objects.create(
            school=self.other_school, name='Grade 9', code='grade-9',
        )
        self.section_a = Section.objects.create(
            school=self.school, class_room=self.classroom, name='A',
        )
        self.section_b = Section.objects.create(
            school=self.school, class_room=self.classroom, name='B',
        )
        self.other_section = Section.objects.create(
            school=self.other_school, class_room=self.other_classroom, name='A',
        )
        self.math = Subject.objects.create(school=self.school, name='Mathematics')
        self.science = Subject.objects.create(school=self.school, name='Science')
        self.unconfigured = Subject.objects.create(school=self.school, name='Drama')
        self.other_subject = Subject.objects.create(
            school=self.other_school, name='Mathematics',
        )
        self.classroom.subjects.add(self.math, self.science)
        self.other_classroom.subjects.add(self.other_subject)

        self.teacher_user = self.user('teacher', User.Role.TEACHER, self.school)
        self.teacher = Teacher.objects.create(
            school=self.school, user=self.teacher_user, joining_date=date(2025, 1, 1),
            phone='9000000001', status=Teacher.Status.ACTIVE,
        )
        self.teacher.sections.add(self.section_a)
        self.teacher.subject_records.add(self.math)
        self.second_teacher_user = self.user('teacher-two', User.Role.TEACHER, self.school)
        self.second_teacher = Teacher.objects.create(
            school=self.school, user=self.second_teacher_user,
            joining_date=date(2025, 1, 1), phone='9000000002',
            status=Teacher.Status.ACTIVE,
        )
        self.second_teacher.sections.add(self.section_b)
        self.second_teacher.subject_records.add(self.science)
        self.other_teacher_user = self.user(
            'other-teacher', User.Role.TEACHER, self.other_school,
        )
        self.other_teacher = Teacher.objects.create(
            school=self.other_school, user=self.other_teacher_user,
            joining_date=date(2025, 1, 1), phone='9000000003',
            status=Teacher.Status.ACTIVE,
        )
        self.other_teacher.sections.add(self.other_section)
        self.other_teacher.subject_records.add(self.other_subject)
        self.client = APIClient()

    @staticmethod
    def user(prefix, role, school):
        return User.objects.create_user(
            username=prefix, email=f'{prefix}@example.com', password='StrongPass123!',
            role=role, school=school, first_name=prefix.replace('-', ' ').title(),
        )

    def payload(self, **overrides):
        data = {
            'academicYear': self.year.name,
            'sectionId': self.section_a.pk,
            'day': 'Monday',
            'period': 1,
            'time': '08:30 AM - 09:15 AM',
            'subjectId': self.math.pk,
            'teacherId': self.teacher.pk,
            'classroom': 'Room 9A',
        }
        data.update(overrides)
        return data

    def slot(self, **overrides):
        data = {
            'school': self.school,
            'academic_year': self.year,
            'section': self.section_a,
            'subject': self.math,
            'teacher': self.teacher,
            'day': TimetableSlot.Day.MONDAY,
            'period': 1,
            'time_label': '08:30 AM - 09:15 AM',
            'classroom': 'Room 9A',
        }
        data.update(overrides)
        return TimetableSlot.objects.create(**data)

    def results(self, response):
        self.assertEqual(response.status_code, 200)
        return response.data['results']

    def test_school_admin_crud_persists_normalized_slot_and_maps_frontend_shape(self):
        self.client.force_authenticate(self.admin)

        created = self.client.post('/api/v1/timetable-slots/', self.payload(), format='json')

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data, {
            'id': str(TimetableSlot.objects.get().pk),
            'schoolId': str(self.school.pk),
            'academicYear': '2026-27',
            'class': 'Grade 9',
            'section': 'A',
            'sectionId': self.section_a.pk,
            'day': 'Monday',
            'period': 1,
            'time': '08:30 AM - 09:15 AM',
            'subject': 'Mathematics',
            'subjectId': self.math.pk,
            'teacherId': str(self.teacher.pk),
            'teacherName': 'Teacher',
            'classroom': 'Room 9A',
            'published': False,
        })
        stored = TimetableSlot.objects.get()
        self.assertEqual(stored.created_by, self.admin)
        updated = self.client.patch(
            f'/api/v1/timetable-slots/{stored.pk}/',
            {'classroom': 'Science Lab'}, format='json',
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data['classroom'], 'Science Lab')
        self.assertEqual(self.client.delete(
            f'/api/v1/timetable-slots/{stored.pk}/',
        ).status_code, 204)
        self.assertFalse(TimetableSlot.objects.exists())

    def test_publish_is_explicit_and_editing_live_slot_returns_it_to_draft(self):
        slot = self.slot()
        self.client.force_authenticate(self.admin)

        published = self.client.post('/api/v1/timetable-slots/publish/', {
            'academicYear': self.year.name, 'sectionId': self.section_a.pk,
        }, format='json')

        self.assertEqual(published.status_code, 200)
        self.assertEqual(published.data['updated'], 1)
        self.assertEqual(len(published.data['slots']), 1)
        self.assertTrue(published.data['slots'][0]['published'])
        slot.refresh_from_db()
        self.assertTrue(slot.published)

        edited = self.client.patch(
            f'/api/v1/timetable-slots/{slot.pk}/',
            {'classroom': 'Updated Room'}, format='json',
        )
        self.assertEqual(edited.status_code, 200)
        self.assertFalse(edited.data['published'])
        slot.refresh_from_db()
        self.assertFalse(slot.published)

    def test_create_rejects_cross_tenant_relations_without_writing(self):
        self.client.force_authenticate(self.admin)
        for field, foreign_id in [
            ('sectionId', self.other_section.pk),
            ('subjectId', self.other_subject.pk),
            ('teacherId', self.other_teacher.pk),
        ]:
            response = self.client.post(
                '/api/v1/timetable-slots/', self.payload(**{field: foreign_id}),
                format='json',
            )
            self.assertEqual(response.status_code, 400)
        wrong_school = self.client.post(
            '/api/v1/timetable-slots/',
            self.payload(schoolId=self.other_school.pk), format='json',
        )
        self.assertEqual(wrong_school.status_code, 400)
        self.assertFalse(TimetableSlot.objects.exists())

    def test_create_requires_subject_on_class_and_exact_teacher_scope(self):
        self.client.force_authenticate(self.admin)
        subject_not_on_class = self.client.post(
            '/api/v1/timetable-slots/', self.payload(subjectId=self.unconfigured.pk),
            format='json',
        )
        teacher_not_on_section = self.client.post(
            '/api/v1/timetable-slots/',
            self.payload(teacherId=self.second_teacher.pk), format='json',
        )
        self.teacher.subject_records.clear()
        teacher_not_on_subject = self.client.post(
            '/api/v1/timetable-slots/', self.payload(), format='json',
        )

        self.assertEqual(subject_not_on_class.status_code, 400)
        self.assertIn('subjectId', subject_not_on_class.data)
        self.assertEqual(teacher_not_on_section.status_code, 400)
        self.assertIn('teacherId', teacher_not_on_section.data)
        self.assertEqual(teacher_not_on_subject.status_code, 400)
        self.assertIn('teacherId', teacher_not_on_subject.data)
        self.assertFalse(TimetableSlot.objects.exists())

        invalid_period = self.client.post(
            '/api/v1/timetable-slots/', self.payload(period=0), format='json',
        )
        self.assertEqual(invalid_period.status_code, 400)
        self.assertIn('period', invalid_period.data)

    def test_unique_section_and_teacher_periods_return_validation_errors(self):
        self.slot()
        self.teacher.sections.add(self.section_b)
        self.teacher.subject_records.add(self.science)
        self.client.force_authenticate(self.admin)

        section_collision = self.client.post(
            '/api/v1/timetable-slots/', self.payload(subjectId=self.math.pk),
            format='json',
        )
        teacher_collision = self.client.post('/api/v1/timetable-slots/', self.payload(
            sectionId=self.section_b.pk, subjectId=self.science.pk,
        ), format='json')

        self.assertEqual(section_collision.status_code, 400)
        self.assertIn('period', section_collision.data)
        self.assertEqual(teacher_collision.status_code, 400)
        self.assertIn('teacherId', teacher_collision.data)
        self.assertEqual(TimetableSlot.objects.count(), 1)

    def test_full_weekly_schedule_exceeding_twenty_five_slots_returns_all_including_wednesday(self):
        self.client.force_authenticate(self.admin)
        days = [
            TimetableSlot.Day.MONDAY,
            TimetableSlot.Day.TUESDAY,
            TimetableSlot.Day.WEDNESDAY,
            TimetableSlot.Day.THURSDAY,
            TimetableSlot.Day.FRIDAY,
        ]
        # Create 30 slots (6 periods x 5 days) for section_a
        for day in days:
            for p in range(1, 7):
                self.slot(day=day, period=p)

        self.assertEqual(TimetableSlot.objects.count(), 30)
        response = self.client.get('/api/v1/timetable-slots/')
        rows = self.results(response)
        self.assertEqual(len(rows), 30)

        # Verify Wednesday slots are present and not omitted due to pagination
        wednesday_slots = [r for r in rows if r['day'] == 'Wednesday']
        self.assertEqual(len(wednesday_slots), 6)
        self.assertEqual([r['period'] for r in wednesday_slots], [1, 2, 3, 4, 5, 6])

        # Verify chronological day ordering: Monday precedes Wednesday, which precedes Friday
        days_in_order = [r['day'] for r in rows]
        monday_idx = days_in_order.index('Monday')
        wednesday_idx = days_in_order.index('Wednesday')
        friday_idx = days_in_order.index('Friday')
        self.assertTrue(monday_idx < wednesday_idx < friday_idx)

    def test_teacher_only_gets_own_published_slots(self):
        own = self.slot(published=True)
        self.slot(
            section=self.section_b, subject=self.science, teacher=self.second_teacher,
            day='Tuesday', published=True,
        )
        self.slot(day='Wednesday', period=2, published=False)
        self.client.force_authenticate(self.teacher_user)

        rows = self.results(self.client.get(
            '/api/v1/timetable-slots/?academicYear=2026-27',
        ))

        self.assertEqual([row['id'] for row in rows], [str(own.pk)])
        self.teacher.status = Teacher.Status.INACTIVE
        self.teacher.save(update_fields=['status'])
        self.assertEqual(
            self.results(self.client.get('/api/v1/timetable-slots/')), [],
        )

    def test_cross_tenant_teacher_profile_fails_closed(self):
        cross_user = self.user('cross-profile', User.Role.TEACHER, self.school)
        Teacher.objects.create(
            school=self.other_school, user=cross_user, joining_date=date(2025, 1, 1),
            phone='9000000040', status=Teacher.Status.ACTIVE,
        )
        TimetableSlot.objects.create(
            school=self.other_school, academic_year=self.other_year,
            section=self.other_section, subject=self.other_subject,
            teacher=cross_user.teacher_profile, day='Monday', period=1,
            time_label='08:30 AM - 09:15 AM', published=True,
        )
        self.client.force_authenticate(cross_user)

        self.assertEqual(
            self.results(self.client.get('/api/v1/timetable-slots/')), [],
        )

    def test_student_only_gets_published_slots_for_own_section(self):
        own = self.slot(published=True)
        self.slot(
            section=self.section_b, subject=self.science, teacher=self.second_teacher,
            day='Tuesday', published=True,
        )
        student = Student.objects.create(
            school=self.school, admission_no='TT-STUDENT', name='Student One',
            class_name='Grade 9', section='A', section_record=self.section_a,
            roll_no=1, parent_name='Parent', parent_phone='9000000010',
            parent_email='parent@example.com', dob=date(2012, 1, 1), gender='Female',
            academic_year='2026-27',
        )
        user = self.user('student', User.Role.STUDENT, self.school)
        StudentProfile.objects.create(user=user, student=student)
        self.client.force_authenticate(user)

        rows = self.results(self.client.get('/api/v1/timetable-slots/'))

        self.assertEqual([row['id'] for row in rows], [str(own.pk)])

    def test_parent_gets_published_slots_for_all_linked_wards_only(self):
        section_a_slot = self.slot(published=True)
        section_b_slot = self.slot(
            section=self.section_b, subject=self.science, teacher=self.second_teacher,
            day='Tuesday', published=True,
        )
        student_a = Student.objects.create(
            school=self.school, admission_no='TT-WARD-A', name='Ward A',
            class_name='Grade 9', section='A', section_record=self.section_a,
            roll_no=1, parent_name='Parent', parent_phone='9000000020',
            parent_email='parent2@example.com', dob=date(2012, 1, 1), gender='Female',
            academic_year='2026-27',
        )
        student_b = Student.objects.create(
            school=self.school, admission_no='TT-WARD-B', name='Ward B',
            class_name='Grade 9', section='B', section_record=self.section_b,
            roll_no=2, parent_name='Parent', parent_phone='9000000020',
            parent_email='parent2@example.com', dob=date(2012, 1, 1), gender='Male',
            academic_year='2026-27',
        )
        parent_user = self.user('parent', User.Role.PARENT, self.school)
        profile = ParentProfile.objects.create(user=parent_user, phone='9000000020')
        profile.students.add(student_a, student_b)
        self.client.force_authenticate(parent_user)

        rows = self.results(self.client.get('/api/v1/timetable-slots/'))

        self.assertEqual(
            {row['id'] for row in rows},
            {str(section_a_slot.pk), str(section_b_slot.pk)},
        )

    def test_non_admin_roles_cannot_mutate_or_publish(self):
        slot = self.slot(published=True)
        student = Student.objects.create(
            school=self.school, admission_no='TT-BLOCKED', name='Blocked Student',
            class_name='Grade 9', section='A', section_record=self.section_a,
            roll_no=3, parent_name='Parent', parent_phone='9000000030',
            parent_email='blocked-parent@example.com', dob=date(2012, 1, 1),
            gender='Female', academic_year='2026-27',
        )
        student_user = self.user('blocked-student', User.Role.STUDENT, self.school)
        StudentProfile.objects.create(user=student_user, student=student)

        for user in [self.teacher_user, student_user]:
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post(
                '/api/v1/timetable-slots/', self.payload(period=3), format='json',
            ).status_code, 403)
            self.assertEqual(self.client.patch(
                f'/api/v1/timetable-slots/{slot.pk}/', {'classroom': 'Blocked'},
                format='json',
            ).status_code, 403)
            self.assertEqual(self.client.post(
                '/api/v1/timetable-slots/publish/', {
                    'academicYear': self.year.name, 'sectionId': self.section_a.pk,
                }, format='json',
            ).status_code, 403)

    def test_role_without_school_tenant_is_denied(self):
        tenantless = self.user('tenantless-admin', User.Role.SCHOOL_ADMIN, None)
        self.client.force_authenticate(tenantless)

        self.assertEqual(self.client.get('/api/v1/timetable-slots/').status_code, 403)
        self.assertEqual(self.client.post(
            '/api/v1/timetable-slots/', self.payload(), format='json',
        ).status_code, 403)

    def test_school_admin_cannot_read_or_mutate_another_tenants_slot(self):
        foreign = TimetableSlot.objects.create(
            school=self.other_school, academic_year=self.other_year,
            section=self.other_section, subject=self.other_subject,
            teacher=self.other_teacher, day='Monday', period=1,
            time_label='08:30 AM - 09:15 AM', published=True,
        )
        self.client.force_authenticate(self.admin)

        self.assertEqual(self.results(self.client.get('/api/v1/timetable-slots/')), [])
        self.assertEqual(self.client.get(
            f'/api/v1/timetable-slots/{foreign.pk}/',
        ).status_code, 404)
        self.assertEqual(self.client.patch(
            f'/api/v1/timetable-slots/{foreign.pk}/', {'classroom': 'Hacked'},
            format='json',
        ).status_code, 404)
        foreign.refresh_from_db()
        self.assertEqual(foreign.classroom, 'Default')
