import json
from unittest import TestCase
from unittest.mock import patch

from django.test import RequestFactory

from config.urls import health_check


class HealthCheckTests(TestCase):
    def setUp(self):
        self.request = RequestFactory().get('/healthz/')

    def test_database_failure_does_not_expose_exception_details(self):
        with patch('config.urls.connection.cursor', side_effect=RuntimeError('private database host and password')):
            with self.assertLogs('config.urls', level='ERROR'):
                response = health_check(self.request)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)['database'], 'unavailable')
        self.assertNotIn('private database host and password', response.content.decode())

    def test_database_success_returns_healthy_status(self):
        with patch('config.urls.connection.cursor') as cursor:
            response = health_check(self.request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['database'], 'ok')
        cursor.assert_called_once_with()
