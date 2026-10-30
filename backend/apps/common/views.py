import os
from django.http import FileResponse, Http404
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet
from .models import AdminAuditEvent, ExportJob, PlatformSetting
from .pagination import AdminListPagination
from .serializers import ExportJobSerializer
from .tasks import export_resource_task


class AdminAuditEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    school_name = serializers.CharField(source='school.name', read_only=True, default='')

    class Meta:
        model = AdminAuditEvent
        fields = ['id', 'action', 'object_type', 'object_id', 'metadata', 'remote_addr', 'created_at', 'actor_id', 'actor_name', 'school_id', 'school_name']

    def get_actor_name(self, obj):
        if not obj.actor:
            return ''
        return obj.actor.get_full_name() or obj.actor.email


class AdminAuditReadPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN])


class AdminAuditEventViewSet(viewsets.ReadOnlyModelViewSet):
    """Paginated, tenant-scoped audit history for administrators."""
    serializer_class = AdminAuditEventSerializer
    pagination_class = AdminListPagination
    permission_classes = [AdminAuditReadPermission]
    queryset = AdminAuditEvent.objects.select_related('actor', 'school').all()
    filterset_fields = ['action', 'school']
    search_fields = ['action', 'object_type', 'object_id', 'actor__email', 'actor__first_name', 'actor__last_name']
    ordering_fields = ['created_at', 'action']
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role == User.Role.SCHOOL_ADMIN:
            qs = qs.filter(school_id=user.school_id)
        school_id = self.request.query_params.get('school_id')
        if school_id and user.role == User.Role.SUPER_ADMIN:
            qs = qs.filter(school_id=school_id)
        from django.utils.dateparse import parse_datetime
        after = parse_datetime(self.request.query_params.get('after', ''))
        before = parse_datetime(self.request.query_params.get('before', ''))
        if after:
            qs = qs.filter(created_at__gte=after)
        if before:
            qs = qs.filter(created_at__lt=before)
        return qs

    def create(self, request, *args, **kwargs):
        return Response({'detail': 'Audit events are append-only.'}, status=status.HTTP_405_METHOD_NOT_ALLOWED)


class PlatformSettingsView(APIView):
    """Server-side non-secret settings. Secrets belong in deployment secret storage."""
    permission_classes = [permissions.IsAuthenticated]
    ALLOWED_KEYS = {'system', 'modules', 'fee_categories', 'exam_types'}

    def _authorize(self, request):
        return request.user.role == User.Role.SUPER_ADMIN

    def get(self, request):
        if not self._authorize(request):
            return Response({'detail': 'Only Super Admins can manage platform settings.'}, status=status.HTTP_403_FORBIDDEN)
        settings_data = {row.key: row.value for row in PlatformSetting.objects.all()}
        return Response(settings_data)

    def put(self, request):
        if not self._authorize(request):
            return Response({'detail': 'Only Super Admins can manage platform settings.'}, status=status.HTTP_403_FORBIDDEN)
        key = request.data.get('key')
        value = request.data.get('value')
        if key not in self.ALLOWED_KEYS:
            return Response({'detail': 'Unsupported platform setting.'}, status=status.HTTP_400_BAD_REQUEST)
        if isinstance(value, (dict, list)) is False:
            return Response({'detail': 'Setting value must be an object or list.'}, status=status.HTTP_400_BAD_REQUEST)
        if key == 'system' and not isinstance(value, dict):
            return Response({'detail': 'This setting must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
        if key in {'modules', 'fee_categories', 'exam_types'} and not isinstance(value, list):
            return Response({'detail': 'This setting must be a list.'}, status=status.HTTP_400_BAD_REQUEST)
        if key == 'system':
            allowed_fields = {
                'schoolName', 'schoolPrefix', 'operatingHoursStart', 'operatingHoursEnd', 'holidays',
                'minAttendancePercent', 'absentAutoSMS', 'smsTemplate', 'gpaScale', 'pushAlerts',
                'emailAlerts', 'smtpHost', 'senderID', 'paymentGatewayMode', 'razorpayKeyId',
                'backupSchedule', 'backupDestination', 'backupRetentionDays', 'minPasswordLength',
                'lockoutAttempts', 'require2FAForAdmins',
            }
            if set(value) - allowed_fields:
                return Response({'detail': 'Setting contains unsupported fields.'}, status=status.HTTP_400_BAD_REQUEST)
        if key == 'modules':
            allowed_module_fields = {'id', 'name', 'description', 'category', 'enabled'}
            if len(value) > 100 or any(not isinstance(row, dict) or set(row) - allowed_module_fields for row in value):
                return Response({'detail': 'Module configuration is invalid.'}, status=status.HTTP_400_BAD_REQUEST)
        if key in {'fee_categories', 'exam_types'}:
            if len(value) > 100 or any(not isinstance(item, str) or not item.strip() or len(item) > 80 for item in value):
                return Response({'detail': 'List entries must be non-empty text up to 80 characters.'}, status=status.HTTP_400_BAD_REQUEST)
        def contains_secret(item):
            if isinstance(item, dict):
                def is_secret_field(name):
                    normalized = str(name).lower().replace('-', '_')
                    return (
                        normalized in {'password', 'password_hash', 'credential', 'credentials'}
                        or 'secret' in normalized
                        or normalized.endswith('token')
                        or 'private_key' in normalized
                    )
                return any(is_secret_field(name) or contains_secret(child) for name, child in item.items())
            if isinstance(item, list):
                return any(contains_secret(child) for child in item)
            return False
        if contains_secret(value):
            return Response({'detail': 'Credentials and secret values cannot be stored in platform settings.'}, status=status.HTTP_400_BAD_REQUEST)
        row, _ = PlatformSetting.objects.update_or_create(
            key=key,
            defaults={'value': value, 'updated_by': request.user},
        )
        from .audit import record_admin_audit_event
        record_admin_audit_event(request, 'platform_setting_updated', target=row, metadata={'setting': key})
        return Response({'key': row.key, 'value': row.value})


class CanManageExports(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        )


class ExportJobViewSet(TenantScopedViewSet):
    """
    Asynchronous export engine for high-volume datasets (up to 1,000,000 records).
    Dispatches Celery worker tasks that stream rows directly to disk in 2000-row chunks.
    """
    serializer_class = ExportJobSerializer
    permission_classes = [CanManageExports]
    throttle_scope = 'exports'
    queryset = ExportJob.objects.select_related('school', 'created_by').order_by('-created_at')

    def create(self, request, *args, **kwargs):
        school = getattr(request.user, 'school', None)
        if not school:
            return Response({'error': 'School context required to start export'}, status=status.HTTP_400_BAD_REQUEST)

        resource_type = request.data.get('resource_type')
        if not resource_type or resource_type not in ExportJob.ResourceType.values:
            valid_types = list(ExportJob.ResourceType.values)
            return Response(
                {'error': f"Invalid resource_type '{resource_type}'. Supported: {valid_types}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filters = request.data.get('filters', {})
        if not isinstance(filters, dict):
            filters = {}

        file_format = request.data.get('file_format', 'csv')

        job = ExportJob.objects.create(
            school=school,
            created_by=request.user,
            resource_type=resource_type,
            file_format=file_format,
            filters=filters,
            status=ExportJob.Status.PENDING,
        )

        from .audit import record_admin_audit_event
        record_admin_audit_event(
            request,
            'export_requested',
            target=job,
            school=school,
            metadata={'resource_type': resource_type, 'file_format': file_format},
        )

        # Dispatch async Celery worker task
        export_resource_task.delay(str(job.id))

        serializer = self.get_serializer(job)
        return Response(serializer.data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'], url_path='status')
    def job_status(self, request, pk=None):
        job = self.get_object()
        serializer = self.get_serializer(job)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='download')
    def download(self, request, pk=None):
        job = self.get_object()
        if job.status != ExportJob.Status.COMPLETED or not job.file_path:
            return Response(
                {'error': f"Export is not completed yet (current status: {job.status})"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not os.path.exists(job.file_path):
            raise Http404("Exported file does not exist on disk")

        filename = os.path.basename(job.file_path)
        from .audit import record_admin_audit_event
        record_admin_audit_event(request, 'export_downloaded', target=job, school=job.school, metadata={'resource_type': job.resource_type})
        response = FileResponse(open(job.file_path, 'rb'), as_attachment=True, filename=filename)
        response['Content-Type'] = 'text/csv'
        return response
