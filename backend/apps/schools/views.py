import logging

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from django.http import Http404, HttpResponse
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from django.utils import timezone
from apps.accounts.models import User
from apps.common.fast_cache import fast_cache_response, bump_cache_version
from .models import School
from .serializers import SchoolSerializer


logger = logging.getLogger(__name__)

class IsSuperAdminOnly(BasePermission):
    """Only the platform operator may mutate schools."""

    def has_permission(self, request, view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return request.user.is_authenticated
        return request.user.is_authenticated and request.user.role == 'super_admin'


class SchoolViewSet(viewsets.ModelViewSet):
    serializer_class, permission_classes = SchoolSerializer, [IsSuperAdminOnly]
    queryset = School.objects.defer('logo_data').order_by('name')

    def get_queryset(self):
        qs = super().get_queryset()
        return qs if self.request.user.role == 'super_admin' else qs.filter(pk=self.request.user.school_id)

    @fast_cache_response(namespace='schools', timeout=120)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @fast_cache_response(namespace='schools', timeout=120)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    def perform_create(self, serializer):
        super().perform_create(serializer)
        bump_cache_version('schools')

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        bump_cache_version('schools')

    @action(detail=True, methods=['get'], url_path='logo')
    def logo(self, request, pk=None):
        school = self.get_object()
        if not school.logo_data:
            raise Http404
        response = HttpResponse(bytes(school.logo_data), content_type=school.logo_content_type or 'image/webp')
        response['Cache-Control'] = 'private, max-age=300'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    def perform_update(self, serializer):
        previous_instance = self.get_object()
        was_active = previous_instance.is_active
        instance = serializer.save()
        bump_cache_version('schools')
        if 'is_active' in serializer.validated_data and was_active != instance.is_active:
            with transaction.atomic():
                tenant_users = User.objects.filter(school=instance)
                if not instance.is_active:
                    # Deactivate respective school admins and tenant users
                    tenant_users.update(is_active=False, is_online=False)
                    from apps.accounts.models import RefreshTokenRecord
                    RefreshTokenRecord.objects.filter(user__in=tenant_users, revoked_at__isnull=True).update(revoked_at=timezone.now())
                    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
                    for token in OutstandingToken.objects.select_for_update().filter(user__in=tenant_users):
                        BlacklistedToken.objects.get_or_create(token=token)
                    logger.warning(
                        'school_deactivated actor_user_id=%s school_id=%s school_code=%s deactivated_user_count=%s',
                        self.request.user.pk, instance.pk, instance.code, tenant_users.count(),
                    )
                else:
                    # Reactivate respective school admins and tenant users
                    tenant_users.update(is_active=True)
                    logger.info(
                        'school_reactivated actor_user_id=%s school_id=%s school_code=%s reactivated_user_count=%s',
                        self.request.user.pk, instance.pk, instance.code, tenant_users.count(),
                    )

    def destroy(self, request, *args, **kwargs):
        """Permanently remove exactly one school and its tenant-owned records."""
        school = self.get_object()
        if request.data.get('confirmation') != school.code:
            return Response(
                {'detail': f'Type the school code "{school.code}" to permanently delete this school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # Remove every tenant identity before the School cascade deletes tenant records.
            users = User.objects.filter(school=school)
            user_count = users.count()
            from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
            for token in OutstandingToken.objects.select_for_update().filter(user__in=users):
                BlacklistedToken.objects.get_or_create(token=token)
            users.delete()
            school_name, school_code, school_id = school.name, school.code, school.pk
            school.delete()

        bump_cache_version('schools')

        logger.warning(
            'school_permanently_deleted actor_user_id=%s school_id=%s school_code=%s deleted_user_count=%s',
            request.user.pk, school_id, school_code, user_count,
        )
        return Response(
            {'detail': f'School "{school_name}" and its related data were permanently deleted.'},
            status=status.HTTP_200_OK,
        )
