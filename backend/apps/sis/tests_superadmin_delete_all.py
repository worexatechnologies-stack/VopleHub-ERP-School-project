from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.schools.models import School


class SuperAdminDeleteAllStudentsPermissionTests(TestCase):
    def test_super_admin_cannot_call_school_admin_delete_all_endpoint(self):
        super_admin = User.objects.create_superuser(
            username='delete-all-super-admin', email='delete-all-super-admin@example.com',
            password='StrongPass123!', role=User.Role.SUPER_ADMIN,
        )
        School.objects.create(name='Delete All School', code='delete-all-school')
        client = APIClient()
        client.force_authenticate(super_admin)

        response = client.post('/api/v1/students/delete-all/', {
            'adminPassword': 'StrongPass123!',
        }, format='json')

        self.assertEqual(response.status_code, 403)
