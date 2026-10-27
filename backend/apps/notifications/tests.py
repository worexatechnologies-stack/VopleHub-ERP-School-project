from datetime import timedelta
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ParentProfile, StudentProfile, User
from apps.academics.models import Class, Section
from apps.schools.models import School
from apps.sis.models import Student
from apps.staff.models import Teacher

from .fcm import FCMNotificationService
from .models import DeviceToken, Notification
from .tasks import fanout_notification_task


class ParentNotificationAccessTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='North School', code='north-school')
        self.other_school = School.objects.create(name='South School', code='south-school')
        self.admin = User.objects.create_user(username='north-admin', email='north-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.other_admin = User.objects.create_user(username='south-admin', email='south-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.other_school)
        self.parent = User.objects.create_user(username='north-parent', email='north-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=self.school)
        self.other_parent = User.objects.create_user(username='south-parent', email='south-parent@example.com', password='StrongPass123!', role=User.Role.PARENT, school=self.other_school)
        self.official = Notification.objects.create(school=self.school, sender=self.admin, recipient=self.parent, category='General', title='North notice', body='Official message', channel='school-to-parents')
        self.other_school_notice = Notification.objects.create(school=self.other_school, sender=self.other_admin, recipient=self.other_parent, category='General', title='South notice', body='Private message', channel='school-to-parents')
        teacher = User.objects.create_user(username='north-teacher', email='north-teacher@example.com', password='StrongPass123!', role=User.Role.TEACHER, school=self.school)
        self.teacher_notice = Notification.objects.create(school=self.school, sender=teacher, recipient=self.parent, category='General', title='Teacher update', body='Class update', channel='teacher-to-parents')
        self.client = APIClient()

    def test_parent_receives_own_school_admin_and_teacher_notices(self):
        self.client.force_authenticate(self.parent)
        response = self.client.get('/api/v1/notifications/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item['id'] for item in response.data],
            [self.teacher_notice.id, self.official.id],
        )

    def test_parent_can_mark_own_notice_read_but_not_another_parents(self):
        self.client.force_authenticate(self.parent)
        response = self.client.patch(f'/api/v1/notifications/{self.official.id}/read/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.official.refresh_from_db()
        self.assertIsNotNone(self.official.read_at)
        response = self.client.patch(f'/api/v1/notifications/{self.other_school_notice.id}/read/', {}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_parent_notices_reset_at_the_start_of_each_week(self):
        previous_week = Notification.objects.create(
            school=self.school, sender=self.admin, recipient=self.parent,
            category='General', title='Last week', body='Old notice', channel='school-to-parents',
        )
        Notification.objects.filter(pk=previous_week.pk).update(created_at=timezone.now() - timedelta(days=8))

        self.client.force_authenticate(self.parent)
        response = self.client.get('/api/v1/notifications/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item['id'] for item in response.data],
            [self.teacher_notice.id, self.official.id],
        )


class SchoolAdminNotificationComposerTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='North School', code='north-school')
        self.admin = User.objects.create_user(username='north-admin', email='north-admin@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.student = Student.objects.create(
            school=self.school, admission_no='N-001', name='Asha Kumar', class_name='Class 10', section='A', roll_no=1,
            parent_name='Parent Kumar', parent_phone='9000000001', parent_email='parent@example.com', dob='2012-01-01',
            gender='Female', address='', academic_year='2026-27', status=Student.Status.ACTIVE,
        )
        self.student_user = User.objects.create_user(username='asha', email='asha@students.example.com', password='StrongPass123!', role=User.Role.STUDENT, school=self.school)
        StudentProfile.objects.create(user=self.student_user, student=self.student)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_all_mode_ignores_stale_targeted_recipient_input(self):
        response = self.client.post('/api/v1/notifications/teacher-to-students/', {
            'recipientMode': 'all', 'recipients': ['no-longer-selected'], 'category': 'General', 'title': 'School notice', 'body': 'Hello',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 1)

    def test_targeted_selector_accepts_class_section_with_spaces(self):
        response = self.client.post('/api/v1/notifications/teacher-to-students/', {
            'recipientMode': 'section', 'recipients': ['Class 10 - A'], 'category': 'General', 'title': 'School notice', 'body': 'Hello',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 1)


class TeacherScopedNotificationComposerTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Scoped School', code='scoped-school')
        self.classroom = Class.objects.create(
            school=self.school, name='Class 9', code='class-9', sort_order=9,
        )
        self.section_a = Section.objects.create(
            school=self.school, class_room=self.classroom, name='A',
        )
        self.section_b = Section.objects.create(
            school=self.school, class_room=self.classroom, name='B',
        )
        self.teacher_user = User.objects.create_user(
            username='scoped-teacher', email='scoped-teacher@example.com',
            password='StrongPass123!', role=User.Role.TEACHER, school=self.school,
        )
        self.teacher = Teacher.objects.create(
            school=self.school, user=self.teacher_user, joining_date=date.today(),
            phone='9000000010', status=Teacher.Status.ACTIVE,
        )
        self.teacher.sections.add(self.section_a)

        self.student_a = self._student('A-001', 'Assigned Student', self.section_a, 1)
        self.student_b = self._student('B-001', 'Other Student', self.section_b, 2)
        self.student_user_a = self._student_login(self.student_a, 'assigned-student')
        self.student_user_b = self._student_login(self.student_b, 'other-student')
        self.parent_user_a = self._parent_login(self.student_a, 'assigned-parent')
        self.parent_user_b = self._parent_login(self.student_b, 'other-parent')

        self.client = APIClient()
        self.client.force_authenticate(self.teacher_user)

    def _student(self, admission_no, name, section, roll_no):
        return Student.objects.create(
            school=self.school, admission_no=admission_no, name=name,
            class_name=self.classroom.name, section=section.name,
            section_record=section, roll_no=roll_no, parent_name=f'{name} Parent',
            parent_phone=f'90000000{roll_no:02d}', parent_email=f'{admission_no.lower()}@parent.test',
            dob='2012-01-01', gender='Female', address='', academic_year='2026-27',
            status=Student.Status.ACTIVE,
        )

    def _student_login(self, student, username):
        user = User.objects.create_user(
            username=username, email=f'{username}@students.test', password='StrongPass123!',
            role=User.Role.STUDENT, school=self.school,
        )
        StudentProfile.objects.create(user=user, student=student)
        return user

    def _parent_login(self, student, username):
        user = User.objects.create_user(
            username=username, email=f'{username}@parents.test', password='StrongPass123!',
            role=User.Role.PARENT, school=self.school,
        )
        profile = ParentProfile.objects.create(user=user, phone=student.parent_phone)
        profile.students.add(student)
        return user

    @staticmethod
    def _payload(*, mode='all', recipients=None, title='Class update'):
        return {
            'recipientMode': mode,
            'recipients': recipients or [],
            'category': 'General',
            'title': title,
            'body': 'Please review this message.',
        }

    def test_teacher_all_mode_reaches_only_students_in_assigned_sections(self):
        response = self.client.post(
            '/api/v1/notifications/teacher-to-students/', self._payload(), format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 1)
        self.assertTrue(Notification.objects.filter(recipient=self.student_user_a).exists())
        self.assertFalse(Notification.objects.filter(recipient=self.student_user_b).exists())

    def test_teacher_cannot_target_student_outside_assigned_sections(self):
        response = self.client.post(
            '/api/v1/notifications/teacher-to-students/',
            self._payload(mode='individual', recipients=[str(self.student_b.pk)]),
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Notification.objects.filter(recipient=self.student_user_b).exists())

    def test_targeted_mode_requires_an_explicit_recipient(self):
        response = self.client.post(
            '/api/v1/notifications/teacher-to-students/',
            self._payload(mode='individual'),
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Notification.objects.exists())

    def test_teacher_can_message_assigned_parent_and_parent_can_read_it(self):
        response = self.client.post(
            '/api/v1/notifications/teacher-to-parents/',
            self._payload(
                mode='individual', recipients=[str(self.student_a.pk)],
                title='Guardian follow-up',
            ),
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 1)
        self.assertTrue(Notification.objects.filter(
            recipient=self.parent_user_a, title='Guardian follow-up',
        ).exists())
        self.assertFalse(Notification.objects.filter(recipient=self.parent_user_b).exists())

        self.client.force_authenticate(self.parent_user_a)
        inbox = self.client.get('/api/v1/notifications/')
        self.assertEqual(inbox.status_code, 200)
        self.assertIn('Guardian follow-up', [item['title'] for item in inbox.data])

    def test_inactive_teacher_cannot_send(self):
        self.teacher.status = Teacher.Status.INACTIVE
        self.teacher.save(update_fields=['status'])

        response = self.client.post(
            '/api/v1/notifications/teacher-to-students/', self._payload(), format='json',
        )

        self.assertEqual(response.status_code, 403)

class FCMDeviceTokenTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='FCM School', code='fcm-school')
        self.user = User.objects.create_user(username='fcm-user', email='fcm@example.com', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.token = 'fcm-registration-token-' + ('x' * 48)

    def test_user_can_register_list_and_deactivate_own_device_without_token_leakage(self):
        response = self.client.post('/api/v1/notifications/devices/', {'token': self.token, 'deviceName': 'Chrome on Windows'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('token', response.data)
        device = DeviceToken.objects.get(token=self.token)
        self.assertEqual(device.user, self.user)
        self.assertTrue(device.is_active)

        response = self.client.get('/api/v1/notifications/devices/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertNotIn('token', response.data[0])

        response = self.client.delete('/api/v1/notifications/devices/', {'token': self.token}, format='json')
        self.assertEqual(response.status_code, 204)
        device.refresh_from_db()
        self.assertFalse(device.is_active)

    def test_invalid_firebase_tokens_are_removed_after_delivery_feedback(self):
        device = DeviceToken.objects.create(user=self.user, token=self.token)
        failed_response = SimpleNamespace(success=False, exception=__import__('firebase_admin').messaging.UnregisteredError('unregistered'))
        batch_response = SimpleNamespace(responses=[failed_response])
        with patch('apps.notifications.fcm._firebase_app', return_value=object()), patch('apps.notifications.fcm.messaging.send_each_for_multicast', return_value=batch_response):
            result = FCMNotificationService().send_to_user(self.user, title='Test', body='Body')
        self.assertEqual(result.invalid, 1)
        self.assertFalse(DeviceToken.objects.filter(pk=device.pk).exists())


class RoleNotificationIsolationTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Isolation School', code='iso-school')
        self.superadmin = User.objects.create_user(
            username='iso-superadmin', email='iso-sa@test.com', password='StrongPass123!',
            role=User.Role.SUPER_ADMIN,
        )
        self.admin = User.objects.create_user(
            username='iso-admin', email='iso-admin@test.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.teacher_user = User.objects.create_user(
            username='iso-teacher', email='iso-teacher@test.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=self.school,
        )
        self.parent_user = User.objects.create_user(
            username='iso-parent', email='iso-parent@test.com', password='StrongPass123!',
            role=User.Role.PARENT, school=self.school,
        )
        # 1. Notice sent from Teacher to Parent
        self.teacher_to_parent_notif = Notification.objects.create(
            school=self.school, sender=self.teacher_user, recipient=self.parent_user,
            category='General', title='Parent Notice Only', body='Homework due tomorrow',
            channel='teacher-to-parents',
        )
        # 2. Notice sent from Teacher to Admin (Leave request)
        self.teacher_to_admin_notif = Notification.objects.create(
            school=self.school, sender=self.teacher_user, recipient=self.admin,
            category='Leave Request', title='Leave Application', body='Request for 1 day leave',
            channel='teacher-to-admin',
        )
        # 3. Direct chat message between Teacher and Parent
        self.chat_notif = Notification.objects.create(
            school=self.school, sender=self.teacher_user, recipient=self.parent_user,
            category='Message', title='New Message from Teacher', body='Hello Parent',
            channel='chat',
        )
        # 4. Direct chat message between Teacher and Admin
        self.admin_chat_notif = Notification.objects.create(
            school=self.school, sender=self.teacher_user, recipient=self.admin,
            category='Message', title='New Message from Teacher to Admin', body='Hello Admin',
            channel='chat',
        )
        self.client = APIClient()

    def test_super_admin_does_not_receive_school_admin_or_teacher_notices(self):
        self.client.force_authenticate(self.superadmin)
        response = self.client.get('/api/v1/notifications/')
        self.assertEqual(response.status_code, 200)
        # Super admin has no direct notices, so inbox must be empty, not leaking admin notices
        self.assertEqual(len(response.data), 0)

    def test_admin_does_not_receive_parent_teacher_notices_or_chats(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/v1/notifications/')
        self.assertEqual(response.status_code, 200)
        received_ids = [item['id'] for item in response.data]
        # Admin must receive the leave request and chat sent to Admin
        self.assertIn(self.teacher_to_admin_notif.id, received_ids)
        self.assertIn(self.admin_chat_notif.id, received_ids)
        # Admin must NEVER receive parent-teacher notice or parent-teacher chat
        self.assertNotIn(self.teacher_to_parent_notif.id, received_ids)
        self.assertNotIn(self.chat_notif.id, received_ids)


class QueuedFanoutTests(TestCase):
    def test_fanout_targets_active_users_in_one_school_and_records_sender(self):
        school = School.objects.create(name='Queue School', code='queue-school')
        sender = User.objects.create_user(
            username='queue-admin', email='queue-admin@test.com', password='StrongPass123!',
            role=User.Role.SCHOOL_ADMIN, school=school,
        )
        student = User.objects.create_user(
            username='queue-student', email='queue-student@test.com', password='StrongPass123!',
            role=User.Role.STUDENT, school=school,
        )
        parent = User.objects.create_user(
            username='queue-parent', email='queue-parent@test.com', password='StrongPass123!',
            role=User.Role.PARENT, school=school,
        )
        inactive = User.objects.create_user(
            username='queue-inactive', email='queue-inactive@test.com', password='StrongPass123!',
            role=User.Role.TEACHER, school=school, is_active=False,
        )
        other_school = School.objects.create(name='Other Queue School', code='other-queue-school')
        other_user = User.objects.create_user(
            username='other-queue-user', email='other-queue@test.com', password='StrongPass123!',
            role=User.Role.STUDENT, school=other_school,
        )

        with patch('apps.notifications.services.enqueue_fcm_notification'), patch('apps.notifications.services._dispatch_ws_notification'):
            result = fanout_notification_task.apply(kwargs={
                'school_id': school.id,
                'sender_id': sender.id,
                'title': 'School announcement',
                'body': 'Important update',
                'category': 'Notice',
                'channel': 'community',
            })

        self.assertEqual(result.get(), 2)
        recipients = set(Notification.objects.values_list('recipient_id', flat=True))
        self.assertEqual(recipients, {student.id, parent.id})
        self.assertFalse(Notification.objects.filter(recipient=inactive).exists())
        self.assertFalse(Notification.objects.filter(recipient=other_user).exists())
        self.assertTrue(Notification.objects.filter(sender=sender, channel='community').exists())
