from datetime import timedelta
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import User, StudentProfile
from apps.community.models import SchoolEvent, EventRegistration, CommunityPost
from apps.schools.models import School
from apps.sis.models import Student


class CommunityAndEventsTests(APITestCase):
    def setUp(self):
        self.school_a = School.objects.create(name='Global Academy', code='global-acad')
        self.school_b = School.objects.create(name='Beacon High', code='beacon-high')

        # Admin user
        self.admin = User.objects.create_user(
            username='admin_a',
            email='admin@schoola.edu',
            password='Password123!',
            role=User.Role.SCHOOL_ADMIN,
            school=self.school_a,
        )

        # Student user & profile
        self.student_user = User.objects.create_user(
            username='student_1',
            email='student1@schoola.edu',
            password='Password123!',
            role=User.Role.STUDENT,
            school=self.school_a,
        )
        self.student = Student.objects.create(
            school=self.school_a,
            admission_no='ADM-2026-001',
            name='Alice Wonderland',
            class_name='Grade 10',
            section='A',
            roll_no=15,
            parent_name='Bob Wonderland',
            parent_phone='+1234567890',
            parent_email='parent@wonderland.com',
            dob='2010-05-12',
            gender='Female',
            academic_year='2026-2027',
        )
        StudentProfile.objects.create(user=self.student_user, student=self.student)

        # Student 2
        self.student_user_2 = User.objects.create_user(
            username='student_2',
            email='student2@schoola.edu',
            password='Password123!',
            role=User.Role.STUDENT,
            school=self.school_a,
        )
        self.student_2 = Student.objects.create(
            school=self.school_a,
            admission_no='ADM-2026-002',
            name='Charlie Brown',
            class_name='Grade 10',
            section='B',
            roll_no=8,
            parent_name='Snoopy Brown',
            parent_phone='+1234567891',
            parent_email='snoopy@brown.com',
            dob='2010-08-20',
            gender='Male',
            academic_year='2026-2027',
        )
        StudentProfile.objects.create(user=self.student_user_2, student=self.student_2)

    def test_admin_can_create_update_delete_event(self):
        """Admin can post an event with a registration deadline, update it, and delete it."""
        self.client.force_authenticate(user=self.admin)
        event_date = timezone.now() + timedelta(days=10)
        deadline_date = timezone.now() + timedelta(days=5)

        # 1. Create event
        response = self.client.post('/api/v1/events/', {
            'title': 'Science Fair 2026',
            'kind': 'Competition',
            'description': 'Annual science and robotics competition',
            'date': event_date.isoformat(),
            'registration_deadline': deadline_date.isoformat(),
            'venue': 'Main Auditorium',
            'capacity': 50,
            'ticket_required': True,
            'audience': 'Teachers, students and parents',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        event_id = response.data['id']
        self.assertEqual(response.data['title'], 'Science Fair 2026')
        self.assertEqual(response.data['capacity'], 50)
        self.assertFalse(response.data['is_deadline_passed'])
        self.assertTrue(response.data['is_registration_open'])

        # 2. Update event
        update_response = self.client.patch(f'/api/v1/events/{event_id}/', {
            'venue': 'Grand Exhibition Hall',
            'capacity': 75,
        }, format='json')
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data['venue'], 'Grand Exhibition Hall')
        self.assertEqual(update_response.data['capacity'], 75)

        # 3. Delete event
        delete_response = self.client.delete(f'/api/v1/events/{event_id}/')
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(SchoolEvent.objects.filter(id=event_id).exists())

    def test_registration_deadline_stops_registration(self):
        """Registration is strictly stopped when the registration deadline date has passed."""
        # Create event with deadline in the past
        past_deadline = timezone.now() - timedelta(days=1)
        future_event_date = timezone.now() + timedelta(days=5)

        event = SchoolEvent.objects.create(
            school=self.school_a,
            title='Past Deadline Hackathon',
            kind='Workshop',
            date=future_event_date,
            registration_deadline=past_deadline,
            venue='Computer Lab',
            capacity=30,
            ticket_required=True,
            status=SchoolEvent.Status.PUBLISHED,
        )

        self.client.force_authenticate(user=self.student_user)
        # Attempt to register
        response = self.client.post(f'/api/v1/events/{event.id}/register/', {
            'notes': 'I want to register!',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Registration deadline has passed', response.data['detail'])
        self.assertEqual(EventRegistration.objects.count(), 0)

    def test_student_can_register_before_deadline_and_get_ticket(self):
        """Student can successfully register before deadline, receive ticket code, and view in my-registrations."""
        future_deadline = timezone.now() + timedelta(days=3)
        future_event_date = timezone.now() + timedelta(days=7)

        event = SchoolEvent.objects.create(
            school=self.school_a,
            title='Debate Championship',
            kind='Competition',
            date=future_event_date,
            registration_deadline=future_deadline,
            venue='Senior Hall',
            capacity=10,
            ticket_required=True,
            status=SchoolEvent.Status.PUBLISHED,
        )

        self.client.force_authenticate(user=self.student_user)
        response = self.client.post(f'/api/v1/events/{event.id}/register/', {
            'notes': 'Prepared on Topic A',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['ticket_code'].startswith('SCH-'))
        self.assertEqual(response.data['attendee_name'], 'Alice Wonderland')
        self.assertEqual(response.data['class_name'], 'Grade 10')
        self.assertEqual(response.data['roll_no'], 15)

        # Check my-registrations
        my_reg_resp = self.client.get('/api/v1/event-registrations/my_registrations/')
        self.assertEqual(my_reg_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(my_reg_resp.data), 1)
        self.assertEqual(my_reg_resp.data[0]['ticket_code'], response.data['ticket_code'])

    def test_cannot_register_twice(self):
        """Student cannot register multiple times for the same event."""
        future_deadline = timezone.now() + timedelta(days=3)
        event = SchoolEvent.objects.create(
            school=self.school_a,
            title='Chess Tournament',
            kind='Competition',
            date=timezone.now() + timedelta(days=5),
            registration_deadline=future_deadline,
            venue='Activity Room',
            capacity=20,
            status=SchoolEvent.Status.PUBLISHED,
        )

        self.client.force_authenticate(user=self.student_user)
        # First registration
        r1 = self.client.post(f'/api/v1/events/{event.id}/register/', {}, format='json')
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)

        # Second registration attempt
        r2 = self.client.post(f'/api/v1/events/{event.id}/register/', {}, format='json')
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already registered', r2.data['detail'].lower())

    def test_capacity_limit_enforcement(self):
        """When capacity is full, further registrations are rejected."""
        event = SchoolEvent.objects.create(
            school=self.school_a,
            title='Exclusive Astronomy Night',
            kind='Workshop',
            date=timezone.now() + timedelta(days=5),
            registration_deadline=timezone.now() + timedelta(days=3),
            venue='Rooftop Observatory',
            capacity=1,
            status=SchoolEvent.Status.PUBLISHED,
        )

        # Student 1 registers (fills the 1 spot)
        self.client.force_authenticate(user=self.student_user)
        r1 = self.client.post(f'/api/v1/events/{event.id}/register/', {}, format='json')
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)

        # Student 2 attempts to register
        self.client.force_authenticate(user=self.student_user_2)
        r2 = self.client.post(f'/api/v1/events/{event.id}/register/', {}, format='json')
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('full', r2.data['detail'].lower())

    def test_admin_can_view_registered_students(self):
        """Admin can fetch complete roster of registered students for an event."""
        event = SchoolEvent.objects.create(
            school=self.school_a,
            title='Annual Sports Meet',
            kind='Sports',
            date=timezone.now() + timedelta(days=10),
            registration_deadline=timezone.now() + timedelta(days=5),
            venue='School Ground',
            capacity=100,
            status=SchoolEvent.Status.PUBLISHED,
        )

        # Register Student 1 & 2
        self.client.force_authenticate(user=self.student_user)
        self.client.post(f'/api/v1/events/{event.id}/register/', {'notes': '100m Sprint'}, format='json')
        self.client.force_authenticate(user=self.student_user_2)
        self.client.post(f'/api/v1/events/{event.id}/register/', {'notes': 'Relay'}, format='json')

        # Admin checks attendee list
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get(f'/api/v1/events/{event.id}/registrations/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 2)
        names = [item['attendee_name'] for item in resp.data]
        self.assertIn('Alice Wonderland', names)
        self.assertIn('Charlie Brown', names)
        admissions = [item['admission_no'] for item in resp.data]
        self.assertIn('ADM-2026-001', admissions)
        self.assertIn('ADM-2026-002', admissions)

    def test_community_post_lifecycle(self):
        """Admin can publish and list community updates."""
        self.client.force_authenticate(user=self.admin)
        post_resp = self.client.post('/api/v1/community-posts/', {
            'kind': 'Announcement',
            'title': 'School Reopening Date',
            'body': 'School will reopen on Sept 1st after summer break.',
            'audience': 'Teachers, students and parents',
            'channels': ['School portal', 'Social media'],
        }, format='json')
        self.assertEqual(post_resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(post_resp.data['title'], 'School Reopening Date')

        list_resp = self.client.get('/api/v1/community-posts/')
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        # Handles pagination or list
        results = list_resp.data['results'] if 'results' in list_resp.data else list_resp.data
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['author_name'], 'admin_a')
