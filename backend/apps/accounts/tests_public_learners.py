from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import PublicLearnerSubscription, User


class PublicLearnerApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_registration_hashes_password_and_keeps_account_pending(self):
        response = self.client.post('/api/v1/public-learning/register/', {
            'name': 'Test Learner',
            'email': 'learner@example.test',
            'password': 'A strong test pass 938!',
            'phone': '+91 9876543210',
            'plan': PublicLearnerSubscription.Plan.MONTHLY,
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertNotIn('password', response.data)
        user = User.objects.get(email='learner@example.test')
        self.assertNotEqual(user.password, 'A strong test pass 938!')
        self.assertTrue(user.check_password('A strong test pass 938!'))
        self.assertFalse(user.is_active)
        self.assertEqual(user.public_subscription.status, PublicLearnerSubscription.Status.PENDING)

    def test_me_endpoint_returns_active_subscription_without_credentials(self):
        user = User.objects.create_user(
            username='public-learner-test',
            email='active@example.test',
            password='A strong test pass 938!',
            first_name='Active Learner',
            role=User.Role.PUBLIC_LEARNER,
            is_active=True,
        )
        PublicLearnerSubscription.objects.create(
            user=user,
            plan=PublicLearnerSubscription.Plan.QUARTERLY,
            status=PublicLearnerSubscription.Status.ACTIVE,
        )
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/v1/public-learning/me/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['email'], user.email)
        self.assertEqual(response.data['status'], PublicLearnerSubscription.Status.ACTIVE)
        self.assertNotIn('password', response.data)

    def test_pending_subscription_cannot_access_learner_profile(self):
        user = User.objects.create_user(
            username='public-learner-pending',
            email='pending@example.test',
            password='A strong test pass 938!',
            role=User.Role.PUBLIC_LEARNER,
            is_active=False,
        )
        PublicLearnerSubscription.objects.create(user=user, plan=PublicLearnerSubscription.Plan.ANNUAL)
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/v1/public-learning/me/')

        self.assertEqual(response.status_code, 403)

    def test_non_super_admin_cannot_list_subscriptions(self):
        user = User.objects.create_user(
            username='school-admin-test',
            email='admin@example.test',
            password='A strong test pass 938!',
            role=User.Role.SCHOOL_ADMIN,
        )
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/v1/public-learning/learners/')

        self.assertEqual(response.status_code, 403)

    def test_legacy_import_hashes_password_and_requires_change(self):
        admin = User.objects.create_user(
            username='super-admin-import-test',
            email='super-admin-import@example.test',
            password='A strong test pass 938!',
            role=User.Role.SUPER_ADMIN,
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=admin)

        response = self.client.post('/api/v1/public-learning/learners/migrate-legacy/', {
            'learners': [{
                'name': 'Legacy Learner',
                'email': 'legacy@example.test',
                'password': 'legacy test password',
                'plan': PublicLearnerSubscription.Plan.MONTHLY,
                'status': PublicLearnerSubscription.Status.ACTIVE,
                'paymentDate': '2026-01-01',
                'expiryDate': '2027-01-01',
                'phone': '+91 9876543210',
                'notes': 'Imported from browser storage',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        user = User.objects.get(email='legacy@example.test')
        self.assertTrue(user.check_password('legacy test password'))
        self.assertTrue(user.must_change_password)
        self.assertTrue(user.is_active)
        self.assertEqual(user.public_subscription.status, PublicLearnerSubscription.Status.ACTIVE)
        self.assertNotIn('password', response.data)
