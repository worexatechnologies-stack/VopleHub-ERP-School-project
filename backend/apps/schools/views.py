import logging
import json
import re
import base64
import binascii
from django.core.files.base import ContentFile

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.views import APIView
from django.http import Http404, HttpResponse
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from django.utils import timezone
from apps.accounts.models import User
from apps.common.fast_cache import fast_cache_response, bump_cache_version
from apps.common.validators import optimize_raster_image, validate_school_logo
from .models import School
from .serializers import SchoolSerializer


logger = logging.getLogger(__name__)

HALL_TICKET_DEFAULTS = {
    'layout': 'classic',
    'heading': 'Examination Hall Ticket',
    'accentColor': '#4f46e5',
    'showWatermark': True,
    'showInstructions': True,
    'footerNote': '',
    'showAdmissionNo': True,
    'showClassSection': True,
    'showRollNumber': True,
    'showExamDate': True,
    'showExamTimings': True,
    'showMaxMarks': True,
    'showVenue': True,
    'showSignatures': True,
    'controllerSignatureImage': '',
    'invigilatorSignatures': {},
    'instructions': [
        'Candidates must arrive at the examination hall at least 15 minutes before the scheduled start time.',
        'Carrying this Hall Ticket / Admit Card and the valid Student ID is strictly mandatory for admission.',
        'Electronic gadgets including mobile phones, smartwatches, and programmable calculators are strictly prohibited.',
        'Follow all instructions given by the invigilator and maintain absolute silence in the examination room.',
    ],
    'labels': {
        'officialBadge': 'Official Admit Card',
        'ticketNumber': 'Hall Ticket No.',
        'academicSession': 'Academic Session',
        'candidateName': 'Candidate Name',
        'admissionNo': 'Admission No',
        'classSection': 'Class & Section',
        'rollNumber': 'Roll Number',
        'papersTitle': 'Admitted Subject Papers & Venue',
        'subject': 'Subject Paper',
        'examDate': 'Exam Date',
        'examTimings': 'Exam Timings',
        'maxMarks': 'Max Marks',
        'venue': 'Assigned Venue',
        'instructionsTitle': 'Mandatory Examination Rules & Instructions:',
        'candidateSignature': 'Candidate Signature',
        'schoolSeal': 'Official School Authorized Seal',
        'controllerSignature': 'Controller of Examinations',
    },
}

class IsSuperAdminOnly(BasePermission):
    """Only the platform operator may mutate schools."""

    def has_permission(self, request, view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return request.user.is_authenticated
        return request.user.is_authenticated and request.user.role == 'super_admin'


class SchoolViewSet(viewsets.ModelViewSet):
    serializer_class, permission_classes = SchoolSerializer, [IsSuperAdminOnly]
    queryset = School.objects.defer('logo_data').order_by('name')
    search_fields = ['name', 'code', 'subdomain']
    filterset_fields = ['is_active', 'is_demo']
    ordering_fields = ['name', 'code', 'created_at', 'student_count']

    def get_queryset(self):
        from django.db.models import Count
        qs = super().get_queryset().annotate(student_count=Count('students', distinct=True))
        return (qs if self.request.user.role == 'super_admin' else qs.filter(pk=self.request.user.school_id)).order_by('name', 'pk')

    @action(detail=False, methods=['get'], url_path='school-counts')
    def school_counts(self, request):
        if request.user.role != 'super_admin':
            return Response({'detail': 'Only Super Admins can view cross-school record counts.'}, status=status.HTTP_403_FORBIDDEN)

        from django.db.models import Count
        from apps.sis.models import Student
        from apps.staff.models import Teacher

        counts = {
            str(school_id): {'students': 0, 'teachers': 0}
            for school_id in School.objects.values_list('id', flat=True)
        }
        student_rows = Student.objects.values('school_id').annotate(total=Count('id'))
        teacher_rows = Teacher.objects.values('school_id').annotate(total=Count('id'))
        for row in student_rows:
            counts[str(row['school_id'])]['students'] = row['total']
        for row in teacher_rows:
            counts[str(row['school_id'])]['teachers'] = row['total']
        response = Response(counts)
        response['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response['Pragma'] = 'no-cache'
        return response

    @fast_cache_response(namespace='schools', timeout=120)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @fast_cache_response(namespace='schools', timeout=120)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    def perform_create(self, serializer):
        school = serializer.save()
        from apps.common.audit import record_admin_audit_event
        record_admin_audit_event(self.request, 'school_created', target=school, school=school, metadata={'school_code': school.code})
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
        response['Cache-Control'] = 'private, no-store, must-revalidate'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    def perform_update(self, serializer):
        previous_instance = self.get_object()
        was_active = previous_instance.is_active
        instance = serializer.save()
        from apps.common.audit import record_admin_audit_event
        changed_fields = sorted(serializer.validated_data.keys())
        record_admin_audit_event(
            self.request,
            'school_updated',
            target=instance,
            school=instance,
            metadata={'changed_fields': changed_fields},
        )
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
            from apps.common.audit import record_admin_audit_event
            record_admin_audit_event(
                request,
                'school_deleted',
                target=school,
                school=school,
                metadata={'school_code': school.code},
            )
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


class HallTicketSettingsView(APIView):
    """Tenant-scoped hall-ticket branding, editable only by its school admin."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _get_school(self, request):
        if not request.user.school_id:
            return None
        return School.objects.filter(pk=request.user.school_id).first()

    @staticmethod
    def _serialize(school):
        stored = school.hall_ticket_settings if isinstance(school.hall_ticket_settings, dict) else {}
        stored_labels = stored.get('labels')
        labels = {**HALL_TICKET_DEFAULTS['labels'], **(stored_labels if isinstance(stored_labels, dict) else {})}
        return {
            **HALL_TICKET_DEFAULTS,
            **stored,
            'labels': labels,
            'logoImageUrl': f'/api/v1/schools/{school.pk}/logo/' if school.logo_data else '',
        }

    def get(self, request):
        school = self._get_school(request)
        if not school:
            return Response({'detail': 'A school tenant is required.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(self._serialize(school))

    def patch(self, request):
        if request.user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'Only this school’s admin can edit hall ticket branding.'}, status=status.HTTP_403_FORBIDDEN)
        school = self._get_school(request)
        if not school:
            return Response({'detail': 'A school tenant is required.'}, status=status.HTTP_404_NOT_FOUND)

        settings_data = self._serialize(school)
        settings_data.pop('logoImageUrl', None)
        if 'layout' in request.data:
            layout = str(request.data.get('layout', '')).strip()
            if layout not in {'classic', 'compact'}:
                return Response({'layout': ['Choose classic or compact layout.']}, status=status.HTTP_400_BAD_REQUEST)
            settings_data['layout'] = layout
        if 'heading' in request.data:
            heading = str(request.data.get('heading', '')).strip()
            if not heading or len(heading) > 80:
                return Response({'heading': ['Enter a heading up to 80 characters.']}, status=status.HTTP_400_BAD_REQUEST)
            settings_data['heading'] = heading
        if 'accentColor' in request.data:
            color = str(request.data.get('accentColor', '')).strip()
            if not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
                return Response({'accentColor': ['Enter a valid hex color.']}, status=status.HTTP_400_BAD_REQUEST)
            settings_data['accentColor'] = color
        for key in (
            'showWatermark', 'showInstructions', 'showAdmissionNo', 'showClassSection',
            'showRollNumber', 'showExamDate', 'showExamTimings', 'showMaxMarks',
            'showVenue', 'showSignatures',
        ):
            if key in request.data:
                raw_value = request.data.get(key)
                settings_data[key] = raw_value is True or str(raw_value).lower() in {'true', '1', 'yes', 'on'}
        if 'footerNote' in request.data:
            footer_note = str(request.data.get('footerNote', '')).strip()
            if len(footer_note) > 240:
                return Response({'footerNote': ['Use 240 characters or fewer.']}, status=status.HTTP_400_BAD_REQUEST)
            settings_data['footerNote'] = footer_note
        if 'instructions' in request.data:
            raw_instructions = request.data.get('instructions')
            if isinstance(raw_instructions, str):
                try:
                    raw_instructions = json.loads(raw_instructions)
                except json.JSONDecodeError:
                    return Response({'instructions': ['Examination instructions must be valid JSON.']}, status=status.HTTP_400_BAD_REQUEST)
            if (
                not isinstance(raw_instructions, list)
                or len(raw_instructions) > 10
                or any(not isinstance(item, str) or not item.strip() or len(item.strip()) > 240 for item in raw_instructions)
            ):
                return Response({'instructions': ['Add up to 10 non-empty instructions, each 240 characters or fewer.']}, status=status.HTTP_400_BAD_REQUEST)
            settings_data['instructions'] = [item.strip() for item in raw_instructions]
        if 'controllerSignatureImage' in request.data:
            raw_signature = request.data.get('controllerSignatureImage')
            try:
                settings_data['controllerSignatureImage'] = self._clean_signature_image(raw_signature) if raw_signature else ''
            except ValueError as exc:
                return Response({'controllerSignatureImage': [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        if 'invigilatorSignatures' in request.data:
            raw_signatures = request.data.get('invigilatorSignatures')
            if isinstance(raw_signatures, str):
                try:
                    raw_signatures = json.loads(raw_signatures)
                except json.JSONDecodeError:
                    return Response({'invigilatorSignatures': ['Subject signatures must be valid JSON.']}, status=status.HTTP_400_BAD_REQUEST)
            if not isinstance(raw_signatures, dict) or len(raw_signatures) > 50:
                return Response({'invigilatorSignatures': ['Add signatures for up to 50 subjects.']}, status=status.HTTP_400_BAD_REQUEST)
            optimized_signatures = {}
            total_bytes = 0
            try:
                for subject, signature in raw_signatures.items():
                    subject_name = str(subject).strip()
                    if not subject_name or len(subject_name) > 100:
                        raise ValueError('Subject names for signatures must be 1–100 characters.')
                    optimized = self._clean_signature_image(signature) if signature else ''
                    total_bytes += len(optimized)
                    if total_bytes > 8 * 1024 * 1024:
                        raise ValueError('The optimized subject signatures must total 8 MB or less.')
                    if optimized:
                        optimized_signatures[subject_name] = optimized
                settings_data['invigilatorSignatures'] = optimized_signatures
            except ValueError as exc:
                return Response({'invigilatorSignatures': [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        if 'labels' in request.data:
            raw_labels = request.data.get('labels')
            if isinstance(raw_labels, str):
                try:
                    raw_labels = json.loads(raw_labels)
                except json.JSONDecodeError:
                    return Response({'labels': ['Format labels must be valid JSON.']}, status=status.HTTP_400_BAD_REQUEST)
            if not isinstance(raw_labels, dict):
                return Response({'labels': ['Format labels must be an object.']}, status=status.HTTP_400_BAD_REQUEST)
            labels = dict(settings_data['labels'])
            for key, value in raw_labels.items():
                if key not in labels or not isinstance(value, str) or not value.strip() or len(value.strip()) > 80:
                    return Response({'labels': [f'Enter valid text (up to 80 characters) for {key}.']}, status=status.HTTP_400_BAD_REQUEST)
                labels[key] = value.strip()
            settings_data['labels'] = labels

        logo_file = request.FILES.get('logoFile')
        remove_logo = str(request.data.get('removeLogo', '')).lower() in {'true', '1', 'yes', 'on'}
        logo_update_fields = []
        if logo_file:
            try:
                validate_school_logo(logo_file)
                logo_data, logo_content_type, _ = optimize_raster_image(logo_file)
            except Exception as exc:
                return Response({'logoFile': [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
            school.logo_data = logo_data
            school.logo_content_type = logo_content_type
            logo_update_fields.extend(['logo_data', 'logo_content_type'])
        elif remove_logo:
            school.logo_data = None
            school.logo_content_type = ''
            logo_update_fields.extend(['logo_data', 'logo_content_type'])

        school.hall_ticket_settings = settings_data
        school.save(update_fields=['hall_ticket_settings', *logo_update_fields])
        bump_cache_version('schools')
        return Response(self._serialize(school))

    @staticmethod
    def _clean_signature_image(value):
        if not isinstance(value, str):
            raise ValueError('Choose a PNG, JPEG, or WebP signature image.')
        match = re.fullmatch(r'data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)', value)
        if not match:
            raise ValueError('Choose a PNG, JPEG, or WebP signature image.')
        try:
            payload = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError('The signature image data is invalid.') from exc
        if not payload or len(payload) > 5 * 1024 * 1024:
            raise ValueError('Each signature image must be smaller than 5 MB.')
        extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[match.group(1)]
        try:
            optimized, content_type, _ = optimize_raster_image(ContentFile(payload, name=f'signature.{extension}'))
        except Exception as exc:
            raise ValueError(str(exc)) from exc
        return f'data:{content_type};base64,{base64.b64encode(optimized).decode("ascii")}'
