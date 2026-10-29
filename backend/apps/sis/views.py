import logging
import re
import secrets
from io import BytesIO

from django.db import IntegrityError, transaction
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email

logger = logging.getLogger(__name__)
from django.db.models import Prefetch, Count, Avg, Sum, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.http import FileResponse, Http404, HttpResponse
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.accounts.authentication import CachedJWTAuthentication
from rest_framework.authentication import SessionAuthentication
from drf_spectacular.utils import OpenApiResponse, OpenApiTypes, extend_schema
from apps.accounts.models import ParentProfile, User, StudentProfile
from apps.accounts.credential_generator import generate_login_id, generate_password
from apps.common.tenancy import TenantScopedViewSet, tenant_rls_context
from apps.common.fast_cache import fast_cache_response, bump_cache_version
from apps.common.import_queue import CanManageSchoolImports, import_status_key, queue_import_batch
from apps.common.storage import sanitize_filename
from apps.common.validators import (
    detected_content_type,
    optimize_raster_image,
    validate_enrollment_document,
    validate_enrollment_photo,
)

def invalidate_student_dependent_caches(school_id, academic_year: str = ''):
    """Invalidate all student, academic, financial, and school directory caches dependent on student roster data."""
    if not school_id:
        return
    bump_cache_version('students', school_id)
    bump_cache_version('academics', school_id)
    bump_cache_version('schools')
    try:
        from django.core.cache import cache
        cache.delete(f"school_revenue_{school_id}_all")
        if academic_year:
            cache.delete(f"school_revenue_{school_id}_{academic_year}")
    except Exception:
        pass


def schedule_enrollment_sync(school_id, action: str, application_id):
    """Publish an enrollment queue event only after its database write commits."""
    from apps.common.realtime import broadcast_sync_event

    transaction.on_commit(lambda: broadcast_sync_event(
        school_id=school_id,
        entity='enrollment',
        action=action,
        entity_id=application_id,
    ))
from .access import teacher_can_access_student, teacher_student_queryset
from .models import AcademicHistory, Student, StudentDocument, EnrollmentLink, EnrollmentApplication
from .serializers import (
    DocumentSerializer,
    StudentDocumentUploadSerializer,
    StudentSerializer,
    TeacherStudentSerializer,
    EnrollmentLinkSerializer,
    EnrollmentApplicationSerializer,
)
from .services import create_or_link_parent_login, create_student_login, deactivate_login_if_student_left


def next_available_admission_no(*, school, academic_year, proposed: str) -> str:
    """Allocate the next sequence value for UI-generated admission numbers."""
    match = re.fullmatch(r'(.+?)(\d+)', proposed)
    if not match:
        return proposed
    prefix, digits = match.groups()
    width = len(digits)
    highest = int(digits)
    for value in Student.objects.filter(
        school=school,
        academic_year=academic_year,
        admission_no__startswith=prefix,
    ).values_list('admission_no', flat=True):
        candidate = re.fullmatch(rf'{re.escape(prefix)}(\d+)', value)
        if candidate:
            highest = max(highest, int(candidate.group(1)))
    return f'{prefix}{highest + 1:0{width}d}'


class CanAdmitStudents(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.role == User.Role.SUPER_ADMIN:
            # Platform reporting may read the cross-school roster, but all
            # student lifecycle changes remain owned by the School Admin.
            return request.method in permissions.SAFE_METHODS
        if view.action == 'create':
            return request.user.role == User.Role.SCHOOL_ADMIN
        return request.user.role in [
            User.Role.SCHOOL_ADMIN, User.Role.TEACHER,
            User.Role.PARENT, User.Role.STUDENT,
        ]

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return True
        if user.role == User.Role.STUDENT:
            return getattr(user, 'student_profile', None) and user.student_profile.student_id == obj.id and request.method in permissions.SAFE_METHODS
        if user.role == User.Role.PARENT:
            return getattr(user, 'parent_profile', None) and user.parent_profile.students.filter(pk=obj.pk).exists() and request.method in permissions.SAFE_METHODS
        if user.role == User.Role.TEACHER:
            profile = getattr(user, 'teacher_profile', None)
            return teacher_can_access_student(profile, obj) and request.method in permissions.SAFE_METHODS
        return False


class StudentPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 500


class StudentViewSet(TenantScopedViewSet):
    serializer_class = StudentSerializer
    pagination_class = StudentPagination
    permission_classes = [CanAdmitStudents]
    queryset = Student.objects.defer(
        'photo_data'
    ).select_related(
        'school', 'section_record', 'section_record__class_room',
    ).order_by('school_id', 'roll_no', 'id')
    filterset_fields = ['class_name', 'section', 'academic_year', 'status', 'section_record', 'gender']
    search_fields = ['name', 'admission_no', 'parent_name', 'parent_phone', 'parent_email']
    ordering_fields = ['roll_no', 'id', 'name', 'admission_no']

    @fast_cache_response(namespace='students', timeout=60)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=['get'], url_path='stats')
    @fast_cache_response(namespace='students', timeout=60)
    def stats(self, request):
        qs = self.filter_queryset(self.get_queryset())
        from django.db.models import Count, Avg, Sum, Q
        aggregates = qs.aggregate(
            total_students=Count('id'),
            active_students=Count('id', filter=Q(status=Student.Status.ACTIVE)),
            promoted_students=Count('id', filter=Q(status=Student.Status.PROMOTED)),
            tc_students=Count('id', filter=Q(status=Student.Status.TC_ISSUED)),
            boys_count=Count('id', filter=Q(gender__iexact='Male')),
            girls_count=Count('id', filter=Q(gender__iexact='Female')),
            avg_attendance=Avg('attendance_percentage'),
            total_fee=Sum('fee_total'),
            paid_fee=Sum('fee_paid'),
        )
        total = aggregates['total_students'] or 0
        active_count = aggregates['active_students'] or 0
        promoted_count = aggregates['promoted_students'] or 0
        tc_count = aggregates['tc_students'] or 0
        boys = aggregates['boys_count'] or 0
        girls = aggregates['girls_count'] or 0
        avg_att = round(float(aggregates['avg_attendance']), 1) if aggregates['avg_attendance'] is not None else None
        tot_fee = float(aggregates['total_fee'] or 0)
        paid_fee = float(aggregates['paid_fee'] or 0)
        fee_pct = round((paid_fee / tot_fee * 100), 1) if tot_fee > 0 else 0

        return Response({
            'totalStudents': total,
            'activeStudents': active_count,
            'promotedStudents': promoted_count,
            'tcStudents': tc_count,
            'boysCount': boys,
            'girlsCount': girls,
            'avgAttendance': avg_att,
            'totalFee': tot_fee,
            'paidFee': paid_fee,
            'feeStatusPercent': fee_pct,
        })

    def filter_queryset(self, queryset):
        import re
        academic_year = self.request.query_params.get('academic_year')
        if academic_year and academic_year.lower() != 'all':
            raw_ay = academic_year.strip()
            m = re.match(r'^(\d{4})[-/–](\d{2,4})$', raw_ay)
            if m:
                start, end = m.groups()
                if len(end) == 2:
                    end_4 = f"{start[:2]}{end}"
                    variants = [f"{start}-{end}", f"{start}-{end_4}", f"{start}/{end}", f"{start}/{end_4}", raw_ay]
                else:
                    end_2 = end[-2:]
                    variants = [f"{start}-{end}", f"{start}-{end_2}", f"{start}/{end}", f"{start}/{end_2}", raw_ay]
                queryset = queryset.filter(academic_year__in=list(set(variants)))
            else:
                queryset = queryset.filter(academic_year__iexact=raw_ay)
            try:
                request_params = self.request.query_params.copy()
                request_params.pop('academic_year', None)
                self.request._request.GET = request_params
            except Exception:
                pass

        class_name = self.request.query_params.get('class_name')
        if class_name and class_name.lower() != 'all':
            cleaned = re.sub(r'^(class|grade|std)\s+', '', class_name, flags=re.IGNORECASE).strip()
            class_q = Q(class_name__iexact=class_name) | Q(class_name__iexact=cleaned) | Q(class_name__iexact=f"Class {cleaned}") | Q(class_name__iexact=f"Grade {cleaned}")
            queryset = queryset.filter(class_q)
            try:
                request_params = self.request.query_params.copy()
                request_params.pop('class_name', None)
                self.request._request.GET = request_params
            except Exception:
                pass

        search_query = self.request.query_params.get('search', '').strip()
        if search_query and search_query.isdigit():
            queryset = queryset.filter(
                Q(roll_no=int(search_query)) |
                Q(admission_no__icontains=search_query) |
                Q(parent_phone__icontains=search_query) |
                Q(name__icontains=search_query)
            )
            try:
                request_params = self.request.query_params.copy()
                request_params.pop('search', None)
                self.request._request.GET = request_params
            except Exception:
                pass

        return super().filter_queryset(queryset)

    @fast_cache_response(namespace='students', timeout=60)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    def perform_destroy(self, instance):
        school_id = instance.school_id
        ay = getattr(instance, 'academic_year', '')
        super().perform_destroy(instance)
        invalidate_student_dependent_caches(school_id, ay)

    def get_serializer_class(self):
        user = getattr(self.request, 'user', None)
        if user and user.is_authenticated and user.role == User.Role.TEACHER:
            return TeacherStudentSerializer
        return StudentSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Student.objects.none()
        user = self.request.user
        if not user.is_authenticated:
            return Student.objects.none()
        qs = super().get_queryset()

        doc_prefetch = Prefetch('documents', queryset=StudentDocument.objects.defer('file_data'))
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return qs.prefetch_related(doc_prefetch, 'history')
        if user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            return qs.filter(pk=profile.student_id).prefetch_related(doc_prefetch, 'history') if profile else qs.none()
        if user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            return qs.filter(parent_profiles=profile).prefetch_related(doc_prefetch, 'history').distinct() if profile else qs.none()
        if user.role == User.Role.TEACHER:
            profile = getattr(user, 'teacher_profile', None)
            return teacher_student_queryset(profile, qs, school_id=user.school_id).select_related(None).only(
                'id', 'school_id', 'section_record_id', 'admission_no', 'name',
                'photo_content_type', 'class_name', 'section', 'roll_no',
                'parent_name', 'parent_phone', 'dob', 'gender', 'status',
                'academic_year',
            )
        return qs.none()
    def create(self, request, *args, **kwargs):
        payload = request.data.copy()
        school = request.user.school
        if not school:
            # A school tenant is mandatory. We never silently fall back to
            # ``School.objects.first()`` because that would attach a student
            # to an unrelated school and break tenant isolation. 
            return Response(
                {'detail': 'A school tenant is required to admit students.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        requested_admission_no = str(payload.get('admissionNo', '')).strip()
        academic_year = str(payload.get('academicYear', '')).strip()
        admission_number_adjusted = False
        if requested_admission_no and academic_year and Student.objects.filter(
            school=school,
            admission_no=requested_admission_no,
            academic_year=academic_year,
        ).exists():
            allocated_admission_no = next_available_admission_no(
                school=school,
                academic_year=academic_year,
                proposed=requested_admission_no,
            )
            if allocated_admission_no != requested_admission_no:
                payload['admissionNo'] = allocated_admission_no
                admission_number_adjusted = True

        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            student = serializer.save(school=school)
            custom_student_pwd = str(payload.get('password') or payload.get('studentPassword') or payload.get('temporaryPassword') or '').strip()
            custom_student_email = str(payload.get('studentEmail') or '').strip()
            custom_parent_pwd = str(payload.get('parentPassword') or '').strip()
            custom_parent_email = str(payload.get('parentEmail') or '').strip()

            student_credentials = create_student_login(
                student,
                password=custom_student_pwd or None,
                email=custom_student_email or None,
            )
            parent_credentials = create_or_link_parent_login(
                student,
                password=custom_parent_pwd or None,
                email=custom_parent_email or None,
            )

        response_serializer = self.get_serializer(student)
        headers = self.get_success_headers(response_serializer.data)
        data = response_serializer.data
        data['loginCredentials'] = {
            'student': student_credentials,
            'parent': parent_credentials,
        }
        if admission_number_adjusted:
            data['admissionNumberAdjusted'] = True
        invalidate_student_dependent_caches(school.id, academic_year)

        # Notify student, parent, and school admins
        try:
            from apps.notifications.services import notify_student_and_parents, notify_school_admins
            notify_student_and_parents(
                student,
                title=f"Welcome to {school.name}!",
                body=f"Admission confirmed for {student.name} in Class {student.class_name}-{student.section}. Admission No: {student.admission_no}.",
                category="Admissions",
                channel="admissions",
                sender=request.user,
                related={'studentId': student.id, 'admissionNo': student.admission_no},
            )
            notify_school_admins(
                school,
                title="New Student Admitted",
                body=f"{student.name} has been admitted to Class {student.class_name}-{student.section} (Adm No: {student.admission_no}).",
                category="Admissions",
                channel="admissions",
                sender=request.user,
                related={'studentId': student.id, 'admissionNo': student.admission_no},
            )
        except Exception:
            pass

        return Response(data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_update(self, serializer):
        student = serializer.save()
        invalidate_student_dependent_caches(student.school_id, getattr(student, 'academic_year', ''))
        if student.status == Student.Status.TC_ISSUED:
            deactivate_login_if_student_left(student)

    @action(detail=True, methods=['get', 'post'], url_path='photo')
    def photo(self, request, pk=None):
        student = self.get_object()
        if request.method.lower() == 'post':
            if request.user.role != User.Role.SCHOOL_ADMIN:
                return Response({'detail': 'Only school administrators can upload student photos.'}, status=status.HTTP_403_FORBIDDEN)
            photo_file = request.FILES.get('photo')
            if not photo_file:
                return Response({'detail': 'No photo file provided.'}, status=status.HTTP_400_BAD_REQUEST)
            from apps.sis.serializers import StudentSerializer
            StudentSerializer._store_photo(student, photo_file)
            return Response({'photoUrl': f'/api/v1/students/{student.id}/photo/'}, status=status.HTTP_200_OK)

        from apps.common.storage import open_file, file_exists
        if student.photo_key and file_exists(student.photo_key):
            try:
                handle = open_file(student.photo_key)
                response = FileResponse(handle, content_type=student.photo_content_type or 'image/webp')
                response['Cache-Control'] = 'private, max-age=300'
                response['X-Content-Type-Options'] = 'nosniff'
                return response
            except Exception:
                pass
        if not student.photo_data:
            raise Http404
        response = HttpResponse(bytes(student.photo_data), content_type=student.photo_content_type or 'image/webp')
        response['Cache-Control'] = 'private, max-age=300'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    @action(detail=True, methods=['get'], url_path='fee-summary')
    def fee_summary(self, request, pk=None):
        student = self.get_object()
        from apps.finance.views import get_student_fee_summary
        summary = get_student_fee_summary(student)
        return Response(summary)

    @action(detail=True, methods=['get'], url_path='promotion-eligibility')
    def promotion_eligibility(self, request, pk=None):
        student = self.get_object()
        from apps.finance.views import get_student_fee_summary
        fee_summary = get_student_fee_summary(student)
        fee_total = float(fee_summary.get('totalFees', 0) or student.fee_total or 0)
        fee_paid = float(fee_summary.get('totalPaid', 0) or student.fee_paid or 0)
        fee_percentage = round((fee_paid / fee_total * 100.0), 1) if fee_total > 0 else 100.0
        is_eligible = fee_total == 0 or fee_percentage >= 50.0
        min_required = round(fee_total * 0.5, 2)
        shortfall = max(0.0, round(min_required - fee_paid, 2))
        return Response({
            'studentId': student.id,
            'name': student.name,
            'admissionNo': student.admission_no,
            'currentClass': student.class_name,
            'currentSection': student.section,
            'academicYear': student.academic_year,
            'status': student.status,
            'feeTotal': fee_total,
            'feePaid': fee_paid,
            'feePercentage': fee_percentage,
            'minRequired': min_required,
            'shortfall': shortfall,
            'isEligible': is_eligible,
        })

    @action(detail=True, methods=['post'], url_path='promote')
    def promote(self, request, pk=None):
        """
        Promote a student to the next higher class.
        Requirement: Student must have paid at least 50% of the fees to be promoted.
        """
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response(
                {'detail': 'Only school administrators can promote students.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        student = self.get_object()
        if student.status == Student.Status.TC_ISSUED:
            return Response(
                {'detail': 'Cannot promote a student whose Transfer Certificate (TC) has been issued.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if student.status == Student.Status.PROMOTED:
            return Response(
                {'detail': 'This student record is already marked as Promoted and archived.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # -------------------------------------------------------------
        # Fee Requirement Check & Admin Approval:
        # Student must have completed at least 50% of the school fees,
        # approved by Admin, and fees invoice updated for new class.
        # -------------------------------------------------------------
        from apps.finance.views import get_student_fee_summary, resolve_fee_structure_for_student
        from apps.finance.models import StudentFeeRecord

        fee_summary = get_student_fee_summary(student)
        fee_total = float(fee_summary.get('totalFees', 0) or student.fee_total or 0)
        fee_paid = float(fee_summary.get('totalPaid', 0) or student.fee_paid or 0)

        allow_fee_waiver = bool(request.data.get('allow_fee_waiver', False) or request.data.get('allowFeeWaiver', False))
        waiver_reason = str(request.data.get('waiver_reason', '') or request.data.get('waiverReason', '')).strip()
        admin_approved = bool(request.data.get('admin_approved', True) if 'admin_approved' in request.data else request.data.get('adminApproved', True))

        if not admin_approved and not allow_fee_waiver:
            return Response(
                {'detail': 'Admin approval is required to authorize student promotion.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        fee_percentage = (fee_paid / fee_total * 100.0) if fee_total > 0 else 100.0

        if fee_total > 0:
            if fee_percentage < 50.0 and not allow_fee_waiver:
                shortfall = (fee_total * 0.5) - fee_paid
                return Response(
                    {
                        'detail': f'Fee requirement not met: {student.name} has completed only {fee_percentage:.1f}% (₹{fee_paid:,.2f} of ₹{fee_total:,.2f}). At least 50% fee clearance (₹{fee_total * 0.5:,.2f}) must be completed and approved by the admin before promotion. Shortfall: ₹{shortfall:,.2f}.',
                        'feeTotal': fee_total,
                        'feePaid': fee_paid,
                        'feePercentage': round(fee_percentage, 1),
                        'minRequired': round(fee_total * 0.5, 2),
                        'shortfall': round(shortfall, 2),
                        'isEligible': False,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        target_class = str(request.data.get('next_class') or request.data.get('nextClass') or '').strip()
        if not target_class:
            return Response(
                {'detail': 'Target next class is required for promotion.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_section = str(request.data.get('next_section') or request.data.get('nextSection') or student.section or 'A').strip()
        target_year = str(request.data.get('next_academic_year') or request.data.get('nextAcademicYear') or '').strip()

        with transaction.atomic():
            # 1. Archive current academic history
            admin_username = getattr(request.user, 'username', 'Admin')
            history_status = ('Promoted (Admin Waiver)' if allow_fee_waiver else f'Promoted to {target_class}')[:32]

            AcademicHistory.objects.get_or_create(
                student=student,
                academic_year=student.academic_year,
                defaults={
                    'class_name': student.class_name,
                    'section': student.section,
                    'gpa': student.gpa,
                    'attendance': student.attendance_percentage,
                    'status': history_status,
                }
            )

            # Find matching section_record in target class if exists
            from apps.academics.models import Section as AcadSection
            target_sec_record = AcadSection.objects.filter(
                school=student.school,
                class_room__name__iexact=target_class,
                name__iexact=target_section,
            ).first()

            if not target_sec_record:
                target_sec_record = AcadSection.objects.filter(
                    school=student.school,
                    class_room__name__iexact=target_class,
                ).first()

            # If next_academic_year is provided and differs from current, create new student cycle record
            if target_year and target_year != student.academic_year:
                existing_clone = Student.objects.filter(
                    school=student.school,
                    admission_no=student.admission_no,
                    academic_year=target_year,
                ).first()

                if existing_clone:
                    existing_clone.class_name = target_class
                    existing_clone.section = target_section
                    existing_clone.section_record = target_sec_record
                    existing_clone.status = Student.Status.ACTIVE
                    existing_clone.save()
                    promoted_student = existing_clone
                else:
                    student.status = Student.Status.PROMOTED
                    student.save(update_fields=['status'])

                    highest_roll = Student.objects.filter(
                        school=student.school,
                        class_name=target_class,
                        section=target_section,
                        academic_year=target_year,
                    ).order_by('-roll_no').values_list('roll_no', flat=True).first() or 0

                    promoted_student = Student.objects.create(
                        school=student.school,
                        admission_no=student.admission_no,
                        name=student.name,
                        photo_data=student.photo_data,
                        photo_content_type=student.photo_content_type,
                        class_name=target_class,
                        section=target_section,
                        section_record=target_sec_record,
                        roll_no=highest_roll + 1,
                        parent_name=student.parent_name,
                        parent_phone=student.parent_phone,
                        parent_email=student.parent_email,
                        dob=student.dob,
                        gender=student.gender,
                        address=student.address,
                        medical_conditions=student.medical_conditions,
                        status=Student.Status.ACTIVE,
                        academic_year=target_year,
                        attendance_percentage=100.0,
                        fee_total=0.0,
                        fee_paid=0.0,
                    )

                    if hasattr(student, 'login_profile'):
                        login_prof = student.login_profile
                        login_prof.student = promoted_student
                        login_prof.save(update_fields=['student'])

                    for parent_prof in student.parent_profiles.all():
                        parent_prof.students.add(promoted_student)
            else:
                student.class_name = target_class
                student.section = target_section
                student.section_record = target_sec_record
                student.save(update_fields=['class_name', 'section', 'section_record'])
                promoted_student = student

            # -------------------------------------------------------------
            # 2. Update Student Fee Invoice / Record for the Promoted Class
            # -------------------------------------------------------------
            target_ay = target_year or promoted_student.academic_year or '2026-2027'

            # Resolve fee structure for the promoted class & academic year
            target_fee_structure = resolve_fee_structure_for_student(
                promoted_student,
                academic_year=target_ay,
            )

            # Look up or create the StudentFeeRecord
            promoted_fee_rec = StudentFeeRecord.objects.filter(
                school=promoted_student.school,
                admission_no=promoted_student.admission_no,
                academic_year=target_ay,
            ).first()

            new_custom_items = (target_fee_structure.items or []) if target_fee_structure else []
            new_custom_quarters = (target_fee_structure.quarters or []) if target_fee_structure else []

            if not promoted_fee_rec:
                promoted_fee_rec = StudentFeeRecord.objects.create(
                    school=promoted_student.school,
                    student=promoted_student,
                    student_id_str=str(promoted_student.id),
                    student_name=promoted_student.name,
                    admission_no=promoted_student.admission_no,
                    class_name=target_class,
                    section_name=target_section,
                    academic_year=target_ay,
                    scholarship=0,
                    discount=0,
                    transport_charges=0,
                    hostel_charges=0,
                    fine_amount=0,
                    installments_paid=0,
                    custom_items=new_custom_items,
                    custom_quarters=new_custom_quarters,
                    payment_history=[],
                )
            else:
                promoted_fee_rec.student = promoted_student
                promoted_fee_rec.student_name = promoted_student.name
                promoted_fee_rec.class_name = target_class
                promoted_fee_rec.section_name = target_section
                promoted_fee_rec.academic_year = target_ay
                if target_fee_structure and (not promoted_fee_rec.custom_items or len(promoted_fee_rec.custom_items) == 0):
                    promoted_fee_rec.custom_items = new_custom_items
                    promoted_fee_rec.custom_quarters = new_custom_quarters
                promoted_fee_rec.save()

            # Recalculate authoritative fee summary for the updated class invoice
            updated_fee_summary = get_student_fee_summary(promoted_student, academic_year=target_ay)
            if updated_fee_summary:
                new_fee_total = float(updated_fee_summary.get('totalFees', 0) or 0)
                new_fee_paid = float(updated_fee_summary.get('totalPaid', 0) or 0)
                promoted_student.fee_total = new_fee_total
                promoted_student.fee_paid = new_fee_paid
                promoted_student.save(update_fields=['fee_total', 'fee_paid'])

        response_data = self.get_serializer(promoted_student).data
        response_data['message'] = f'Successfully promoted {promoted_student.name} to {target_class}-{target_section} with Admin approval. Fees invoice updated.'
        response_data['feeInvoice'] = updated_fee_summary
        response_data['adminApproval'] = {
            'approved': True,
            'approvedBy': admin_username,
            'feeClearedPct': round(fee_percentage, 1),
            'allowFeeWaiver': allow_fee_waiver,
            'waiverReason': waiver_reason if allow_fee_waiver else None,
        }
        return Response(response_data, status=status.HTTP_200_OK)

    @action(
        detail=False,
        methods=['get'],
        url_path='bulk-import/status',
        permission_classes=[CanManageSchoolImports],
    )
    def bulk_import_status(self, request):
        from django.core.cache import cache

        job_id = str(request.query_params.get('jobId') or '').strip()
        try:
            batch_number = int(request.query_params.get('batchNumber') or 0)
        except (TypeError, ValueError):
            batch_number = 0
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', job_id) or not 1 <= batch_number <= 10000:
            return Response({'detail': 'Valid jobId and batchNumber are required.'}, status=status.HTTP_400_BAD_REQUEST)
        key = import_status_key(
            entity='students', school_id=request.user.school_id, user_id=request.user.pk,
            job_id=job_id, batch_number=batch_number,
        )
        queued = cache.get(key)
        if queued is None:
            return Response({'detail': 'Import batch not found or its status has expired.'}, status=status.HTTP_404_NOT_FOUND)
        response = Response({'jobId': job_id, 'batchNumber': batch_number, **queued}, status=status.HTTP_200_OK)
        response['Cache-Control'] = 'private, no-store'
        return response

    @action(
        detail=False,
        methods=['post'],
        url_path='bulk-import',
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def bulk_import(self, request):
        """Bulk import students from JSON payload or uploaded Excel (.xlsx/.xls)/CSV file.
        High-throughput architecture supporting up to 50,000+ student records:
        - Memory-efficient streaming spreadsheet parsing
        - O(1) in-memory allocation of unique admission numbers, roll numbers, and login credentials
        - Ultra-fast temporary credential hashing with native auto-upgrade on user login
        - Batched database writes (bulk_create) to eliminate N+1 bottlenecks
        - Idempotent batch processing with cached job recovery
        - Structured, sanitized error diagnostics for high reliability
        """
        import time
        from apps.academics.models import AcademicYear, Class, Section
        from apps.accounts.models import CredentialVaultRecord, ParentProfile, StudentProfile, User
        from apps.common.spreadsheet_parser import (
            STUDENT_FIELD_SYNONYMS,
            auto_map_columns,
            detect_header_and_data,
            normalize_date_value,
            normalize_gender_value,
            normalize_phone_number,
            parse_spreadsheet_bytes,
        )
        from apps.common.validators import validate_spreadsheet_upload
        from apps.sis.services import generate_temporary_password
        from django.contrib.auth.hashers import MD5PasswordHasher
        from django.core.cache import cache
        from django.core.exceptions import ValidationError
        from django.db import DatabaseError, IntegrityError, transaction
        from django.db.models import Max, Q
        from django.utils.text import slugify
        import json as json_lib
        import secrets

        start_time = time.time()

        user = request.user
        if not (user and user.is_authenticated and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]):
            return Response({
                'success': False,
                'errorCategory': 'AUTHENTICATION_ERROR',
                'detail': 'Only School Admins can bulk import students.',
            }, status=status.HTTP_403_FORBIDDEN)

        school = user.school
        if not school:
            return Response({
                'success': False,
                'errorCategory': 'TENANT_ERROR',
                'detail': 'A school tenant is required to import students.',
            }, status=status.HTTP_400_BAD_REQUEST)

        queued_response = queue_import_batch(request, entity='students', user=user, school=school)
        if queued_response is not None:
            return queued_response

        job_id = str(request.data.get('jobId') or request.data.get('job_id') or '').strip()
        try:
            batch_number = int(request.data.get('batchNumber') or request.data.get('batch_number') or 1)
        except (ValueError, TypeError):
            batch_number = 1
        try:
            total_batches = int(request.data.get('totalBatches') or request.data.get('total_batches') or 1)
        except (ValueError, TypeError):
            total_batches = 1

        # Check idempotency cache if job_id is provided
        cache_key = f"bulk_import_student:{school.id}:{user.id}:{job_id}:{batch_number}" if job_id else None
        if cache_key:
            cached_result = cache.get(cache_key)
            if cached_result:
                return Response(cached_result, status=status.HTTP_200_OK)

        # 1. Gather raw student records
        uploaded_file = request.FILES.get('file')
        raw_students = []

        if uploaded_file:
            try:
                validate_spreadsheet_upload(uploaded_file)
                file_bytes = uploaded_file.read()
                grid_rows = parse_spreadsheet_bytes(file_bytes, uploaded_file.name)
                if not grid_rows:
                    return Response({
                        'success': False,
                        'jobId': job_id,
                        'batchNumber': batch_number,
                        'errorCategory': 'VALIDATION_ERROR',
                        'detail': 'The uploaded spreadsheet contains no readable rows.',
                    }, status=status.HTTP_400_BAD_REQUEST)

                _, header_names, data_rows = detect_header_and_data(grid_rows, STUDENT_FIELD_SYNONYMS)
                col_mapping = auto_map_columns(header_names, STUDENT_FIELD_SYNONYMS)

                # Optional user-override column mapping from multipart form data
                if 'column_mapping' in request.data:
                    override_map = request.data.get('column_mapping')
                    if isinstance(override_map, str):
                        try:
                            override_map = json_lib.loads(override_map)
                        except Exception:
                            override_map = {}
                    if isinstance(override_map, dict):
                        for k, v in override_map.items():
                            if isinstance(v, int):
                                col_mapping[k] = v

                for r_idx, row in enumerate(data_rows, start=1):
                    # Skip empty rows
                    if not any(c is not None and str(c).strip() != '' for c in row):
                        continue
                    student_dict = {'_row_num': r_idx}
                    for field, c_idx in col_mapping.items():
                        if c_idx < len(row):
                            student_dict[field] = row[c_idx]
                    raw_students.append(student_dict)
            except Exception as exc:
                logger.exception("Failed to parse student spreadsheet (job %s, batch %s)", job_id, batch_number)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'errorCategory': 'FILE_PARSE_ERROR',
                    'detail': 'Could not process the spreadsheet. Check its format and try again.',
                }, status=status.HTTP_400_BAD_REQUEST)
        else:
            payload = request.data
            if isinstance(payload, dict) and 'students' in payload:
                raw_students = payload['students']
            elif isinstance(payload, list):
                raw_students = payload
            elif isinstance(payload.get('students'), str):
                try:
                    raw_students = json_lib.loads(payload['students'])
                except Exception:
                    raw_students = []

        if not raw_students:
            return Response({
                'success': False,
                'jobId': job_id,
                'batchNumber': batch_number,
                'errorCategory': 'VALIDATION_ERROR',
                'detail': 'No student records found to import.',
            }, status=status.HTTP_400_BAD_REQUEST)

        # 2. Setup caches & defaults
        active_ay = AcademicYear.objects.filter(school=school, is_active=True).first()
        default_academic_year = (
            str(request.data.get('academicYear') or request.data.get('academic_year') or '').strip()
            or (active_ay.name if active_ay else (AcademicYear.objects.filter(school=school).order_by('-starts_on').values_list('name', flat=True).first() or '2026-2027'))
        )
        if not AcademicYear.objects.filter(school=school).exists():
            from datetime import date
            match = re.search(r'(\d{4})[^\d]+(\d{2,4})', default_academic_year)
            if match:
                s_yr = int(match.group(1))
                e_yr = int(match.group(2))
                if e_yr < 100:
                    e_yr += 2000
            else:
                s_yr = 2026
                e_yr = 2027
            AcademicYear.objects.create(
                school=school,
                name=default_academic_year,
                starts_on=date(s_yr, 4, 1),
                ends_on=date(e_yr, 3, 31),
                is_active=True,
            )
            bump_cache_version('academics', school.id)

        classes_by_name = {c.name.strip().lower(): c for c in Class.objects.filter(school=school)}
        classes_by_code = {c.code.strip().lower(): c for c in Class.objects.filter(school=school)}
        sections_by_class_and_name = {
            (s.class_room_id, s.name.strip().lower()): s
            for s in Section.objects.filter(school=school).select_related('class_room')
        }

        def resolve_class_and_section(class_str, sec_str):
            c_name = str(class_str or '').strip() or 'Class 1'
            c_key = c_name.lower()
            code = slugify(c_name)[:80] or f'class-{len(classes_by_name)+1}'

            class_obj = classes_by_name.get(c_key) or classes_by_code.get(code.lower())
            if not class_obj:
                digits_match = re.search(r'\d+', c_name)
                if digits_match:
                    d = digits_match.group()
                    class_obj = (
                        classes_by_name.get(d)
                        or classes_by_name.get(f"class {d}")
                        or classes_by_name.get(f"class-{d}")
                        or classes_by_code.get(d)
                        or classes_by_code.get(f"class-{d}")
                    )

            if not class_obj:
                existing = Class.objects.filter(school=school).filter(
                    Q(name__iexact=c_name) | Q(code=code)
                ).first()
                if existing:
                    class_obj = existing
                else:
                    base_code = code
                    counter = 1
                    while Class.objects.filter(school=school, code=code).exists():
                        code = f"{base_code}-{counter}"[:80]
                        counter += 1
                    class_obj, _ = Class.objects.get_or_create(
                        school=school,
                        code=code,
                        defaults={'name': c_name}
                    )
                classes_by_name[c_key] = class_obj
                classes_by_name[class_obj.name.strip().lower()] = class_obj
                classes_by_code[class_obj.code.strip().lower()] = class_obj
            else:
                classes_by_name[c_key] = class_obj

            s_name = str(sec_str or '').strip().upper() or 'A'
            s_key = (class_obj.id, s_name.lower())
            if s_key not in sections_by_class_and_name:
                sec_obj, _ = Section.objects.get_or_create(
                    school=school,
                    class_room=class_obj,
                    name=s_name
                )
                sections_by_class_and_name[s_key] = sec_obj
            else:
                sec_obj = sections_by_class_and_name[s_key]

            return class_obj, sec_obj

        # Optimized Admission Numbers: Check ONLY proposed admission numbers in this batch
        proposed_adms = [
            str(item.get('admission_no') or item.get('admissionNo') or '').strip()
            for item in raw_students
            if str(item.get('admission_no') or item.get('admissionNo') or '').strip()
        ]
        existing_admission_nos = set(
            Student.objects.filter(school=school, admission_no__in=proposed_adms).values_list('admission_no', flat=True)
        ) if proposed_adms else set()

        prefix = f"ADM{default_academic_year[:4]}" if default_academic_year and default_academic_year[:4].isdigit() else "ADM"
        last_adm = Student.objects.filter(school=school, admission_no__startswith=prefix).order_by('-admission_no').values_list('admission_no', flat=True).first()
        adm_seq = 0
        if last_adm:
            m = re.search(r'(\d+)$', str(last_adm))
            if m:
                adm_seq = int(m.group(1))

        def allocate_admission_no(ay_str, proposed=''):
            nonlocal adm_seq
            prop = str(proposed or '').strip()
            if prop and prop not in existing_admission_nos:
                existing_admission_nos.add(prop)
                return prop

            pfx = f"ADM{ay_str[:4]}" if ay_str and ay_str[:4].isdigit() else prefix
            adm_seq += 1
            candidate = f"{pfx}{adm_seq:04d}"
            while candidate in existing_admission_nos:
                adm_seq += 1
                candidate = f"{pfx}{adm_seq:04d}"
            existing_admission_nos.add(candidate)
            return candidate

        # Optimized Roll Numbers cache
        roll_counters = {}
        def next_roll(sec_id, ay_val):
            k = (sec_id, ay_val)
            if k not in roll_counters:
                max_roll = Student.objects.filter(school=school, section_record_id=sec_id, academic_year=ay_val).aggregate(Max('roll_no'))['roll_no__max'] or 0
                roll_counters[k] = max_roll
            roll_counters[k] += 1
            return roll_counters[k]

        # Optimized Parent Profiles: Check ONLY phones in this batch
        batch_phones = [
            normalize_phone_number(item.get('parent_phone') or item.get('parentPhone') or item.get('phone') or '')
            for item in raw_students
        ]
        batch_phones = [p for p in batch_phones if p and len(p) >= 10]
        existing_parent_profiles = {
            p.phone: p for p in ParentProfile.objects.filter(user__school=school, phone__in=batch_phones).select_related('user')
        } if batch_phones else {}

        # Optimized Login Credentials: Check ONLY explicit proposed emails in this batch
        proposed_custom_emails = [
            str(item.get('student_email') or item.get('studentEmail') or item.get('parent_email') or item.get('parentEmail') or '').strip().lower()
            for item in raw_students
            if str(item.get('student_email') or item.get('studentEmail') or item.get('parent_email') or item.get('parentEmail') or '').strip()
        ]
        existing_custom_emails = set(
            User.objects.filter(Q(email__in=proposed_custom_emails) | Q(username__in=proposed_custom_emails)).values_list('username', flat=True)
        ) if proposed_custom_emails else set()

        allocated_batch_usernames = set()
        subdomain_slug = slugify(getattr(school, 'subdomain', '') or getattr(school, 'code', '') or f'school-{school.id}') or f'school-{school.id}'

        # Fast password hasher
        fast_hasher = MD5PasswordHasher()
        def get_fast_credentials(override_password=None):
            raw_pwd = str(override_password or '').strip()
            if not raw_pwd:
                raw_pwd = generate_temporary_password(14)
            encoded_pwd = fast_hasher.encode(raw_pwd, secrets.token_hex(8))
            return raw_pwd, encoded_pwd

        created_students = []
        credentials_list = []
        errors_list = []
        total_created = 0

        # Process records in bounded batches (default 1000)
        try:
            param_batch_size = int(request.data.get('batchSize') or request.data.get('batch_size') or 1000)
            BATCH_SIZE = max(100, min(param_batch_size, 5000))
        except (ValueError, TypeError):
            BATCH_SIZE = 1000

        for chunk_start in range(0, len(raw_students), BATCH_SIZE):
            chunk = raw_students[chunk_start:chunk_start + BATCH_SIZE]

            chunk_students = []
            chunk_student_users = []
            chunk_new_parent_users = []
            chunk_new_parent_profiles = []
            chunk_parent_student_pairs = []
            chunk_creds_metadata = []

            for idx_offset, item in enumerate(chunk):
                overall_idx = chunk_start + idx_offset + 1
                row_num = item.get('_row_num', overall_idx)
                name = str(item.get('name') or item.get('student_name') or item.get('fullName') or '').strip()
                if not name:
                    errors_list.append({
                        'row': row_num,
                        'name': '(Blank)',
                        'reason': 'Missing student name.',
                    })
                    continue

                class_name_input = item.get('class_name') or item.get('class') or item.get('class_') or item.get('grade') or 'Class 1'
                section_input = item.get('section') or item.get('sec') or 'A'
                class_obj, sec_obj = resolve_class_and_section(class_name_input, section_input)

                ay = str(item.get('academic_year') or item.get('academicYear') or default_academic_year).strip() or default_academic_year
                if active_ay:
                    m_ay = re.match(r'^(\d{4})[-/–](\d{2,4})$', ay)
                    m_act = re.match(r'^(\d{4})[-/–](\d{2,4})$', active_ay.name)
                    if m_ay and m_act and m_ay.group(1) == m_act.group(1):
                        ay = active_ay.name

                # Admission Number
                prop_adm = str(item.get('admission_no') or item.get('admissionNo') or '').strip()
                adm_no = allocate_admission_no(ay, prop_adm)

                # Roll Number
                raw_roll = item.get('roll_no') or item.get('rollNo')
                try:
                    roll_no = int(float(raw_roll)) if raw_roll is not None and str(raw_roll).strip() != '' else 0
                except (ValueError, TypeError):
                    roll_no = 0
                if roll_no <= 0:
                    roll_no = next_roll(sec_obj.id, ay)
                else:
                    k = (sec_obj.id, ay)
                    roll_counters[k] = max(roll_counters.get(k, 0), roll_no)

                # Parent & Contact
                parent_name = str(item.get('parent_name') or item.get('parentName') or item.get('father_name') or f"{name}'s Parent").strip()
                parent_phone = normalize_phone_number(item.get('parent_phone') or item.get('parentPhone') or item.get('phone') or '')
                if not parent_phone or len(parent_phone) < 10:
                    parent_phone = f"98{overall_idx:08d}"[-10:]

                parent_email_val = str(item.get('parent_email') or item.get('parentEmail') or '').strip()
                if not parent_email_val or '@' not in parent_email_val:
                    parent_email_val = f"parent.{slugify(adm_no).lower()}@{subdomain_slug}.edu"

                dob_val = normalize_date_value(item.get('dob') or item.get('dateOfBirth')) or '2014-06-15'
                gender_val = normalize_gender_value(item.get('gender') or item.get('sex'))
                address_val = str(item.get('address') or '').strip()
                med_val = str(item.get('medical_conditions') or item.get('medicalConditions') or '').strip()

                student_inst = Student(
                    school=school,
                    admission_no=adm_no,
                    name=name,
                    class_name=class_obj.name,
                    section=sec_obj.name,
                    section_record=sec_obj,
                    roll_no=roll_no,
                    parent_name=parent_name,
                    parent_phone=parent_phone,
                    parent_email=parent_email_val,
                    dob=dob_val,
                    gender=gender_val,
                    address=address_val,
                    medical_conditions=med_val,
                    status=Student.Status.ACTIVE,
                    academic_year=ay,
                )

                # Student User Account: Deterministic O(1) Unique Login
                student_email_input = str(item.get('student_email') or item.get('studentEmail') or '').strip().lower()
                if student_email_input and student_email_input not in existing_custom_emails and student_email_input not in allocated_batch_usernames:
                    student_login_id = student_email_input
                else:
                    adm_slug = slugify(adm_no).lower() or f"s{overall_idx}"
                    student_login_id = f"{adm_slug}@students.{subdomain_slug}.volpehub.education"
                allocated_batch_usernames.add(student_login_id)

                s_override_pwd = item.get('student_password') or item.get('studentPassword') or item.get('password') or item.get('temp_password')
                student_plain_pwd, student_enc_pwd = get_fast_credentials(s_override_pwd)

                student_user = User(
                    username=student_login_id,
                    email=student_login_id,
                    first_name=name,
                    role=User.Role.STUDENT,
                    school=school,
                    is_active=True,
                    must_change_password=True,
                    password=student_enc_pwd,
                )

                # Parent User Account & Profile
                if parent_phone in existing_parent_profiles:
                    parent_prof = existing_parent_profiles[parent_phone]
                    parent_login_id = parent_prof.user.email if parent_prof.user else parent_email_val
                    parent_plain_pwd = '(Existing Account Linked)'
                    parent_user_obj = parent_prof.user
                else:
                    p_override_pwd = item.get('parent_password') or item.get('parentPassword') or item.get('parent_pwd')
                    parent_plain_pwd, parent_enc_pwd = get_fast_credentials(p_override_pwd)
                    if parent_email_val and parent_email_val not in existing_custom_emails and parent_email_val not in allocated_batch_usernames:
                        parent_login_id = parent_email_val
                    else:
                        adm_slug = slugify(adm_no).lower() or f"p{overall_idx}"
                        parent_login_id = f"p_{adm_slug}@parents.{subdomain_slug}.volpehub.education"
                    allocated_batch_usernames.add(parent_login_id)

                    parent_user_obj = User(
                        username=parent_login_id,
                        email=parent_login_id,
                        first_name=parent_name,
                        role=User.Role.PARENT,
                        school=school,
                        is_active=True,
                        must_change_password=True,
                        password=parent_enc_pwd,
                    )
                    parent_prof = ParentProfile(
                        user=parent_user_obj,
                        phone=parent_phone,
                    )
                    chunk_new_parent_users.append(parent_user_obj)
                    chunk_new_parent_profiles.append(parent_prof)
                    existing_parent_profiles[parent_phone] = parent_prof

                chunk_students.append(student_inst)
                chunk_student_users.append(student_user)
                chunk_parent_student_pairs.append((parent_prof, student_inst))

                chunk_creds_metadata.append({
                    'name': name,
                    'admissionNo': adm_no,
                    'className': f"{class_obj.name} - {sec_obj.name}",
                    'studentEmail': student_login_id,
                    'studentPassword': student_plain_pwd,
                    'parentEmail': parent_login_id,
                    'parentPassword': parent_plain_pwd,
                    'parentName': parent_name,
                    'parentPhone': parent_phone,
                    'parentUser': parent_user_obj,
                    'academicYear': ay,
                })

            if not chunk_students:
                continue

            try:
                with transaction.atomic():
                    # 1. Bulk insert students (PostgreSQL populates IDs)
                    Student.objects.bulk_create(chunk_students, batch_size=BATCH_SIZE)

                    # 2. Bulk insert users (both student users and new parent users)
                    all_new_users = chunk_student_users + chunk_new_parent_users
                    User.objects.bulk_create(all_new_users, batch_size=BATCH_SIZE)

                    # 3. Synchronize user_id on ParentProfile BEFORE bulk_create!
                    for p_prof in chunk_new_parent_profiles:
                        p_prof.user_id = p_prof.user.id

                    if chunk_new_parent_profiles:
                        ParentProfile.objects.bulk_create(chunk_new_parent_profiles, batch_size=BATCH_SIZE)

                    # 4. Bulk insert StudentProfile (both user_id and student_id are now populated)
                    student_profiles_to_create = [
                        StudentProfile(user_id=u.id, student_id=s.id)
                        for u, s in zip(chunk_student_users, chunk_students)
                    ]
                    StudentProfile.objects.bulk_create(student_profiles_to_create, batch_size=BATCH_SIZE)

                    # 5. Bulk link parents to students through M2M
                    through_model = ParentProfile.students.through
                    through_links = [
                        through_model(parentprofile_id=p_prof.id, student_id=s_inst.id)
                        for p_prof, s_inst in chunk_parent_student_pairs
                    ]
                    through_model.objects.bulk_create(through_links, batch_size=BATCH_SIZE, ignore_conflicts=True)

                    # 6. Bulk insert CredentialVaultRecord for both students & parents
                    vault_records = []
                    for s_user, s_inst, meta in zip(chunk_student_users, chunk_students, chunk_creds_metadata):
                        vault_records.append(CredentialVaultRecord(
                            school=school,
                            user_id=s_user.id,
                            role=CredentialVaultRecord.Role.STUDENT,
                            name=s_inst.name,
                            login_id=meta['studentEmail'],
                            plaintext_password=meta['studentPassword'],
                            identifier=s_inst.admission_no,
                            class_name=s_inst.class_name,
                            section=s_inst.section,
                            academic_year=s_inst.academic_year,
                            phone=s_inst.parent_phone,
                            source='csv_bulk_import',
                            must_change_password=True,
                        ))
                        if meta['parentPassword'] != '(Existing Account Linked)':
                            vault_records.append(CredentialVaultRecord(
                                school=school,
                                user_id=meta.get('parentUser').id if meta.get('parentUser') else None,
                                role=CredentialVaultRecord.Role.PARENT,
                                name=meta['parentName'],
                                login_id=meta['parentEmail'],
                                plaintext_password=meta['parentPassword'],
                                identifier=f"P-{s_inst.admission_no}",
                                class_name=s_inst.class_name,
                                section=s_inst.section,
                                academic_year=s_inst.academic_year,
                                phone=meta['parentPhone'],
                                linked_student_name=s_inst.name,
                                source='csv_bulk_import',
                                must_change_password=True,
                            ))

                    CredentialVaultRecord.objects.bulk_create(
                        vault_records, batch_size=BATCH_SIZE, ignore_conflicts=True
                    )
            except IntegrityError as exc:
                logger.exception("Database IntegrityError during bulk import of students (batch %s, job %s)", batch_number, job_id)
                err_msg = str(exc)
                category = 'DATABASE_CONSTRAINT_ERROR'
                if 'unique constraint' in err_msg.lower():
                    category = 'DUPLICATE_KEY_ERROR'
                    clean_msg = "Duplicate key detected in database. A student or user with this admission number, code, or email already exists."
                elif 'foreign key constraint' in err_msg.lower():
                    category = 'FOREIGN_KEY_ERROR'
                    clean_msg = "Foreign key reference error. A referenced class, section, or school could not be linked."
                elif 'violates not-null constraint' in err_msg.lower():
                    category = 'DATABASE_CONSTRAINT_ERROR'
                    clean_msg = "Database constraint violation: A required field was missing or null."
                else:
                    clean_msg = "Database constraint violation occurred during bulk import."

                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': category,
                    'detail': clean_msg,
                    'attemptedRows': len(chunk_students),
                    'createdCount': 0,
                    'skippedCount': len(chunk_students),
                    'durationMs': int((time.time() - start_time) * 1000),
                    'errors': [{'row': f'Batch {batch_number}', 'reason': clean_msg}],
                }, status=status.HTTP_400_BAD_REQUEST)
            except ValidationError as exc:
                logger.exception("Validation error during student bulk import (batch %s, job %s)", batch_number, job_id)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': 'VALIDATION_ERROR',
                    'detail': f"Validation failure: {str(exc)}",
                    'attemptedRows': len(chunk_students),
                    'createdCount': 0,
                    'skippedCount': len(chunk_students),
                    'durationMs': int((time.time() - start_time) * 1000),
                    'errors': [{'row': f'Batch {batch_number}', 'reason': str(exc)}],
                }, status=status.HTTP_400_BAD_REQUEST)
            except DatabaseError as exc:
                logger.exception("Database error during student bulk import (batch %s, job %s)", batch_number, job_id)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': 'DATABASE_ERROR',
                    'detail': "Database operation failed. The batch was rolled back cleanly.",
                    'attemptedRows': len(chunk_students),
                    'createdCount': 0,
                    'skippedCount': len(chunk_students),
                    'durationMs': int((time.time() - start_time) * 1000),
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            except Exception as exc:
                logger.exception("Unexpected exception during student bulk import (batch %s, job %s)", batch_number, job_id)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': 'INTERNAL_SERVER_ERROR',
                    'detail': 'Student import failed because of an unexpected server error. Please try again or contact support.',
                    'attemptedRows': len(chunk_students),
                    'createdCount': 0,
                    'skippedCount': len(chunk_students),
                    'durationMs': int((time.time() - start_time) * 1000),
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Record results
            total_created += len(chunk_students)
            for s_inst, meta in zip(chunk_students, chunk_creds_metadata):
                credentials_list.append({
                    'studentId': s_inst.id,
                    'name': s_inst.name,
                    'admissionNo': s_inst.admission_no,
                    'className': meta['className'],
                    'studentEmail': meta['studentEmail'],
                    'studentPassword': meta['studentPassword'],
                    'parentEmail': meta['parentEmail'],
                    'parentPassword': meta['parentPassword'],
                })
                if len(created_students) < 100:
                    created_students.append({
                        'id': s_inst.id,
                        'name': s_inst.name,
                        'admission_no': s_inst.admission_no,
                        'class_name': s_inst.class_name,
                        'section': s_inst.section,
                        'roll_no': s_inst.roll_no,
                        'academic_year': s_inst.academic_year,
                    })

        duration_ms = int((time.time() - start_time) * 1000)
        response_data = {
            'success': True,
            'jobId': job_id,
            'batchNumber': batch_number,
            'totalBatches': total_batches,
            'totalProcessed': len(raw_students),
            'createdCount': total_created,
            'skippedCount': len(errors_list),
            'durationMs': duration_ms,
            'createdStudents': created_students,
            'credentials': credentials_list[:5000] if len(credentials_list) > 5000 else credentials_list,
            'errors': errors_list,
        }

        # Cache response for idempotency
        if cache_key:
            cache.set(cache_key, response_data, timeout=3600)
        if total_created:
            invalidate_student_dependent_caches(school.id, default_academic_year)

        return Response(response_data, status=status.HTTP_201_CREATED if total_created else status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, *args, **kwargs):
        """Delete an admission and any login identities made orphaned by it."""
        student = self.get_object()
        student_profile = getattr(student, 'login_profile', None)
        student_user_id = student_profile.user_id if student_profile else None
        parent_profile_ids = list(student.parent_profiles.values_list('id', flat=True))

        with transaction.atomic():
            admission_no = student.admission_no
            school = student.school
            self.perform_destroy(student)

            # Clean up student credential vault record before deleting user (prevent SET_NULL orphan)
            try:
                from apps.accounts.models import CredentialVaultRecord
                from django.db.models import Q
                c_filter = Q(identifier=admission_no)
                if student_user_id:
                    c_filter |= Q(user_id=student_user_id)
                CredentialVaultRecord.objects.filter(school=school, role=CredentialVaultRecord.Role.STUDENT).filter(c_filter).delete()
            except Exception:
                pass

            if student_user_id:
                User.objects.filter(pk=student_user_id).delete()

            # A parent with another enrolled child keeps the same shared login.
            # Remove only identities that no longer have a student relationship.
            orphan_parent_user_ids = list(ParentProfile.objects.filter(
                pk__in=parent_profile_ids,
                students__isnull=True,
            ).values_list('user_id', flat=True))
            if orphan_parent_user_ids:
                try:
                    from apps.accounts.models import CredentialVaultRecord
                    CredentialVaultRecord.objects.filter(
                        school=school,
                        user_id__in=orphan_parent_user_ids,
                    ).delete()
                except Exception:
                    pass
                User.objects.filter(pk__in=orphan_parent_user_ids).delete()

        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'], url_path='delete-all')
    def delete_all(self, request):
        """Wipe all student data for this school tenant after verifying admin credentials."""
        user = request.user
        if not (user and user.is_authenticated and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]):
            return Response(
                {'detail': 'Only School Admins can delete student roster data.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        admin_password = (request.data.get('adminPassword') or request.data.get('password') or '').strip()
        admin_email = (request.data.get('adminEmail') or request.data.get('email') or '').strip()

        if not admin_password:
            return Response(
                {'detail': 'Admin password is required to confirm student deletion.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If admin_email is provided, verify it matches the user's email
        if admin_email and admin_email.lower() != user.email.lower():
            return Response(
                {'detail': 'Admin email does not match your currently authenticated account.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Verify password against current user
        if not user.check_password(admin_password):
            return Response(
                {'detail': 'Incorrect admin password. Deletion cancelled.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        school = user.school
        if user.role == User.Role.SUPER_ADMIN:
            school_id = request.data.get('schoolId')
            if school_id:
                from apps.schools.models import School
                school = School.objects.filter(pk=school_id).first()
            elif not school:
                from apps.schools.models import School
                school = School.objects.first()

        if not school:
            return Response({'detail': 'A valid school tenant is required.'}, status=status.HTTP_400_BAD_REQUEST)

        students_qs = Student.objects.filter(school=school)
        deleted_count = students_qs.count()

        with transaction.atomic():
            # 1. Clean up student & parent credential vault records FIRST
            try:
                from apps.accounts.models import CredentialVaultRecord
                CredentialVaultRecord.objects.filter(
                    school=school,
                    role__in=[CredentialVaultRecord.Role.STUDENT, CredentialVaultRecord.Role.PARENT],
                ).delete()
            except Exception:
                pass

            # 2. Identify all student user accounts
            student_user_ids = list(
                StudentProfile.objects.filter(student__school=school).values_list('user_id', flat=True)
            )

            # 3. Identify parent profiles linked to this school's students
            parent_profile_ids = list(
                ParentProfile.objects.filter(user__school=school).values_list('id', flat=True)
            )

            # 4. Delete all students for this school (cascades to documents, history, fees, attendance, results, etc.)
            for s in students_qs:
                s.delete()

            # 5. Delete student User accounts
            if student_user_ids:
                User.objects.filter(pk__in=student_user_ids).delete()

            # 6. Remove orphan parent users that no longer have any student linked
            orphan_parent_user_ids = list(
                ParentProfile.objects.filter(
                    pk__in=parent_profile_ids,
                    students__isnull=True,
                ).values_list('user_id', flat=True)
            )
            if orphan_parent_user_ids:
                User.objects.filter(pk__in=orphan_parent_user_ids).delete()

        if school and school.id:
            invalidate_student_dependent_caches(school.id)

        return Response({
            'success': True,
            'deletedCount': deleted_count,
            'message': f'Successfully wiped {deleted_count} student records, credentials, and associated data.',
        })



class StudentDocumentDownloadView(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]
    authentication_classes = [CachedJWTAuthentication, SessionAuthentication]

    def _get_student_id(self, request, student_id):
        if not student_id or str(student_id).lower() == 'me' or (request.user.role == User.Role.STUDENT and str(student_id) == '0'):
            if hasattr(request.user, 'student_profile') and request.user.student_profile:
                return request.user.student_profile.student_id
        return student_id

    @extend_schema(responses={
        200: OpenApiResponse(response=OpenApiTypes.BINARY, description='Authorized student document download'),
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def retrieve(self, request, student_id=None, doc_id=None):
        resolved_student_id = self._get_student_id(request, student_id)
        query = StudentDocument.objects.select_related('student')
        if doc_id:
            query = query.filter(pk=doc_id)
        if resolved_student_id and str(resolved_student_id).lower() != 'me':
            query = query.filter(student_id=resolved_student_id)
        document = query.first()
        if not document:
            raise Http404
        student, user = document.student, request.user
        if user.role == User.Role.SUPER_ADMIN:
            return Response({'detail': 'Super Admins cannot access student documents.'}, status=status.HTTP_403_FORBIDDEN)
        if str(user.school_id or '') != str(student.school_id or ''):
            raise Http404
        allowed = user.role == User.Role.SCHOOL_ADMIN
        # Staff documents contain identity/banking material and are not part of
        # the teacher classroom read scope. Only the school admin, linked
        # parent, or the student themself may download them.
        if user.role == User.Role.PARENT:
            allowed = hasattr(user, 'parent_profile') and user.parent_profile.students.filter(pk=student.pk).exists()
        elif user.role == User.Role.STUDENT:
            allowed = hasattr(user, 'student_profile') and user.student_profile.student_id == student.pk
        if not allowed:
            raise Http404

        as_attachment = request.query_params.get('inline') != '1' and request.query_params.get('view') != '1'
        from apps.common.storage import open_file, file_exists
        if document.file_key and file_exists(document.file_key):
            try:
                handle = open_file(document.file_key)
                response = FileResponse(
                    handle,
                    as_attachment=as_attachment,
                    filename=document.file_name or document.name,
                    content_type=document.file_content_type or 'application/octet-stream',
                )
                response['Cache-Control'] = 'private, no-store'
                response['X-Content-Type-Options'] = 'nosniff'
                response['X-Frame-Options'] = 'SAMEORIGIN'
                response['Access-Control-Expose-Headers'] = 'Content-Disposition, Content-Type, Content-Length'
                return response
            except Exception:
                pass
        if not document.file_data:
            raise Http404
        response = FileResponse(
            BytesIO(bytes(document.file_data)),
            as_attachment=as_attachment,
            filename=document.file_name or document.name,
            content_type=document.file_content_type or 'application/octet-stream',
        )
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        response['X-Frame-Options'] = 'SAMEORIGIN'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition, Content-Type, Content-Length'
        return response

    @extend_schema(request=DocumentSerializer, responses={
        200: DocumentSerializer,
        400: OpenApiResponse(description='Bad request'),
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def partial_update(self, request, student_id=None, doc_id=None):
        if request.user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'Only school administrators can verify or reject student documents.'}, status=status.HTTP_403_FORBIDDEN)
        resolved_student_id = self._get_student_id(request, student_id)
        query = StudentDocument.objects.select_related('student').filter(pk=doc_id)
        if resolved_student_id and str(resolved_student_id).lower() != 'me':
            query = query.filter(student_id=resolved_student_id)
        document = query.first()
        if not document or str(document.student.school_id or '') != str(request.user.school_id or ''):
            raise Http404
        new_status = request.data.get('status')
        if new_status in [StudentDocument.Status.VERIFIED, StudentDocument.Status.REJECTED, StudentDocument.Status.PENDING]:
            document.status = new_status
            if 'remarks' in request.data:
                document.remarks = str(request.data.get('remarks', '') or '')[:255]
            if new_status in [StudentDocument.Status.VERIFIED, StudentDocument.Status.REJECTED]:
                document.verified_at = timezone.now()
                document.verified_by = request.user
            else:
                document.verified_at = None
                document.verified_by = None
            document.save()
            return Response(DocumentSerializer(document, context={'request': request}).data)
        return Response({'detail': 'Invalid status. Choose Verified, Rejected, or Pending.'}, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(request=None, responses={
        204: None,
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def destroy(self, request, student_id=None, doc_id=None):
        resolved_student_id = self._get_student_id(request, student_id)
        query = StudentDocument.objects.select_related('student').filter(
            pk=doc_id, student__school_id=request.user.school_id
        )
        if resolved_student_id and str(resolved_student_id).lower() != 'me':
            query = query.filter(student_id=resolved_student_id)
        document = query.first()
        if not document:
            raise Http404
        allowed = (request.user.role == User.Role.SCHOOL_ADMIN) or (
            request.user.role == User.Role.STUDENT and hasattr(request.user, 'student_profile')
            and request.user.student_profile.student_id == document.student_id
            and document.status in [StudentDocument.Status.PENDING, StudentDocument.Status.REJECTED]
        )
        if not allowed:
            return Response({'detail': 'You do not have permission to delete this document.'}, status=status.HTTP_403_FORBIDDEN)
        if document.file_key:
            from apps.common.storage import delete_file
            delete_file(document.file_key)
        document.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StudentDocumentCollectionView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'credential_management'

    def _get_student_id(self, request, student_id):
        if not student_id or str(student_id).lower() == 'me' or (request.user.role == User.Role.STUDENT and str(student_id) == '0'):
            if hasattr(request.user, 'student_profile') and request.user.student_profile:
                return request.user.student_profile.student_id
        return student_id

    @extend_schema(responses={200: DocumentSerializer(many=True), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')})
    def get(self, request, student_id=None):
        resolved_student_id = self._get_student_id(request, student_id)
        student = Student.objects.filter(pk=resolved_student_id, school_id=request.user.school_id).first()
        if not student:
            raise Http404
        allowed = request.user.role == User.Role.SCHOOL_ADMIN or (
            request.user.role == User.Role.STUDENT and hasattr(request.user, 'student_profile') and request.user.student_profile.student_id == student.pk
        ) or (
            request.user.role == User.Role.PARENT and hasattr(request.user, 'parent_profile') and request.user.parent_profile.students.filter(pk=student.pk).exists()
        )
        if request.user.role == User.Role.TEACHER:
            teacher = getattr(request.user, 'teacher_profile', None)
            allowed = teacher_can_access_student(teacher, student, school_id=request.user.school_id)
        if not allowed:
            return Response({'detail': 'You do not have permission to view documents for this student.'}, status=status.HTTP_403_FORBIDDEN)
        documents = student.documents.defer('file_data').all()
        return Response(DocumentSerializer(documents, many=True, context={'request': request}).data)

    @extend_schema(request=StudentDocumentUploadSerializer, responses={201: DocumentSerializer, 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')})
    def post(self, request, student_id=None):
        resolved_student_id = self._get_student_id(request, student_id)
        student = Student.objects.filter(pk=resolved_student_id, school_id=request.user.school_id).first()
        if not student:
            raise Http404
        allowed = (request.user.role == User.Role.SCHOOL_ADMIN) or (
            request.user.role == User.Role.STUDENT and hasattr(request.user, 'student_profile') and request.user.student_profile.student_id == student.pk
        )
        if not allowed:
            return Response({'detail': 'You do not have permission to upload documents for this student.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = StudentDocumentUploadSerializer(data=request.data, context={'student': student})
        serializer.is_valid(raise_exception=True)
        document = serializer.save()
        return Response(DocumentSerializer(document, context={'request': request}).data, status=status.HTTP_201_CREATED)


class SchoolDocumentQueueView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: OpenApiResponse(description='All student and teacher documents for the school')})
    def get(self, request):
        user = request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can access document verification queues.'}, status=status.HTTP_403_FORBIDDEN)

        school_id = request.user.school_id
        if not school_id and user.role == User.Role.SUPER_ADMIN:
            school_id = request.query_params.get('school_id')
        if not school_id:
            return Response({'detail': 'A school context is required.'}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Fetch Student Documents
        student_docs_qs = StudentDocument.objects.filter(
            student__school_id=school_id
        ).select_related('student', 'verified_by').order_by('-created_at')

        # 2. Fetch Teacher Documents
        from apps.staff.models import TeacherDocument
        teacher_docs_qs = TeacherDocument.objects.filter(
            teacher__school_id=school_id
        ).select_related('teacher', 'teacher__user', 'verified_by').order_by('-created_at')

        student_list = []
        for d in student_docs_qs:
            student_list.append({
                'id': d.id,
                'docType': 'student',
                'studentId': d.student_id,
                'studentName': d.student.name if d.student else 'Student',
                'admissionNo': d.student.admission_no or '' if d.student else '',
                'className': d.student.class_name or '' if d.student else '',
                'sectionName': d.student.section or '' if d.student else '',
                'name': d.name,
                'category': d.category,
                'status': d.status,
                'remarks': d.remarks or '',
                'fileType': d.file_type or 'PDF',
                'fileName': d.file_name or '',
                'uploadedAt': d.created_at.isoformat() if d.created_at else None,
                'verifiedAt': d.verified_at.isoformat() if d.verified_at else None,
                'verifiedByName': (d.verified_by.get_full_name() or d.verified_by.username) if d.verified_by else None,
                'downloadUrl': f'/api/v1/students/{d.student_id}/documents/{d.id}/',
            })

        teacher_list = []
        for d in teacher_docs_qs:
            t_user = d.teacher.user if d.teacher else None
            t_name = f"{t_user.first_name or ''} {t_user.last_name or ''}".strip() if t_user else 'Teacher'
            if not t_name and t_user:
                t_name = t_user.username
            teacher_list.append({
                'id': d.id,
                'docType': 'teacher',
                'teacherId': d.teacher_id,
                'teacherName': t_name or 'Teacher',
                'qualification': d.teacher.qualification or '' if d.teacher else '',
                'department': getattr(d.teacher, 'department', '') or '',
                'name': d.name,
                'category': d.category,
                'status': d.status,
                'remarks': d.remarks or '',
                'fileType': d.file_type or 'PDF',
                'fileName': d.file_name or '',
                'uploadedAt': d.created_at.isoformat() if d.created_at else None,
                'verifiedAt': d.verified_at.isoformat() if d.verified_at else None,
                'verifiedByName': (d.verified_by.get_full_name() or d.verified_by.username) if d.verified_by else None,
                'downloadUrl': f'/api/v1/teachers/{d.teacher_id}/documents/{d.id}/',
            })

        all_docs = student_list + teacher_list
        all_docs.sort(key=lambda x: x.get('uploadedAt') or '', reverse=True)

        pending_count = sum(1 for d in all_docs if d['status'] == 'Pending')
        verified_count = sum(1 for d in all_docs if d['status'] == 'Verified')
        rejected_count = sum(1 for d in all_docs if d['status'] == 'Rejected')

        return Response({
            'documents': all_docs,
            'studentDocuments': student_list,
            'teacherDocuments': teacher_list,
            'summary': {
                'totalDocs': len(all_docs),
                'totalPending': pending_count,
                'totalVerified': verified_count,
                'totalRejected': rejected_count,
                'totalStudentDocs': len(student_list),
                'totalTeacherDocs': len(teacher_list),
            }
        })


class EnrollmentLinkViewSet(TenantScopedViewSet):
    serializer_class = EnrollmentLinkSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = EnrollmentLink.objects.select_related('school', 'created_by').order_by('-created_at')

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return EnrollmentLink.objects.none()
        return super().get_queryset()

    def create(self, request, *args, **kwargs):
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can generate self-enrollment links.'}, status=status.HTTP_403_FORBIDDEN)
        school = request.user.school
        if not school:
            return Response({'detail': 'A school tenant is required.'}, status=status.HTTP_400_BAD_REQUEST)

        target_class = str(request.data.get('targetClass') or request.data.get('target_class') or '').strip()
        academic_year = str(request.data.get('academicYear') or request.data.get('academic_year') or '').strip()
        if not academic_year:
            from apps.academics.models import AcademicYear
            ay_obj = AcademicYear.objects.filter(school=school, is_active=True).first()
            academic_year = ay_obj.name if ay_obj else '2026-2027'

        title = str(request.data.get('title') or (f'Class {target_class} Self-Enrollment Link' if target_class else 'School Admission Link')).strip()
        duration_minutes = int(request.data.get('durationMinutes') or request.data.get('duration_minutes') or 1440)

        # Generate unique secure token
        token = secrets.token_urlsafe(16)

        link = EnrollmentLink.objects.create(
            school=school,
            token=token,
            title=title,
            target_class=target_class,
            academic_year=academic_year,
            duration_minutes=duration_minutes,
            created_by=request.user,
        )

        serializer = self.get_serializer(link)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='deactivate')
    def deactivate(self, request, pk=None):
        link = self.get_object()
        link.is_active = False
        link.save(update_fields=['is_active'])
        return Response(self.get_serializer(link).data)


class VerifyEnrollmentLinkView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'enrollment_apply'

    @extend_schema(responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT})
    def get(self, request):
        token = request.query_params.get('token', '').strip()
        if not token:
            return Response({'detail': 'Enrollment link token is required.'}, status=status.HTTP_400_BAD_REQUEST)

        link = EnrollmentLink.objects.select_related('school').filter(token=token, is_active=True).first()
        if not link:
            return Response({'detail': 'Invalid or expired enrollment link.'}, status=status.HTTP_404_NOT_FOUND)

        # 24-hour validation window starts when user first opens the link
        if not link.first_opened_at:
            link.first_opened_at = timezone.now()
            link.save(update_fields=['first_opened_at'])

        if link.is_expired():
            return Response({
                'detail': 'This enrollment link has expired. The 24-hour submission window has elapsed.',
                'isExpired': True,
                'remainingSeconds': 0,
            }, status=status.HTTP_400_BAD_REQUEST)

        from apps.academics.models import Class as AcadClass
        available_classes = list(
            AcadClass.objects.filter(school=link.school).order_by('sort_order', 'name').values_list('name', flat=True)
        )
        if not available_classes:
            available_classes = [f'Class {i}' for i in range(1, 13)]

        return Response({
            'valid': True,
            'token': link.token,
            'title': link.title,
            'schoolName': link.school.name,
            'schoolCode': link.school.code,
            'targetClass': link.target_class,
            'academicYear': link.academic_year,
            'durationMinutes': link.duration_minutes,
            'remainingSeconds': link.remaining_seconds(),
            'firstOpenedAt': link.first_opened_at,
            'availableClasses': available_classes,
            'availableSections': ['A', 'B', 'C', 'D'],
        })


class SubmitEnrollmentApplicationView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'enrollment_apply'
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={201: EnrollmentApplicationSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT})
    def post(self, request):
        token = str(request.data.get('token', '')).strip()
        if not token:
            return Response({'detail': 'Link token is required.'}, status=status.HTTP_400_BAD_REQUEST)

        link = EnrollmentLink.objects.select_related('school').filter(token=token, is_active=True).first()
        if not link:
            return Response({'detail': 'Invalid or inactive enrollment link.'}, status=status.HTTP_404_NOT_FOUND)

        if not link.first_opened_at:
            link.first_opened_at = timezone.now()
            link.save(update_fields=['first_opened_at'])

        if link.is_expired():
            return Response({
                'detail': 'This enrollment link has expired. The 24-hour submission window has elapsed.',
                'isExpired': True,
                'remainingSeconds': 0,
            }, status=status.HTTP_400_BAD_REQUEST)

        data = request.data
        name = str(data.get('name', '')).strip()
        class_name = str(data.get('className') or data.get('class_name') or link.target_class or '').strip()
        section = str(data.get('section', 'A')).strip() or 'A'
        dob = str(data.get('dob', '')).strip()
        gender = str(data.get('gender', 'Male')).strip()
        blood_group = str(data.get('bloodGroup') or data.get('blood_group') or '').strip()
        parent_name = str(data.get('parentName') or data.get('parent_name') or '').strip()
        parent_phone = str(data.get('parentPhone') or data.get('parent_phone') or '').strip()
        parent_email = str(data.get('parentEmail') or data.get('parent_email') or '').strip()
        address = str(data.get('address', '')).strip()
        aadhaar_no = str(data.get('aadhaarNo') or data.get('aadhaar_no') or '').strip()
        medical_conditions = str(data.get('medicalConditions') or data.get('medical_conditions') or '').strip()

        if not (name and class_name and dob and parent_name and parent_phone and parent_email):
            return Response({
                'detail': 'Please provide all mandatory fields: Student Name, Class, Date of Birth, Parent Name, Parent Phone, and Parent Email.'
            }, status=status.HTTP_400_BAD_REQUEST)

        field_limits = {
            'Student Name': (name, 160),
            'Class': (class_name, 40),
            'Section': (section, 40),
            'Gender': (gender, 32),
            'Blood Group': (blood_group, 16),
            'Parent Name': (parent_name, 160),
            'Parent Phone': (parent_phone, 30),
            'Parent Email': (parent_email, 254),
            'Aadhaar Number': (aadhaar_no, 32),
        }
        for label, (value, maximum) in field_limits.items():
            if len(value) > maximum:
                return Response(
                    {'detail': f'{label} must be {maximum} characters or fewer.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        if parse_date(dob) is None:
            return Response({'detail': 'Enter a valid date of birth.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(parent_email)
        except DjangoValidationError:
            return Response({'detail': 'Enter a valid parent email address.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.common.storage import (
            delete_file,
            save_file,
            enrollment_photo_key,
            enrollment_document_key,
        )

        photo_file = request.FILES.get('photo')
        doc_file = request.FILES.get('document')
        try:
            if photo_file:
                validate_enrollment_photo(photo_file)
            if doc_file:
                validate_enrollment_document(doc_file)
        except DjangoValidationError as exc:
            return Response({'detail': exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        photo_data = None
        photo_key = ''
        photo_content_type = ''
        document_data = None
        document_key = ''
        document_size = 0
        document_name = ''
        document_content_type = ''
        if photo_file:
            try:
                photo_data, photo_content_type, _ = optimize_raster_image(photo_file)
            except DjangoValidationError as exc:
                return Response({'detail': exc.messages}, status=status.HTTP_400_BAD_REQUEST)
        document_category = str(request.data.get('documentCategory') or request.data.get('document_category') or 'Birth Certificate').strip()
        if len(document_category) > 64:
            return Response({'detail': 'Document category must be 64 characters or fewer.'}, status=status.HTTP_400_BAD_REQUEST)
        if doc_file:
            doc_bytes = doc_file.read()
            document_size = len(doc_bytes)
            document_name = sanitize_filename(doc_file.name)[:255]
            document_content_type = detected_content_type(doc_file)
            document_data = doc_bytes

        storage_id = secrets.token_hex(16)
        try:
            if photo_data:
                photo_key = save_file(photo_data, enrollment_photo_key(link.school_id, storage_id))
            if document_data:
                document_key = save_file(
                    document_data,
                    enrollment_document_key(link.school_id, storage_id, document_name),
                )
        except Exception:
            if photo_key:
                delete_file(photo_key)
            if document_key:
                delete_file(document_key)
            logger.exception('Enrollment attachment storage failed (school %s)', link.school_id)
            return Response(
                {'detail': 'We could not save the uploaded files. Please retry without attachments or contact the school.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        application = None
        login_id = ''
        plaintext_password = ''
        try:
            # Anonymous submissions have no middleware-selected tenant. Apply the
            # trusted tenant from the validated one-time enrollment token.
            with tenant_rls_context(link.school_id):
                for attempt in range(5):
                    app_no = f'APP-{timezone.now().year}-{secrets.randbelow(89999) + 10000}'
                    login_id = generate_login_id(name[:40].split()[0], User.Role.STUDENT, link.school)
                    plaintext_password = generate_password(name, User.Role.STUDENT)
                    try:
                        with transaction.atomic():
                            user = User(
                                username=login_id,
                                email=login_id,
                                first_name=name[:150],
                                role=User.Role.STUDENT,
                                school=link.school,
                                is_active=False,
                                must_change_password=True,
                            )
                            user.set_password(plaintext_password)
                            user.save()

                            application = EnrollmentApplication.objects.create(
                                school=link.school,
                                link=link,
                                application_no=app_no,
                                name=name,
                                class_name=class_name,
                                section=section,
                                dob=parse_date(dob),
                                gender=gender,
                                blood_group=blood_group,
                                parent_name=parent_name,
                                parent_phone=parent_phone,
                                parent_email=parent_email,
                                address=address,
                                aadhaar_no=aadhaar_no,
                                medical_conditions=medical_conditions,
                                photo_key=photo_key,
                                photo_data=photo_data,
                                photo_content_type=photo_content_type,
                                document_key=document_key,
                                document_size=document_size,
                                document_data=document_data,
                                document_name=document_name,
                                document_content_type=document_content_type,
                                document_category=document_category,
                                academic_year=link.academic_year,
                                user=user,
                                provisional_username=login_id.split('@')[0],
                                provisional_email=login_id,
                                status=EnrollmentApplication.Status.PENDING,
                            )
                        break
                    except IntegrityError:
                        if attempt == 4:
                            raise
                        # A simultaneous submission may have claimed the same
                        # generated login ID or application number.
                        continue
        except Exception as exc:
            if photo_key:
                delete_file(photo_key)
            if document_key:
                delete_file(document_key)
            reference = secrets.token_hex(6)
            logger.exception('Enrollment application creation failed (school %s, ref %s)', link.school_id, reference)
            if isinstance(exc, IntegrityError):
                return Response(
                    {'detail': f'We could not reserve unique enrollment credentials. Please retry. Reference: {reference}'},
                    status=status.HTTP_409_CONFLICT,
                )
            return Response(
                {'detail': f'Enrollment could not be saved due to a server problem. Please retry or contact the school. Reference: {reference}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        schedule_enrollment_sync(link.school_id, 'created', application.pk)

        # Notify school admin of new admission application
        try:
            from apps.notifications.services import notify_school_admins
            notify_school_admins(
                link.school,
                title="New Online Admission Application",
                body=f"New admission application {application.application_no} submitted for {application.name} (Class {application.class_name}).",
                category="Admissions",
                channel="admissions",
                related={'applicationNo': application.application_no, 'studentName': application.name},
            )
        except Exception:
            pass

        return Response({
            'success': True,
            'message': 'Student admission form submitted successfully! Please save your provisional portal credentials below.',
            'applicationNo': application.application_no,
            'studentName': application.name,
            'className': application.class_name,
            'section': application.section,
            'academicYear': application.academic_year,
            'credentials': {
                'username': login_id.split('@')[0],
                'loginId': login_id,
                'temporaryPassword': plaintext_password,
                'mustChangePassword': True,
                'status': 'Pending Admin Approval',
                'activationNotice': 'Your credentials have been securely generated and will be activated as soon as the School Admin approves your application.',
            }
        }, status=status.HTTP_201_CREATED)


class EnrollmentApplicationPermission(permissions.BasePermission):
    """Enrollment PII and lifecycle actions are restricted to administrators."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
            and getattr(view, 'action', None) not in {
                'create', 'update', 'partial_update', 'destroy',
            }
        )


class EnrollmentApplicationViewSet(TenantScopedViewSet):
    serializer_class = EnrollmentApplicationSerializer
    permission_classes = [EnrollmentApplicationPermission]
    queryset = EnrollmentApplication.objects.defer(
        'photo_data', 'document_data'
    ).select_related('school', 'link', 'user', 'approved_by', 'created_student').order_by('-submitted_at')
    filterset_fields = ['status', 'class_name', 'academic_year']
    search_fields = ['name', 'application_no', 'parent_name', 'parent_phone']

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return EnrollmentApplication.objects.none()
        return super().get_queryset()

    @action(detail=True, methods=['get'], url_path='photo')
    def photo(self, request, pk=None):
        app = self.get_object()
        from apps.common.storage import open_file, file_exists
        if app.photo_key and file_exists(app.photo_key):
            try:
                handle = open_file(app.photo_key)
                response = FileResponse(handle, content_type=app.photo_content_type or 'image/jpeg')
                response['Cache-Control'] = 'private, max-age=300'
                response['Access-Control-Expose-Headers'] = 'Content-Type'
                return response
            except Exception:
                pass
        if not app.photo_data:
            raise Http404('No photo found for this application.')
        response = HttpResponse(bytes(app.photo_data), content_type=app.photo_content_type or 'image/jpeg')
        response['Cache-Control'] = 'private, max-age=300'
        response['Access-Control-Expose-Headers'] = 'Content-Type'
        return response

    @action(detail=True, methods=['get'], url_path='document')
    def document(self, request, pk=None):
        app = self.get_object()
        from apps.common.storage import open_file, file_exists
        is_download = request.query_params.get('download') in ['1', 'true']
        disp = 'attachment' if is_download else 'inline'
        filename = app.document_name or "document"
        if app.document_key and file_exists(app.document_key):
            try:
                handle = open_file(app.document_key)
                response = FileResponse(
                    handle,
                    content_type=app.document_content_type or 'application/octet-stream',
                )
                response['Content-Disposition'] = f'{disp}; filename="{filename}"'
                response['Cache-Control'] = 'private, max-age=300'
                response['Access-Control-Expose-Headers'] = 'Content-Disposition, Content-Type'
                return response
            except Exception:
                pass
        if not app.document_data:
            raise Http404('No document found for this application.')
        response = HttpResponse(
            bytes(app.document_data),
            content_type=app.document_content_type or 'application/octet-stream',
        )
        response['Content-Disposition'] = f'{disp}; filename="{filename}"'
        response['Cache-Control'] = 'private, max-age=300'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition, Content-Type'
        return response

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can approve student enrollments.'}, status=status.HTTP_403_FORBIDDEN)

        app = self.get_object()
        if app.status == EnrollmentApplication.Status.APPROVED:
            return Response({'detail': 'This application has already been approved.'}, status=status.HTTP_400_BAD_REQUEST)

        # The application is already tenant-scoped by get_queryset for School
        # Admins. Use its school as the source of truth so platform admins
        # cannot accidentally create a school-less student.
        school = app.school
        target_class = str(request.data.get('className') or request.data.get('class_name') or app.class_name).strip()
        target_section = str(request.data.get('section') or app.section or 'A').strip()
        requested_admission_no = str(request.data.get('admissionNo') or request.data.get('admission_no') or '').strip()

        with transaction.atomic():
            if not requested_admission_no:
                proposed = f'ADM-{target_class.replace(" ", "")}-101'
                admission_no = next_available_admission_no(school=school, academic_year=app.academic_year, proposed=proposed)
            else:
                admission_no = requested_admission_no

            from apps.academics.models import Section as AcadSection
            sec_record = AcadSection.objects.filter(
                school=school,
                class_room__name__iexact=target_class,
                name__iexact=target_section,
            ).first() or AcadSection.objects.filter(
                school=school,
                class_room__name__iexact=target_class,
            ).first()

            highest_roll = Student.objects.filter(
                school=school,
                class_name=target_class,
                section=target_section,
                academic_year=app.academic_year,
            ).order_by('-roll_no').values_list('roll_no', flat=True).first() or 0
            roll_no = int(request.data.get('rollNo') or request.data.get('roll_no') or (highest_roll + 1))

            student = Student.objects.create(
                school=school,
                admission_no=admission_no,
                name=app.name,
                photo_key=app.photo_key,
                photo_data=app.photo_data,
                photo_content_type=app.photo_content_type,
                class_name=target_class,
                section=target_section,
                section_record=sec_record,
                roll_no=roll_no,
                parent_name=app.parent_name,
                parent_phone=app.parent_phone,
                parent_email=app.parent_email,
                dob=app.dob,
                gender=app.gender,
                address=app.address,
                medical_conditions=app.medical_conditions,
                status=Student.Status.ACTIVE,
                academic_year=app.academic_year,
                attendance_percentage=100.0,
                fee_total=0.0,
                fee_paid=0.0,
            )

            # Activate student user
            if app.user:
                user = app.user
                user.is_active = True
                user.save(update_fields=['is_active'])
                from apps.accounts.models import StudentProfile
                StudentProfile.objects.create(user=user, student=student)
            else:
                create_student_login(student)

            create_or_link_parent_login(student)

            from apps.finance.views import resolve_fee_structure_for_student, get_student_fee_summary
            from apps.finance.models import StudentFeeRecord
            structure = resolve_fee_structure_for_student(student, academic_year=app.academic_year)
            custom_items = (structure.items or []) if structure else []
            custom_quarters = (structure.quarters or []) if structure else []

            StudentFeeRecord.objects.create(
                school=school,
                student=student,
                student_id_str=str(student.id),
                student_name=student.name,
                admission_no=student.admission_no,
                class_name=student.class_name,
                section_name=student.section,
                academic_year=student.academic_year,
                scholarship=0,
                discount=0,
                transport_charges=0,
                hostel_charges=0,
                fine_amount=0,
                installments_paid=0,
                custom_items=custom_items,
                custom_quarters=custom_quarters,
                payment_history=[],
            )
            fee_sum = get_student_fee_summary(student, academic_year=app.academic_year)
            if fee_sum:
                student.fee_total = float(fee_sum.get('totalFees', 0) or 0)
                student.fee_paid = float(fee_sum.get('totalPaid', 0) or 0)
                student.save(update_fields=['fee_total', 'fee_paid'])

            app.status = EnrollmentApplication.Status.APPROVED
            app.approved_at = timezone.now()
            app.approved_by = request.user
            app.created_student = student
            app.save()

            schedule_enrollment_sync(school.pk, 'updated', app.pk)

            if app.document_data or app.document_key:
                StudentDocument.objects.create(
                    student=student,
                    name=app.document_name or f'{app.document_category or "Admission Document"} - {student.name}',
                    category=app.document_category or 'Birth Certificate',
                    file_key=app.document_key,
                    file_size=app.document_size or (len(app.document_data) if app.document_data else 0),
                    file_data=app.document_data,
                    file_content_type=app.document_content_type or 'application/pdf',
                    file_name=app.document_name or 'document.pdf',
                    status=StudentDocument.Status.VERIFIED,
                    file_type=(app.document_name.split('.')[-1].upper() if '.' in app.document_name else 'PDF')[:12],
                    remarks='Uploaded by Parent during Online Admission',
                    verified_at=timezone.now(),
                    verified_by=request.user,
                )

        # Notify parent and student of confirmed admission approval
        try:
            from apps.notifications.services import notify_student_and_parents, notify_school_admins
            notify_student_and_parents(
                student,
                title=f"Admission Approved: {student.name}",
                body=f"Congratulations! Admission for {student.name} is approved into Class {student.class_name}-{student.section}. Admission No: {student.admission_no}.",
                category="Admissions",
                channel="admissions",
                sender=request.user,
                related={'studentId': student.id, 'admissionNo': student.admission_no, 'applicationNo': app.application_no},
            )
            notify_school_admins(
                school,
                title="Admission Approved",
                body=f"Application {app.application_no} approved for {student.name} ({student.class_name}-{student.section}).",
                category="Admissions",
                channel="admissions",
                sender=request.user,
                related={'studentId': student.id, 'applicationNo': app.application_no},
            )
        except Exception:
            pass

        student_data = StudentSerializer(student, context={'request': request}).data
        return Response({
            'message': f'Approved and enrolled {student.name} into {student.class_name}-{student.section}. Student credentials activated and fees invoice initialized.',
            'student': student_data,
            'application': self.get_serializer(app).data,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can reject applications.'}, status=status.HTTP_403_FORBIDDEN)

        app = self.get_object()
        app.status = EnrollmentApplication.Status.REJECTED
        app.rejection_remarks = str(request.data.get('remarks', '')).strip()
        app.save(update_fields=['status', 'rejection_remarks'])
        schedule_enrollment_sync(app.school_id, 'updated', app.pk)

        if app.user and not app.created_student:
            app.user.delete()
            app.user = None
            app.save(update_fields=['user'])

        return Response(self.get_serializer(app).data)


