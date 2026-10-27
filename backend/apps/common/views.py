import os
from django.http import FileResponse, Http404
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet
from .models import ExportJob
from .serializers import ExportJobSerializer
from .tasks import export_resource_task


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
        response = FileResponse(open(job.file_path, 'rb'), as_attachment=True, filename=filename)
        response['Content-Type'] = 'text/csv'
        return response
