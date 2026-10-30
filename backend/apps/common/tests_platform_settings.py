from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.common.models import AdminAuditEvent, PlatformSetting
from apps.schools.models import School


class PlatformSettingsApiTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Settings School', code='settings-school')
        self.super_admin = User.objects.create_superuser(
            username='settings-super-admin', email='settings-super-admin@example.com',
            password='StrongPass123!', role=User.Role.SUPER_ADMIN,
        )
        self.school_admin = User.objects.create_user(
            username='settings-school-admin', email='settings-school-admin@example.com',
            password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school,
        )
        self.client = APIClient()

    def test_super_admin_can_save_database_setting_and_creates_audit_event(self):
        self.client.force_authenticate(self.super_admin)
        response = self.client.put('/api/v1/super-admin/settings/', {
            'key': 'system', 'value': {'minPasswordLength': 12},
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(PlatformSetting.objects.get(pk='system').value, {'minPasswordLength': 12})
        self.assertTrue(AdminAuditEvent.objects.filter(
            actor=self.super_admin, action='platform_setting_updated',
            metadata={'setting': 'system'},
        ).exists())

    def test_setting_api_rejects_secret_fields(self):
        self.client.force_authenticate(self.super_admin)
        response = self.client.put('/api/v1/super-admin/settings/', {
            'key': 'system', 'value': {'smtpPassword': 'never-store-me'},
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(PlatformSetting.objects.exists())

    def test_school_admin_cannot_read_or_write_global_settings(self):
        self.client.force_authenticate(self.school_admin)
        get_response = self.client.get('/api/v1/super-admin/settings/')
        put_response = self.client.put('/api/v1/super-admin/settings/', {
            'key': 'modules', 'value': {},
        }, format='json')

        self.assertEqual(get_response.status_code, 403)
        self.assertEqual(put_response.status_code, 403)
