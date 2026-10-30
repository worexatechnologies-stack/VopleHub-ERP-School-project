import json
import time
from django.test import TestCase, override_settings
from django.conf import settings
from rest_framework.test import APIClient
from apps.accounts.models import RefreshTokenRecord, User
from apps.schools.models import School
from django.contrib.sessions.models import Session
from django.contrib.sessions.backends.cached_db import SessionStore
from django.urls import reverse


@override_settings(
    SECURE_SSL_REDIRECT=False,
    SESSION_COOKIE_SECURE=False,
    CSRF_COOKIE_SECURE=False,
)
class BackendManagedSessionAuthTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Greenwood High', code='greenwood-session-test')
        self.super_admin = User.objects.create_superuser(
            username='superadmin@test.com',
            email='superadmin@test.com',
            password='ComplexPassword123!',
            role=User.Role.SUPER_ADMIN,
        )
        self.teacher = User.objects.create_user(
            username='teacher@test.com',
            email='teacher@test.com',
            password='ComplexPassword123!',
            role=User.Role.TEACHER,
            school=self.school,
        )
        self.school_admin = User.objects.create_user(
            username='admin@test.com',
            email='admin@test.com',
            password='ComplexPassword123!',
            role=User.Role.SCHOOL_ADMIN,
            school=self.school,
        )
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.defaults['HTTP_X_CLIENT_TYPE'] = 'web'
        self.client.defaults['HTTP_X_CSRFTOKEN'] = self.client.get(
            '/api/v1/auth/csrf/'
        ).data['csrfToken']

    def complete_super_admin_mfa(self, client, response, *, mobile=False):
        self.assertTrue(response.data.get('mfa_required'))
        return client.post(
            '/api/v1/auth/verify-otp/',
            {'mfa_token': response.data['mfa_token'], 'otp': response.data['dev_otp']},
            format='json',
            **({'HTTP_X_CLIENT_TYPE': 'mobile'} if mobile else {}),
        )

    def test_web_login_creates_server_session_and_sets_cookie(self):
        """Web login creates a server-side session and returns sessionid cookie, with NO access/refresh tokens in body."""
        response = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        response = self.complete_super_admin_mfa(self.client, response)

        self.assertEqual(response.status_code, 200)
        # Verify NO JWT tokens in web response body
        self.assertNotIn('access', response.data)
        self.assertNotIn('refresh', response.data)
        self.assertEqual(response.cookies['access_token_cookie'].value, '')
        self.assertEqual(response.cookies['refresh_token_cookie'].value, '')
        self.assertIn('user', response.data)
        self.assertEqual(response.data['user']['email'], 'superadmin@test.com')

        # Verify sessionid cookie in response
        self.assertIn(settings.SESSION_COOKIE_NAME, response.cookies)
        session_cookie = response.cookies[settings.SESSION_COOKIE_NAME]
        self.assertTrue(session_cookie['httponly'])
        self.assertEqual(session_cookie['samesite'], 'Lax')
        self.assertEqual(session_cookie['path'], '/')

        # Verify session is valid in backend session store
        session_key = session_cookie.value
        store = SessionStore(session_key=session_key)
        self.assertEqual(int(store.get('_auth_user_id')), self.super_admin.pk)
        self.assertFalse(RefreshTokenRecord.objects.filter(user=self.super_admin).exists())

    def test_web_login_rotates_session_key(self):
        """Successful login cycles/rotates the session key to prevent session fixation."""
        # Establish initial session before login
        self.client.get('/api/v1/auth/csrf/')
        initial_session_key = self.client.session.session_key

        response = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        response = self.complete_super_admin_mfa(self.client, response)

        self.assertEqual(response.status_code, 200)
        post_login_session_key = response.cookies[settings.SESSION_COOKIE_NAME].value
        self.assertNotEqual(initial_session_key, post_login_session_key)

    def test_web_login_rejects_switching_between_admin_portals(self):
        """The school and platform admin portals must match the account's server role."""
        csrf_token = self.client.get('/api/v1/auth/csrf/').data['csrfToken']
        response = self.client.post('/api/v1/auth/login/', {
            'email': 'admin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'super_admin',
        }, format='json', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['user_role'], User.Role.SCHOOL_ADMIN)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)

        response = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'school_admin',
        }, format='json', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['user_role'], User.Role.SUPER_ADMIN)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)

        response = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'super_admin',
        }, format='json', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['mfa_required'])
        response = self.complete_super_admin_mfa(self.client, response)

        # Preserve the legacy native-client alias behavior; mobile does not
        # select a browser portal and consumes the same token API contract.
        mobile_client = APIClient()
        mobile_response = mobile_client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'school_admin',
            'client_type': 'mobile',
        }, format='json', HTTP_X_CLIENT_TYPE='mobile')
        mobile_response = self.complete_super_admin_mfa(mobile_client, mobile_response, mobile=True)
        self.assertEqual(mobile_response.status_code, 200)
        self.assertIn('access', mobile_response.data)
        self.assertIn('refresh', mobile_response.data)

    def test_csrf_token_endpoint_and_cookie(self):
        """GET /api/v1/auth/csrf/ returns a valid token and sets csrftoken cookie."""
        self.client.cookies['refresh_token_cookie'] = 'legacy-refresh-cookie'
        self.client.cookies['access_token_cookie'] = 'legacy-access-cookie'
        response = self.client.get('/api/v1/auth/csrf/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('csrfToken', response.data)
        self.assertTrue(len(response.data['csrfToken']) > 10)
        self.assertIn(settings.CSRF_COOKIE_NAME, response.cookies)
        self.assertFalse(response.cookies[settings.CSRF_COOKIE_NAME]['httponly'])
        refresh_cookie_paths = {
            morsel['path'] for morsel in response.cookies.values()
            if morsel.key == 'refresh_token_cookie'
        }
        self.assertIn('/api/v1/auth/', refresh_cookie_paths)
        self.assertIn('/', refresh_cookie_paths)
        self.assertEqual(response.cookies['access_token_cookie'].value, '')

    def test_django_maintenance_admin_uses_non_conflicting_route(self):
        self.assertEqual(reverse('admin:index'), '/django-admin/')

    def test_csrf_enforcement_on_unsafe_methods(self):
        """Session-authenticated state-changing requests without CSRF token are rejected with 403."""
        # Log in to get session cookie
        login_res = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        login_res = self.complete_super_admin_mfa(self.client, login_res)
        self.assertEqual(login_res.status_code, 200)

        # 1. Unsafe POST without CSRF token must fail with 403 Forbidden
        csrf_header = self.client.defaults.pop('HTTP_X_CSRFTOKEN')
        post_res = self.client.post('/api/v1/auth/school-admins/', {
            'name': 'Test Admin',
            'schoolId': self.school.id,
            'status': 'Active',
        }, format='json')
        self.assertEqual(post_res.status_code, 403)
        self.assertIn('CSRF', str(post_res.data))

        # 2. Get CSRF token and send X-CSRFToken header -> Must succeed
        csrf_res = self.client.get('/api/v1/auth/csrf/')
        csrf_token = csrf_res.data['csrfToken']
        self.client.defaults['HTTP_X_CSRFTOKEN'] = csrf_header

        post_with_csrf = self.client.post(
            '/api/v1/auth/school-admins/',
            {
                'name': 'Test Admin',
                'schoolId': self.school.id,
                'status': 'Active',
            },
            format='json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(post_with_csrf.status_code, 201)

    def test_current_user_me_endpoint_with_session(self):
        """GET /api/v1/auth/me/ authenticates using session cookie without any bearer token."""
        # Unauthenticated request returns 401
        unauth_res = self.client.get('/api/v1/auth/me/')
        self.assertIn(unauth_res.status_code, [401, 403])

        # Log in
        login_res = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        login_res = self.complete_super_admin_mfa(self.client, login_res)
        self.assertEqual(login_res.status_code, 200)

        # GET /auth/me/ with session cookie
        me_res = self.client.get('/api/v1/auth/me/')
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.data['email'], 'superadmin@test.com')
        self.assertEqual(me_res.data['role'], 'super_admin')
        self.assertNotIn('password', me_res.data)
        self.assertNotIn('token', me_res.data)

    def test_logout_flushes_session_and_expires_cookie(self):
        """Logout invalidates server session and expires session cookie."""
        # Log in
        login_res = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        login_res = self.complete_super_admin_mfa(self.client, login_res)
        session_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value

        # Verify session exists in store
        self.assertTrue(SessionStore(session_key=session_key).exists(session_key))

        # Logout with CSRF token
        csrf_token = self.client.get('/api/v1/auth/csrf/').data['csrfToken']
        logout_res = self.client.post('/api/v1/auth/logout/', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(logout_res.status_code, 204)

        # Verify session is deleted from server store
        self.assertFalse(SessionStore(session_key=session_key).exists(session_key))

        # Subsequent GET /auth/me/ must return 401
        self.assertIn(self.client.get('/api/v1/auth/me/').status_code, [401, 403])

    def test_mobile_client_receives_jwt_and_authenticates_via_bearer(self):
        """Mobile clients specifying X-Client-Type: mobile receive JWT tokens and authenticate via Bearer header."""
        mobile_login = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
            'client_type': 'mobile',
        }, format='json', HTTP_X_CLIENT_TYPE='mobile')
        mobile_login = self.complete_super_admin_mfa(self.client, mobile_login, mobile=True)

        self.assertEqual(mobile_login.status_code, 200)
        self.assertIn('access', mobile_login.data)
        self.assertIn('refresh', mobile_login.data)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, mobile_login.cookies)
        self.assertNotIn('access_token_cookie', mobile_login.cookies)
        self.assertNotIn('refresh_token_cookie', mobile_login.cookies)
        # Clear cookies to simulate mobile client environment
        mobile_client = APIClient()
        mobile_client.cookies.clear()

        refresh_res = mobile_client.post(
            '/api/v1/auth/refresh/',
            {'refresh': mobile_login.data['refresh']},
            format='json',
            HTTP_X_CLIENT_TYPE='mobile',
        )
        self.assertEqual(refresh_res.status_code, 200)
        self.assertIn('access', refresh_res.data)
        self.assertIn('refresh', refresh_res.data)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, refresh_res.cookies)
        self.assertNotIn('access_token_cookie', refresh_res.cookies)
        self.assertNotIn('refresh_token_cookie', refresh_res.cookies)

        # Mobile request with Bearer token must succeed without CSRF requirement
        me_res = mobile_client.get('/api/v1/auth/me/', HTTP_AUTHORIZATION=f"Bearer {refresh_res.data['access']}")
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.data['email'], 'superadmin@test.com')

    @override_settings(DEBUG=True)
    def test_mobile_mfa_completion_returns_tokens_without_browser_cookies(self):
        login_response = APIClient().post('/api/v1/auth/login/', {
            'email': 'teacher@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Teacher',
            'client_type': 'mobile',
        }, format='json', HTTP_X_CLIENT_TYPE='mobile')
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.data['mfa_required'])

        verify_response = APIClient().post('/api/v1/auth/verify-otp/', {
            'mfa_token': login_response.data['mfa_token'],
            'otp': login_response.data['dev_otp'],
            'client_type': 'mobile',
        }, format='json', HTTP_X_CLIENT_TYPE='mobile')

        self.assertEqual(verify_response.status_code, 200)
        self.assertIn('access', verify_response.data)
        self.assertIn('refresh', verify_response.data)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, verify_response.cookies)
        self.assertNotIn('access_token_cookie', verify_response.cookies)
        self.assertNotIn('refresh_token_cookie', verify_response.cookies)

    def test_account_deactivation_invalidates_session_access(self):
        """Deactivating an account immediately blocks session access."""
        login_res = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        login_res = self.complete_super_admin_mfa(self.client, login_res)
        self.assertEqual(login_res.status_code, 200)

        # Deactivate user
        self.super_admin.is_active = False
        self.super_admin.save(update_fields=['is_active'])

        # Session request must fail with 401/403
        me_res = self.client.get('/api/v1/auth/me/')
        self.assertIn(me_res.status_code, [401, 403])

    def test_idle_timeout_expires_the_server_session(self):
        login_res = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        login_res = self.complete_super_admin_mfa(self.client, login_res)
        self.assertEqual(login_res.status_code, 200)
        session_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        session = self.client.session
        session['_auth_session_last_activity_at'] = time.time() - settings.SESSION_IDLE_TIMEOUT_SECONDS - 1
        session.save()

        response = self.client.get('/api/v1/auth/me/')

        self.assertIn(response.status_code, [401, 403])
        self.assertFalse(SessionStore(session_key=session_key).exists(session_key))

    def test_absolute_timeout_expires_an_active_session(self):
        login_res = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        login_res = self.complete_super_admin_mfa(self.client, login_res)
        self.assertEqual(login_res.status_code, 200)
        session_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        session = self.client.session
        session['_auth_session_created_at'] = time.time() - settings.SESSION_ABSOLUTE_TIMEOUT_SECONDS - 1
        session['_auth_session_last_activity_at'] = time.time()
        session.save()

        response = self.client.get('/api/v1/auth/me/')

        self.assertIn(response.status_code, [401, 403])
        self.assertFalse(SessionStore(session_key=session_key).exists(session_key))

    def test_invalid_credentials_rejected_without_creating_session(self):
        """Invalid credentials return 401 and do not create a session."""
        response = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'WrongPassword!',
            'role': 'Super Admin',
        }, format='json')
        self.assertEqual(response.status_code, 401)
        self.assertNotIn(settings.SESSION_COOKIE_NAME, response.cookies)

    @override_settings(DEBUG=True)
    def test_student_cannot_access_other_school_or_admin_operations(self):
        """Role and tenant boundaries are strictly enforced for session-authenticated users."""
        school_b = School.objects.create(name='School B', code='school-b-test')
        student = User.objects.create_user(
            username='student@test.com',
            email='student@test.com',
            password='ComplexPassword123!',
            role=User.Role.STUDENT,
            school=self.school,
        )

        # Log in as student
        client = APIClient(enforce_csrf_checks=True)
        client.defaults['HTTP_X_CLIENT_TYPE'] = 'web'
        client.defaults['HTTP_X_CSRFTOKEN'] = client.get(
            '/api/v1/auth/csrf/'
        ).data['csrfToken']
        # Students require 2FA, but in test let's force_login or verify 2FA OTP
        login_res = client.post('/api/v1/auth/login/', {
            'email': 'student@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Student',
        }, format='json')
        self.assertEqual(login_res.status_code, 200)
        self.assertTrue(login_res.data.get('mfa_required'))
        mfa_token = login_res.data['mfa_token']
        dev_otp = login_res.data['dev_otp']

        verify_res = client.post('/api/v1/auth/verify-otp/', {
            'mfa_token': mfa_token,
            'otp': dev_otp,
        }, format='json')
        self.assertEqual(verify_res.status_code, 200)
        self.assertIn(settings.SESSION_COOKIE_NAME, verify_res.cookies)

        # Student cannot access Super Admin endpoints
        users_res = client.get('/api/v1/auth/users/')
        self.assertIn(users_res.status_code, [401, 403])

        # Student cannot create School Admin
        csrf_token = client.get('/api/v1/auth/csrf/').data['csrfToken']
        create_res = client.post('/api/v1/auth/school-admins/', {
            'name': 'Hacker Admin',
            'schoolId': school_b.id,
            'status': 'Active',
        }, format='json', HTTP_X_CSRFTOKEN=csrf_token)
        self.assertEqual(create_res.status_code, 403)

    def test_no_sensitive_secrets_in_me_or_login_response(self):
        """Responses never expose passwords, password hashes, or secret keys."""
        response = self.client.post('/api/v1/auth/login/', {
            'email': 'superadmin@test.com',
            'password': 'ComplexPassword123!',
            'role': 'Super Admin',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        data_str = json.dumps(response.data).lower()
        self.assertNotIn('complexpassword123!', data_str)
        self.assertNotIn('argon2', data_str)
        self.assertNotIn('pbkdf2', data_str)
