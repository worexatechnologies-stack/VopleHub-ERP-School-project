from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from django.test import SimpleTestCase

from apps.common.middleware import JwtTenantSecurityMiddleware


class TenantContextMiddlewareTests(SimpleTestCase):
    def _call_middleware(self, user, status_code=200):
        request = SimpleNamespace(user=user, path='/api/v1/students/')
        response = SimpleNamespace(status_code=status_code)
        get_response = MagicMock(return_value=response)
        cursor = MagicMock()
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = MagicMock(vendor='postgresql')
        connection.cursor.return_value = cursor_context
        transaction_context = MagicMock()
        set_rollback = MagicMock()

        with (
            patch('apps.common.middleware.connection', connection),
            patch('apps.common.tenancy.connection', connection),
            patch('apps.common.middleware.transaction.atomic', return_value=transaction_context) as atomic,
            patch('apps.common.middleware.transaction.set_rollback', set_rollback),
        ):
            result = JwtTenantSecurityMiddleware(get_response)(request)

        return result, response, get_response, atomic, cursor, set_rollback

    def test_regular_user_context_is_set_with_separate_transaction_local_statements(self):
        user = SimpleNamespace(
            is_authenticated=True,
            must_change_password=False,
            school_id=42,
            role='school_admin',
        )

        result, response, get_response, atomic, cursor, set_rollback = self._call_middleware(user)

        self.assertIs(result, response)
        atomic.assert_called_once_with()
        cursor.execute.assert_has_calls([
            call("SELECT set_config('app.school_id', %s, true)", ['42']),
            call("SELECT set_config('app.is_superadmin', %s, true)", ['false']),
        ])
        get_response.assert_called_once()
        set_rollback.assert_not_called()

    def test_superadmin_context_is_set_explicitly(self):
        user = SimpleNamespace(
            is_authenticated=True,
            must_change_password=False,
            school_id=None,
            role='super_admin',
        )

        _, _, _, _, cursor, _ = self._call_middleware(user)

        cursor.execute.assert_has_calls([
            call("SELECT set_config('app.school_id', %s, true)", ['']),
            call("SELECT set_config('app.is_superadmin', %s, true)", ['true']),
        ])

    def test_error_responses_roll_back_the_request_transaction(self):
        user = SimpleNamespace(
            is_authenticated=True,
            must_change_password=False,
            school_id=42,
            role='school_admin',
        )

        _, _, _, _, _, set_rollback = self._call_middleware(user, status_code=400)

        set_rollback.assert_called_once_with(True)


class TenantPolicyMigrationTests(SimpleTestCase):
    def test_rls_policies_deny_access_when_superadmin_context_is_missing(self):
        migration = import_module('apps.schools.migrations.0013_tenant_rls_fail_closed')
        cursor = MagicMock()
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = SimpleNamespace(vendor='postgresql', cursor=MagicMock(return_value=cursor_context))
        schema_editor = SimpleNamespace(connection=connection)

        migration.fail_closed(None, schema_editor)

        statements = [entry.args[0] for entry in cursor.execute.call_args_list]
        self.assertEqual(len(statements), 10)
        self.assertTrue(all("'false') = 'true'" in statement for statement in statements))
