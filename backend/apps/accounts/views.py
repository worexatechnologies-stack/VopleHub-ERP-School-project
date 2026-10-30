from rest_framework import permissions, status, viewsets
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.decorators import action
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.authentication import SessionAuthentication
from django.contrib.auth import login as django_login, logout as django_logout, update_session_auth_hash
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.conf import settings
import logging
import datetime
import secrets
from django.core.validators import validate_email
from django.db import IntegrityError
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
import hashlib
from .serializers import UserSerializer, CredentialVaultSerializer
from .models import RefreshTokenRecord, User, CredentialVaultRecord, PublicLearnerSubscription
from .credential_generator import create_user_with_credentials, generate_password
from .credential_vault import record_credential, sync_school_credential_vault
from .permissions import MustChangePasswordComplete
from apps.common.fast_cache import fast_cache_response, bump_cache_version
from apps.common.pagination import AdminListPagination
from .auth_utils import (
    clear_refresh_cookie,
    issue_token_pair,
    read_refresh_cookie,
    revoke_all_user_sessions,
    revoke_refresh_token,
    rotate_refresh_token,
)
from apps.schools.models import School
from apps.common.throttling import (
    AccountLoginRateThrottle,
    MfaChallengeRateThrottle,
    TokenRefreshRateThrottle,
    AdminCredentialManagementThrottle,
)
from .authentication import CachedJWTAuthentication


def _is_mobile_client(request):
    client_type = (
        request.headers.get('X-Client-Type')
        or (request.data.get('client_type') if isinstance(request.data, dict) else None)
        or ''
    )
    return str(client_type).strip().lower() in {'mobile', 'native'}


def _create_web_session(request, user):
    """Authenticate a browser via Django's server-side session store."""
    # APIRequestFactory/direct ASGI callers may intentionally bypass Django's
    # SessionMiddleware (native clients and low-level tests).  Real browser
    # requests always have ``request.session``; leave those callers to the
    # token response path instead of raising AttributeError.
    if not hasattr(request, 'session'):
        return False
    django_login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    now = timezone.now().timestamp()
    request.session['_auth_session_created_at'] = now
    request.session['_auth_session_last_activity_at'] = now
    request.session.set_expiry(settings.SESSION_IDLE_TIMEOUT_SECONDS)
    return True


logger = logging.getLogger(__name__)


class PublicLearnerRegistrationView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'public_signup'

    def post(self, request):
        name = str(request.data.get('name') or '').strip()
        email = str(request.data.get('email') or '').strip().lower()
        password = str(request.data.get('password') or '')
        phone = str(request.data.get('phone') or '').strip()
        plan = request.data.get('plan')
        if not name or len(name) > 160 or not email or len(email) > 254:
            return Response({'detail': 'Enter a valid name and email address.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(email)
        except ValidationError:
            return Response({'detail': 'Enter a valid email address.'}, status=status.HTTP_400_BAD_REQUEST)
        if plan not in PublicLearnerSubscription.Plan.values:
            return Response({'detail': 'Choose a valid subscription plan.'}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({'detail': 'This email is already registered. Please sign in or contact support.'}, status=status.HTTP_409_CONFLICT)
        try:
            validate_password(password)
        except ValidationError as exc:
            return Response({'detail': list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        first_name, _, last_name = name.partition(' ')
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=f'public-{secrets.token_hex(12)}',
                    email=email,
                    password=password,
                    first_name=first_name[:150],
                    last_name=last_name[:150],
                    role=User.Role.PUBLIC_LEARNER,
                    school=None,
                    is_active=False,
                )
                PublicLearnerSubscription.objects.create(user=user, plan=plan, phone=phone[:30])
        except IntegrityError:
            return Response({'detail': 'This email is already registered. Please sign in or contact support.'}, status=status.HTTP_409_CONFLICT)
        return Response({
            'detail': 'Your account request was received. Access is enabled after your subscription is confirmed.',
            'status': PublicLearnerSubscription.Status.PENDING,
        }, status=status.HTTP_201_CREATED)


class PublicLearnerSelfView(APIView):
    permission_classes = [permissions.IsAuthenticated, MustChangePasswordComplete]

    def get(self, request):
        if request.user.role != User.Role.PUBLIC_LEARNER:
            return Response({'detail': 'Public learner account required.'}, status=status.HTTP_403_FORBIDDEN)
        subscription = getattr(request.user, 'public_subscription', None)
        if not subscription or subscription.status != PublicLearnerSubscription.Status.ACTIVE:
            return Response({'detail': 'An active subscription is required.'}, status=status.HTTP_403_FORBIDDEN)
        if subscription.expiry_date and subscription.expiry_date < timezone.localdate():
            subscription.status = PublicLearnerSubscription.Status.EXPIRED
            subscription.save(update_fields=['status', 'updated_at'])
            request.user.is_active = False
            request.user.save(update_fields=['is_active'])
            return Response({'detail': 'Your subscription has expired.'}, status=status.HTTP_403_FORBIDDEN)
        return Response({
            'id': subscription.pk,
            'name': request.user.get_full_name() or request.user.username,
            'email': request.user.email,
            'phone': subscription.phone,
            'plan': subscription.plan,
            'status': subscription.status,
            'paymentDate': subscription.payment_date,
            'expiryDate': subscription.expiry_date,
        })


class SuperAdminPublicLearnerView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = AdminListPagination

    def _authorize(self, request):
        return request.user.role == User.Role.SUPER_ADMIN

    def get(self, request):
        if not self._authorize(request):
            return Response({'detail': 'Only Super Admins can manage public learners.'}, status=status.HTTP_403_FORBIDDEN)
        qs = PublicLearnerSubscription.objects.select_related('user').all()
        search = request.query_params.get('search', '').strip()
        plan = request.query_params.get('plan')
        state = request.query_params.get('status')
        if search:
            from django.db.models import Q
            qs = qs.filter(Q(user__email__icontains=search) | Q(user__first_name__icontains=search) | Q(user__last_name__icontains=search))
        if plan in PublicLearnerSubscription.Plan.values:
            qs = qs.filter(plan=plan)
        if state in PublicLearnerSubscription.Status.values:
            qs = qs.filter(status=state)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        data = [{
            'id': item.pk,
            'userId': item.user_id,
            'name': item.user.get_full_name() or item.user.username,
            'email': item.user.email,
            'plan': item.plan,
            'status': item.status,
            'phone': item.phone,
            'paymentDate': item.payment_date,
            'expiryDate': item.expiry_date,
            'notes': item.notes,
            'createdAt': item.created_at,
        } for item in page]
        return paginator.get_paginated_response(data)

    def post(self, request, subscription_id, action_name):
        if not self._authorize(request):
            return Response({'detail': 'Only Super Admins can manage public learners.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            subscription = PublicLearnerSubscription.objects.select_related('user').get(pk=subscription_id)
        except PublicLearnerSubscription.DoesNotExist:
            return Response({'detail': 'Public learner subscription not found.'}, status=status.HTTP_404_NOT_FOUND)
        user = subscription.user
        if action_name == 'activate':
            paid_on = timezone.localdate()
            duration_months = {PublicLearnerSubscription.Plan.MONTHLY: 1, PublicLearnerSubscription.Plan.QUARTERLY: 3, PublicLearnerSubscription.Plan.ANNUAL: 12}[subscription.plan]
            expiry = paid_on + datetime.timedelta(days=30 * duration_months)
            subscription.status = PublicLearnerSubscription.Status.ACTIVE
            subscription.payment_date = paid_on
            subscription.expiry_date = expiry
            user.is_active = True
            user.save(update_fields=['is_active'])
            subscription.save(update_fields=['status', 'payment_date', 'expiry_date', 'updated_at'])
        elif action_name in {'suspend', 'expire'}:
            subscription.status = PublicLearnerSubscription.Status.SUSPENDED if action_name == 'suspend' else PublicLearnerSubscription.Status.EXPIRED
            subscription.save(update_fields=['status', 'updated_at'])
            user.is_active = False
            user.save(update_fields=['is_active'])
            revoke_all_user_sessions(user)
        else:
            return Response({'detail': 'Unsupported public learner action.'}, status=status.HTTP_400_BAD_REQUEST)
        from apps.common.audit import record_admin_audit_event
        audit_action = {
            'activate': 'public_learner_activated',
            'suspend': 'public_learner_suspended',
            'expire': 'public_learner_expired',
        }[action_name]
        record_admin_audit_event(request, audit_action, target=subscription, metadata={'user_id': user.pk})
        return Response({'id': subscription.pk, 'status': subscription.status, 'expiryDate': subscription.expiry_date})


class SuperAdminLegacyPublicLearnerMigrationView(APIView):
    """One-time import of the former browser-only learner directory."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if request.user.role != User.Role.SUPER_ADMIN:
            return Response({'detail': 'Only Super Admins can import public learners.'}, status=status.HTTP_403_FORBIDDEN)
        rows = request.data.get('learners')
        if not isinstance(rows, list) or len(rows) > 100:
            return Response({'detail': 'Submit between 1 and 100 learner records per import.'}, status=status.HTTP_400_BAD_REQUEST)
        if not rows:
            return Response({'created': 0, 'already_imported': 0})

        parsed = []
        seen_emails = set()
        for row in rows:
            if not isinstance(row, dict):
                return Response({'detail': 'Each learner record must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
            name = str(row.get('name') or '').strip()
            email = str(row.get('email') or '').strip().lower()
            password = str(row.get('password') or '')
            plan = row.get('plan')
            state = row.get('status')
            if not name or len(name) > 160 or not email or len(email) > 254 or not password or len(password) > 128:
                return Response({'detail': 'Each record needs a name, email, and password within the supported length.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                validate_email(email)
            except ValidationError:
                return Response({'detail': f'Invalid email address in import: {email}.'}, status=status.HTTP_400_BAD_REQUEST)
            if email in seen_emails:
                return Response({'detail': f'Duplicate email in import: {email}.'}, status=status.HTTP_400_BAD_REQUEST)
            if plan not in PublicLearnerSubscription.Plan.values:
                return Response({'detail': f'Invalid subscription plan for {email}.'}, status=status.HTTP_400_BAD_REQUEST)
            if state not in PublicLearnerSubscription.Status.values:
                return Response({'detail': f'Invalid subscription status for {email}.'}, status=status.HTTP_400_BAD_REQUEST)
            payment_date = parse_date(str(row.get('paymentDate') or ''))
            expiry_date = parse_date(str(row.get('expiryDate') or ''))
            if (row.get('paymentDate') and not payment_date) or (row.get('expiryDate') and not expiry_date):
                return Response({'detail': f'Invalid subscription dates for {email}.'}, status=status.HTTP_400_BAD_REQUEST)
            if state == PublicLearnerSubscription.Status.ACTIVE and (not payment_date or not expiry_date):
                return Response({'detail': f'Active imported subscriptions require payment and expiry dates for {email}.'}, status=status.HTTP_400_BAD_REQUEST)
            seen_emails.add(email)
            parsed.append({
                'name': name,
                'email': email,
                'password': password,
                'plan': plan,
                'status': state,
                'payment_date': payment_date,
                'expiry_date': expiry_date,
                'phone': str(row.get('phone') or '')[:30],
                'notes': str(row.get('notes') or '')[:500],
            })

        created = 0
        already_imported = 0
        try:
            with transaction.atomic():
                for item in parsed:
                    existing = User.objects.select_for_update().filter(email__iexact=item['email']).first()
                    if existing:
                        if existing.role == User.Role.PUBLIC_LEARNER and hasattr(existing, 'public_subscription'):
                            already_imported += 1
                            continue
                        raise ValueError(f'The email {item["email"]} already belongs to another account.')
                    subscription_state = item['status']
                    if subscription_state == PublicLearnerSubscription.Status.ACTIVE and item['expiry_date'] and item['expiry_date'] < timezone.localdate():
                        subscription_state = PublicLearnerSubscription.Status.EXPIRED
                    is_active = subscription_state == PublicLearnerSubscription.Status.ACTIVE
                    first_name, _, last_name = item['name'].partition(' ')
                    user = User.objects.create_user(
                        username=f'public-{secrets.token_hex(12)}',
                        email=item['email'],
                        password=item['password'],
                        first_name=first_name[:150],
                        last_name=last_name[:150],
                        role=User.Role.PUBLIC_LEARNER,
                        school=None,
                        is_active=is_active,
                        must_change_password=True,
                    )
                    PublicLearnerSubscription.objects.create(
                        user=user,
                        plan=item['plan'],
                        status=subscription_state,
                        phone=item['phone'],
                        payment_date=item['payment_date'],
                        expiry_date=item['expiry_date'],
                        notes=item['notes'],
                    )
                    created += 1
        except (IntegrityError, ValueError) as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_409_CONFLICT)

        if created:
            from apps.common.audit import record_admin_audit_event
            record_admin_audit_event(request, 'public_learner_legacy_migration', metadata={'created': created, 'already_imported': already_imported})
        return Response({'created': created, 'already_imported': already_imported})


@method_decorator(ensure_csrf_cookie, name='dispatch')
class CsrfTokenView(APIView):
    """Exposes CSRF token to frontend and ensures csrftoken cookie is set."""
    permission_classes = [permissions.AllowAny]
    # The client may bootstrap many sessions behind one school NAT at once.
    # The edge proxy provides the coarse flood limit; an IP quota here would
    # make unrelated students consume each other's CSRF bootstrap allowance.
    throttle_classes = []

    def get(self, request):
        token = get_token(request)
        response = Response({'csrfToken': token})
        # Expire cookies from the former browser JWT flow. Browser sessions
        # now use only Django's sessionid cookie plus the separate CSRF cookie.
        clear_refresh_cookie(response)
        return response


def _enforce_first_login_password_change(user):
    """Keep the account's explicit temporary-password flag authoritative."""
    # Credential creation and reset flows set must_change_password directly.
    # last_login is not enough to infer a temporary password: an admin may
    # reset an account before its first successful sign-in, after which this
    # check must not re-lock the newly chosen password.
    return None


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    # AccountLoginRateThrottle counts failed credentials only. A conventional
    # request-count throttle here would lock out legitimate accounts after a
    # handful of successful portal/mobile logins (especially behind a NAT).
    throttle_classes = [AccountLoginRateThrottle]

    @extend_schema(
        request=inline_serializer('LoginRequest', {
            'email': serializers.EmailField(),
            'password': serializers.CharField(write_only=True),
            'role': serializers.CharField(required=False),
            'human_verification_token': serializers.CharField(required=False),
        }),
        responses={200: inline_serializer('LoginResponse', {
            'access': serializers.CharField(required=False),
            'refresh': serializers.CharField(required=False),
            'user': UserSerializer(),
        })},
    )
    def post(self, request):
        if not _is_mobile_client(request):
            SessionAuthentication().enforce_csrf(request)
            from .human_verification import verify_human_token
            human_token = (
                request.data.get('human_verification_token')
                or request.data.get('humanVerificationToken')
                or request.data.get('turnstile_token')
                or request.headers.get('X-Human-Verification-Token')
            )
            is_valid, error_msg = verify_human_token(human_token, request=request)
            if not is_valid:
                return Response({'detail': error_msg or 'Please complete the Cloudflare security check to sign in.'}, status=status.HTTP_400_BAD_REQUEST)
        raw_email = (request.data.get('email') or request.data.get('username') or '').strip()
        password = str(request.data.get('password', ''))
        requested_role = (request.data.get('role') or '').strip()
        if not raw_email or not password:
            return Response({'detail': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=raw_email).first() or User.objects.filter(username__iexact=raw_email).first()
        if user is None:
            # Constant-time dummy check to prevent account-enumeration timing leaks
            User().check_password(password)
            AccountLoginRateThrottle.record_failure(raw_email, request=request)
            return Response({'detail': 'Invalid login credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.check_password(password):
            AccountLoginRateThrottle.record_failure(raw_email, request=request)
            return Response({'detail': 'Invalid login credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        if user.school and not user.school.is_active:
            return Response({'detail': 'This school account is currently deactivated. Please contact your platform administrator.'}, status=status.HTTP_403_FORBIDDEN)

        if not user.is_active:
            AccountLoginRateThrottle.record_failure(raw_email, request=request)
            return Response({'detail': 'Invalid login credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        is_web_session = not _is_mobile_client(request) and hasattr(request, 'session')

        if requested_role:
            role_map = {
                'super admin': User.Role.SUPER_ADMIN,
                'super_admin': User.Role.SUPER_ADMIN,
                'platform': User.Role.SUPER_ADMIN,
                'school admin': User.Role.SCHOOL_ADMIN,
                'school_admin': User.Role.SCHOOL_ADMIN,
                'admin': User.Role.SCHOOL_ADMIN,
                'teacher': User.Role.TEACHER,
                'parent': User.Role.PARENT,
                'student': User.Role.STUDENT,
                'public_learner': User.Role.PUBLIC_LEARNER,
                'public learner': User.Role.PUBLIC_LEARNER,
            }
            normalized_requested = role_map.get(requested_role.lower(), requested_role.lower())

            # Super admin and school admin are both administrator portal roles
            admin_roles = {User.Role.SUPER_ADMIN, User.Role.SCHOOL_ADMIN}
            # Web portal URLs are an explicit login context. Keep legacy native
            # clients' administrator aliases compatible, but never let a
            # School Admin authenticate through the Super Admin portal (or vice versa).
            is_both_admin = (
                not is_web_session
                and user.role in admin_roles
                and normalized_requested in admin_roles
            )

            # Strict Portal Tab Isolation: Students only in Student portal, Teachers in Teacher portal, Parents in Parent portal, Admins in Admin portal
            if user.role != normalized_requested and not is_both_admin:
                role_labels = {
                    User.Role.SUPER_ADMIN: 'Platform Admin',
                    User.Role.SCHOOL_ADMIN: 'Admin account (School Admin)',
                    User.Role.TEACHER: 'Teacher',
                    User.Role.PARENT: 'Parent',
                    User.Role.STUDENT: 'Student',
                    User.Role.PUBLIC_LEARNER: 'Public Learner',
                }
                user_role_label = role_labels.get(user.role, user.get_role_display())
                return Response({
                    'detail': f'These credentials belong to a {user_role_label} account. Please select the {user_role_label} portal tab to sign in.',
                    'user_role': user.role,
                }, status=status.HTTP_403_FORBIDDEN)

        # Enforce password reset on login if account is using an admin-generated/temporary password
        _enforce_first_login_password_change(user)

        # Super Admin accounts always require a second factor.
        is_super_admin = (
            user.role == User.Role.SUPER_ADMIN
            or getattr(user, 'is_superuser', False)
        )

        # Other roles require MFA when the deployment has enabled it.
        from apps.accounts.mfa_service import (
            MfaDeliveryError,
            create_mfa_challenge,
            is_mfa_configured,
            is_mfa_delivery_configured,
        )
        if is_super_admin and not is_mfa_delivery_configured():
            return Response(
                {'detail': 'Super Admin sign-in requires configured MFA delivery. Contact the system administrator.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if is_super_admin or is_mfa_configured():
            AccountLoginRateThrottle.record_success(raw_email, request=request)
            try:
                challenge = create_mfa_challenge(user, request=request, requested_role=requested_role)
            except MfaDeliveryError:
                return Response(
                    {'detail': 'We could not send your verification code. Please try again later or contact your school administrator.'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            return Response({
                'mfa_required': True,
                'mfa_token': challenge['mfa_token'],
                'email': user.email,
                # Keep the authenticated identity available to clients while
                # the session remains pending OTP verification. This is not a
                # credential or authorization grant; VerifyOtpView still gates
                # session/token issuance.
                'user': UserSerializer(user).data,
                'masked_email': challenge['masked_email'],
                'masked_phone': challenge['masked_phone'],
                'role': user.role,
                'dev_otp': challenge['dev_otp'],
                'message': 'Two-factor authentication code sent. Please enter the 6-digit verification code.',
            }, status=status.HTTP_200_OK)

        AccountLoginRateThrottle.record_success(raw_email, request=request)

        user.last_login = timezone.now()
        user.is_online = True
        user.last_seen_at = timezone.now()
        user.save(update_fields=['last_login', 'is_online', 'last_seen_at', 'must_change_password'])

        if is_web_session and _create_web_session(request, user):
            response = Response({'user': UserSerializer(user).data}, status=status.HTTP_200_OK)
            clear_refresh_cookie(response)
            return response

        # Native mobile / token client backward compatibility flow
        tokens = issue_token_pair(user, request)
        session_id_str = str(tokens['record'].jti)
        response = Response({
            'access': tokens['access'],
            'refresh': tokens['refresh'],
            'sessionId': session_id_str,
            'session_id': session_id_str,
            'user': UserSerializer(user).data,
        }, status=status.HTTP_200_OK)
        return response


class RefreshView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [TokenRefreshRateThrottle]
    """Refresh an explicitly supplied native-client token (rotation).

    Flow
    ----
    1. Read the opaque refresh token from the mobile request body.
    2. Hash it and find the matching database record.
    3. If the record is revoked, revoke ALL of the
       user's sessions (reuse detection) and return 401.
    5. Otherwise rotate: revoke the old record, issue a new pair, set a new
       HttpOnly cookie, and return the new access token.
    """

    @extend_schema(
        request=None,
        responses={200: inline_serializer('RefreshResponse', {
            'access': serializers.CharField(),
            'refresh': serializers.CharField(required=False),
            'sessionId': serializers.CharField(required=False),
            'session_id': serializers.CharField(required=False),
        })},
    )
    @transaction.atomic
    def post(self, request):
        # Browser sessions do not use refresh tokens. Low-level native callers
        # may not carry SessionMiddleware, so only those middleware-free calls
        # can use this backward-compatible body-token path.
        if not _is_mobile_client(request) and hasattr(request, 'session'):
            return Response({'detail': 'Refresh tokens are only available to mobile clients.'}, status=status.HTTP_401_UNAUTHORIZED)
        raw_refresh = None
        if isinstance(request.data, dict):
            raw_refresh = request.data.get('refresh') or request.data.get('refreshToken')

        if not raw_refresh:
            return Response({'detail': 'Refresh token is required.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            digest = hashlib.sha256(raw_refresh.encode('utf-8')).hexdigest()
            record = RefreshTokenRecord.objects.select_for_update().select_related('user').get(token_hash=digest)
        except RefreshTokenRecord.DoesNotExist:
            return Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)

        # 1. Cryptographic hash match check
        if not record.matches_hash(raw_refresh):
            response = Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)
            return response

        # A very short retry grace handles a client retrying the same HTTP
        # request after a lost response. It does not reactivate the old record
        # or accept it as a valid session; it issues a fresh pair. Reuse after
        # the grace window is treated as compromise and revokes every session.
        if not record.is_active:
            retry_grace = getattr(settings, 'REFRESH_TOKEN_RETRY_GRACE_SECONDS', 30)
            now = timezone.now()
            if (
                record.revoked_at
                and record.last_used_at
                and (now - record.revoked_at).total_seconds() <= retry_grace
                and (now - record.last_used_at).total_seconds() <= retry_grace
            ):
                tokens = issue_token_pair(record.user, request)
                session_id_str = str(tokens['record'].jti)
                return Response({
                    'access': tokens['access'], 'refresh': tokens['refresh'],
                    'sessionId': session_id_str, 'session_id': session_id_str,
                }, status=status.HTTP_200_OK)
            revoke_all_user_sessions(record.user)
            response = Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)
            return response

        # 2. Check token expiration
        if record.expires_at < timezone.now():
            record.revoke()
            response = Response({'detail': 'Refresh token expired.'}, status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)
            return response

        # Standard rotation: revoke the old record and issue a fresh pair.
        tokens = rotate_refresh_token(record.user, record, request)
        session_id_str = str(tokens['record'].jti)
        response = Response({
            'access': tokens['access'], 'refresh': tokens['refresh'],
            'sessionId': session_id_str, 'session_id': session_id_str,
        }, status=status.HTTP_200_OK)
        return response

class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated, MustChangePasswordComplete]
    # Put bearer authentication first so an inactive/deleted JWT is reported
    # as 401 instead of falling through to SessionAuthentication's 403.
    authentication_classes = [CachedJWTAuthentication, SessionAuthentication]

    @extend_schema(responses=UserSerializer)
    def get(self, request):
        user = request.user
        _enforce_first_login_password_change(user)
        return Response(UserSerializer(user).data)


class UserListView(APIView):
    """Account directory for the Super Admin console; never exposes passwords."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=UserSerializer(many=True))
    def get(self, request):
        if request.user.role == User.Role.SUPER_ADMIN:
            users = User.objects.select_related('school').filter(role=User.Role.SCHOOL_ADMIN).order_by('email')
        elif request.user.role == User.Role.SCHOOL_ADMIN:
            users = User.objects.select_related(
                'school', 'student_profile', 'parent_profile', 'teacher_profile',
            ).prefetch_related(
                'parent_profile__students',
                'teacher_profile__managed_classes',
                'teacher_profile__managed_sections__class_room',
            ).filter(
                school=request.user.school,
                role__in=[User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT],
            ).order_by('role', 'email')
        else:
            return Response({'detail': 'Administrator access is required.'}, status=status.HTTP_403_FORBIDDEN)

        # Preserve the legacy complete-directory response for existing callers.
        # Admin list screens opt into bounded server-side pages with ?page=.
        if 'page' in request.query_params:
            from django.db.models import Q
            from apps.common.pagination import AdminListPagination

            role = request.query_params.get('role', '').strip().lower()
            if role:
                users = users.filter(role=role)
            active = request.query_params.get('is_active')
            if active in {'true', 'false'}:
                users = users.filter(is_active=(active == 'true'))
            school_id = request.query_params.get('school_id')
            if school_id and request.user.role == User.Role.SUPER_ADMIN:
                users = users.filter(school_id=school_id)
            search = request.query_params.get('search', '').strip()[:100]
            if search:
                users = users.filter(
                    Q(first_name__icontains=search)
                    | Q(last_name__icontains=search)
                    | Q(email__icontains=search)
                    | Q(username__icontains=search)
                )

            ordering_fields = {
                'email': 'email', '-email': '-email',
                'name': 'first_name', '-name': '-first_name',
                'role': 'role', '-role': '-role',
                'created_at': 'date_joined', '-created_at': '-date_joined',
            }
            ordering = request.query_params.get('ordering', 'email')
            ordering = ordering_fields.get(ordering, 'email')
            users = users.order_by(ordering, 'pk')
            paginator = AdminListPagination()
            page = paginator.paginate_queryset(users, request, view=self)
            return paginator.get_paginated_response(UserSerializer(page, many=True).data)

        return Response(UserSerializer(users, many=True).data)

class SchoolAdminCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=inline_serializer('SchoolAdminCreateRequest', {
            'name': serializers.CharField(),
            'schoolId': serializers.IntegerField(),
            'status': serializers.ChoiceField(choices=['Active', 'Inactive'], required=False),
        }),
        responses={201: UserSerializer},
    )
    def post(self, request):
        if request.user.role != User.Role.SUPER_ADMIN:
            return Response({'detail': 'Only Super Admins can create school administrators.'}, status=status.HTTP_403_FORBIDDEN)
        name = str(request.data.get('name', '')).strip()
        school_id = request.data.get('schoolId')
        if not name:
            return Response({'detail': 'name is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            school = School.objects.get(pk=school_id)
        except School.DoesNotExist:
            return Response({'detail': 'Select a valid school.'}, status=status.HTTP_400_BAD_REQUEST)
        if school.is_demo:
            return Response(
                {'detail': 'Demo schools cannot receive production School Admin accounts. Create or select a real school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user, credentials = create_user_with_credentials(person=name, role='admin', school=school)
        user.is_active = request.data.get('status', 'Active') == 'Active'
        user.save(update_fields=['is_active'])
        CredentialVaultRecord.objects.update_or_create(
            school=school,
            login_id=credentials['login_id'].lower(),
            defaults={
                'user': user,
                'role': CredentialVaultRecord.Role.ADMIN,
                'name': user.get_full_name() or user.first_name or name,
                'identifier': f"ADM-{user.pk:04d}",
                'source': 'admin_creation',
                'must_change_password': True,
            }
        )
        data = UserSerializer(user).data
        data['loginCredentials'] = {'loginId': credentials['login_id'], 'temporaryPassword': credentials['plaintext_password'], 'mustChangePassword': True}
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(request, 'school_admin_created', target=user, school=school)
        return Response(data, status=status.HTTP_201_CREATED)


class SchoolAdminLifecycleView(APIView):
    """Super Admin-only activation lifecycle for School Admin identities."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(operation_id='school_admin_lifecycle', request=None, responses={200: UserSerializer, 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')})
    def post(self, request, user_id, action):
        if action not in {'deactivate', 'reactivate'}:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role != User.Role.SUPER_ADMIN:
            return Response({'detail': 'Only Super Admins can manage School Admin account lifecycle.'}, status=status.HTTP_403_FORBIDDEN)
        user = User.objects.filter(pk=user_id).first()
        if not user or user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'The target must be a School Admin account.'}, status=status.HTTP_404_NOT_FOUND)

        active = action == 'reactivate'
        with transaction.atomic():
            user.is_active = active
            user.save(update_fields=['is_active'])
            if not active:
                # The blacklist app is installed. Blacklisting outstanding refresh tokens also
                # prevents their later use; JWTAuthentication rejects the inactive user now.
                from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
                for token in OutstandingToken.objects.select_for_update().filter(user=user):
                    BlacklistedToken.objects.get_or_create(token=token)

        logger.info(
            'school_admin_%s actor_user_id=%s target_user_id=%s',
            action, request.user.pk, user.pk,
        )
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(request, f'school_admin_{action}d', target=user, school=user.school)
        return Response(UserSerializer(user).data)


class SchoolAdminDeleteView(APIView):
    """Irreversible account-only deletion, separate from routine deactivation."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        operation_id='school_admin_delete',
        request=inline_serializer('SchoolAdminDeleteRequest', {'confirmation': serializers.EmailField()}),
        responses={200: OpenApiResponse(description='School Admin permanently deleted'), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')},
    )
    def post(self, request, user_id):
        if request.user.role != User.Role.SUPER_ADMIN:
            return Response({'detail': 'Only Super Admins may delete School Admin accounts.'}, status=status.HTTP_403_FORBIDDEN)
        target = User.objects.filter(pk=user_id, role=User.Role.SCHOOL_ADMIN).first()
        if not target:
            return Response({'detail': 'The target must be a School Admin account.'}, status=status.HTTP_404_NOT_FOUND)
        confirmation = str(request.data.get('confirmation') or request.data.get('confirm') or '').strip()
        if confirmation.lower() != target.email.strip().lower() and confirmation.upper() != 'CONFIRM':
            return Response({'detail': 'Type the exact School Admin email to confirm deletion.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            target_id, target_email = target.pk, target.email
            from apps.common.audit import record_admin_audit_event
            record_admin_audit_event(request, 'school_admin_deleted', target=target, school=target.school)
            CredentialVaultRecord.objects.filter(login_id__iexact=target_email).delete()
            target.delete()
        logger.warning('school_admin_deleted actor_user_id=%s target_user_id=%s', request.user.pk, target_id)
        return Response({'detail': f'School Admin {target_email} was permanently deleted.'})


class SchoolAdminPasswordSetView(APIView):
    """Super Admin-only, server-side password change for a School Admin."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [AdminCredentialManagementThrottle]

    @extend_schema(
        operation_id='school_admin_set_password',
        request=None,
        responses={200: inline_serializer('SchoolAdminOneTimeCredential', {
            'userId': serializers.IntegerField(),
            'loginId': serializers.CharField(),
            'temporaryPassword': serializers.CharField(),
            'mustChangePassword': serializers.BooleanField(),
        }), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')},
    )
    def post(self, request, user_id):
        if request.user.role != User.Role.SUPER_ADMIN:
            return Response({'detail': 'Only Super Admins may set School Admin passwords.'}, status=status.HTTP_403_FORBIDDEN)
        target = User.objects.filter(pk=user_id, role=User.Role.SCHOOL_ADMIN).first()
        if not target:
            return Response({'detail': 'The target must be a School Admin account.'}, status=status.HTTP_404_NOT_FOUND)

        password = generate_password(target.first_name or target.username, target.role)
        target.set_password(password)
        target.must_change_password = True
        target.save(update_fields=['password', 'must_change_password'])
        CredentialVaultRecord.objects.filter(login_id__iexact=target.email).update(
            must_change_password=True,
        )
        revoke_all_user_sessions(target)
        logger.warning('school_admin_password_set actor_user_id=%s target_user_id=%s', request.user.pk, target.pk)
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(request, 'school_admin_password_reset', target=target, school=target.school, metadata={'must_change_password': True})
        return Response({
            'userId': target.pk,
            'loginId': target.email or target.username,
            'temporaryPassword': password,
            'mustChangePassword': True,
        })


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'credential_management'
    allows_password_change = True

    @extend_schema(
        request=inline_serializer('ChangePasswordRequest', {
            'password': serializers.CharField(write_only=True, required=False),
            'newPassword': serializers.CharField(write_only=True, required=False),
            'currentPassword': serializers.CharField(write_only=True, required=False),
        }),
        responses={200: OpenApiResponse(description='Password changed successfully'), 400: OpenApiResponse(description='Password validation failed')},
    )
    def post(self, request):
        password = str(
            request.data.get('password')
            or request.data.get('newPassword')
            or request.data.get('new_password')
            or ''
        ).strip()
        current_password = str(
            request.data.get('currentPassword')
            or request.data.get('oldPassword')
            or request.data.get('old_password')
            or ''
        ).strip()

        # Validate the proposed credential first so callers receive a useful
        # password-policy error even when the current password is omitted.
        # Current-password verification still gates the mutation below.
        if not password:
            return Response({'errors': [{'field': 'password', 'error': 'Password is required.'}], 'detail': 'Password is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(password, user=request.user)
        except ValidationError as exc:
            return Response(
                {'errors': [{'field': 'password', 'error': message} for message in exc.messages], 'detail': exc.messages[0]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Standard users must supply their current password. Users with must_change_password=True
        # (initial temp credential) are allowed to set their first password without re-verifying.
        # Administrator portals already require an authenticated, CSRF-bound
        # session; retain their legacy password-change contract (new password
        # only). Operational roles still require re-authentication with the
        # current password unless this is their first temporary-password use.
        admin_password_change = request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        if not request.user.must_change_password and not admin_password_change:
            if not current_password:
                return Response(
                    {'errors': [{'field': 'currentPassword', 'error': 'Current password is required.'}], 'detail': 'Current password is required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not request.user.check_password(current_password):
                return Response(
                    {'errors': [{'field': 'currentPassword', 'error': 'Incorrect current password.'}], 'detail': 'Incorrect current password.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif current_password and not request.user.check_password(current_password):
            return Response(
                {'errors': [{'field': 'currentPassword', 'error': 'Incorrect current password.'}], 'detail': 'Incorrect current password.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request.user.set_password(password)
        request.user.must_change_password = False
        request.user.save(update_fields=['password', 'must_change_password'])

        # Mark the account's vault record as user-managed for every role. If an
        # admin's creation/reset record keeps its temporary-password marker,
        # login will otherwise force another password change next time.
        if request.user.role in [User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT]:
            try:
                from apps.accounts.credential_vault import update_vault_password_for_user
                update_vault_password_for_user(request.user, password)
            except Exception as exc:
                logger.error('Failed to update vault password on password change: %s', exc)
        elif request.user.role == User.Role.SCHOOL_ADMIN and request.user.school_id:
            admin_credentials = CredentialVaultRecord.objects.filter(user=request.user)
            if not admin_credentials.exists():
                admin_credentials = CredentialVaultRecord.objects.filter(
                    school_id=request.user.school_id,
                    login_id__iexact=request.user.email,
                )
            admin_credentials.update(
                user=request.user,
                must_change_password=False,
                source='user_password_change',
            )

        # Revoke all previous active refresh tokens on password change to terminate stale sessions
        RefreshTokenRecord.objects.filter(user=request.user, revoked_at__isnull=True).update(revoked_at=timezone.now())
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(request, 'admin_password_changed', target=request.user, school=request.user.school)

        # Update session auth hash to preserve the user's active session on password change
        if hasattr(request, 'session'):
            update_session_auth_hash(request, request.user)

        client_type = (
            request.headers.get('X-Client-Type')
            or (request.data.get('client_type') if isinstance(request.data, dict) else None)
        )
        if client_type == 'mobile':
            tokens = issue_token_pair(request.user, request)
            session_id_str = str(tokens['record'].jti)
            response = Response({
                'success': True,
                'detail': 'Password changed successfully.',
                'access': tokens['access'],
                'refresh': tokens['refresh'],
                'sessionId': session_id_str,
                'session_id': session_id_str,
            }, status=status.HTTP_200_OK)
            return response

        response = Response({
            'success': True,
            'detail': 'Password changed successfully.',
            'sessionId': getattr(request.session, 'session_key', None),
            'session_id': getattr(request.session, 'session_key', None),
        }, status=status.HTTP_200_OK)
        return response


def _reset_user_credentials(user):
    password = generate_password(user.first_name or user.username, user.role)
    user.set_password(password)
    user.must_change_password = True
    user.save(update_fields=['password', 'must_change_password'])
    revoke_all_user_sessions(user)

    if user.role in [User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT]:
        try:
            record_credential(
                school=user.school,
                role=user.role,
                name=user.get_full_name() or user.first_name or user.username,
                login_id=user.email or user.username,
                user=user,
                source='admin_reset',
                must_change_password=True,
            )
        except Exception:
            logger.exception('Failed to update credential vault during admin reset for user %s', user.pk)

    return {
        'userId': user.pk,
        'loginId': user.email or user.username,
        'temporaryPassword': password,
        'mustChangePassword': True,
    }


class ResetCredentialsView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [AdminCredentialManagementThrottle]

    @extend_schema(
        operation_id='reset_user_credentials',
        request=None,
        responses={200: inline_serializer('ResetCredentialsResponse', {'loginId': serializers.EmailField(), 'temporaryPassword': serializers.CharField(), 'mustChangePassword': serializers.BooleanField()}), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')},
    )
    def post(self, request, user_id):
        if request.user.pk == user_id:
            return Response({'detail': 'Use the change-password endpoint for your own account.'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Administrator access is required.'}, status=status.HTTP_403_FORBIDDEN)
        user = User.objects.filter(pk=user_id).first()
        if not user:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role == User.Role.SUPER_ADMIN and user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'Super Admins may reset School Admin accounts only.'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role == User.Role.SCHOOL_ADMIN and (user.school_id != request.user.school_id or user.role not in [User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT]):
            return Response({'detail': 'School Admins may reset in-school Teacher, Student, and Parent accounts only.'}, status=status.HTTP_403_FORBIDDEN)
        credentials = _reset_user_credentials(user)
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(request, 'user_credentials_reset', target=user, school=user.school, metadata={'target_role': user.role})
        return Response(credentials)


class ResetStudentCredentialsView(APIView):
    """Create or reset a student's/parent's login, always scoped to the admin's school."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [AdminCredentialManagementThrottle]

    @extend_schema(
        operation_id='create_or_reset_student_credentials',
        request=inline_serializer('ResetStudentCredentialsRequest', {
            'role': serializers.ChoiceField(choices=['Student', 'Parent']),
        }),
        responses={200: inline_serializer('ResetStudentCredentialsResponse', {
            'userId': serializers.IntegerField(),
            'loginId': serializers.EmailField(),
            'temporaryPassword': serializers.CharField(),
            'mustChangePassword': serializers.BooleanField(),
        }), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Student not found')},
    )
    @transaction.atomic
    def post(self, request, student_id):
        if request.user.role != User.Role.SCHOOL_ADMIN or not request.user.school_id:
            return Response({'detail': 'School administrator access is required.'}, status=status.HTTP_403_FORBIDDEN)

        role = request.data.get('role')
        if role not in ['Student', 'Parent']:
            return Response({'detail': 'Choose Student or Parent credentials.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.sis.models import Student
        student = Student.objects.select_for_update().filter(
            pk=student_id,
            school_id=request.user.school_id,
        ).first()
        if not student:
            return Response({'detail': 'Student not found in your school.'}, status=status.HTTP_404_NOT_FOUND)

        if role == 'Student':
            from apps.accounts.models import StudentProfile
            profile = StudentProfile.objects.select_related('user').filter(student=student).first()
            if profile:
                user = profile.user
            else:
                from apps.sis.services import create_student_login
                credentials = create_student_login(student)
                from apps.common.audit import record_admin_audit_event
                created_user = User.objects.filter(pk=credentials.get('userId')).first()
                record_admin_audit_event(request, 'student_credentials_created', target=created_user, school=student.school, metadata={'target_role': 'student'})
                return Response({
                    'userId': credentials['userId'],
                    'loginId': credentials['email'],
                    'temporaryPassword': credentials['temporaryPassword'],
                    'mustChangePassword': True,
                })
        else:
            from apps.accounts.models import ParentProfile
            profiles = ParentProfile.objects.filter(
                students=student,
                user__school_id=request.user.school_id,
                user__role=User.Role.PARENT,
            ).select_related('user')
            if student.parent_email:
                profile = profiles.filter(user__email__iexact=student.parent_email).first() or profiles.first()
            else:
                profile = profiles.first()

            if profile:
                user = profile.user
            else:
                from apps.sis.services import create_or_link_parent_login
                credentials = create_or_link_parent_login(student)
                user_id = credentials.get('userId')
                user = User.objects.filter(
                    pk=user_id,
                    school_id=request.user.school_id,
                    role=User.Role.PARENT,
                ).first()
                if not user:
                    return Response({'detail': 'Could not create or link a parent login for this student.'}, status=status.HTTP_400_BAD_REQUEST)
                if credentials.get('created'):
                    from apps.common.audit import record_admin_audit_event
                    record_admin_audit_event(request, 'parent_credentials_created', target=user, school=student.school, metadata={'target_role': 'parent'})
                    return Response({
                        'userId': user.pk,
                        'loginId': credentials['email'],
                        'temporaryPassword': credentials['temporaryPassword'],
                        'mustChangePassword': True,
                    })

        credentials = _reset_user_credentials(user)
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(request, 'user_credentials_reset', target=user, school=user.school, metadata={'target_role': user.role})
        return Response(credentials)


class LogoutView(APIView):
    """Invalidate server-side session, revoke refresh token if present, and clear cookies."""
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        request=None,
        responses={204: OpenApiResponse(description='Logged out')},
    )
    def post(self, request):
        if not _is_mobile_client(request):
            SessionAuthentication().enforce_csrf(request)
        if request.user and request.user.is_authenticated:
            request.user.is_online = False
            request.user.save(update_fields=['is_online'])

        # 1. Terminate Django server-side session in Redis/PostgreSQL
        django_logout(request)

        # Revoke a supplied mobile refresh token and any legacy browser refresh cookie.
        raw_refresh = read_refresh_cookie(request)
        if not raw_refresh and isinstance(request.data, dict):
            raw_refresh = request.data.get('refresh')
        if raw_refresh:
            record = RefreshTokenRecord.objects.filter(
                token_hash=hashlib.sha256(raw_refresh.encode('utf-8')).hexdigest(),
            ).first()
            revoke_refresh_token(record)

        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        response.delete_cookie(
            settings.SESSION_COOKIE_NAME,
            path=settings.SESSION_COOKIE_PATH,
            domain=settings.SESSION_COOKIE_DOMAIN,
            samesite=settings.SESSION_COOKIE_SAMESITE,
        )
        return response


class PresenceHeartbeatView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: inline_serializer('HeartbeatResponse', {'status': serializers.CharField()})})
    def post(self, request):
        request.user.is_online = True
        request.user.last_seen_at = timezone.now()
        request.user.save(update_fields=['is_online', 'last_seen_at'])
        return Response({'status': 'ok'})


class CredentialVaultPermission(permissions.BasePermission):
    """Credential records contain temporary passwords and are admin-only."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
            and (user.role == User.Role.SUPER_ADMIN or user.school_id)
        )

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == User.Role.SUPER_ADMIN:
            return True
        return obj.school_id == user.school_id


class CredentialVaultViewSet(viewsets.ModelViewSet):
    """Encrypted distribution vault for credentials.

    - For Super Admin: Returns exclusively dedicated School Admin credentials.
    - For School Admin: Returns exclusively student, teacher, and parent credentials for their school tenant.
    """
    serializer_class = CredentialVaultSerializer
    permission_classes = [CredentialVaultPermission]
    pagination_class = AdminListPagination
    ordering_fields = ['name', 'role', 'updated_at', 'school__name']

    def _sync_admin_vault_records(self):
        admin_users = User.objects.filter(role=User.Role.SCHOOL_ADMIN).select_related('school')
        for admin in admin_users:
            if not admin.school:
                continue
            rec = CredentialVaultRecord.objects.filter(login_id__iexact=admin.email).first()
            if not rec:
                rec = CredentialVaultRecord.objects.create(
                    school=admin.school,
                    user=admin,
                    role=CredentialVaultRecord.Role.ADMIN,
                    name=admin.get_full_name() or admin.first_name or admin.email.split('@')[0],
                    login_id=admin.email,
                    identifier=f"ADM-{admin.pk:04d}",
                    source='admin_roster',
                    must_change_password=admin.must_change_password,
                )
            elif rec.source == 'admin_roster':
                rec.user = admin
                rec.must_change_password = admin.must_change_password
                rec.save(update_fields=['user', 'must_change_password', 'updated_at'])

    def get_queryset(self):
        user = self.request.user
        if not (user and user.is_authenticated and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]):
            return CredentialVaultRecord.objects.none()

        if user.role == User.Role.SUPER_ADMIN:
            # Super Admin Password Manager: Exclusively return School Admin passwords
            self._sync_admin_vault_records()
            qs = CredentialVaultRecord.objects.filter(role=CredentialVaultRecord.Role.ADMIN).select_related('school', 'user')

            school_id = self.request.query_params.get('school_id') or self.request.query_params.get('schoolId')
            if school_id and str(school_id).lower() != 'all':
                qs = qs.filter(school_id=school_id)

            search = self.request.query_params.get('search')
            if search:
                search_str = search.strip()
                from django.db.models import Q
                qs = qs.filter(
                    Q(name__icontains=search_str)
                    | Q(login_id__icontains=search_str)
                    | Q(school__name__icontains=search_str)
                )

            return qs.order_by('name', 'pk')

        school = user.school
        if not school:
            return CredentialVaultRecord.objects.none()

        # Hard invariant for School Admin: Exclude admin & superadmin
        qs = CredentialVaultRecord.objects.filter(school=school).exclude(
            role__in=['school_admin', 'super_admin', 'admin', 'superadmin']
        )

        role = self.request.query_params.get('role')
        if role and role.lower() != 'all':
            qs = qs.filter(role=role.lower())

        class_name = self.request.query_params.get('className') or self.request.query_params.get('class_name')
        if class_name and str(class_name).lower() != 'all':
            import re
            from django.db.models import Q
            raw_cls = str(class_name).strip()
            num_match = re.search(r'\d+', raw_cls)
            cleaned = num_match.group(0) if num_match else re.sub(r'^(class|grade)\s*', '', raw_cls, flags=re.IGNORECASE).strip()
            formatted_class = f"Class {cleaned}" if cleaned else raw_cls
            formatted_grade = f"Grade {cleaned}" if cleaned else raw_cls
            qs = qs.filter(
                Q(class_name__iexact=raw_cls)
                | Q(class_name__iexact=cleaned)
                | Q(class_name__iexact=formatted_class)
                | Q(class_name__iexact=formatted_grade)
            )

        section = self.request.query_params.get('section')
        if section and str(section).lower() != 'all':
            qs = qs.filter(section__iexact=str(section).strip())

        search = self.request.query_params.get('search')
        if search:
            search_str = search.strip()
            from django.db.models import Q
            qs = qs.filter(
                Q(name__icontains=search_str)
                | Q(login_id__icontains=search_str)
                | Q(identifier__icontains=search_str)
                | Q(phone__icontains=search_str)
                | Q(linked_student_name__icontains=search_str)
            )

        return qs.order_by('role', 'name', 'pk')

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        qs = self.get_queryset()
        from django.db.models import Count, Q
        rows = qs.values('role').annotate(
            total=Count('id'),
            temporary=Count('id', filter=Q(must_change_password=True)),
        )
        by_role = {row['role']: {'total': row['total'], 'temporary': row['temporary']} for row in rows}
        return Response({'byRole': by_role, 'total': sum(item['total'] for item in by_role.values())})

    def perform_create(self, serializer):
        # Never trust a school ID supplied by a school administrator.
        if self.request.user.role == User.Role.SCHOOL_ADMIN:
            serializer.save(school=self.request.user.school)
        else:
            serializer.save()

    def list(self, request, *args, **kwargs):
        user = request.user
        if user and user.is_authenticated and user.role == User.Role.SUPER_ADMIN:
            self._sync_admin_vault_records()
        elif user and user.is_authenticated and user.role == User.Role.SCHOOL_ADMIN:
            school = user.school
            if school:
                try:
                    from apps.sis.models import Student
                    from apps.staff.models import Teacher
                    from apps.accounts.models import ParentProfile
                    student_count = Student.objects.filter(school=school, status=Student.Status.ACTIVE).count()
                    teacher_count = Teacher.objects.filter(school=school, status=Teacher.Status.ACTIVE).count()
                    parent_count = ParentProfile.objects.filter(user__school=school).count()
                    vault_student_count = CredentialVaultRecord.objects.filter(school=school, role=CredentialVaultRecord.Role.STUDENT).count()
                    vault_teacher_count = CredentialVaultRecord.objects.filter(school=school, role=CredentialVaultRecord.Role.TEACHER).count()
                    vault_parent_count = CredentialVaultRecord.objects.filter(school=school, role=CredentialVaultRecord.Role.PARENT).count()
                    if (
                        (student_count > 0 and vault_student_count < student_count)
                        or (teacher_count > 0 and vault_teacher_count < teacher_count)
                        or (parent_count > 0 and vault_parent_count < parent_count)
                    ):
                        sync_school_credential_vault(school)
                except Exception as e:
                    logger.warning(f"Auto-sync credential vault failed: {e}")

        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        role = request.data.get('role')
        norm_role = str(role or '').lower().strip().replace(' ', '_')
        if norm_role in ['super_admin', 'superadmin']:
            return Response({'detail': 'Superadmin root credentials cannot be stored in the vault.'}, status=status.HTTP_400_BAD_REQUEST)
        if norm_role in ['admin', 'school_admin'] and request.user.role != User.Role.SUPER_ADMIN:
            return Response({'detail': 'Only Super Admins may create administrator vault entries.'}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def perform_destroy(self, instance):
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(
            self.request,
            'credential_vault_entry_deleted',
            target=instance,
            school=instance.school,
            metadata={'target_role': instance.role},
        )
        if instance.user and instance.role == CredentialVaultRecord.Role.ADMIN:
            with transaction.atomic():
                user = instance.user
                instance.delete()
                user.delete()
        else:
            instance.delete()

    def perform_update(self, serializer):
        serializer.save()

    def update(self, request, *args, **kwargs):
        if any(key in request.data for key in ('password', 'plaintext_password', 'temporaryPassword')):
            return Response(
                {'detail': 'Passwords cannot be read or written through credential-vault records. Use the reset action.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if any(key in request.data for key in ('password', 'plaintext_password', 'temporaryPassword')):
            return Response(
                {'detail': 'Passwords cannot be read or written through credential-vault records. Use the reset action.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().partial_update(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='sync')
    def sync_roster(self, request):
        user = request.user
        if not (user and user.is_authenticated and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]):
            return Response({'detail': 'Administrator access is required.'}, status=status.HTTP_403_FORBIDDEN)

        school = user.school
        if user.role == User.Role.SUPER_ADMIN:
            school_id = request.data.get('schoolId') or request.query_params.get('school_id')
            if not school_id:
                return Response({'detail': 'Super Admins must specify a schoolId.'}, status=status.HTTP_400_BAD_REQUEST)
            school = School.objects.filter(pk=school_id).first()

        if not school:
            return Response({'detail': 'No school tenant identified.'}, status=status.HTTP_400_BAD_REQUEST)

        result = sync_school_credential_vault(school)
        return Response({'success': True, **result})

    @action(detail=True, methods=['post'], url_path='reset')
    def reset_password(self, request, pk=None):
        user = request.user
        if not (user and user.is_authenticated and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]):
            return Response({'detail': 'Administrator access is required.'}, status=status.HTTP_403_FORBIDDEN)

        record = self.get_object()
        target_user = record.user or User.objects.filter(school=record.school, email__iexact=record.login_id).first() or User.objects.filter(school=record.school, username__iexact=record.login_id).first()
        if not target_user:
            return Response({'detail': 'The account no longer exists. Refresh the directory and try again.'}, status=status.HTTP_404_NOT_FOUND)

        new_pwd = generate_password(record.name, record.role)
        record.must_change_password = True
        record.source = 'admin_reset'
        record.save(update_fields=['must_change_password', 'source', 'updated_at'])

        if not record.user:
            record.user = target_user
            record.save(update_fields=['user'])
        target_user.set_password(new_pwd)
        target_user.must_change_password = True
        target_user.save(update_fields=['password', 'must_change_password'])
        revoke_all_user_sessions(target_user)

        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(request, 'credential_vault_password_reset', target=record, school=record.school, metadata={'target_role': record.role})
        return Response({
            'userId': target_user.pk if target_user else record.user_id,
            'loginId': record.login_id,
            'temporaryPassword': new_pwd,
            'mustChangePassword': True,
        })



class VerifyOtpView(APIView):
    """Verify 2FA OTP and complete user login session."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [MfaChallengeRateThrottle]

    @extend_schema(
        request=inline_serializer('VerifyOtpRequest', {
            'mfa_token': serializers.CharField(),
            'otp': serializers.CharField(),
        }),
        responses={200: inline_serializer('LoginResponse', {
            'access': serializers.CharField(),
            'user': UserSerializer(),
        })},
    )
    def post(self, request):
        if not _is_mobile_client(request):
            SessionAuthentication().enforce_csrf(request)
        mfa_token = str(request.data.get('mfa_token') or request.data.get('mfaToken') or '').strip()
        otp = str(request.data.get('otp') or request.data.get('code') or '').strip()

        if not mfa_token or not otp:
            return Response({'detail': 'Verification token and OTP code are required.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.accounts.mfa_service import verify_mfa_code
        result = verify_mfa_code(mfa_token, otp)
        if not result['success']:
            return Response({'detail': result['error']}, status=status.HTTP_400_BAD_REQUEST)

        user = result['user']
        _enforce_first_login_password_change(user)
        user.last_login = timezone.now()
        user.is_online = True
        user.last_seen_at = timezone.now()
        user.save(update_fields=['last_login', 'is_online', 'last_seen_at'])

        is_web_session = not _is_mobile_client(request) and hasattr(request, 'session')

        if is_web_session and _create_web_session(request, user):
            response = Response({'user': UserSerializer(user).data}, status=status.HTTP_200_OK)
            clear_refresh_cookie(response)
            return response

        # Native mobile / token client backward compatibility flow
        tokens = issue_token_pair(user, request)
        session_id_str = str(tokens['record'].jti)
        response = Response({
            'access': tokens['access'],
            'refresh': tokens['refresh'],
            'sessionId': session_id_str,
            'session_id': session_id_str,
            'user': UserSerializer(user).data,
        }, status=status.HTTP_200_OK)
        return response


class ResendOtpView(APIView):
    """Resend 2FA OTP code with rate limit cooldown protection."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [MfaChallengeRateThrottle]

    @extend_schema(
        request=inline_serializer('ResendOtpRequest', {
            'mfa_token': serializers.CharField(),
        }),
        responses={200: inline_serializer('ResendOtpResponse', {
            'success': serializers.BooleanField(),
            'message': serializers.CharField(),
            'dev_otp': serializers.CharField(required=False),
        })},
    )
    def post(self, request):
        # APIView is exempt from Django's CsrfViewMiddleware. This endpoint
        # issues a new login code, so validate browser requests explicitly.
        if not _is_mobile_client(request):
            SessionAuthentication().enforce_csrf(request)
        mfa_token = str(request.data.get('mfa_token') or request.data.get('mfaToken') or '').strip()
        if not mfa_token:
            return Response({'detail': 'Verification token is required.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.accounts.mfa_service import resend_mfa_code
        result = resend_mfa_code(mfa_token)
        if not result['success']:
            http_status = status.HTTP_503_SERVICE_UNAVAILABLE if result.get('delivery_error') else status.HTTP_429_TOO_MANY_REQUESTS
            return Response({'detail': result['error'], 'cooldown': result.get('cooldown', 0)}, status=http_status)

        response_data = {
            'success': True,
            'message': result.get('message', 'New verification code sent successfully.'),
        }
        if result.get('dev_otp'):
            response_data['dev_otp'] = result['dev_otp']
        return Response(response_data, status=status.HTTP_200_OK)
