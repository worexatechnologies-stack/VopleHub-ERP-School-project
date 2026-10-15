from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
import logging
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from .serializers import UserSerializer, CredentialVaultSerializer
from .models import RefreshTokenRecord, User, CredentialVaultRecord
from .credential_generator import create_user_with_credentials, generate_password
from .credential_vault import record_credential, sync_school_credential_vault
from apps.common.fast_cache import fast_cache_response, bump_cache_version
from .auth_utils import (
    clear_refresh_cookie,
    issue_token_pair,
    read_refresh_cookie,
    revoke_all_user_sessions,
    revoke_refresh_token,
    rotate_refresh_token,
    set_refresh_cookie,
)
from apps.schools.models import School


logger = logging.getLogger(__name__)

class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'login'

    @extend_schema(
        request=inline_serializer('LoginRequest', {
            'email': serializers.EmailField(),
            'password': serializers.CharField(write_only=True),
            'role': serializers.CharField(required=False),
        }),
        responses={200: inline_serializer('LoginResponse', {
            'access': serializers.CharField(),
            'user': UserSerializer(),
        })},
    )
    def post(self, request):
        raw_email = (request.data.get('email') or request.data.get('username') or '').strip()
        password = str(request.data.get('password', ''))
        requested_role = (request.data.get('role') or '').strip()
        if not raw_email or not password:
            return Response({'detail': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=raw_email).first() or User.objects.filter(username__iexact=raw_email).first()
        if user is None or not user.check_password(password):
            # Deliberately identical message for unknown email and wrong password.
            return Response({'detail': 'Invalid login credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        if user.school and not user.school.is_active:
            return Response({'detail': 'This school account is currently deactivated. Please contact your platform administrator.'}, status=status.HTTP_403_FORBIDDEN)

        if not user.is_active:
            return Response({'detail': 'Invalid login credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

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
            if user.role != normalized_requested:
                if {user.role, normalized_requested}.issubset({User.Role.SUPER_ADMIN, User.Role.SCHOOL_ADMIN}):
                    pass
                else:
                    role_labels = {
                        User.Role.SUPER_ADMIN: 'Platform',
                        User.Role.SCHOOL_ADMIN: 'Admin',
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

        user.last_login = timezone.now()
        user.is_online = True
        user.last_seen_at = timezone.now()
        user.save(update_fields=['last_login', 'is_online', 'last_seen_at'])

        tokens = issue_token_pair(user, request)
        response = Response({
            'access': tokens['access'],
            'user': UserSerializer(user).data,
        }, status=status.HTTP_200_OK)
        set_refresh_cookie(response, tokens['refresh'])
        return response


class RefreshView(APIView):
    """Refresh access token using the HttpOnly refresh cookie (rotation).

    Flow
    ----
    1. Read the refresh token from the HttpOnly cookie.
    2. Verify the JWT signature and extract the ``jti`` claim.
    3. Look up the matching ``RefreshTokenRecord`` and compare the bcrypt hash.
    4. If the record is revoked or the hash does not match, revoke ALL of the
       user's sessions (reuse detection) and return 401.
    5. Otherwise rotate: revoke the old record, issue a new pair, set a new
       HttpOnly cookie, and return the new access token.
    """
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        request=None,
        responses={200: inline_serializer('RefreshResponse', {'access': serializers.CharField()})},
    )
    def post(self, request):
        raw_refresh = read_refresh_cookie(request)
        if not raw_refresh:
            return Response({'detail': 'Refresh token cookie is missing.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            token = RefreshToken(raw_refresh)
            jti = token.get('jti')
            user_id = token.get('user_id')
        except TokenError:
            return Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not jti or not user_id:
            return Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            record = RefreshTokenRecord.objects.select_related('user').get(jti=jti)
        except RefreshTokenRecord.DoesNotExist:
            return Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not record.verify_token(raw_refresh):
            # Reuse detection: a revoked or mismatched token was presented.
            revoke_all_user_sessions(record.user)
            response = Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)
            return response

        if record.expires_at < timezone.now():
            record.revoke()
            response = Response({'detail': 'Refresh token expired.'}, status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)
            return response

        # Rotation: revoke the old record and issue a fresh pair.
        tokens = rotate_refresh_token(record.user, record, request)
        response = Response({'access': tokens['access']}, status=status.HTTP_200_OK)
        set_refresh_cookie(response, tokens['refresh'])
        return response

class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=UserSerializer)
    @fast_cache_response(namespace='auth_me', timeout=120)
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class UserListView(APIView):
    """Account directory for the Super Admin console; never exposes passwords."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=UserSerializer(many=True))
    def get(self, request):
        if request.user.role == User.Role.SUPER_ADMIN:
            users = User.objects.select_related('school').filter(role=User.Role.SCHOOL_ADMIN).order_by('email')
        elif request.user.role == User.Role.SCHOOL_ADMIN:
            users = User.objects.select_related('school').filter(school=request.user.school, role__in=[User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT]).order_by('role', 'email')
        else:
            return Response({'detail': 'Administrator access is required.'}, status=status.HTTP_403_FORBIDDEN)
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
                'plaintext_password': credentials['plaintext_password'],
                'identifier': f"ADM-{user.pk:04d}",
                'source': 'admin_creation',
                'must_change_password': True,
            }
        )
        data = UserSerializer(user).data
        data['loginCredentials'] = {'loginId': credentials['login_id'], 'temporaryPassword': credentials['plaintext_password'], 'mustChangePassword': True}
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
            CredentialVaultRecord.objects.filter(login_id__iexact=target_email).delete()
            target.delete()
        logger.warning('school_admin_deleted actor_user_id=%s target_user_id=%s', request.user.pk, target_id)
        return Response({'detail': f'School Admin {target_email} was permanently deleted.'})


class SchoolAdminPasswordSetView(APIView):
    """Super Admin-only, server-side password change for a School Admin."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'credential_management'

    @extend_schema(
        operation_id='school_admin_set_password',
        request=inline_serializer('SchoolAdminPasswordSetRequest', {'password': serializers.CharField(write_only=True)}),
        responses={200: OpenApiResponse(description='Password updated'), 400: OpenApiResponse(description='Password validation failed'), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')},
    )
    def post(self, request, user_id):
        if request.user.role != User.Role.SUPER_ADMIN:
            return Response({'detail': 'Only Super Admins may set School Admin passwords.'}, status=status.HTTP_403_FORBIDDEN)
        target = User.objects.filter(pk=user_id, role=User.Role.SCHOOL_ADMIN).first()
        if not target:
            return Response({'detail': 'The target must be a School Admin account.'}, status=status.HTTP_404_NOT_FOUND)

        password = str(
            request.data.get('password')
            or request.data.get('newPassword')
            or request.data.get('new_password')
            or ''
        ).strip()
        try:
            validate_password(password, user=target)
        except ValidationError as exc:
            return Response(
                {'errors': [{'field': 'password', 'error': message} for message in exc.messages], 'detail': exc.messages[0]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target.set_password(password)
        force_change = request.data.get('must_change_password', True)
        if isinstance(force_change, str):
            force_change = force_change.lower() not in ['false', '0']
        target.must_change_password = bool(force_change)
        target.save(update_fields=['password', 'must_change_password'])
        CredentialVaultRecord.objects.filter(login_id__iexact=target.email).update(
            plaintext_password=password,
            must_change_password=target.must_change_password,
        )
        logger.warning('school_admin_password_set actor_user_id=%s target_user_id=%s', request.user.pk, target.pk)
        return Response({'detail': 'Password updated successfully.'})


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

        # If current password was provided, verify it
        if current_password and not request.user.check_password(current_password):
            return Response(
                {'detail': 'Incorrect current password.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not password:
            return Response({'errors': [{'field': 'password', 'error': 'Password is required.'}], 'detail': 'Password is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(password, user=request.user)
        except ValidationError as exc:
            return Response(
                {'errors': [{'field': 'password', 'error': message} for message in exc.messages], 'detail': exc.messages[0]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        request.user.set_password(password)
        request.user.must_change_password = False
        request.user.save(update_fields=['password', 'must_change_password'])

        # If user is a Teacher, Student, or Parent, automatically update their CredentialVaultRecord
        if request.user.role in [User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT]:
            try:
                from apps.accounts.credential_vault import update_vault_password_for_user
                update_vault_password_for_user(request.user, password)
            except Exception as exc:
                logger.error('Failed to update vault password on password change: %s', exc)

        # Issue fresh token pair so user's active session remains valid with new credentials
        tokens = issue_token_pair(request.user, request)
        response = Response({
            'success': True,
            'detail': 'Password changed successfully.',
            'access': tokens['access'],
        }, status=status.HTTP_200_OK)
        set_refresh_cookie(response, tokens['refresh'])
        return response


class ResetCredentialsView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'credential_management'

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
        password = generate_password(user.first_name or user.username, user.role)
        user.set_password(password)
        user.must_change_password = True
        user.save(update_fields=['password', 'must_change_password'])

        if user.role in [User.Role.TEACHER, User.Role.STUDENT, User.Role.PARENT]:
            try:
                from apps.accounts.credential_vault import record_credential
                record_credential(
                    school=user.school,
                    role=user.role,
                    name=user.get_full_name() or user.first_name or user.username,
                    login_id=user.email or user.username,
                    plaintext_password=password,
                    user=user,
                    source='admin_reset',
                    must_change_password=True,
                )
            except Exception:
                pass

        return Response({'loginId': user.email, 'temporaryPassword': password, 'mustChangePassword': True})


class LogoutView(APIView):
    """Revoke the current device's refresh token and clear the HttpOnly cookie.

    Security decisions
    ------------------
    * The refresh token is read from the HttpOnly cookie (never from the body).
    * The matching ``RefreshTokenRecord`` is revoked so the token cannot be
      reused even if it was captured before logout.
    * The cookie is cleared immediately.
    """
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=None,
        responses={204: OpenApiResponse(description='Logged out')},
    )
    def post(self, request):
        raw_refresh = read_refresh_cookie(request)
        if raw_refresh:
            try:
                token = RefreshToken(raw_refresh)
                jti = token.get('jti')
                if jti:
                    record = RefreshTokenRecord.objects.filter(jti=jti).first()
                    revoke_refresh_token(record)
                try:
                    token.blacklist()
                except Exception:
                    pass
            except TokenError:
                # Invalid/expired cookie is still cleared below.
                pass
        if request.user and request.user.is_authenticated:
            request.user.is_online = False
            request.user.save(update_fields=['is_online'])
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class PresenceHeartbeatView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: inline_serializer('HeartbeatResponse', {'status': serializers.CharField()})})
    def post(self, request):
        request.user.is_online = True
        request.user.last_seen_at = timezone.now()
        request.user.save(update_fields=['is_online', 'last_seen_at'])
        return Response({'status': 'ok'})


class CredentialVaultViewSet(viewsets.ModelViewSet):
    """Encrypted distribution vault for credentials.

    - For Super Admin: Returns exclusively dedicated School Admin credentials.
    - For School Admin: Returns exclusively student, teacher, and parent credentials for their school tenant.
    """
    serializer_class = CredentialVaultSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def _sync_admin_vault_records(self):
        admin_users = User.objects.filter(role=User.Role.SCHOOL_ADMIN).select_related('school')
        for admin in admin_users:
            if not admin.school:
                continue
            rec = CredentialVaultRecord.objects.filter(login_id__iexact=admin.email).first()
            if not rec:
                CredentialVaultRecord.objects.create(
                    school=admin.school,
                    user=admin,
                    role=CredentialVaultRecord.Role.ADMIN,
                    name=admin.get_full_name() or admin.first_name or admin.email.split('@')[0],
                    login_id=admin.email,
                    plaintext_password='Admin@123',
                    identifier=f"ADM-{admin.pk:04d}",
                    source='admin_roster',
                    must_change_password=admin.must_change_password,
                )

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

            return qs.order_by('name')

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

        return qs.order_by('role', 'name')

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
        if instance.user and instance.role == CredentialVaultRecord.Role.ADMIN:
            with transaction.atomic():
                user = instance.user
                instance.delete()
                user.delete()
        else:
            instance.delete()

    def perform_update(self, serializer):
        record = serializer.save()
        if record.user and record.plaintext_password:
            record.user.set_password(record.plaintext_password)
            record.user.must_change_password = False
            record.user.save(update_fields=['password', 'must_change_password'])

    @action(detail=False, methods=['post'], url_path='sync')
    def sync_roster(self, request):
        user = request.user
        if not (user and user.is_authenticated and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]):
            return Response({'detail': 'Administrator access is required.'}, status=status.HTTP_403_FORBIDDEN)

        school = user.school
        if user.role == User.Role.SUPER_ADMIN:
            school_id = request.data.get('schoolId') or request.query_params.get('school_id')
            if school_id:
                school = School.objects.filter(pk=school_id).first()
            elif not school:
                school = School.objects.first()

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
        new_pwd = generate_password(record.name, record.role)
        record.plaintext_password = new_pwd
        record.must_change_password = True
        record.source = 'admin_reset'
        record.save(update_fields=['plaintext_password', 'must_change_password', 'source', 'updated_at'])

        if record.user:
            record.user.set_password(new_pwd)
            record.user.must_change_password = True
            record.user.save(update_fields=['password', 'must_change_password'])

        return Response(self.get_serializer(record).data)

