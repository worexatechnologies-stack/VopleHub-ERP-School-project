import logging
from io import BytesIO

from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q, Sum

logger = logging.getLogger(__name__)
from django.db.models import Prefetch
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import OpenApiResponse, OpenApiTypes, extend_schema

from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet
from apps.common.pagination import AdminListPagination
from apps.common.fast_cache import fast_cache_response, bump_cache_version
from apps.common.import_queue import CanManageSchoolImports, import_status_key, queue_import_batch

from .models import Teacher, TeacherDocument, TeacherTeachingAssignment, StaffSalaryPayment
from .serializers import (
    TeacherCreateSerializer,
    TeacherDocumentSerializer,
    TeacherDocumentUploadSerializer,
    TeacherSerializer,
    TeacherTeachingAssignmentSerializer,
    StaffSalaryPaymentSerializer,
    StaffSalaryPaymentCreateSerializer,
)
from .services import create_teacher_with_login


class TeacherPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.role == User.Role.SUPER_ADMIN:
            return False
        if request.method not in permissions.SAFE_METHODS:
            return request.user.role == User.Role.SCHOOL_ADMIN
        return request.user.role in [
            User.Role.SCHOOL_ADMIN,
            User.Role.TEACHER,
            User.Role.PARENT,
            User.Role.STUDENT,
        ]

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if str(obj.school_id or '') != str(user.school_id or ''):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return user.role == User.Role.SCHOOL_ADMIN

class TeacherViewSet(TenantScopedViewSet):
    permission_classes = [TeacherPermission]
    pagination_class = AdminListPagination
    serializer_class = TeacherSerializer
    queryset = Teacher.objects.defer(
        'photo_data'
    ).select_related(
        'user', 'school'
    ).prefetch_related(
        Prefetch('documents', queryset=TeacherDocument.objects.defer('file_data')),
        Prefetch(
            'teaching_assignments',
            queryset=TeacherTeachingAssignment.objects.select_related('section__class_room', 'subject'),
        ),
        'sections__class_room',
        'subject_records',
    )
    filterset_fields = ['status']
    search_fields = ['user__first_name', 'user__last_name', 'user__email', 'phone', 'qualification']
    ordering_fields = ['id', 'user__first_name', 'joining_date']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Teacher.objects.none()
        user = self.request.user
        if not user.is_authenticated:
            return Teacher.objects.none()
        qs = super().get_queryset()
        if user.role == User.Role.TEACHER:
            return qs.filter(user=user)
        if user.role == User.Role.PARENT:
            parent_profile = getattr(user, 'parent_profile', None)
            if parent_profile:
                linked_students = parent_profile.students.filter(school=user.school, status='Active')
                section_ids = [s.section_record_id for s in linked_students if s.section_record_id]
                section_names = [s.section for s in linked_students if s.section]
                class_names = [s.class_name for s in linked_students if s.class_name]
                from django.db.models import Q
                return qs.filter(
                    Q(teaching_assignments__section_id__in=section_ids) |
                    Q(sections__id__in=section_ids) |
                    Q(teaching_assignments__section__name__in=section_names, teaching_assignments__section__class_room__name__in=class_names) |
                    Q(sections__name__in=section_names, sections__class_room__name__in=class_names)
                ).distinct()
        if user.role == User.Role.STUDENT:
            student_profile = getattr(user, 'student_profile', None)
            student = getattr(student_profile, 'student', None) if student_profile else None
            if student:
                section_id = getattr(student, 'section_record_id', None)
                section_name = getattr(student, 'section', None)
                class_name = getattr(student, 'class_name', None)
                from django.db.models import Q
                filters = Q()
                if section_id:
                    filters |= Q(teaching_assignments__section_id=section_id) | Q(sections__id=section_id)
                if section_name and class_name:
                    filters |= (
                        Q(teaching_assignments__section__name=section_name, teaching_assignments__section__class_room__name=class_name) |
                        Q(sections__name=section_name, sections__class_room__name=class_name)
                    )
                return qs.filter(filters).distinct() if filters else qs
            return qs
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return qs
        return qs.none()

    @fast_cache_response(namespace='teachers', timeout=60)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @fast_cache_response(namespace='teachers', timeout=60)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @action(detail=False, methods=['get'], url_path='stats')
    @fast_cache_response(namespace='teachers', timeout=60)
    def stats(self, request):
        qs = self.filter_queryset(self.get_queryset())
        from django.db.models import Count, Q
        aggregates = qs.aggregate(
            total_teachers=Count('id'),
            active_teachers=Count('id', filter=Q(status=Teacher.Status.ACTIVE)),
        )
        return Response({
            'totalTeachers': aggregates['total_teachers'] or 0,
            'activeTeachers': aggregates['active_teachers'] or 0,
        })

    @staticmethod
    def _normalized_request_data(request):
        import json as json_lib
        if hasattr(request.data, 'dict'):
            data = request.data.dict()
        else:
            data = dict(request.data)

        if 'photo' in request.FILES:
            data['photo'] = request.FILES['photo']

        for list_field in ['subjectIds', 'assignedSections', 'assignedSectionIds', 'teachingAssignments', 'managedClassIds', 'managedSectionIds']:
            if list_field not in data:
                continue
            value = data.get(list_field)
            if isinstance(value, str):
                try:
                    data[list_field] = json_lib.loads(value)
                except (json_lib.JSONDecodeError, TypeError):
                    data[list_field] = [v.strip() for v in value.split(',') if v.strip()]
            elif not value:
                data[list_field] = []

        if not data.get('joiningDate'):
            data.pop('joiningDate', None)
        if data.get('salary') == '' or data.get('salary') is None:
            data.pop('salary', None)
        return data

    def create(self, request, *args, **kwargs):
        data = self._normalized_request_data(request)
        serializer = TeacherCreateSerializer(data=data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        school = request.user.school
        if not school:
            # A school tenant is mandatory. We never silently fall back to
            # ``School.objects.first()`` because that would attach a teacher
            # to an unrelated school and break tenant isolation.
            return Response(
                {'detail': 'A school tenant is required to create teacher profiles.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        teacher, credentials = create_teacher_with_login(
            school=school, data=serializer.validated_data, created_by=request.user,
        )
        bump_cache_version('teachers', school.id)
        bump_cache_version('classes', school.id)
        bump_cache_version('sections', school.id)
        bump_cache_version('academic_structure', school.id)
        teacher_serializer = TeacherSerializer(teacher, context={'request': request})
        result = teacher_serializer.data
        result['loginCredentials'] = credentials
        return Response(result, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        teacher = self.get_object()
        serializer = self.get_serializer(
            teacher,
            data=self._normalized_request_data(request),
            partial=partial,
        )
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        if getattr(teacher, '_prefetched_objects_cache', None):
            teacher._prefetched_objects_cache = {}
        return Response(self.get_serializer(teacher).data)

    def perform_update(self, serializer):
        teacher = serializer.save()
        bump_cache_version('teachers', teacher.school_id)
        user = teacher.user
        active = teacher.status == Teacher.Status.ACTIVE
        if user.is_active != active:
            user.is_active = active
            user.save(update_fields=['is_active'])
        password = self.request.data.get('password')
        if password and str(password).strip():
            clean_pwd = str(password).strip()
            user.set_password(clean_pwd)
            user.must_change_password = True
            user.save(update_fields=['password', 'must_change_password'])
            from apps.accounts.auth_utils import revoke_all_user_sessions
            revoke_all_user_sessions(user)
            try:
                from apps.accounts.credential_vault import record_credential
                record_credential(
                    school=teacher.school,
                    role='teacher',
                    name=teacher.user.get_full_name() or teacher.name,
                    login_id=teacher.user.email,
                    user=user,
                    source='admin_update',
                    must_change_password=True,
                )
            except Exception:
                pass

        # Sync teaching assignments
        normalized_data = self._normalized_request_data(self.request)
        assignments_data = normalized_data.get('teachingAssignments')
        if isinstance(assignments_data, list) and len(assignments_data) > 0:
            with transaction.atomic():
                TeacherTeachingAssignment.objects.filter(teacher=teacher).delete()
                for item in assignments_data:
                    sec_id = item.get('sectionId')
                    sub_id = item.get('subjectId')
                    if sec_id and sub_id:
                        TeacherTeachingAssignment.objects.get_or_create(
                            school=teacher.school,
                            teacher=teacher,
                            section_id=sec_id,
                            subject_id=sub_id,
                            defaults={'created_by': self.request.user},
                        )
        elif teacher.sections.exists() and teacher.subject_records.exists():
            with transaction.atomic():
                for sec in teacher.sections.select_related('class_room').all():
                    cls_subs = set(sec.class_room.subjects.values_list('id', flat=True)) if sec.class_room else set()
                    for sub in teacher.subject_records.all():
                        if not cls_subs or sub.id in cls_subs:
                            TeacherTeachingAssignment.objects.get_or_create(
                                school=teacher.school,
                                teacher=teacher,
                                section=sec,
                                subject=sub,
                                defaults={'created_by': self.request.user},
                            )

        # Sync Class Teacher assignments
        if 'managedClassIds' in normalized_data or 'managedSectionIds' in normalized_data:
            from apps.academics.models import Class, Section
            managed_class_ids = set(normalized_data.get('managedClassIds') or [])
            managed_section_ids = set(normalized_data.get('managedSectionIds') or [])

            # Clear classes previously assigned to this teacher that are no longer selected
            Class.objects.filter(school=teacher.school, class_teacher=teacher).exclude(id__in=managed_class_ids).update(class_teacher=None)
            if managed_class_ids:
                Class.objects.filter(school=teacher.school, id__in=managed_class_ids).update(class_teacher=teacher)

            # Clear sections previously assigned to this teacher that are no longer selected
            Section.objects.filter(school=teacher.school, class_teacher=teacher).exclude(id__in=managed_section_ids).update(class_teacher=None)
            if managed_section_ids:
                Section.objects.filter(school=teacher.school, id__in=managed_section_ids).update(class_teacher=teacher)

            bump_cache_version('classes', teacher.school_id)
            bump_cache_version('sections', teacher.school_id)
            bump_cache_version('academic_structure', teacher.school_id)

    def destroy(self, request, *args, **kwargs):
        """Delete the teacher profile and its login as one atomic operation."""
        teacher = self.get_object()
        school_id = teacher.school_id
        with transaction.atomic():
            try:
                from apps.accounts.models import CredentialVaultRecord
                CredentialVaultRecord.objects.filter(
                    school=teacher.school,
                    role=CredentialVaultRecord.Role.TEACHER,
                    user=teacher.user,
                ).delete()
            except Exception:
                pass
            # The User -> Teacher OneToOne relation cascades to the profile,
            # documents, and exact teaching assignments. Deleting the user is
            # essential: deleting only Teacher leaves an unusable login behind.
            teacher.user.delete()
        bump_cache_version('teachers', school_id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request=TeacherTeachingAssignmentSerializer,
        responses={200: TeacherSerializer},
        description='Add one class-section and subject assignment to an existing teacher.',
    )
    @action(detail=True, methods=['post'], url_path='teaching-assignments')
    def add_teaching_assignment(self, request, pk=None):
        """Assign an existing tenant teacher to one section/subject pair.

        The operation is additive and idempotent so timetable setup cannot
        accidentally replace the teacher's other classes or subjects.
        """
        teacher = self.get_object()
        serializer = TeacherTeachingAssignmentSerializer(
            data=request.data, context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        section = serializer.validated_data['section']
        subject = serializer.validated_data['subject']

        with transaction.atomic():
            teacher = Teacher.objects.select_for_update().get(pk=teacher.pk)
            TeacherTeachingAssignment.objects.get_or_create(
                school_id=request.user.school_id,
                teacher=teacher,
                section=section,
                subject=subject,
                defaults={'created_by': request.user},
            )
            teacher.sections.add(section)
            teacher.subject_records.add(subject)
            teacher.assigned_sections = sorted({
                *(teacher.assigned_sections or []),
                f'{section.class_room.name}-{section.name}',
            })
            teacher.subjects = sorted({*(teacher.subjects or []), subject.name})
            teacher.save(update_fields=['assigned_sections', 'subjects', 'updated_at'])

        bump_cache_version('teachers', request.user.school_id)
        teacher = self.get_queryset().get(pk=teacher.pk)
        return Response(self.get_serializer(teacher).data, status=status.HTTP_200_OK)

    @action(
        detail=False,
        methods=['get'],
        url_path='bulk-import/status',
        permission_classes=[CanManageSchoolImports],
    )
    def bulk_import_status(self, request):
        import re
        from django.core.cache import cache

        job_id = str(request.query_params.get('jobId') or '').strip()
        try:
            batch_number = int(request.query_params.get('batchNumber') or 0)
        except (TypeError, ValueError):
            batch_number = 0
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', job_id) or not 1 <= batch_number <= 10000:
            return Response({'detail': 'Valid jobId and batchNumber are required.'}, status=status.HTTP_400_BAD_REQUEST)
        key = import_status_key(
            entity='teachers', school_id=request.user.school_id, user_id=request.user.pk,
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
        """Bulk import teachers from JSON payload or uploaded Excel (.xlsx/.xls)/CSV file.
        High-throughput architecture supporting up to 50,000+ teacher records:
        - Memory-efficient streaming spreadsheet parsing
        - O(1) in-memory allocation of unique emails and login credentials
        - Standard Django password hashing for imported accounts
        - Batched database writes (bulk_create) to eliminate N+1 bottlenecks
        - Idempotent batch processing with cached job recovery
        - Structured, sanitized error diagnostics for high reliability
        """
        import time
        from apps.academics.models import Subject
        from apps.accounts.models import CredentialVaultRecord, User
        from apps.common.spreadsheet_parser import (
            TEACHER_FIELD_SYNONYMS,
            auto_map_columns,
            detect_header_and_data,
            normalize_date_value,
            normalize_phone_number,
            parse_spreadsheet_bytes,
        )
        from apps.common.validators import validate_spreadsheet_upload
        from apps.sis.services import generate_temporary_password
        from django.contrib.auth.hashers import make_password
        from django.core.cache import cache
        from django.core.exceptions import ValidationError
        from django.db import DatabaseError, IntegrityError, transaction
        from django.db.models import Q
        from django.utils.text import slugify
        import json as json_lib

        start_time = time.time()

        user = request.user
        if not (user and user.is_authenticated and user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]):
            return Response({
                'success': False,
                'errorCategory': 'AUTHENTICATION_ERROR',
                'detail': 'Only School Admins can bulk import teachers.',
            }, status=status.HTTP_403_FORBIDDEN)

        school = user.school
        if not school:
            return Response({
                'success': False,
                'errorCategory': 'TENANT_ERROR',
                'detail': 'A school tenant is required to import teachers.',
            }, status=status.HTTP_400_BAD_REQUEST)

        queued_response = queue_import_batch(request, entity='teachers', user=user, school=school)
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

        # Check idempotency cache
        cache_key = f"bulk_import_teacher_v2:{school.id}:{user.id}:{job_id}:{batch_number}" if job_id else None
        if cache_key:
            cached_result = cache.get(cache_key)
            if cached_result:
                return Response(cached_result, status=status.HTTP_200_OK)

        uploaded_file = request.FILES.get('file')
        raw_teachers = []

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

                _, header_names, data_rows = detect_header_and_data(grid_rows, TEACHER_FIELD_SYNONYMS)
                col_mapping = auto_map_columns(header_names, TEACHER_FIELD_SYNONYMS)

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
                    if not any(c is not None and str(c).strip() != '' for c in row):
                        continue
                    t_dict = {'_row_num': r_idx}
                    for field, c_idx in col_mapping.items():
                        if c_idx < len(row):
                            t_dict[field] = row[c_idx]
                    raw_teachers.append(t_dict)
            except Exception as exc:
                logger.exception("Failed to parse teacher spreadsheet (job %s, batch %s)", job_id, batch_number)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'errorCategory': 'FILE_PARSE_ERROR',
                    'detail': 'Could not process the spreadsheet. Check its format and try again.',
                }, status=status.HTTP_400_BAD_REQUEST)
        else:
            payload = request.data
            if isinstance(payload, dict) and 'teachers' in payload:
                raw_teachers = payload['teachers']
            elif isinstance(payload, list):
                raw_teachers = payload
            elif isinstance(payload.get('teachers'), str):
                try:
                    raw_teachers = json_lib.loads(payload['teachers'])
                except Exception:
                    raw_teachers = []

        if not raw_teachers:
            return Response({
                'success': False,
                'jobId': job_id,
                'batchNumber': batch_number,
                'errorCategory': 'VALIDATION_ERROR',
                'detail': 'No teacher records found to import.',
            }, status=status.HTTP_400_BAD_REQUEST)

        # Subject cache: Query only relevant subjects
        subjects_by_name = {s.name.strip().lower(): s for s in Subject.objects.filter(school=school)}

        # Login credentials allocation: Check only custom emails in this batch
        proposed_custom_emails = [
            str(item.get('email') or item.get('teacher_email') or '').strip().lower()
            for item in raw_teachers
            if str(item.get('email') or item.get('teacher_email') or '').strip()
        ]
        existing_custom_emails = set(
            User.objects.filter(Q(email__in=proposed_custom_emails) | Q(username__in=proposed_custom_emails)).values_list('username', flat=True)
        ) if proposed_custom_emails else set()

        allocated_batch_usernames = set()
        subdomain_slug = slugify(getattr(school, 'subdomain', '') or getattr(school, 'code', '') or f'school-{school.id}') or f'school-{school.id}'

        def get_fast_credentials(override_password=None):
            raw_pwd = str(override_password or '').strip()
            if not raw_pwd:
                raw_pwd = generate_temporary_password(14)
            encoded_pwd = make_password(raw_pwd)
            return raw_pwd, encoded_pwd

        created_teachers = []
        credentials_list = []
        errors_list = []
        total_created = 0

        try:
            param_batch_size = int(request.data.get('batchSize') or request.data.get('batch_size') or 1000)
            BATCH_SIZE = max(100, min(param_batch_size, 5000))
        except (ValueError, TypeError):
            BATCH_SIZE = 1000

        for chunk_start in range(0, len(raw_teachers), BATCH_SIZE):
            chunk = raw_teachers[chunk_start:chunk_start + BATCH_SIZE]

            chunk_teachers = []
            chunk_users = []
            chunk_subject_pairs = []
            chunk_creds_metadata = []

            for idx_offset, item in enumerate(chunk):
                overall_idx = chunk_start + idx_offset + 1
                row_num = item.get('_row_num', overall_idx)
                name = str(item.get('name') or item.get('teacher_name') or item.get('fullName') or '').strip()
                if not name:
                    errors_list.append({
                        'row': row_num,
                        'name': '(Blank)',
                        'reason': 'Missing teacher name.',
                    })
                    continue

                phone = normalize_phone_number(item.get('phone') or item.get('mobile') or '')
                if not phone or len(phone) < 10:
                    phone = f"97{overall_idx:08d}"[-10:]

                raw_email = str(item.get('email') or '').strip().lower()
                if raw_email and '@' in raw_email and raw_email not in existing_custom_emails and raw_email not in allocated_batch_usernames:
                    email = raw_email
                else:
                    name_slug = slugify(name).lower() or 'teacher'
                    email = f"{name_slug}_{overall_idx}@teachers.{subdomain_slug}.volpehub.education"
                allocated_batch_usernames.add(email)

                qualification = str(item.get('qualification') or '').strip()
                joining_date = normalize_date_value(item.get('joining_date') or item.get('joiningDate')) or '2026-01-01'

                # Raw subjects (support both 'subjects' and 'subject')
                raw_subs = item.get('subjects') or item.get('subject') or []
                if isinstance(raw_subs, str):
                    raw_subs = [s.strip() for s in raw_subs.split(',') if s.strip()]

                resolved_subjects = []
                for s_name in raw_subs:
                    s_clean = s_name.strip()
                    if not s_clean:
                        continue
                    s_key = s_clean.lower()
                    if s_key not in subjects_by_name:
                        s_obj, _ = Subject.objects.get_or_create(school=school, name=s_clean)
                        subjects_by_name[s_key] = s_obj
                    else:
                        s_obj = subjects_by_name[s_key]
                    resolved_subjects.append(s_obj)

                salary = None
                if item.get('salary'):
                    try:
                        salary = float(str(item.get('salary')).replace(',', ''))
                    except Exception:
                        salary = None

                t_override_pwd = (
                    item.get('password')
                    or item.get('temp_password')
                    or item.get('temporary_password')
                )
                plain_pwd, enc_pwd = get_fast_credentials(t_override_pwd)

                user_inst = User(
                    username=email,
                    email=email,
                    first_name=name,
                    role=User.Role.TEACHER,
                    school=school,
                    is_active=True,
                    must_change_password=True,
                    password=enc_pwd,
                )

                teacher_inst = Teacher(
                    school=school,
                    user=user_inst,
                    subjects=[s.name for s in resolved_subjects],
                    assigned_sections=[],
                    qualification=qualification,
                    joining_date=joining_date,
                    phone=phone,
                    salary=salary,
                    status=Teacher.Status.ACTIVE,
                )

                chunk_users.append(user_inst)
                chunk_teachers.append(teacher_inst)
                for s_obj in resolved_subjects:
                    chunk_subject_pairs.append((teacher_inst, s_obj))

                chunk_creds_metadata.append({
                    'name': name,
                    'email': email,
                    'password': plain_pwd,
                    'phone': phone,
                })

            if not chunk_teachers:
                continue

            try:
                with transaction.atomic():
                    # 1. Bulk insert users (PostgreSQL populates IDs)
                    User.objects.bulk_create(chunk_users, batch_size=BATCH_SIZE)

                    # 2. Synchronize user_id on Teacher instances BEFORE bulk_create!
                    for t_inst in chunk_teachers:
                        t_inst.user_id = t_inst.user.id

                    # 3. Bulk insert teachers
                    Teacher.objects.bulk_create(chunk_teachers, batch_size=BATCH_SIZE)

                    # 4. Many-to-many through linking for subjects
                    if chunk_subject_pairs:
                        through_model = Teacher.subject_records.through
                        links = [
                            through_model(teacher_id=t.id, subject_id=s.id)
                            for t, s in chunk_subject_pairs
                        ]
                        through_model.objects.bulk_create(links, batch_size=BATCH_SIZE, ignore_conflicts=True)

                    # 5. Credential vault records
                    vault_records = [
                        CredentialVaultRecord(
                            school=school,
                            user_id=u.id,
                            role=CredentialVaultRecord.Role.TEACHER,
                            name=meta['name'],
                            login_id=meta['email'],
                            identifier=f"TCH-{t.id}",
                            phone=meta['phone'],
                            source='csv_bulk_import',
                            must_change_password=True,
                        )
                        for u, t, meta in zip(chunk_users, chunk_teachers, chunk_creds_metadata)
                    ]
                    CredentialVaultRecord.objects.bulk_create(
                        vault_records, batch_size=BATCH_SIZE, ignore_conflicts=True
                    )
            except IntegrityError as exc:
                logger.exception("Database IntegrityError during bulk import of teachers (batch %s, job %s)", batch_number, job_id)
                err_msg = str(exc)
                category = 'DATABASE_CONSTRAINT_ERROR'
                if 'unique constraint' in err_msg.lower():
                    category = 'DUPLICATE_KEY_ERROR'
                    clean_msg = "Duplicate key detected in database. A teacher or user with this email or username already exists."
                elif 'foreign key constraint' in err_msg.lower():
                    category = 'FOREIGN_KEY_ERROR'
                    clean_msg = "Foreign key reference error. A referenced subject or school could not be linked."
                elif 'violates not-null constraint' in err_msg.lower():
                    category = 'DATABASE_CONSTRAINT_ERROR'
                    clean_msg = "Database constraint violation: A required field was missing or null."
                else:
                    clean_msg = "Database constraint violation occurred during teacher bulk import."

                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': category,
                    'detail': clean_msg,
                    'attemptedRows': len(chunk_teachers),
                    'createdCount': 0,
                    'skippedCount': len(chunk_teachers),
                    'durationMs': int((time.time() - start_time) * 1000),
                    'errors': [{'row': f'Batch {batch_number}', 'reason': clean_msg}],
                }, status=status.HTTP_400_BAD_REQUEST)
            except ValidationError as exc:
                logger.exception("Validation error during teacher bulk import (batch %s, job %s)", batch_number, job_id)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': 'VALIDATION_ERROR',
                    'detail': f"Validation failure: {str(exc)}",
                    'attemptedRows': len(chunk_teachers),
                    'createdCount': 0,
                    'skippedCount': len(chunk_teachers),
                    'durationMs': int((time.time() - start_time) * 1000),
                    'errors': [{'row': f'Batch {batch_number}', 'reason': str(exc)}],
                }, status=status.HTTP_400_BAD_REQUEST)
            except DatabaseError as exc:
                logger.exception("Database error during teacher bulk import (batch %s, job %s)", batch_number, job_id)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': 'DATABASE_ERROR',
                    'detail': "Database operation failed. The batch was rolled back cleanly.",
                    'attemptedRows': len(chunk_teachers),
                    'createdCount': 0,
                    'skippedCount': len(chunk_teachers),
                    'durationMs': int((time.time() - start_time) * 1000),
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            except Exception as exc:
                logger.exception("Unexpected exception during teacher bulk import (batch %s, job %s)", batch_number, job_id)
                return Response({
                    'success': False,
                    'jobId': job_id,
                    'batchNumber': batch_number,
                    'totalBatches': total_batches,
                    'errorCategory': 'INTERNAL_SERVER_ERROR',
                    'detail': 'Teacher import failed because of an unexpected server error. Please try again or contact support.',
                    'attemptedRows': len(chunk_teachers),
                    'createdCount': 0,
                    'skippedCount': len(chunk_teachers),
                    'durationMs': int((time.time() - start_time) * 1000),
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            total_created += len(chunk_teachers)
            for t_inst, meta in zip(chunk_teachers, chunk_creds_metadata):
                credentials_list.append({
                    'teacherId': t_inst.id,
                    'name': meta['name'],
                    'email': meta['email'],
                    'password': meta['password'],
                })
                if len(created_teachers) < 100:
                    created_teachers.append({
                        'id': t_inst.id,
                        'name': meta['name'],
                        'email': meta['email'],
                        'phone': meta['phone'],
                        'status': t_inst.status,
                    })

        duration_ms = int((time.time() - start_time) * 1000)
        response_data = {
            'success': True,
            'jobId': job_id,
            'batchNumber': batch_number,
            'totalBatches': total_batches,
            'totalProcessed': len(raw_teachers),
            'createdCount': total_created,
            'skippedCount': len(errors_list),
            'durationMs': duration_ms,
            'createdTeachers': created_teachers,
            'credentials': credentials_list[:5000] if len(credentials_list) > 5000 else credentials_list,
            'errors': errors_list,
        }

        # Cache response for idempotency
        if cache_key:
            # Temporary passwords are returned to the caller once and must not
            # be retained in Redis as part of the idempotency response.
            cache.set(cache_key, {**response_data, 'credentials': []}, timeout=3600)
        if total_created:
            bump_cache_version('teachers', school.id)

        return Response(response_data, status=status.HTTP_201_CREATED if total_created else status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get', 'post'], url_path='photo')
    def photo(self, request, pk=None):
        teacher = self.get_object()
        if request.method.lower() == 'post':
            if request.user.role != User.Role.SCHOOL_ADMIN:
                return Response({'detail': 'Only school administrators can upload teacher photos.'}, status=status.HTTP_403_FORBIDDEN)
            photo_file = request.FILES.get('photo')
            if not photo_file:
                return Response({'detail': 'No photo file provided.'}, status=status.HTTP_400_BAD_REQUEST)
            from apps.staff.serializers import TeacherSerializer
            TeacherSerializer._store_photo(teacher, photo_file)
            return Response({'photoUrl': f'/api/v1/teachers/{teacher.id}/photo/'}, status=status.HTTP_200_OK)

        from apps.common.storage import open_file, file_exists
        if teacher.photo_key and file_exists(teacher.photo_key):
            try:
                handle = open_file(teacher.photo_key)
                response = FileResponse(handle, content_type=teacher.photo_content_type or 'image/webp')
                response['Cache-Control'] = 'private, max-age=300'
                response['X-Content-Type-Options'] = 'nosniff'
                return response
            except Exception:
                pass
        if not teacher.photo_data:
            raise Http404
        response = HttpResponse(bytes(teacher.photo_data), content_type=teacher.photo_content_type or 'image/webp')
        response['Cache-Control'] = 'private, max-age=300'
        response['X-Content-Type-Options'] = 'nosniff'
        return response


class TeacherDocumentDownloadView(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={
        200: OpenApiResponse(response=OpenApiTypes.BINARY, description='Authorized teacher document download'),
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def retrieve(self, request, teacher_id=None, doc_id=None):
        query = TeacherDocument.objects.select_related('teacher__user').filter(pk=doc_id)
        if teacher_id and str(teacher_id).lower() != 'me':
            query = query.filter(teacher_id=teacher_id)
        document = query.first()
        if not document:
            raise Http404
        teacher, user = document.teacher, request.user
        if user.role == User.Role.SUPER_ADMIN:
            return Response({'detail': 'Super Admins cannot access teacher documents.'}, status=status.HTTP_403_FORBIDDEN)
        if str(user.school_id or '') != str(teacher.school_id or ''):
            raise Http404
        allowed = user.role == User.Role.SCHOOL_ADMIN or (
            user.role == User.Role.TEACHER and teacher.user_id == user.id
        )
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

    @extend_schema(request=TeacherDocumentSerializer, responses={
        200: TeacherDocumentSerializer,
        400: OpenApiResponse(description='Bad request'),
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def _get_teacher(self, request, teacher_id):
        if not teacher_id or str(teacher_id).lower() == 'me' or (request.user.role == User.Role.TEACHER and str(teacher_id) == '0'):
            t = Teacher.objects.filter(user=request.user).first()
            if t:
                return t
        t = Teacher.objects.filter(pk=teacher_id, school_id=request.user.school_id).first()
        if not t and request.user.role == User.Role.TEACHER:
            return Teacher.objects.filter(user=request.user).first()
        return t

    @extend_schema(request=None, responses={
        200: TeacherDocumentSerializer,
        400: OpenApiResponse(description='Bad request'),
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def partial_update(self, request, teacher_id=None, doc_id=None):
        if request.user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'Only school administrators can verify or reject teacher documents.'}, status=status.HTTP_403_FORBIDDEN)
        teacher = self._get_teacher(request, teacher_id)
        if teacher:
            document = TeacherDocument.objects.select_related('teacher').filter(pk=doc_id, teacher=teacher).first()
        else:
            document = TeacherDocument.objects.select_related('teacher').filter(pk=doc_id, teacher__school_id=request.user.school_id).first()
        if not document or str(document.teacher.school_id or '') != str(request.user.school_id or ''):
            raise Http404
        new_status = request.data.get('status')
        if new_status in [TeacherDocument.Status.VERIFIED, TeacherDocument.Status.REJECTED, TeacherDocument.Status.PENDING]:
            document.status = new_status
            if 'remarks' in request.data:
                document.remarks = str(request.data.get('remarks', '') or '')[:255]
            if new_status in [TeacherDocument.Status.VERIFIED, TeacherDocument.Status.REJECTED]:
                document.verified_at = timezone.now()
                document.verified_by = request.user
            else:
                document.verified_at = None
                document.verified_by = None
            document.save()
            bump_cache_version('teachers', request.user.school_id)
            return Response(TeacherDocumentSerializer(document, context={'request': request}).data)
        return Response({'detail': 'Invalid status. Choose Verified, Rejected, or Pending.'}, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(request=None, responses={
        204: None,
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def destroy(self, request, teacher_id=None, doc_id=None):
        teacher = self._get_teacher(request, teacher_id)
        if teacher:
            document = TeacherDocument.objects.select_related('teacher').filter(
                pk=doc_id, teacher=teacher, teacher__school_id=request.user.school_id
            ).first()
        else:
            document = TeacherDocument.objects.select_related('teacher').filter(
                pk=doc_id, teacher__school_id=request.user.school_id
            ).first()
        if not document:
            raise Http404
        allowed = (request.user.role == User.Role.SCHOOL_ADMIN) or (
            request.user.role == User.Role.TEACHER and document.teacher.user_id == request.user.id
        )
        if not allowed:
            return Response({'detail': 'You do not have permission to delete this document.'}, status=status.HTTP_403_FORBIDDEN)
        if document.file_key:
            from apps.common.storage import delete_file
            delete_file(document.file_key)
        document.delete()
        bump_cache_version('teachers', request.user.school_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TeacherDocumentCollectionView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'credential_management'

    def _get_teacher(self, request, teacher_id):
        if not teacher_id or str(teacher_id).lower() == 'me' or (request.user.role == User.Role.TEACHER and str(teacher_id) == '0'):
            t = Teacher.objects.filter(user=request.user).first()
            if t:
                return t
        t = Teacher.objects.filter(pk=teacher_id, school_id=request.user.school_id).first()
        if not t and request.user.role == User.Role.TEACHER:
            return Teacher.objects.filter(user=request.user).first()
        return t

    @extend_schema(responses={200: TeacherDocumentSerializer(many=True), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')})
    def get(self, request, teacher_id=None):
        teacher = self._get_teacher(request, teacher_id)
        if not teacher:
            raise Http404
        allowed = (request.user.role == User.Role.SCHOOL_ADMIN) or (
            request.user.role == User.Role.TEACHER and teacher.user_id == request.user.id
        )
        if not allowed:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        documents = teacher.documents.defer('file_data').all()
        return Response(TeacherDocumentSerializer(documents, many=True, context={'request': request}).data)

    @extend_schema(request=TeacherDocumentUploadSerializer, responses={
        201: TeacherDocumentSerializer,
        403: OpenApiResponse(description='Forbidden'),
        404: OpenApiResponse(description='Not found'),
    })
    def post(self, request, teacher_id=None):
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER]:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        teacher = self._get_teacher(request, teacher_id)
        if not teacher:
            raise Http404
        if request.user.role == User.Role.TEACHER and teacher.user_id != request.user.id:
            return Response({'detail': 'Teachers can only upload documents for their own profile.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = TeacherDocumentUploadSerializer(data=request.data, context={'teacher': teacher, 'request': request})
        serializer.is_valid(raise_exception=True)
        document = serializer.save()
        bump_cache_version('teachers', request.user.school_id)
        return Response(TeacherDocumentSerializer(document, context={'request': request}).data, status=status.HTTP_201_CREATED)


def generate_salary_receipt_number(school_id, year, month):
    prefix = f"RCPT-SAL-{year}{int(month):02d}"
    last = StaffSalaryPayment.objects.filter(
        school_id=school_id, receipt_number__startswith=prefix
    ).order_by('-receipt_number').first()
    seq = 1
    if last and last.receipt_number:
        try:
            seq = int(last.receipt_number.split('-')[-1]) + 1
        except (ValueError, IndexError):
            seq = 1
    candidate = f"{prefix}-{seq:04d}"
    while StaffSalaryPayment.objects.filter(school_id=school_id, receipt_number=candidate).exists():
        seq += 1
        candidate = f"{prefix}-{seq:04d}"
    return candidate


class StaffSalaryPaymentPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.role == User.Role.SUPER_ADMIN:
            return False
        if request.method not in permissions.SAFE_METHODS:
            return request.user.role == User.Role.SCHOOL_ADMIN
        return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER]

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == User.Role.SCHOOL_ADMIN:
            return str(obj.school_id or '') == str(user.school_id or '')
        if user.role == User.Role.TEACHER:
            return obj.teacher.user_id == user.id and request.method in permissions.SAFE_METHODS
        return False


class StaffSalaryPaymentViewSet(TenantScopedViewSet):
    permission_classes = [StaffSalaryPaymentPermission]
    pagination_class = AdminListPagination
    serializer_class = StaffSalaryPaymentSerializer
    queryset = StaffSalaryPayment.objects.select_related('school', 'teacher__user', 'paid_by')

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return StaffSalaryPayment.objects.none()
        user = self.request.user
        if not user.is_authenticated:
            return StaffSalaryPayment.objects.none()
        qs = super().get_queryset()
        if user.role == User.Role.TEACHER:
            qs = qs.filter(teacher__user=user)
        elif user.role == User.Role.SCHOOL_ADMIN:
            teacher_id = self.request.query_params.get('teacherId')
            if teacher_id:
                qs = qs.filter(teacher_id=teacher_id)
        else:
            return StaffSalaryPayment.objects.none()

        month = self.request.query_params.get('month')
        year = self.request.query_params.get('year')
        if month:
            qs = qs.filter(month=month)
        if year:
            qs = qs.filter(year=year)
        return qs

    @action(detail=False, methods=['get'], url_path='payroll-summary')
    def payroll_summary(self, request):
        """Return the filtered teacher payroll roster as one server-paginated page."""
        user = request.user
        if user.role != User.Role.SCHOOL_ADMIN or not user.school_id:
            return Response({'detail': 'A School Admin account is required.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            month = int(request.query_params.get('month', timezone.localdate().month))
            year = int(request.query_params.get('year', timezone.localdate().year))
            if month < 1 or month > 12 or year < 2000 or year > 2200:
                raise ValueError
        except (TypeError, ValueError):
            return Response({'detail': 'Choose a valid payroll month and year.'}, status=status.HTTP_400_BAD_REQUEST)

        active_teachers = Teacher.objects.filter(school_id=user.school_id, status=Teacher.Status.ACTIVE)
        payments = StaffSalaryPayment.objects.filter(school_id=user.school_id, month=month, year=year)
        teacher_list = active_teachers.select_related('user').annotate(
            has_paid_salary=Exists(payments.filter(teacher_id=OuterRef('pk'), status=StaffSalaryPayment.Status.PAID)),
        )
        search = request.query_params.get('search', '').strip()[:100]
        if search:
            teacher_list = teacher_list.filter(
                Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
                | Q(user__email__icontains=search)
                | Q(phone__icontains=search)
            )
        state = request.query_params.get('status', '').strip()
        if state == 'Paid':
            teacher_list = teacher_list.filter(has_paid_salary=True)
        elif state == 'Pending':
            teacher_list = teacher_list.filter(has_paid_salary=False)

        summary = active_teachers.aggregate(total_payroll=Sum('salary'))
        paid_summary = payments.filter(status=StaffSalaryPayment.Status.PAID).aggregate(
            total_paid=Sum('amount'),
            paid_count=Count('teacher_id', distinct=True),
        )
        total_count = active_teachers.count()
        paid_count = paid_summary['paid_count'] or 0
        page = self.paginate_queryset(teacher_list.order_by('user__first_name', 'user__last_name', 'id'))
        teachers_data = []
        for teacher in page:
            full_name = f'{teacher.user.first_name or ""} {teacher.user.last_name or ""}'.strip()
            teacher_name = ' '.join((full_name or teacher.user.username or 'Teacher').split()).title()
            teachers_data.append({
                'id': teacher.pk,
                'userId': teacher.user_id,
                'name': teacher_name,
                'email': teacher.user.email,
                'phone': teacher.phone,
                'salary': str(teacher.salary) if teacher.salary is not None else None,
                'qualification': teacher.qualification,
                'joiningDate': teacher.joining_date,
                'status': teacher.status,
                'subjects': teacher.subjects,
                'assignedSections': teacher.assigned_sections,
                'photoUrl': f'/api/v1/teachers/{teacher.pk}/photo/' if teacher.photo_key or teacher.photo_content_type else None,
            })
        page_ids = [teacher.pk for teacher in page]
        payment_rows = StaffSalaryPayment.objects.filter(
            school_id=user.school_id, month=month, year=year, teacher_id__in=page_ids,
        ).select_related('teacher__user', 'paid_by')
        payment_data = {
            row.teacher_id: StaffSalaryPaymentSerializer(row, context={'request': request}).data
            for row in payment_rows
        }
        results = [{
            'teacher': teacher_data,
            'fixedSalary': float(teacher_data.get('salary') or 0),
            'payment': payment_data.get(teacher_data['id']),
            'isPaid': bool(payment_data.get(teacher_data['id']) and payment_data[teacher_data['id']]['status'] == StaffSalaryPayment.Status.PAID),
        } for teacher_data in teachers_data]
        response = self.get_paginated_response(results)
        response.data['summary'] = {
            'totalPayroll': summary['total_payroll'] or 0,
            'totalPaid': paid_summary['total_paid'] or 0,
            'totalPending': max((summary['total_payroll'] or 0) - (paid_summary['total_paid'] or 0), 0),
            'paidCount': paid_count,
            'totalCount': total_count,
            'pendingCount': max(total_count - paid_count, 0),
        }
        return response

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return StaffSalaryPaymentCreateSerializer
        return StaffSalaryPaymentSerializer

    def create(self, request, *args, **kwargs):
        school = request.user.school
        if not school:
            return Response({'detail': 'A school tenant is required.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = StaffSalaryPaymentCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)

        teacher = serializer.validated_data['teacher']
        month = serializer.validated_data['month']
        year = serializer.validated_data['year']

        existing = StaffSalaryPayment.objects.filter(
            school=school, teacher=teacher, year=year, month=month
        ).first()

        if existing:
            for attr, val in serializer.validated_data.items():
                setattr(existing, attr, val)
            existing.paid_by = request.user
            existing.save()

            # Notify teacher
            try:
                from apps.notifications.services import notify_teacher_user
                amt = existing.net_salary if getattr(existing, 'net_salary', None) else getattr(existing, 'basic_salary', 0)
                notify_teacher_user(
                    teacher=existing.teacher,
                    title="Salary Updated",
                    body=f"Your salary details for {existing.month} {existing.year} have been updated. Net: ₹{amt}. Receipt: {existing.receipt_number}.",
                    category="Salary",
                    channel="school-to-teachers",
                    sender=request.user,
                    related={'receiptNumber': existing.receipt_number, 'month': existing.month, 'year': existing.year},
                )
            except Exception:
                pass

            return Response(
                StaffSalaryPaymentSerializer(existing, context={'request': request}).data,
                status=status.HTTP_200_OK
            )

        receipt_number = serializer.validated_data.get('receipt_number')
        if not receipt_number:
            receipt_number = generate_salary_receipt_number(school.id, year, month)

        max_attempts = 5
        instance = None
        for attempt in range(max_attempts):
            try:
                instance = serializer.save(
                    school=school,
                    paid_by=request.user,
                    receipt_number=receipt_number
                )
                break
            except ValidationError as ve:
                if hasattr(ve, 'message_dict') and 'receipt_number' in ve.message_dict and attempt < max_attempts - 1:
                    receipt_number = generate_salary_receipt_number(school.id, year, month)
                    continue
                raise

        # Notify teacher that salary was credited
        try:
            from apps.notifications.services import notify_teacher_user, notify_school_admins
            if instance:
                amt = instance.net_salary if getattr(instance, 'net_salary', None) else getattr(instance, 'basic_salary', 0)
                teacher_name = instance.teacher.user.get_full_name() if instance.teacher and instance.teacher.user else f"Teacher #{instance.teacher_id}"
                notify_teacher_user(
                    teacher=instance.teacher,
                    title="Salary Credited",
                    body=f"Your salary of ₹{amt} for {instance.month} {instance.year} has been processed. Receipt: {instance.receipt_number}.",
                    category="Salary",
                    channel="school-to-teachers",
                    sender=request.user,
                    related={'receiptNumber': instance.receipt_number, 'month': instance.month, 'year': instance.year, 'amount': float(amt or 0)},
                )
                notify_school_admins(
                    school=school,
                    title="Salary Payment Processed",
                    body=f"Salary of ₹{amt} disbursed to {teacher_name} for {instance.month} {instance.year}. Receipt: {instance.receipt_number}.",
                    category="Salary",
                    channel="system",
                    sender=request.user,
                    related={'receiptNumber': instance.receipt_number, 'teacherId': instance.teacher_id},
                )
        except Exception:
            pass

        return Response(
            StaffSalaryPaymentSerializer(instance, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )
