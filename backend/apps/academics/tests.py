from datetime import date, time

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import StudentProfile, User
from apps.exams.models import Exam
from apps.schools.models import School
from apps.sis.models import AcademicHistory, Student
from apps.staff.models import Teacher

from .models import AcademicYear, Class, Section, Subject


class AcademicTenantAccessTests(TestCase):
    def setUp(self):
        self.school_a = School.objects.create(name='School A', code='school-a-academic')
        self.school_b = School.objects.create(name='School B', code='school-b-academic')
        self.admin_a = User.objects.create_user(username='admin-a-academic', email='admin-a-academic@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school_a)
        self.teacher_a = User.objects.create_user(username='teacher-a-academic', email='teacher-a-academic@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school_a)
        self.class_b = Class.objects.create(school=self.school_b, name='Grade 8', code='grade-8')
        self.client = APIClient()

    def test_school_admin_creates_and_reads_only_own_academic_data(self):
        self.client.force_authenticate(self.admin_a)
        create = self.client.post('/api/v1/classes/', {'name': 'Grade 7', 'code': 'grade-7'}, format='json')
        self.assertEqual(create.status_code, 201)
        self.assertEqual(create.data['name'], 'Grade 7')
        self.assertEqual(self.client.get(f'/api/v1/classes/{self.class_b.id}/').status_code, 404)

    def test_teacher_can_read_but_cannot_create_class(self):
        self.client.force_authenticate(self.teacher_a)
        self.assertEqual(self.client.get('/api/v1/classes/').status_code, 200)
        response = self.client.post('/api/v1/classes/', {'name': 'Grade 6', 'code': 'grade-6'}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_new_school_has_no_automatic_classes_or_sections(self):
        school = School.objects.create(name='Admin Managed Structure', code='admin-managed-structure')
        self.assertFalse(Class.objects.filter(school=school).exists())
        self.assertFalse(Section.objects.filter(school=school).exists())

    def test_admin_creates_multiple_classes_and_sections_without_duplicates(self):
        self.client.force_authenticate(self.admin_a)
        classroom = self.client.post('/api/v1/classes/', {'name': 'Grade 10', 'code': 'grade-10'}, format='json')
        self.assertEqual(classroom.status_code, 201)
        section = self.client.post('/api/v1/sections/', {'classId': classroom.data['id'], 'name': 'A'}, format='json')
        self.assertEqual(section.status_code, 201)
        duplicate = self.client.post('/api/v1/sections/', {'classId': classroom.data['id'], 'name': 'A'}, format='json')
        self.assertEqual(duplicate.status_code, 400)

    def test_only_admin_creates_subjects_without_duplicates(self):
        self.client.force_authenticate(self.admin_a)
        created = self.client.post('/api/v1/subjects/', {'name': 'Mathematics'}, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertTrue(Subject.objects.filter(school=self.school_a, name='Mathematics').exists())
        self.assertEqual(self.client.post('/api/v1/subjects/', {'name': 'mathematics'}, format='json').status_code, 400)

        self.client.force_authenticate(self.teacher_a)
        self.assertEqual(self.client.get('/api/v1/subjects/').status_code, 200)
        self.assertEqual(self.client.post('/api/v1/subjects/', {'name': 'Science'}, format='json').status_code, 403)

    def test_visible_subjects_for_teacher_are_limited_to_own_assignments(self):
        classroom = Class.objects.create(
            school=self.school_a, name='Grade 9', code='grade-9-visible-teacher',
        )
        section = Section.objects.create(
            school=self.school_a, class_room=classroom, name='A',
        )
        mathematics = Subject.objects.create(school=self.school_a, name='Mathematics')
        science = Subject.objects.create(school=self.school_a, name='Science')
        music = Subject.objects.create(school=self.school_a, name='Music')
        foreign = Subject.objects.create(school=self.school_b, name='Foreign Subject')
        classroom.subjects.add(mathematics, science)
        teacher = Teacher.objects.create(
            school=self.school_a, user=self.teacher_a, joining_date=date(2025, 1, 1),
            phone='9000000123', subjects=['Mathematics', 'Music'],
            assigned_sections=['Grade 9-A'],
        )
        teacher.sections.add(section)
        # Include a deliberately invalid foreign relation to prove the response
        # applies tenant filtering even if old data was manually corrupted.
        teacher.subject_records.add(mathematics, music, foreign)
        self.client.force_authenticate(self.teacher_a)

        response = self.client.get('/api/v1/subjects/visible/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['scopeKind'], 'teacher_assignment')
        self.assertEqual(response.data['teacherId'], teacher.id)
        subjects = {item['name']: item for item in response.data['subjects']}
        self.assertEqual(set(subjects), {'Mathematics', 'Music'})
        self.assertEqual(subjects['Mathematics']['scopes'], [{
            'classId': classroom.id,
            'className': 'Grade 9',
            'sectionId': section.id,
            'sectionName': 'A',
        }])
        self.assertEqual(subjects['Music']['scopes'], [])
        self.assertNotIn('Science', subjects)
        self.assertNotIn('Foreign Subject', subjects)

    def test_visible_subjects_for_student_come_only_from_own_class(self):
        classroom = Class.objects.create(
            school=self.school_a, name='Grade 8', code='grade-8-visible-student',
        )
        other_class = Class.objects.create(
            school=self.school_a, name='Grade 10', code='grade-10-visible-student',
        )
        section = Section.objects.create(
            school=self.school_a, class_room=classroom, name='B',
        )
        mathematics = Subject.objects.create(school=self.school_a, name='Mathematics')
        science = Subject.objects.create(school=self.school_a, name='Science')
        classroom.subjects.add(mathematics)
        other_class.subjects.add(science)
        student = Student.objects.create(
            school=self.school_a, admission_no='VISIBLE-001', name='Visible Student',
            class_name='Grade 8', section='B', section_record=section, roll_no=1,
            parent_name='Visible Parent', parent_phone='9000000456',
            parent_email='visible-parent@example.com', dob=date(2012, 1, 1),
            gender='Female', academic_year='2026-27',
        )
        student_user = User.objects.create_user(
            username='visible-student', email='visible-student@example.com',
            password='StrongPass123!', role=User.Role.STUDENT, school=self.school_a,
        )
        StudentProfile.objects.create(user=student_user, student=student)
        self.client.force_authenticate(student_user)

        response = self.client.get('/api/v1/subjects/visible/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['scopeKind'], 'student_class')
        self.assertEqual(response.data['teacherId'], None)
        self.assertEqual(response.data['subjects'], [{
            'id': mathematics.id,
            'name': 'Mathematics',
            'scopes': [{
                'classId': classroom.id,
                'className': 'Grade 8',
                'sectionId': section.id,
                'sectionName': 'B',
            }],
        }])

    def test_generic_academic_lists_are_scoped_to_teacher_assignments(self):
        assigned_class = Class.objects.create(
            school=self.school_a, name='Assigned Grade', code='assigned-grade',
        )
        hidden_class = Class.objects.create(
            school=self.school_a, name='Hidden Grade', code='hidden-grade',
        )
        assigned_section = Section.objects.create(
            school=self.school_a, class_room=assigned_class, name='A',
        )
        hidden_section = Section.objects.create(
            school=self.school_a, class_room=hidden_class, name='B',
        )
        assigned_subject = Subject.objects.create(school=self.school_a, name='Assigned Subject')
        hidden_subject = Subject.objects.create(school=self.school_a, name='Hidden Subject')
        assigned_class.subjects.add(assigned_subject)
        hidden_class.subjects.add(hidden_subject)
        teacher = Teacher.objects.create(
            school=self.school_a, user=self.teacher_a, joining_date=date(2025, 1, 1),
            phone='9000000789', subjects=['Assigned Subject'],
            assigned_sections=['Assigned Grade-A'],
        )
        teacher.sections.add(assigned_section)
        teacher.subject_records.add(assigned_subject)
        self.client.force_authenticate(self.teacher_a)

        responses = {
            'classes': self.client.get('/api/v1/classes/'),
            'sections': self.client.get('/api/v1/sections/'),
            'subjects': self.client.get('/api/v1/subjects/'),
        }

        for response in responses.values():
            self.assertEqual(response.status_code, 200)
        rows = {
            key: (response.data if isinstance(response.data, list) else response.data['results'])
            for key, response in responses.items()
        }
        self.assertEqual([item['id'] for item in rows['classes']], [assigned_class.id])
        self.assertEqual([item['id'] for item in rows['sections']], [assigned_section.id])
        self.assertEqual([item['id'] for item in rows['subjects']], [assigned_subject.id])
        self.assertNotIn(hidden_class.id, [item['id'] for item in rows['classes']])
        self.assertNotIn(hidden_section.id, [item['id'] for item in rows['sections']])
        self.assertNotIn(hidden_subject.id, [item['id'] for item in rows['subjects']])

        teacher.status = Teacher.Status.INACTIVE
        teacher.save(update_fields=['status'])
        for path in ['/api/v1/classes/', '/api/v1/sections/', '/api/v1/subjects/']:
            inactive_response = self.client.get(path)
            inactive_rows = (
                inactive_response.data if isinstance(inactive_response.data, list)
                else inactive_response.data['results']
            )
            self.assertEqual(inactive_rows, [])
        inactive_visible = self.client.get('/api/v1/subjects/visible/')
        self.assertEqual(inactive_visible.data['teacherId'], None)
        self.assertEqual(inactive_visible.data['subjects'], [])

    def test_generic_academic_lists_are_scoped_to_student_class(self):
        own_class = Class.objects.create(
            school=self.school_a, name='Student Grade', code='student-grade',
        )
        hidden_class = Class.objects.create(
            school=self.school_a, name='Other Grade', code='other-grade',
        )
        own_section = Section.objects.create(
            school=self.school_a, class_room=own_class, name='A',
        )
        Section.objects.create(school=self.school_a, class_room=hidden_class, name='A')
        own_subject = Subject.objects.create(school=self.school_a, name='Student Subject')
        hidden_subject = Subject.objects.create(school=self.school_a, name='Other Subject')
        own_class.subjects.add(own_subject)
        hidden_class.subjects.add(hidden_subject)
        student = Student.objects.create(
            school=self.school_a, admission_no='SCOPED-001', name='Scoped Student',
            class_name='Student Grade', section='A', section_record=own_section, roll_no=1,
            parent_name='Scoped Parent', parent_phone='9000000999',
            parent_email='scoped-parent@example.com', dob=date(2012, 1, 1),
            gender='Female', academic_year='2026-27',
        )
        student_user = User.objects.create_user(
            username='scoped-student', email='scoped-student@example.com',
            password='StrongPass123!', role=User.Role.STUDENT, school=self.school_a,
        )
        StudentProfile.objects.create(user=student_user, student=student)
        self.client.force_authenticate(student_user)

        class_response = self.client.get('/api/v1/classes/')
        section_response = self.client.get('/api/v1/sections/')
        subject_response = self.client.get('/api/v1/subjects/')
        class_rows = class_response.data if isinstance(class_response.data, list) else class_response.data['results']
        section_rows = section_response.data if isinstance(section_response.data, list) else section_response.data['results']
        subject_rows = subject_response.data if isinstance(subject_response.data, list) else subject_response.data['results']

        self.assertEqual([item['id'] for item in class_rows], [own_class.id])
        self.assertEqual([item['id'] for item in section_rows], [own_section.id])
        self.assertEqual([item['id'] for item in subject_rows], [own_subject.id])

    def test_section_rejects_class_from_another_school(self):
        self.client.force_authenticate(self.admin_a)
        response = self.client.post('/api/v1/sections/', {'classId': self.class_b.id, 'name': 'A'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_super_admin_cannot_create_academic_year(self):
        super_admin = User.objects.create_superuser(username='super-academic', email='super-academic@example.com', password='StrongPass123!', role=User.Role.SUPER_ADMIN)
        self.client.force_authenticate(super_admin)
        response = self.client.post('/api/v1/academic-years/', {'schoolId': self.school_b.id, 'name': '2026-27', 'startsOn': '2026-04-01', 'endsOn': '2027-03-31', 'is_active': True}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(AcademicYear.objects.filter(school=self.school_b, name='2026-27').exists())

    def test_academic_year_crud_is_persisted_and_only_one_year_is_active(self):
        self.client.force_authenticate(self.admin_a)
        first = self.client.post('/api/v1/academic-years/', {
            'name': '2025-26', 'startsOn': '2025-04-01', 'endsOn': '2026-03-31',
            'is_active': True,
        }, format='json')
        self.assertEqual(first.status_code, 201)
        second = self.client.post('/api/v1/academic-years/', {
            'name': '2026-27', 'startsOn': '2026-04-01', 'endsOn': '2027-03-31',
            'is_active': True,
        }, format='json')
        self.assertEqual(second.status_code, 201)
        self.assertFalse(AcademicYear.objects.get(pk=first.data['id']).is_active)
        self.assertTrue(AcademicYear.objects.get(pk=second.data['id']).is_active)

        updated = self.client.patch(
            f"/api/v1/academic-years/{second.data['id']}/",
            {'name': '2026-28', 'endsOn': '2028-03-31'},
            format='json',
        )
        self.assertEqual(updated.status_code, 200)
        stored = AcademicYear.objects.get(pk=second.data['id'])
        self.assertEqual(stored.name, '2026-28')
        self.assertEqual(stored.ends_on, date(2028, 3, 31))

        deleted = self.client.delete(f"/api/v1/academic-years/{first.data['id']}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(AcademicYear.objects.filter(pk=first.data['id']).exists())

    def test_academic_year_rejects_duplicate_name_and_invalid_dates(self):
        AcademicYear.objects.create(
            school=self.school_a, name='2026-27', starts_on=date(2026, 4, 1),
            ends_on=date(2027, 3, 31),
        )
        self.client.force_authenticate(self.admin_a)
        duplicate = self.client.post('/api/v1/academic-years/', {
            'name': '2026-27', 'startsOn': '2026-04-01', 'endsOn': '2027-03-31',
        }, format='json')
        self.assertEqual(duplicate.status_code, 400)
        invalid_dates = self.client.post('/api/v1/academic-years/', {
            'name': '2027-28', 'startsOn': '2028-04-01', 'endsOn': '2028-03-31',
        }, format='json')
        self.assertEqual(invalid_dates.status_code, 400)

    def test_class_can_assign_update_and_clear_multiple_subjects(self):
        mathematics = Subject.objects.create(school=self.school_a, name='Mathematics')
        science = Subject.objects.create(school=self.school_a, name='Science')
        self.client.force_authenticate(self.admin_a)

        created = self.client.post('/api/v1/classes/', {
            'name': 'Grade 9', 'code': 'grade-9', 'sortOrder': 9,
            'subjectIds': [mathematics.id, science.id],
        }, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(set(created.data['subjectIds']), {mathematics.id, science.id})
        classroom = Class.objects.get(pk=created.data['id'])
        self.assertEqual(classroom.sort_order, 9)
        self.assertEqual(set(classroom.subjects.values_list('id', flat=True)), {mathematics.id, science.id})

        updated = self.client.patch(
            f'/api/v1/classes/{classroom.id}/', {'subjectIds': [science.id]}, format='json',
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(list(classroom.subjects.values_list('id', flat=True)), [science.id])

        cleared = self.client.patch(
            f'/api/v1/classes/{classroom.id}/', {'subjectIds': []}, format='json',
        )
        self.assertEqual(cleared.status_code, 200)
        self.assertFalse(classroom.subjects.exists())

    def test_class_rejects_cross_tenant_subject_without_changing_database(self):
        own_subject = Subject.objects.create(school=self.school_a, name='Mathematics')
        foreign_subject = Subject.objects.create(school=self.school_b, name='Foreign Mathematics')
        classroom = Class.objects.create(school=self.school_a, name='Grade 9', code='grade-9')
        classroom.subjects.add(own_subject)
        self.client.force_authenticate(self.admin_a)

        response = self.client.patch(
            f'/api/v1/classes/{classroom.id}/',
            {'subjectIds': [foreign_subject.id]},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(list(classroom.subjects.values_list('id', flat=True)), [own_subject.id])

    def test_safe_delete_returns_conflict_for_referenced_records(self):
        classroom = Class.objects.create(school=self.school_a, name='Grade 9', code='grade-9')
        section = Section.objects.create(school=self.school_a, class_room=classroom, name='A')
        subject = Subject.objects.create(school=self.school_a, name='Mathematics')
        classroom.subjects.add(subject)
        Student.objects.create(
            school=self.school_a, admission_no='SAFE-001', name='Safe Delete Student',
            class_name='Grade 9', section='A', section_record=section, roll_no=1,
            parent_name='Parent', parent_phone='9000000010',
            parent_email='safe-delete@example.com', dob=date(2012, 1, 1),
            gender='Female', academic_year='2026-27',
        )
        self.client.force_authenticate(self.admin_a)

        class_response = self.client.delete(f'/api/v1/classes/{classroom.id}/')
        section_response = self.client.delete(f'/api/v1/sections/{section.id}/')
        subject_response = self.client.delete(f'/api/v1/subjects/{subject.id}/')
        self.assertEqual(class_response.status_code, 409)
        self.assertEqual(section_response.status_code, 409)
        self.assertEqual(subject_response.status_code, 409)
        self.assertEqual(class_response.data['code'], 'record_in_use')
        self.assertEqual(class_response.data['resource'], {
            'type': 'class', 'id': classroom.id, 'name': 'Grade 9',
        })
        class_references = {
            reference['code']: reference for reference in class_response.data['references']
        }
        self.assertEqual(class_references['sections']['count'], 1)
        self.assertEqual(class_references['sections']['deletionPolicy'], 'cascade')
        self.assertEqual(class_references['students']['count'], 1)
        self.assertEqual(class_references['students']['deletionPolicy'], 'blocked')
        self.assertFalse(class_response.data['canCascade'])
        self.assertTrue(Class.objects.filter(pk=classroom.id).exists())
        self.assertTrue(Section.objects.filter(pk=section.id).exists())
        self.assertTrue(Subject.objects.filter(pk=subject.id).exists())

    def test_class_delete_offers_explicit_safe_cascade_for_empty_sections(self):
        classroom = Class.objects.create(school=self.school_a, name='Grade 6', code='grade-6')
        section = Section.objects.create(school=self.school_a, class_room=classroom, name='A')
        subject = Subject.objects.create(school=self.school_a, name='Science')
        classroom.subjects.add(subject)
        teacher = Teacher.objects.create(
            school=self.school_a, user=self.teacher_a, joining_date=date(2025, 1, 1),
            phone='9000000001', subjects=['Science'], assigned_sections=['Grade 6-A'],
        )
        teacher.sections.add(section)
        teacher.subject_records.add(subject)
        self.client.force_authenticate(self.admin_a)

        response = self.client.delete(f'/api/v1/classes/{classroom.id}/')

        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.data['canCascade'])
        self.assertEqual(response.data['cascadeParam'], 'sections')
        references = {item['code']: item for item in response.data['references']}
        self.assertEqual(references['sections']['count'], 1)
        self.assertEqual(references['teacher_assignments']['deletionPolicy'], 'detach')
        self.assertEqual(references['subject_assignments']['deletionPolicy'], 'detach')
        self.assertTrue(Class.objects.filter(pk=classroom.id).exists())

    def test_safe_class_cascade_preserves_teachers_subjects_and_other_assignments(self):
        deleted_class = Class.objects.create(school=self.school_a, name='Grade 6', code='grade-6')
        deleted_section = Section.objects.create(
            school=self.school_a, class_room=deleted_class, name='A',
        )
        kept_class = Class.objects.create(school=self.school_a, name='Grade 7', code='grade-7')
        kept_section = Section.objects.create(
            school=self.school_a, class_room=kept_class, name='B',
        )
        subject = Subject.objects.create(school=self.school_a, name='Science')
        deleted_class.subjects.add(subject)
        kept_class.subjects.add(subject)
        teacher = Teacher.objects.create(
            school=self.school_a, user=self.teacher_a, joining_date=date(2025, 1, 1),
            phone='9000000001', subjects=['Science'],
            assigned_sections=['Grade 6-A', 'Grade 7-B'],
        )
        teacher.sections.add(deleted_section, kept_section)
        teacher.subject_records.add(subject)
        self.client.force_authenticate(self.admin_a)

        response = self.client.delete(
            f'/api/v1/classes/{deleted_class.id}/?cascade=sections',
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Class.objects.filter(pk=deleted_class.id).exists())
        self.assertFalse(Section.objects.filter(pk=deleted_section.id).exists())
        self.assertTrue(Class.objects.filter(pk=kept_class.id).exists())
        self.assertTrue(Section.objects.filter(pk=kept_section.id).exists())
        self.assertTrue(Teacher.objects.filter(pk=teacher.id).exists())
        self.assertTrue(Subject.objects.filter(pk=subject.id).exists())
        teacher.refresh_from_db()
        self.assertEqual(list(teacher.sections.values_list('id', flat=True)), [kept_section.id])
        self.assertEqual(teacher.assigned_sections, ['Grade 7-B'])
        self.assertEqual(list(teacher.subject_records.values_list('id', flat=True)), [subject.id])

    def test_safe_class_cascade_never_deletes_students_or_exams(self):
        classroom = Class.objects.create(school=self.school_a, name='Grade 6', code='grade-6')
        section = Section.objects.create(school=self.school_a, class_room=classroom, name='A')
        student = Student.objects.create(
            school=self.school_a, admission_no='BLOCK-001', name='Protected Student',
            class_name='Grade 6', section='A', section_record=section, roll_no=1,
            parent_name='Parent', parent_phone='9000000011',
            parent_email='protected@example.com', dob=date(2013, 1, 1),
            gender='Female', academic_year='2026-27',
        )
        exam = Exam.objects.create(
            school=self.school_a, name='Midterm', class_name='Grade 6', section='A',
            subject='Science', date=date(2026, 8, 1), time=time(9, 30), max_marks=100,
        )
        self.client.force_authenticate(self.admin_a)

        response = self.client.delete(
            f'/api/v1/classes/{classroom.id}/?cascade=sections',
        )

        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.data['canCascade'])
        references = {item['code']: item for item in response.data['references']}
        self.assertEqual(references['students']['count'], 1)
        self.assertEqual(references['exams']['count'], 1)
        self.assertTrue(Class.objects.filter(pk=classroom.id).exists())
        self.assertTrue(Section.objects.filter(pk=section.id).exists())
        self.assertTrue(Student.objects.filter(pk=student.id).exists())
        self.assertTrue(Exam.objects.filter(pk=exam.id).exists())

    def test_class_delete_rejects_unknown_cascade_mode(self):
        classroom = Class.objects.create(school=self.school_a, name='Grade 6', code='grade-6')
        self.client.force_authenticate(self.admin_a)

        response = self.client.delete(f'/api/v1/classes/{classroom.id}/?cascade=all')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'invalid_cascade')
        self.assertTrue(Class.objects.filter(pk=classroom.id).exists())

    def test_class_cascade_cannot_delete_another_schools_class(self):
        foreign_section = Section.objects.create(
            school=self.school_b, class_room=self.class_b, name='A',
        )
        self.client.force_authenticate(self.admin_a)

        response = self.client.delete(
            f'/api/v1/classes/{self.class_b.id}/?cascade=sections',
        )

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Class.objects.filter(pk=self.class_b.id).exists())
        self.assertTrue(Section.objects.filter(pk=foreign_section.id).exists())

    def test_admin_renames_propagate_to_denormalized_current_records(self):
        academic_year = AcademicYear.objects.create(
            school=self.school_a, name='2026-27', starts_on=date(2026, 4, 1),
            ends_on=date(2027, 3, 31), is_active=True,
        )
        classroom = Class.objects.create(school=self.school_a, name='Grade 8', code='grade-8')
        section = Section.objects.create(school=self.school_a, class_room=classroom, name='A')
        subject = Subject.objects.create(school=self.school_a, name='Mathematics')
        classroom.subjects.add(subject)
        student = Student.objects.create(
            school=self.school_a, admission_no='ADM-001', name='Student One',
            class_name='Grade 8', section='A', section_record=section, roll_no=1,
            parent_name='Parent One', parent_phone='9000000000',
            parent_email='parent@example.com', dob=date(2012, 1, 1), gender='Female',
            academic_year='2026-27',
        )
        history = AcademicHistory.objects.create(
            student=student, academic_year='2026-27', class_name='Grade 8',
            section='A', gpa=None, attendance=None, status='Completed',
        )
        exam = Exam.objects.create(
            school=self.school_a, name='Midterm', class_name='Grade 8', section='A',
            subject='Mathematics', date=date(2026, 8, 1), time=time(9, 30), max_marks=100,
        )
        teacher = Teacher.objects.create(
            school=self.school_a, user=self.teacher_a, joining_date=date(2025, 1, 1),
            phone='9000000001', subjects=['Mathematics'], assigned_sections=['Grade 8-A'],
        )
        teacher.sections.add(section)
        teacher.subject_records.add(subject)
        self.client.force_authenticate(self.admin_a)

        self.assertEqual(self.client.patch(
            f'/api/v1/classes/{classroom.id}/', {'name': 'Grade Eight'}, format='json',
        ).status_code, 200)
        self.assertEqual(self.client.patch(
            f'/api/v1/sections/{section.id}/', {'name': 'Alpha'}, format='json',
        ).status_code, 200)
        self.assertEqual(self.client.patch(
            f'/api/v1/subjects/{subject.id}/', {'name': 'Advanced Mathematics'}, format='json',
        ).status_code, 200)
        self.assertEqual(self.client.patch(
            f'/api/v1/academic-years/{academic_year.id}/', {'name': '2026-28'}, format='json',
        ).status_code, 200)

        student.refresh_from_db()
        history.refresh_from_db()
        exam.refresh_from_db()
        teacher.refresh_from_db()
        self.assertEqual((student.class_name, student.section, student.academic_year), ('Grade Eight', 'Alpha', '2026-28'))
        self.assertEqual(history.academic_year, '2026-28')
        self.assertEqual((exam.class_name, exam.section, exam.subject), ('Grade Eight', 'Alpha', 'Advanced Mathematics'))
        self.assertEqual(teacher.assigned_sections, ['Grade Eight-Alpha'])
        self.assertEqual(teacher.subjects, ['Advanced Mathematics'])
