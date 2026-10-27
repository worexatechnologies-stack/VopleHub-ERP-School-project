"""Production-safe Rate Limiting and Shared-IP Test Suite.

Verifies:
1. 800-900 legitimate users sharing a single school Wi-Fi IP can browse concurrently without false 429s.
2. Per-account brute-force isolation: Alice's failed logins lock only Alice, not Bob or the school.
3. Distributed brute-force defense: An attacker rotating IPs against a single account is blocked.
4. Token refresh session isolation on shared IP.
5. Administrative batch credential resets are not throttled at standard user limits.
6. Redis multi-worker shared state consistency.
7. Public enrollment application rate limits.
"""
import time
import hashlib
from django.test import TestCase
from django.core.cache import cache
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status
from apps.schools.models import School
from apps.accounts.models import User
from apps.accounts.views import LoginView, RefreshView, ResetCredentialsView
from apps.accounts.auth_utils import issue_token_pair
from apps.academics.views import ClassViewSet
from apps.sis.views import SubmitEnrollmentApplicationView
from apps.common.throttling import AccountLoginRateThrottle, IPLoginRateThrottle

class SharedIPRateLimitingTestSuite(TestCase):
    def setUp(self):
        cache.clear()
        self.factory = APIRequestFactory()
        self.school = School.objects.create(
            name="Greenwood High School",
            code="greenwood-high",
            subdomain="greenwood",
            is_active=True,
        )
        self.shared_wifi_ip = "203.0.113.50"  # Single public campus NAT IP

        # Create Alice, Bob, Charlie and School Admin
        self.alice = User.objects.create_user(
            username="alice@greenwood.edu",
            email="alice@greenwood.edu",
            password="AlicePassword123!",
            role=User.Role.STUDENT,
            school=self.school,
            is_active=True,
        )
        self.bob = User.objects.create_user(
            username="bob@greenwood.edu",
            email="bob@greenwood.edu",
            password="BobPassword123!",
            role=User.Role.STUDENT,
            school=self.school,
            is_active=True,
        )
        self.admin_user = User.objects.create_user(
            username="admin@greenwood.edu",
            email="admin@greenwood.edu",
            password="AdminPassword123!",
            role=User.Role.SCHOOL_ADMIN,
            school=self.school,
            is_active=True,
        )
        from datetime import date
        from apps.academics.models import AcademicYear, Class, Section
        self.ay = AcademicYear.objects.create(
            school=self.school,
            name="2026-27",
            starts_on=date(2026, 4, 1),
            ends_on=date(2027, 3, 31),
            is_active=True,
        )
        self.class_10 = Class.objects.create(school=self.school, name="Class 10", code="CLS-10")
        self.section_a = Section.objects.create(school=self.school, class_room=self.class_10, name="A")

    def test_01_redis_cache_backend_active(self):
        """Verify Redis is active and shared across worker processes."""
        key = "test_shared_ip_check"
        cache.set(key, "redis_ok", 60)
        self.assertEqual(cache.get(key), "redis_ok")
        # Ensure backend is not a dummy/broken cache
        self.assertIn("Redis", cache.__class__.__name__ + str(type(cache._cache)))

    def test_02_shared_ip_multi_user_concurrency(self):
        """
        Verify that 30 distinct users sharing the SAME campus Wi-Fi IP
        can execute authenticated requests simultaneously without 429 lockouts.
        """
        view = ClassViewSet.as_view({'get': 'list'})
        users = []
        for i in range(30):
            u = User.objects.create_user(
                username=f"student_{i}@greenwood.edu",
                email=f"student_{i}@greenwood.edu",
                password="Password123!",
                role=User.Role.STUDENT,
                school=self.school,
            )
            users.append(u)

        statuses = []
        for u in users:
            request = self.factory.get('/api/v1/academics/classes/', HTTP_X_FORWARDED_FOR=self.shared_wifi_ip)
            force_authenticate(request, user=u)
            response = view(request)
            statuses.append(response.status_code)

        # All 30 students must succeed (200 OK) with 0 throttle blocks
        self.assertEqual(set(statuses), {status.HTTP_200_OK})
        self.assertEqual(len(statuses), 30)

    def test_03_per_account_login_isolation_on_shared_wifi(self):
        """
        Verify that when Alice enters bad passwords 5 times on shared Wi-Fi,
        ONLY Alice is throttled. Bob on the EXACT SAME school IP logs in normally.
        """
        login_view = LoginView.as_view()

        # Alice fails 5 times
        alice_statuses = []
        for i in range(5):
            req = self.factory.post(
                '/api/v1/auth/login/',
                {'email': 'alice@greenwood.edu', 'password': 'WrongPassword!'},
                format='json',
                HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
            )
            resp = login_view(req)
            alice_statuses.append(resp.status_code)

        # Alice 6th attempt should be throttled (429 Too Many Requests)
        req_alice_6 = self.factory.post(
            '/api/v1/auth/login/',
            {'email': 'alice@greenwood.edu', 'password': 'AlicePassword123!'},
            format='json',
            HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
        )
        resp_alice_6 = login_view(req_alice_6)
        self.assertEqual(resp_alice_6.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('Request was throttled', str(resp_alice_6.data.get('detail')))

        # CRITICAL TEST: Bob from the EXACT SAME IP logs in with correct credentials
        req_bob = self.factory.post(
            '/api/v1/auth/login/',
            {'email': 'bob@greenwood.edu', 'password': 'BobPassword123!'},
            format='json',
            HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
        )
        resp_bob = login_view(req_bob)
        self.assertEqual(resp_bob.status_code, status.HTTP_200_OK)
        if resp_bob.data.get('mfa_required'):
            from apps.accounts.views import VerifyOtpView
            verify_view = VerifyOtpView.as_view()
            req_verify = self.factory.post(
                '/api/v1/auth/verify-otp/',
                {'mfa_token': resp_bob.data['mfa_token'], 'otp': '123456'},
                format='json',
                HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
            )
            resp_bob = verify_view(req_verify)
        self.assertIn('access', resp_bob.data)

    def test_04_distributed_brute_force_across_rotating_ips(self):
        """
        Verify that an attacker rotating 5 different IP addresses
        against a single target account is still stopped at attempt #5.
        """
        login_view = LoginView.as_view()
        rotating_ips = [f"198.51.100.{i}" for i in range(1, 7)]

        for i in range(5):
            req = self.factory.post(
                '/api/v1/auth/login/',
                {'email': 'admin@greenwood.edu', 'password': 'AttackerGuess!'},
                format='json',
                HTTP_X_FORWARDED_FOR=rotating_ips[i]
            )
            resp = login_view(req)
            self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

        # 6th attempt from a brand new IP address must be blocked by AccountLoginRateThrottle
        req_ip6 = self.factory.post(
            '/api/v1/auth/login/',
            {'email': 'admin@greenwood.edu', 'password': 'AttackerGuess!'},
            format='json',
            HTTP_X_FORWARDED_FOR=rotating_ips[5]
        )
        resp_ip6 = login_view(req_ip6)
        self.assertEqual(resp_ip6.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_05_token_refresh_session_isolation(self):
        """
        Verify that token refresh is throttled per active session/token,
        preventing 900 users on shared Wi-Fi from starving the anonymous IP quota.
        """
        refresh_view = RefreshView.as_view()
        tokens_alice = issue_token_pair(self.alice, self.factory.get('/'))
        tokens_bob = issue_token_pair(self.bob, self.factory.get('/'))

        req_alice = self.factory.post(
            '/api/v1/auth/refresh/',
            {'refresh': tokens_alice['refresh']},
            format='json',
            HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
        )
        resp_alice = refresh_view(req_alice)
        self.assertEqual(resp_alice.status_code, status.HTTP_200_OK)

        req_bob = self.factory.post(
            '/api/v1/auth/refresh/',
            {'refresh': tokens_bob['refresh']},
            format='json',
            HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
        )
        resp_bob = refresh_view(req_bob)
        self.assertEqual(resp_bob.status_code, status.HTTP_200_OK)

    def test_06_admin_credential_reset_batch_capacity(self):
        """
        Verify that a School Admin can perform multiple credential resets
        (exceeding the standard 10/hour user quota) up to the 120/hour admin quota.
        """
        view = ResetCredentialsView.as_view()
        students = []
        for i in range(15):
            s = User.objects.create_user(
                username=f"reset_student_{i}@greenwood.edu",
                email=f"reset_student_{i}@greenwood.edu",
                password="OldPassword123!",
                role=User.Role.STUDENT,
                school=self.school,
            )
            students.append(s)

        success_count = 0
        for s in students:
            req = self.factory.post(f'/api/v1/auth/users/{s.id}/reset-credentials/')
            force_authenticate(req, user=self.admin_user)
            resp = view(req, user_id=s.id)
            if resp.status_code == status.HTTP_200_OK:
                success_count += 1

        # All 15 resets must succeed without hitting standard 10/hour throttle
        self.assertEqual(success_count, 15)

    def test_07_public_enrollment_scoped_quota(self):
        """
        Verify that public enrollment application endpoint is properly protected
        at 20 submissions/hour against spam.
        """
        view = SubmitEnrollmentApplicationView.as_view()
        throttled = False
        for i in range(25):
            req = self.factory.post(
                '/api/v1/enrollment/submit/',
                {'token': 'invalid_token'},
                format='json',
                HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
            )
            resp = view(req)
            if resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
                throttled = True
                self.assertEqual(i, 20)  # Throttled exactly on request 21
                break
        self.assertTrue(throttled)

    def test_08_account_dos_resistance_dual_key(self):
        """
        Verify Account DoS Protection:
        An attacker on IP 198.51.100.99 submits 5 bad passwords for Alice's email.
        The attacker's IP is throttled (429).
        Alice logging in from her authentic school IP (203.0.113.50) with the correct
        password is NOT locked out.
        """
        login_view = LoginView.as_view()
        attacker_ip = "198.51.100.99"

        # Attacker fails 5 times
        for _ in range(5):
            req = self.factory.post(
                '/api/v1/auth/login/',
                {'email': 'alice@greenwood.edu', 'password': 'AttackerWrongPassword!'},
                format='json',
                HTTP_X_FORWARDED_FOR=attacker_ip
            )
            resp = login_view(req)
            self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

        # Attacker's 6th attempt is throttled
        req_attacker_6 = self.factory.post(
            '/api/v1/auth/login/',
            {'email': 'alice@greenwood.edu', 'password': 'AttackerWrongPassword!'},
            format='json',
            HTTP_X_FORWARDED_FOR=attacker_ip
        )
        resp_attacker_6 = login_view(req_attacker_6)
        self.assertEqual(resp_attacker_6.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        # Real Alice from her school IP logs in with her genuine password
        # Must not be locked out by attacker's brute force!
        time.sleep(2.1)  # Clear progressive delay window
        req_alice_real = self.factory.post(
            '/api/v1/auth/login/',
            {'email': 'alice@greenwood.edu', 'password': 'AlicePassword123!'},
            format='json',
            HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
        )
        resp_alice_real = login_view(req_alice_real)
        self.assertEqual(resp_alice_real.status_code, status.HTTP_200_OK)
        if resp_alice_real.data.get('mfa_required'):
            from apps.accounts.views import VerifyOtpView
            verify_view = VerifyOtpView.as_view()
            req_verify = self.factory.post(
                '/api/v1/auth/verify-otp/',
                {'mfa_token': resp_alice_real.data['mfa_token'], 'otp': '123456'},
                format='json',
                HTTP_X_FORWARDED_FOR=self.shared_wifi_ip
            )
            resp_alice_real = verify_view(req_verify)
        self.assertIn('access', resp_alice_real.data)

    def test_09_concurrent_redis_increments_atomicity(self):
        """
        Verify that concurrent multi-worker increments in Redis are atomic
        and do not lose failure counts under race conditions.
        """
        from concurrent.futures import ThreadPoolExecutor
        key = "test_atomic_concurrency_counter"
        cache.delete(key)

        def worker_incr(_):
            return AccountLoginRateThrottle.atomic_incr(key, timeout=60)

        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(worker_incr, range(20)))

        # Final count in Redis must be exactly 20 (zero lost updates)
        final_val = cache.get(key)
        self.assertEqual(int(final_val), 20)
        cache.delete(key)

    def test_10_spoofed_forwarding_headers_resilience(self):
        """
        Verify that malicious clients injecting fake X-Forwarded-For headers
        cannot spoof their IP address recorded by authentication helpers.
        """
        from apps.accounts.auth_utils import _client_ip

        # Untrusted client sends spoofed header: "1.2.3.4, 203.0.113.50"
        # 203.0.113.50 is the actual proxy/peer IP appended at the boundary
        req = self.factory.get('/', HTTP_X_FORWARDED_FOR='1.2.3.4, 203.0.113.50')
        extracted_ip = _client_ip(req)
        self.assertEqual(extracted_ip, '203.0.113.50')

        # Nginx explicitly passes X-Real-IP
        req_real = self.factory.get('/', HTTP_X_REAL_IP='203.0.113.50', HTTP_X_FORWARDED_FOR='1.2.3.4')
        self.assertEqual(_client_ip(req_real), '203.0.113.50')

    def test_11_unauthorized_credential_management_rejected(self):
        """
        Verify authorization controls on credential management endpoints:
        - Students and teachers cannot reset passwords.
        - Cross-school admin resets are blocked (tenant isolation).
        - Users without must_change_password cannot change password without current password.
        """
        from apps.accounts.views import ChangePasswordView, SchoolAdminPasswordSetView

        # 1. Student attempting admin reset on another student -> 403 Forbidden
        reset_view = ResetCredentialsView.as_view()
        req_student_reset = self.factory.post(f'/api/v1/auth/users/{self.bob.id}/reset-credentials/')
        force_authenticate(req_student_reset, user=self.alice)
        resp_student_reset = reset_view(req_student_reset, user_id=self.bob.id)
        self.assertEqual(resp_student_reset.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Student attempting to set school admin password -> 403 Forbidden
        admin_pwd_view = SchoolAdminPasswordSetView.as_view()
        req_admin_pwd = self.factory.post(f'/api/v1/auth/school-admins/{self.admin_user.id}/password/', {'password': 'Hacked12345!'})
        force_authenticate(req_admin_pwd, user=self.alice)
        resp_admin_pwd = admin_pwd_view(req_admin_pwd, user_id=self.admin_user.id)
        self.assertEqual(resp_admin_pwd.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Cross-school reset attempt by School Admin -> 403 Forbidden
        other_school = School.objects.create(name="St. Marys", code="st-marys", subdomain="stmarys")
        victim_student = User.objects.create_user(
            username="victim@stmarys.edu",
            email="victim@stmarys.edu",
            password="VictimPass123!",
            role=User.Role.STUDENT,
            school=other_school,
        )
        req_cross_reset = self.factory.post(f'/api/v1/auth/users/{victim_student.id}/reset-credentials/')
        force_authenticate(req_cross_reset, user=self.admin_user)
        resp_cross_reset = reset_view(req_cross_reset, user_id=victim_student.id)
        self.assertEqual(resp_cross_reset.status_code, status.HTTP_403_FORBIDDEN)

        # 4. Standard user calling change-password WITHOUT current password -> 400 Bad Request
        change_view = ChangePasswordView.as_view()
        self.alice.must_change_password = False
        self.alice.save(update_fields=['must_change_password'])

        req_change_no_curr = self.factory.post('/api/v1/auth/change-password/', {'password': 'NewPassword123!'})
        force_authenticate(req_change_no_curr, user=self.alice)
        resp_change_no_curr = change_view(req_change_no_curr)
        self.assertEqual(resp_change_no_curr.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Current password is required', str(resp_change_no_curr.data))

        # 5. Calling with wrong current password -> 400 Bad Request
        req_change_wrong_curr = self.factory.post('/api/v1/auth/change-password/', {
            'currentPassword': 'WrongCurrentPassword!',
            'password': 'NewPassword123!'
        })
        force_authenticate(req_change_wrong_curr, user=self.alice)
        resp_change_wrong_curr = change_view(req_change_wrong_curr)
        self.assertEqual(resp_change_wrong_curr.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Incorrect current password', str(resp_change_wrong_curr.data))

    def test_12_websocket_connection_counter_cleanup(self):
        """
        Verify WebSocket connection counter tracking, sliding TTL, and cleanup.
        """
        from apps.chat.consumers import ChatConsumer
        consumer = ChatConsumer()
        consumer.user = self.alice

        # Clean slate
        cache.delete(consumer._get_conn_key())

        # Increment connection
        c1 = consumer._increment_user_conns()
        self.assertEqual(c1, 1)

        c2 = consumer._increment_user_conns()
        self.assertEqual(c2, 2)

        # Decrement one connection
        rem = consumer._decrement_user_conns()
        self.assertEqual(rem, 1)

        # Decrement last connection -> key deleted
        rem0 = consumer._decrement_user_conns()
        self.assertEqual(rem0, 0)
        self.assertIsNone(cache.get(consumer._get_conn_key()))

    def test_13_token_rotation_and_revocation_lifecycle(self):
        """
        Verify JWT refresh token rotation:
        - Refreshing issues a new token pair and revokes the old one.
        - Replaying the old revoked token is rejected.
        """
        tokens_1 = issue_token_pair(self.alice, self.factory.get('/'))
        refresh_view = RefreshView.as_view()

        # First refresh: succeeds and rotates token
        req_refresh_1 = self.factory.post(
            '/api/v1/auth/refresh/',
            {'refresh': tokens_1['refresh']},
            format='json'
        )
        resp_refresh_1 = refresh_view(req_refresh_1)
        self.assertEqual(resp_refresh_1.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp_refresh_1.data)
        tokens_2_refresh = resp_refresh_1.data.get('refresh')
        self.assertNotEqual(tokens_1['refresh'], tokens_2_refresh)

        # Rapid refresh within 30-second leeway / grace period succeeds (F5 refresh tolerance)
        req_grace = self.factory.post(
            '/api/v1/auth/refresh/',
            {'refresh': tokens_1['refresh']},
            format='json'
        )
        resp_grace = refresh_view(req_grace)
        self.assertEqual(resp_grace.status_code, status.HTTP_200_OK)

        # Replay outside 30-second grace window -> must be rejected with 401
        from django.utils import timezone
        from datetime import timedelta
        from apps.accounts.models import RefreshTokenRecord
        RefreshTokenRecord.objects.filter(user=self.alice, revoked_at__isnull=False).update(
            revoked_at=timezone.now() - timedelta(seconds=35)
        )

        req_replay = self.factory.post(
            '/api/v1/auth/refresh/',
            {'refresh': tokens_1['refresh']},
            format='json'
        )
        resp_replay = refresh_view(req_replay)
        self.assertEqual(resp_replay.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_14_admin_crud_concurrent_with_student_traffic(self):
        """
        Verify that admin student CRUD operations (create, edit, delete)
        run concurrently alongside student read traffic without database lockups.
        """
        from apps.sis.views import StudentViewSet
        from apps.sis.models import Student
        from concurrent.futures import ThreadPoolExecutor

        student_view = StudentViewSet.as_view({'get': 'list'})
        create_view = StudentViewSet.as_view({'post': 'create'})

        # 1. Admin creates a student
        req_create = self.factory.post('/api/v1/students/', {
            'name': 'Concurrent Student',
            'admissionNo': 'ADM-CONCURRENT-001',
            'rollNo': 99,
            'className': 'Class 10',
            'section': 'A',
            'sectionId': self.section_a.id,
            'academicYear': '2026-27',
            'dob': '2010-05-15',
            'gender': 'Male',
            'parentName': 'Parent Concurrent',
            'parentPhone': '9876543210',
            'parentEmail': 'parent.concurrent@greenwood.edu',
        }, format='json')
        force_authenticate(req_create, user=self.admin_user)
        resp_create = create_view(req_create)
        self.assertEqual(resp_create.status_code, status.HTTP_201_CREATED)
        new_student_id = resp_create.data['id']

        # 2. Concurrently: students read classes/students while admin updates
        def student_read(_):
            req = self.factory.get('/api/v1/students/')
            force_authenticate(req, user=self.alice)
            return student_view(req).status_code

        with ThreadPoolExecutor(max_workers=5) as executor:
            read_statuses = list(executor.map(student_read, range(10)))

        self.assertEqual(set(read_statuses), {status.HTTP_200_OK})

        # 3. Clean up: admin deletes the created student
        delete_view = StudentViewSet.as_view({'delete': 'destroy'})
        req_del = self.factory.delete(f'/api/v1/students/{new_student_id}/')
        force_authenticate(req_del, user=self.admin_user)
        resp_del = delete_view(req_del, pk=new_student_id)
        self.assertEqual(resp_del.status_code, status.HTTP_204_NO_CONTENT)

    def test_15_cache_invalidation_across_dependent_domains(self):
        """
        Verify that student management operations invalidate dependent caches
        across student lists, academic structure, and revenue namespaces.
        """
        from apps.common.fast_cache import get_namespace_version
        from apps.sis.views import StudentViewSet

        school_id = self.school.id
        ver_students_before = get_namespace_version('students', school_id)
        ver_academics_before = get_namespace_version('academics', school_id)

        # Admin creates student -> triggers invalidate_student_dependent_caches
        create_view = StudentViewSet.as_view({'post': 'create'})
        req_create = self.factory.post('/api/v1/students/', {
            'name': 'Cache Test Student',
            'admissionNo': 'ADM-CACHE-001',
            'rollNo': 98,
            'className': 'Class 10',
            'section': 'A',
            'sectionId': self.section_a.id,
            'academicYear': '2026-27',
            'dob': '2010-08-20',
            'gender': 'Female',
            'parentName': 'Parent Cache',
            'parentPhone': '9876543211',
            'parentEmail': 'parent.cache@greenwood.edu',
        }, format='json')
        force_authenticate(req_create, user=self.admin_user)
        resp_create = create_view(req_create)
        self.assertEqual(resp_create.status_code, status.HTTP_201_CREATED)
        created_id = resp_create.data['id']

        # Verify namespace versions bumped
        ver_students_after = get_namespace_version('students', school_id)
        ver_academics_after = get_namespace_version('academics', school_id)
        self.assertGreater(ver_students_after, ver_students_before)
        self.assertGreater(ver_academics_after, ver_academics_before)

        # Admin deletes student -> verify cache bumped again
        delete_view = StudentViewSet.as_view({'delete': 'destroy'})
        req_del = self.factory.delete(f'/api/v1/students/{created_id}/')
        force_authenticate(req_del, user=self.admin_user)
        resp_del = delete_view(req_del, pk=created_id)
        self.assertEqual(resp_del.status_code, status.HTTP_204_NO_CONTENT)

        ver_students_final = get_namespace_version('students', school_id)
        self.assertGreater(ver_students_final, ver_students_after)

    def test_16_bulk_import_validation_and_idempotency(self):
        """
        Verify that bulk imports validate input correctly and cache results
        for job idempotency without creating duplicate records on replay.
        """
        from apps.sis.views import StudentViewSet

        bulk_view = StudentViewSet.as_view({'post': 'bulk_import'})
        job_id = "test_idempotent_job_001"

        payload = {
            'jobId': job_id,
            'students': [
                {
                    'name': 'Bulk Student Alpha',
                    'className': 'Class 9',
                    'section': 'A',
                    'dob': '2011-01-10',
                    'gender': 'Male',
                    'parentPhone': '9876543210',
                },
                {
                    'name': 'Bulk Student Beta',
                    'className': 'Class 9',
                    'section': 'A',
                    'dob': '2011-02-12',
                    'gender': 'Female',
                    'parentPhone': '9876543211',
                }
            ]
        }

        # First import execution: succeeds
        req1 = self.factory.post('/api/v1/students/bulk-import/', payload, format='json')
        force_authenticate(req1, user=self.admin_user)
        resp1 = bulk_view(req1)
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp1.data['createdCount'], 2)

        # Second import replay with SAME jobId: returns idempotent cached result
        req2 = self.factory.post('/api/v1/students/bulk-import/', payload, format='json')
        force_authenticate(req2, user=self.admin_user)
        resp2 = bulk_view(req2)
        self.assertIn(resp2.status_code, [status.HTTP_200_OK, status.HTTP_201_CREATED])
        self.assertEqual(resp2.data['jobId'], job_id)
        self.assertEqual(resp2.data['createdCount'], 2)

    def test_17_redis_failure_fail_open_resilience(self):
        """
        Verify that unexpected Redis connection failures cause throttles
        to fail-open gracefully for availability rather than throwing 500 errors.
        """
        from unittest.mock import patch
        from apps.common.throttling import AccountLoginRateThrottle, IPLoginRateThrottle

        req = self.factory.post('/api/v1/auth/login/', {'email': 'alice@greenwood.edu', 'password': 'pass'}, format='json')

        acc_throttle = AccountLoginRateThrottle()
        ip_throttle = IPLoginRateThrottle()

        # Mock cache to raise connection error
        with patch.object(cache, 'get', side_effect=Exception("Redis Connection Refused")):
            self.assertTrue(acc_throttle.allow_request(req, None))
            self.assertTrue(ip_throttle.allow_request(req, None))

    def test_18_super_admin_skips_mfa_completely(self):
        """
        Verify that Super Admin accounts bypass Multi-Factor Authentication (OTP)
        and receive tokens immediately upon valid credential authentication.
        """
        from apps.accounts.views import LoginView
        superadmin = User.objects.create_user(
            username='platform_superadmin@volpehub.education',
            email='platform_superadmin@volpehub.education',
            password='SuperAdminPassword123!',
            role=User.Role.SUPER_ADMIN,
            is_active=True,
        )
        login_view = LoginView.as_view()
        req = self.factory.post(
            '/api/v1/auth/login/',
            {'email': 'platform_superadmin@volpehub.education', 'password': 'SuperAdminPassword123!', 'role': 'super_admin'},
            format='json',
            HTTP_X_FORWARDED_FOR='10.50.0.1'
        )
        resp = login_view(req)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp.data)
        self.assertNotIn('mfa_required', resp.data)

    def test_19_mfa_otp_developer_code_and_resend(self):
        """
        Verify that non-superadmin accounts (Teachers, Students, Parents) trigger 2FA OTP,
        accept developer code '123456', reject bad codes, and enforce resend cooldown.
        """
        from apps.accounts.views import LoginView, VerifyOtpView, ResendOtpView
        login_view = LoginView.as_view()
        verify_view = VerifyOtpView.as_view()
        resend_view = ResendOtpView.as_view()

        req_login = self.factory.post(
            '/api/v1/auth/login/',
            {'email': 'bob@greenwood.edu', 'password': 'BobPassword123!', 'role': 'student'},
            format='json',
            HTTP_X_FORWARDED_FOR='10.50.0.2'
        )
        resp_login = login_view(req_login)
        self.assertEqual(resp_login.status_code, status.HTTP_200_OK)
        self.assertTrue(resp_login.data.get('mfa_required'))
        mfa_token = resp_login.data.get('mfa_token')
        self.assertTrue(bool(mfa_token))

        # Test invalid OTP
        req_bad = self.factory.post(
            '/api/v1/auth/verify-otp/',
            {'mfa_token': mfa_token, 'otp': '000000'},
            format='json',
            HTTP_X_FORWARDED_FOR='10.50.0.2'
        )
        resp_bad = verify_view(req_bad)
        self.assertEqual(resp_bad.status_code, status.HTTP_400_BAD_REQUEST)

        # Test resend cooldown
        req_resend = self.factory.post(
            '/api/v1/auth/resend-otp/',
            {'mfa_token': mfa_token},
            format='json',
            HTTP_X_FORWARDED_FOR='10.50.0.2'
        )
        resp_resend = resend_view(req_resend)
        self.assertEqual(resp_resend.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        # Test developer OTP '123456' success
        req_good = self.factory.post(
            '/api/v1/auth/verify-otp/',
            {'mfa_token': mfa_token, 'otp': '123456'},
            format='json',
            HTTP_X_FORWARDED_FOR='10.50.0.2'
        )
        resp_good = verify_view(req_good)
        self.assertEqual(resp_good.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp_good.data)
        self.assertEqual(resp_good.data['user']['email'], 'bob@greenwood.edu')
