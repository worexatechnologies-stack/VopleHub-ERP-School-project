from itertools import islice
import base64
import binascii
import json
from io import BytesIO
from pathlib import Path

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.http import FileResponse, Http404
from django.db.models import Prefetch, Q
from django.db.models.deletion import ProtectedError, RestrictedError
from rest_framework import permissions, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet
from apps.common.fast_cache import fast_cache_response, bump_cache_version

from .models import AcademicYear, Class, Section, Subject, Homework, HomeworkFileAttachment
from .serializers import AcademicYearSerializer, ClassSerializer, SectionSerializer, SubjectSerializer, HomeworkSerializer


def _delete_reference(code, label, count, *, examples=(), policy='blocked', message=''):
    """Build a stable, UI-friendly description of a delete dependency."""
    try:
        limited_examples = examples[:5]
    except TypeError:
        limited_examples = islice(examples, 5)
    return {
        'code': code,
        'label': label,
        'count': count,
        'examples': [str(value) for value in limited_examples],
        'deletionPolicy': policy,
        'message': message,
    }


class AcademicAdminWritePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        # Academic structures are school-operational data. Platform Super
        # Admins manage schools and must not read or mutate a school's
        # curriculum through this API.
        if request.user.role == User.Role.SUPER_ADMIN:
            return False
        if request.method in permissions.SAFE_METHODS:
            return request.user.role in [
                User.Role.SCHOOL_ADMIN, User.Role.TEACHER,
                User.Role.PARENT, User.Role.STUDENT,
            ]
        return request.user.role == User.Role.SCHOOL_ADMIN

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.role == User.Role.SUPER_ADMIN:
            return False
        if str(obj.school_id or '') != str(user.school_id or ''):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return user.role == User.Role.SCHOOL_ADMIN


def _active_teacher_profile(user):
    """Return a canonical active teacher owned by the user's tenant."""
    from apps.staff.models import Teacher

    return Teacher.objects.filter(
        user=user,
        school_id=user.school_id,
        status=Teacher.Status.ACTIVE,
    ).first()


def _refresh_teacher_section_labels(teacher_ids, replaced_labels=()):
    """Keep the temporary JSON labels aligned with canonical section links."""
    from apps.staff.models import Teacher

    teachers = list(
        Teacher.objects.filter(pk__in=set(teacher_ids))
        .prefetch_related('sections__class_room')
    )
    replaced = {str(label).casefold() for label in replaced_labels}
    changed = []
    for teacher in teachers:
        canonical_labels = sorted(
            f'{section.class_room.name}-{section.name}'
            for section in teacher.sections.all()
        )
        canonical_keys = {label.casefold() for label in canonical_labels}
        preserved = [
            str(label) for label in (teacher.assigned_sections or [])
            if str(label).casefold() not in replaced
            and str(label).casefold() not in canonical_keys
        ]
        labels = canonical_labels + preserved
        if teacher.assigned_sections != labels:
            teacher.assigned_sections = labels
            changed.append(teacher)
    if changed:
        Teacher.objects.bulk_update(changed, ['assigned_sections'], batch_size=500)


def _refresh_teacher_subject_labels(teacher_ids, replaced_labels=()):
    """Keep the temporary subject JSON aligned with canonical subject links."""
    from apps.staff.models import Teacher

    teachers = list(
        Teacher.objects.filter(pk__in=set(teacher_ids)).prefetch_related('subject_records')
    )
    replaced = {str(label).casefold() for label in replaced_labels}
    changed = []
    for teacher in teachers:
        canonical_labels = sorted(subject.name for subject in teacher.subject_records.all())
        canonical_keys = {label.casefold() for label in canonical_labels}
        preserved = [
            str(label) for label in (teacher.subjects or [])
            if str(label).casefold() not in replaced
            and str(label).casefold() not in canonical_keys
        ]
        labels = canonical_labels + preserved
        if teacher.subjects != labels:
            teacher.subjects = labels
            changed.append(teacher)
    if changed:
        Teacher.objects.bulk_update(changed, ['subjects'], batch_size=500)


class AcademicMasterViewSet(TenantScopedViewSet):
    """Tenant-safe CRUD with deterministic conflicts instead of database 500s."""

    permission_classes = [AcademicAdminWritePermission]
    integrity_error_message = 'This academic record conflicts with an existing record.'

    def mutation_snapshot(self, instance):
        return {}

    def before_create(self, serializer):
        pass

    def before_update(self, serializer):
        pass

    def after_create(self, instance):
        pass

    def after_update(self, instance, previous):
        pass

    def get_delete_references(self, instance):
        return []

    def get_delete_resource(self, instance):
        return {
            'type': instance._meta.model_name,
            'id': instance.pk,
            'name': getattr(instance, 'name', str(instance)),
        }

    def delete_conflict_response(
        self, instance, references, *, can_cascade=False,
        cascade_param=None, detail=None, cascade_summary=None,
    ):
        resource = self.get_delete_resource(instance)
        if detail is None:
            detail = (
                f'{resource["type"].replace("_", " ").title()} '
                f'"{resource["name"]}" is in use and cannot be deleted.'
            )
        return Response(
            {
                'code': 'record_in_use',
                'detail': detail,
                'resource': resource,
                'references': references,
                'canCascade': can_cascade,
                'cascadeParam': cascade_param,
                'cascadeSummary': cascade_summary,
            },
            status=status.HTTP_409_CONFLICT,
        )

    def database_delete_conflict_response(self, instance, exc):
        protected = getattr(exc, 'protected_objects', None)
        if protected is None:
            protected = getattr(exc, 'restricted_objects', None)
        count = len(protected) if protected is not None else 1
        return self.delete_conflict_response(
            instance,
            [_delete_reference(
                'database_references', 'Other records', count,
                message='One or more database records still reference this item.',
            )],
            detail='This record is still referenced by other data and cannot be deleted.',
        )

    def list(self, request, *args, **kwargs):
        if getattr(request.user, 'role', None) == User.Role.SCHOOL_ADMIN:
            return self._cached_list(request, *args, **kwargs)
        return super().list(request, *args, **kwargs)

    @fast_cache_response(namespace='academics', timeout=120)
    def _cached_list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        if getattr(request.user, 'role', None) == User.Role.SCHOOL_ADMIN:
            return self._cached_retrieve(request, *args, **kwargs)
        return super().retrieve(request, *args, **kwargs)

    @fast_cache_response(namespace='academics', timeout=120)
    def _cached_retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    def perform_create(self, serializer):
        try:
            with transaction.atomic():
                self.before_create(serializer)
                instance = serializer.save(school=self.request.user.school)
                self.after_create(instance)
            bump_cache_version('academics', getattr(self.request.user, 'school_id', None))
        except IntegrityError as exc:
            raise serializers.ValidationError({'detail': self.integrity_error_message}) from exc

    def perform_update(self, serializer):
        previous = self.mutation_snapshot(serializer.instance)
        try:
            with transaction.atomic():
                self.before_update(serializer)
                instance = serializer.save(school=serializer.instance.school)
                self.after_update(instance, previous)
            bump_cache_version('academics', getattr(self.request.user, 'school_id', None))
        except IntegrityError as exc:
            raise serializers.ValidationError({'detail': self.integrity_error_message}) from exc

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        references = self.get_delete_references(instance)
        if references:
            return self.delete_conflict_response(instance, references)
        try:
            with transaction.atomic():
                self.perform_destroy(instance)
            bump_cache_version('academics', getattr(self.request.user, 'school_id', None))
        except (ProtectedError, RestrictedError, IntegrityError) as exc:
            return self.database_delete_conflict_response(instance, exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AcademicYearViewSet(AcademicMasterViewSet):
    queryset = AcademicYear.objects.all()
    serializer_class = AcademicYearSerializer
    integrity_error_message = 'An academic year with this name already exists.'

    def _auto_provision_academic_year(self, school_id):
        from datetime import date
        import re
        from apps.schools.models import School
        from apps.sis.models import Student

        school = School.objects.filter(pk=school_id).first()
        if not school:
            return None

        student_year = (
            Student.objects.filter(school_id=school_id)
            .exclude(academic_year='')
            .values_list('academic_year', flat=True)
            .first()
        )
        year_name = (student_year or '').strip() or '2026-2027'

        match = re.search(r'(\d{4})[^\d]+(\d{2,4})', year_name)
        if match:
            s_yr = int(match.group(1))
            e_yr = int(match.group(2))
            if e_yr < 100:
                e_yr += 2000
        else:
            today = date.today()
            s_yr = today.year if today.month >= 4 else today.year - 1
            e_yr = s_yr + 1

        ay, _ = AcademicYear.objects.get_or_create(
            school=school,
            name=year_name,
            defaults={
                'starts_on': date(s_yr, 4, 1),
                'ends_on': date(e_yr, 3, 31),
                'is_active': True,
            },
        )
        if not ay.is_active and not AcademicYear.objects.filter(school=school, is_active=True).exists():
            ay.is_active = True
            ay.save(update_fields=['is_active'])

        bump_cache_version('academics', school_id)
        return ay

    def get_queryset(self):
        qs = super().get_queryset()
        user = getattr(self.request, 'user', None)
        if user and user.is_authenticated and user.school_id:
            if not qs.exists():
                self._auto_provision_academic_year(user.school_id)
                qs = super().get_tenant_queryset()
            elif not qs.filter(is_active=True).exists():
                first_year = qs.order_by('-starts_on').first()
                if first_year:
                    first_year.is_active = True
                    first_year.save(update_fields=['is_active'])
                    bump_cache_version('academics', user.school_id)
        return qs

    def mutation_snapshot(self, instance):
        return {'name': instance.name}

    def _make_only_active_year(self, instance):
        if instance.is_active:
            AcademicYear.objects.filter(
                school_id=instance.school_id, is_active=True,
            ).exclude(pk=instance.pk).update(is_active=False)

    def before_create(self, serializer):
        if serializer.validated_data.get('is_active', False):
            AcademicYear.objects.filter(
                school_id=self.request.user.school_id, is_active=True,
            ).update(is_active=False)

    def before_update(self, serializer):
        will_be_active = serializer.validated_data.get(
            'is_active', serializer.instance.is_active,
        )
        if will_be_active:
            AcademicYear.objects.filter(
                school_id=serializer.instance.school_id, is_active=True,
            ).exclude(pk=serializer.instance.pk).update(is_active=False)

    def after_create(self, instance):
        self._make_only_active_year(instance)

    def after_update(self, instance, previous):
        from apps.sis.models import AcademicHistory, Student

        old_name = previous['name']
        if old_name != instance.name:
            Student.objects.filter(
                school_id=instance.school_id, academic_year__iexact=old_name,
            ).update(academic_year=instance.name)
            AcademicHistory.objects.filter(
                student__school_id=instance.school_id, academic_year__iexact=old_name,
            ).update(academic_year=instance.name)
        self._make_only_active_year(instance)

    def get_delete_references(self, instance):
        from apps.sis.models import AcademicHistory, Student

        references = []
        students = Student.objects.filter(
            school_id=instance.school_id, academic_year__iexact=instance.name,
        )
        student_count = students.count()
        if student_count:
            references.append(_delete_reference(
                'students', 'Students', student_count,
                examples=[
                    f'{admission_no} · {name}'
                    for admission_no, name in students.order_by('admission_no').values_list('admission_no', 'name')
                ],
                message='Students currently use this academic year.',
            ))
        history = AcademicHistory.objects.filter(
            student__school_id=instance.school_id, academic_year__iexact=instance.name,
        )
        history_count = history.count()
        if history_count:
            references.append(_delete_reference(
                'student_academic_history', 'Student academic history', history_count,
                message='Historical student records use this academic year.',
            ))
        return references


class ClassViewSet(AcademicMasterViewSet):
    queryset = Class.objects.prefetch_related('subjects')
    serializer_class = ClassSerializer
    integrity_error_message = 'A class with this name or code already exists.'

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return qs
        if user.role == User.Role.TEACHER:
            profile = _active_teacher_profile(user)
            return qs.filter(
                Q(sections__teachers=profile, sections__school_id=user.school_id) |
                Q(sections__teacher_assignments__teacher=profile, sections__teacher_assignments__school_id=user.school_id)
            ).distinct() if profile else qs.none()
        if user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            section_id = getattr(getattr(profile, 'student', None), 'section_record_id', None)
            return qs.filter(sections__id=section_id) if section_id else qs.none()
        if user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            return qs.filter(sections__students__parent_profiles=profile).distinct() if profile else qs.none()
        return qs.none()

    def mutation_snapshot(self, instance):
        return {'name': instance.name}

    def after_update(self, instance, previous):
        from apps.exams.models import Exam
        from apps.sis.models import Student
        from apps.staff.models import Teacher

        old_name = previous['name']
        if old_name == instance.name:
            return

        Student.objects.filter(
            school_id=instance.school_id, section_record__class_room_id=instance.pk,
        ).update(class_name=instance.name)
        Student.objects.filter(
            school_id=instance.school_id, section_record__isnull=True,
            class_name__iexact=old_name,
        ).update(class_name=instance.name)
        Exam.objects.filter(
            school_id=instance.school_id, class_name__iexact=old_name,
        ).update(class_name=instance.name)
        teacher_ids = Teacher.objects.filter(
            school_id=instance.school_id, sections__class_room_id=instance.pk,
        ).values_list('pk', flat=True)
        old_labels = [
            f'{old_name}-{section_name}'
            for section_name in instance.sections.values_list('name', flat=True)
        ]
        _refresh_teacher_section_labels(teacher_ids, old_labels)

    def get_delete_references(self, instance):
        from apps.exams.models import Exam
        from apps.sis.models import Student
        from apps.staff.models import Teacher

        references = []
        sections = instance.sections.order_by('name')
        section_count = sections.count()
        if section_count:
            references.append(_delete_reference(
                'sections', 'Sections', section_count,
                examples=sections.values_list('name', flat=True), policy='cascade',
                message='These sections belong to the class and can be removed with it.',
            ))

        students = Student.objects.filter(
            school_id=instance.school_id,
            section_record__class_room_id=instance.pk,
        )
        student_count = students.count()
        if student_count:
            references.append(_delete_reference(
                'students', 'Students', student_count,
                examples=[
                    f'{admission_no} · {name} ({academic_year})'
                    for admission_no, name, academic_year in students.order_by('admission_no').values_list('admission_no', 'name', 'academic_year')
                ],
                message='Reassign these students to another section before deleting the class.',
            ))

        legacy_students = Student.objects.filter(
            school_id=instance.school_id, section_record__isnull=True,
            class_name__iexact=instance.name,
        )
        legacy_student_count = legacy_students.count()
        if legacy_student_count:
            references.append(_delete_reference(
                'legacy_student_assignments', 'Unlinked student assignments',
                legacy_student_count,
                examples=[
                    f'{admission_no} · {name} ({academic_year})'
                    for admission_no, name, academic_year in legacy_students.order_by('admission_no').values_list('admission_no', 'name', 'academic_year')
                ],
                message='Link or reassign these legacy student records before deleting the class.',
            ))

        exams = Exam.objects.filter(
            school_id=instance.school_id, class_name__iexact=instance.name,
        )
        exam_count = exams.count()
        if exam_count:
            references.append(_delete_reference(
                'exams', 'Exams', exam_count,
                examples=exams.order_by('date', 'name').values_list('name', flat=True),
                message='Delete or move these exams before deleting the class.',
            ))

        teacher_ids, section_labels = self._assigned_teacher_ids(instance)
        if teacher_ids:
            teachers = Teacher.objects.filter(pk__in=teacher_ids).select_related('user').order_by('user__email')
            teacher_examples = [
                teacher.user.get_full_name() or teacher.user.email
                for teacher in teachers[:5]
            ]
            references.append(_delete_reference(
                'teacher_assignments', 'Teacher assignments', len(teacher_ids),
                examples=teacher_examples, policy='detach',
                message='Teacher accounts are preserved; only assignments to these sections are removed.',
            ))

        subject_count = instance.subjects.count()
        if subject_count:
            references.append(_delete_reference(
                'subject_assignments', 'Subject assignments', subject_count,
                examples=instance.subjects.order_by('name').values_list('name', flat=True),
                policy='detach',
                message='Subjects are preserved; only their assignment to this class is removed.',
            ))
        return references

    def _assigned_teacher_ids(self, instance):
        """Return canonical and legacy teacher assignments for this class."""
        from apps.staff.models import Teacher

        section_labels = {
            f'{instance.name}-{name}'.casefold()
            for name in instance.sections.values_list('name', flat=True)
        }
        teacher_ids = set(
            Teacher.objects.filter(
                school_id=instance.school_id, sections__class_room_id=instance.pk,
            ).values_list('pk', flat=True)
        )
        if section_labels:
            for teacher_id, labels in Teacher.objects.filter(
                school_id=instance.school_id,
            ).values_list('pk', 'assigned_sections').iterator(chunk_size=500):
                if any(str(label).casefold() in section_labels for label in (labels or [])):
                    teacher_ids.add(teacher_id)
        return teacher_ids, section_labels

    def _class_delete_conflict(self, instance, references):
        hard_blockers = [
            reference for reference in references
            if reference['deletionPolicy'] == 'blocked'
        ]
        can_cascade = not hard_blockers and any(
            reference['deletionPolicy'] == 'cascade' for reference in references
        )
        if hard_blockers:
            blocker_summary = ', '.join(
                f'{reference["count"]} {reference["label"].lower()}'
                for reference in hard_blockers
            )
            detail = (
                f'Class "{instance.name}" cannot be deleted because it has '
                f'{blocker_summary}. Reassign or remove those records first.'
            )
            cascade_summary = None
        else:
            section_count = next(
                (reference['count'] for reference in references if reference['code'] == 'sections'),
                0,
            )
            detail = (
                f'Class "{instance.name}" contains {section_count} section(s). '
                'Confirm deletion to remove the class and its empty sections.'
            )
            cascade_summary = (
                'The class and its empty sections will be deleted. Teacher and subject '
                'records are preserved; only their assignments to this class are removed.'
            )
        return self.delete_conflict_response(
            instance, references, can_cascade=can_cascade,
            cascade_param='sections' if can_cascade else None,
            detail=detail, cascade_summary=cascade_summary,
        )

    def destroy(self, request, *args, **kwargs):
        """Delete a class, optionally cascading only through safe section links.

        ``?cascade=sections`` is deliberately narrow: it can remove empty sections
        and assignment join rows, but it never deletes students, teachers, subjects,
        or exams. Data-bearing dependencies continue to return HTTP 409.
        """
        requested_cascade = request.query_params.get('cascade')
        if requested_cascade not in (None, '', 'sections'):
            return Response(
                {
                    'code': 'invalid_cascade',
                    'detail': 'Unsupported cascade option. Use cascade=sections.',
                    'allowedValues': ['sections'],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        instance = self.get_object()
        try:
            with transaction.atomic():
                # Re-read under a row lock so the dependency decision and the
                # delete are one operation rather than a stale preflight check.
                instance = self.get_queryset().select_for_update().get(pk=instance.pk)
                references = self.get_delete_references(instance)
                relevant_references = [
                    reference for reference in references
                    if reference['deletionPolicy'] in ('blocked', 'cascade')
                ]
                hard_blockers = [
                    reference for reference in references
                    if reference['deletionPolicy'] == 'blocked'
                ]
                if requested_cascade != 'sections' and relevant_references:
                    return self._class_delete_conflict(instance, references)
                if requested_cascade == 'sections' and hard_blockers:
                    return self._class_delete_conflict(instance, references)

                teacher_ids, section_labels = self._assigned_teacher_ids(instance)
                self.perform_destroy(instance)
                if teacher_ids:
                    _refresh_teacher_section_labels(teacher_ids, section_labels)
        except (ProtectedError, RestrictedError, IntegrityError) as exc:
            return self.database_delete_conflict_response(instance, exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SectionViewSet(AcademicMasterViewSet):
    queryset = Section.objects.select_related('class_room')
    serializer_class = SectionSerializer
    integrity_error_message = 'This section already exists in the selected class.'

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return qs
        if user.role == User.Role.TEACHER:
            profile = _active_teacher_profile(user)
            return qs.filter(
                Q(teachers=profile, school_id=user.school_id) |
                Q(teacher_assignments__teacher=profile, teacher_assignments__school_id=user.school_id)
            ).distinct() if profile else qs.none()
        if user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            section_id = getattr(getattr(profile, 'student', None), 'section_record_id', None)
            return qs.filter(pk=section_id) if section_id else qs.none()
        if user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            return qs.filter(students__parent_profiles=profile).distinct() if profile else qs.none()
        return qs.none()

    def mutation_snapshot(self, instance):
        return {
            'name': instance.name,
            'class_name': instance.class_room.name,
        }

    def after_update(self, instance, previous):
        from apps.exams.models import Exam
        from apps.sis.models import Student
        from apps.staff.models import Teacher

        new_class_name = instance.class_room.name
        old_name = previous['name']
        old_class_name = previous['class_name']
        if old_name == instance.name and old_class_name == new_class_name:
            return

        Student.objects.filter(
            school_id=instance.school_id, section_record_id=instance.pk,
        ).update(class_name=new_class_name, section=instance.name)
        Student.objects.filter(
            school_id=instance.school_id, section_record__isnull=True,
            class_name__iexact=old_class_name, section__iexact=old_name,
        ).update(class_name=new_class_name, section=instance.name)
        Exam.objects.filter(
            school_id=instance.school_id, class_name__iexact=old_class_name,
            section__iexact=old_name,
        ).update(class_name=new_class_name, section=instance.name)
        teacher_ids = Teacher.objects.filter(
            school_id=instance.school_id, sections=instance,
        ).values_list('pk', flat=True)
        _refresh_teacher_section_labels(
            teacher_ids, [f'{old_class_name}-{old_name}'],
        )

    def get_delete_references(self, instance):
        from apps.exams.models import Exam
        from apps.sis.models import Student
        from apps.staff.models import Teacher

        references = []
        students = instance.students.order_by('admission_no')
        student_count = students.count()
        if student_count:
            references.append(_delete_reference(
                'students', 'Students', student_count,
                examples=[
                    f'{admission_no} · {name} ({academic_year})'
                    for admission_no, name, academic_year in students.values_list('admission_no', 'name', 'academic_year')
                ],
                message='Reassign these students before deleting the section.',
            ))
        teachers = instance.teachers.select_related('user').order_by('user__email')
        teacher_count = teachers.count()
        if teacher_count:
            references.append(_delete_reference(
                'teachers', 'Teachers', teacher_count,
                examples=[teacher.user.get_full_name() or teacher.user.email for teacher in teachers[:5]],
                message='Remove this section from these teachers before deleting it.',
            ))
        canonical_teacher_ids = set(teachers.values_list('pk', flat=True))
        section_label = f'{instance.class_room.name}-{instance.name}'.casefold()
        legacy_teacher_ids = {
            teacher_id
            for teacher_id, labels in Teacher.objects.filter(
                school_id=instance.school_id,
            ).values_list('pk', 'assigned_sections').iterator(chunk_size=500)
            if any(str(label).casefold() == section_label for label in (labels or []))
        } - canonical_teacher_ids
        if legacy_teacher_ids:
            references.append(_delete_reference(
                'legacy_teacher_assignments', 'Unlinked teacher assignments',
                len(legacy_teacher_ids),
                message='Remove this legacy section assignment before deleting the section.',
            ))
        legacy_students = Student.objects.filter(
            school_id=instance.school_id, section_record__isnull=True,
            class_name__iexact=instance.class_room.name,
            section__iexact=instance.name,
        )
        legacy_student_count = legacy_students.count()
        if legacy_student_count:
            references.append(_delete_reference(
                'legacy_student_assignments', 'Unlinked student assignments',
                legacy_student_count,
                examples=[
                    f'{admission_no} · {name} ({academic_year})'
                    for admission_no, name, academic_year in legacy_students.order_by('admission_no').values_list('admission_no', 'name', 'academic_year')
                ],
                message='Link or reassign these legacy student records before deleting the section.',
            ))
        exams = Exam.objects.filter(
            school_id=instance.school_id, class_name__iexact=instance.class_room.name,
            section__iexact=instance.name,
        )
        exam_count = exams.count()
        if exam_count:
            references.append(_delete_reference(
                'exams', 'Exams', exam_count,
                examples=exams.order_by('date', 'name').values_list('name', flat=True),
                message='Delete or move these exams before deleting the section.',
            ))
        return references


class SubjectViewSet(AcademicMasterViewSet):
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    integrity_error_message = 'A subject with this name already exists.'

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return qs
        if user.role == User.Role.TEACHER:
            profile = _active_teacher_profile(user)
            return qs.filter(
                Q(teachers=profile, school_id=user.school_id) |
                Q(teacher_assignments__teacher=profile, teacher_assignments__school_id=user.school_id)
            ).distinct() if profile else qs.none()
        if user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            section_id = getattr(getattr(profile, 'student', None), 'section_record_id', None)
            return qs.filter(classes__sections__id=section_id).distinct() if section_id else qs.none()
        if user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            return qs.filter(classes__sections__students__parent_profiles=profile).distinct() if profile else qs.none()
        return qs.none()

    @staticmethod
    def _scope_payload(section):
        return {
            'classId': section.class_room_id,
            'className': section.class_room.name,
            'sectionId': section.id,
            'sectionName': section.name,
        }

    @action(detail=False, methods=['get'], url_path='visible')
    def visible(self, request):
        """Return only the curriculum subjects visible to the signed-in role.

        This endpoint deliberately describes curriculum/teaching assignments,
        not timetable publication.  A class subject becomes visible to a
        student as soon as the School Admin assigns it in Academic Setup.  A
        teacher sees their own subject records, with class/section scopes
        limited to the sections assigned to that same teacher.  Whether a
        subject has a published period is a separate timetable concern.
        """
        user = request.user
        school_id = user.school_id
        subject_scopes = {}
        teacher_id = None

        if user.role == User.Role.SCHOOL_ADMIN:
            subjects = list(
                Subject.objects.filter(school_id=school_id)
                .order_by('name')
            )
            scope_kind = 'school_catalog'
        elif user.role == User.Role.TEACHER:
            profile = _active_teacher_profile(user)
            if not profile:
                subjects = []
            else:
                teacher_id = profile.pk
                assignments = list(
                    profile.teaching_assignments.filter(
                        school_id=school_id,
                        section__school_id=school_id,
                        subject__school_id=school_id,
                    )
                    .select_related('section__class_room', 'subject')
                    .order_by(
                        'subject__name', 'section__class_room__sort_order',
                        'section__class_room__name', 'section__name',
                    )
                )
                subject_by_id = {}
                for assignment in assignments:
                    subject_by_id[assignment.subject_id] = assignment.subject
                    subject_scopes.setdefault(assignment.subject_id, []).append(
                        self._scope_payload(assignment.section)
                    )
                for direct_subject in profile.subject_records.filter(school_id=school_id):
                    subject_by_id.setdefault(direct_subject.pk, direct_subject)
                    subject_scopes.setdefault(direct_subject.pk, [])
                    for sec in profile.sections.filter(school_id=school_id, class_room__subjects=direct_subject).select_related('class_room'):
                        scope = self._scope_payload(sec)
                        if scope not in subject_scopes[direct_subject.pk]:
                            subject_scopes[direct_subject.pk].append(scope)
                subjects = sorted(
                    subject_by_id.values(), key=lambda item: item.name.casefold(),
                )
            scope_kind = 'teacher_assignment'
        elif user.role == User.Role.STUDENT:
            login_profile = getattr(user, 'student_profile', None)
            student = getattr(login_profile, 'student', None)
            section = getattr(student, 'section_record', None)
            if not section or section.school_id != school_id:
                subjects = []
            else:
                section = (
                    Section.objects.select_related('class_room')
                    .prefetch_related('class_room__subjects')
                    .get(pk=section.pk, school_id=school_id)
                )
                subjects = list(section.class_room.subjects.all().order_by('name'))
                for subject in subjects:
                    subject_scopes[subject.pk] = [self._scope_payload(section)]
            scope_kind = 'student_class'
        elif user.role == User.Role.PARENT:
            parent_profile = getattr(user, 'parent_profile', None)
            sections = []
            if parent_profile:
                section_ids = parent_profile.students.filter(
                    school_id=school_id, section_record__isnull=False,
                ).values_list('section_record_id', flat=True)
                sections = list(
                    Section.objects.filter(pk__in=section_ids, school_id=school_id)
                    .select_related('class_room')
                    .prefetch_related('class_room__subjects')
                    .order_by('class_room__sort_order', 'class_room__name', 'name')
                    .distinct()
                )
            subject_by_id = {}
            for section in sections:
                for subject in section.class_room.subjects.all():
                    subject_by_id[subject.pk] = subject
                    subject_scopes.setdefault(subject.pk, []).append(
                        self._scope_payload(section)
                    )
            subjects = sorted(subject_by_id.values(), key=lambda item: item.name.casefold())
            scope_kind = 'linked_students_classes'
        else:
            subjects = []
            scope_kind = 'none'

        # Teacher scopes come only from exact section-subject assignments.
        # Independent legacy section/subject lists must never be combined as a
        # Cartesian product because that would grant classes the teacher was
        # not actually assigned to teach.
        return Response({
            'role': user.frontend_role,
            'scopeKind': scope_kind,
            'teacherId': teacher_id,
            'subjects': [
                {
                    'id': subject.pk,
                    'name': subject.name,
                    'scopes': subject_scopes.get(subject.pk, []),
                }
                for subject in subjects
            ],
            'semantics': {
                'assigned': 'Subjects configured for the user in PostgreSQL.',
                'scheduled': 'A subject is scheduled only after a timetable period is published.',
            },
        })

    def mutation_snapshot(self, instance):
        return {'name': instance.name}

    def after_update(self, instance, previous):
        from apps.exams.models import Exam
        from apps.staff.models import Teacher

        old_name = previous['name']
        if old_name == instance.name:
            return
        Exam.objects.filter(
            school_id=instance.school_id, subject__iexact=old_name,
        ).update(subject=instance.name)
        teacher_ids = Teacher.objects.filter(
            school_id=instance.school_id, subject_records=instance,
        ).values_list('pk', flat=True)
        _refresh_teacher_subject_labels(teacher_ids, [old_name])

    def get_delete_references(self, instance):
        from apps.exams.models import Exam
        from apps.staff.models import Teacher

        references = []
        classes = instance.classes.order_by('sort_order', 'name')
        class_count = classes.count()
        if class_count:
            references.append(_delete_reference(
                'classes', 'Classes', class_count,
                examples=classes.values_list('name', flat=True),
                message='Remove this subject from these classes before deleting it.',
            ))
        teachers = instance.teachers.select_related('user').order_by('user__email')
        teacher_count = teachers.count()
        if teacher_count:
            references.append(_delete_reference(
                'teachers', 'Teachers', teacher_count,
                examples=[teacher.user.get_full_name() or teacher.user.email for teacher in teachers[:5]],
                message='Remove this subject from these teachers before deleting it.',
            ))
        canonical_teacher_ids = set(teachers.values_list('pk', flat=True))
        exams = Exam.objects.filter(
            school_id=instance.school_id, subject__iexact=instance.name,
        )
        exam_count = exams.count()
        if exam_count:
            references.append(_delete_reference(
                'exams', 'Exams', exam_count,
                examples=exams.order_by('date', 'name').values_list('name', flat=True),
                message='Delete or move these exams before deleting the subject.',
            ))
        legacy_teacher_ids = {
            teacher_id
            for teacher_id, values in Teacher.objects.filter(
                school_id=instance.school_id,
            ).values_list('pk', 'subjects').iterator(chunk_size=500)
            if any(str(value).casefold() == instance.name.casefold() for value in (values or []))
        } - canonical_teacher_ids
        if legacy_teacher_ids:
            references.append(_delete_reference(
                'legacy_teacher_assignments', 'Unlinked teacher assignments',
                len(legacy_teacher_ids),
                message='Remove this legacy subject assignment before deleting the subject.',
            ))
        return references


def _normalize_class_clean_str(val):
    if not val:
        return ''
    import re
    return re.sub(r'(?i)^(class|grade|standard|std)\s*', '', str(val)).strip(' -_')

def _match_class_identifiers(a, b):
    if not a or not b:
        return False
    sa = str(a).strip().lower()
    sb = str(b).strip().lower()
    if sa == sb:
        return True
    na = _normalize_class_clean_str(a).lower()
    nb = _normalize_class_clean_str(b).lower()
    if '-' in na:
        na = na.split('-')[0].strip()
    if '-' in nb:
        nb = nb.split('-')[0].strip()
    return bool(na and nb and na == nb)

def _match_section_identifiers(a, b):
    if not a or not b:
        return True
    sa = str(a).strip().lower()
    sb = str(b).strip().lower()
    if sa in ['all', ''] or sb in ['all', '']:
        return True
    import re
    na = re.sub(r'(?i)^(section|sec)\s*', '', sa).strip(' -_')
    nb = re.sub(r'(?i)^(section|sec)\s*', '', sb).strip(' -_')
    return na == nb

def _match_subject_identifiers(a, b):
    if not a or not b:
        return True
    return str(a).strip().lower() == str(b).strip().lower()

def _normalize_class_q(raw_class_name):
    if not raw_class_name:
        return Q()
    raw_str = str(raw_class_name).strip()
    clean = _normalize_class_clean_str(raw_str)
    if '-' in clean:
        clean = clean.split('-')[0].strip()
    candidates = {
        raw_str,
        clean,
        f"Class {clean}",
        f"class {clean}",
        f"Class-{clean}",
        f"class-{clean}",
    }
    q_obj = Q()
    for c in candidates:
        if c:
            q_obj |= Q(class_name__iexact=c)
    return q_obj


def _homework_targets_student(homework, student):
    if not student or student.school_id != homework.school_id:
        return False
    if homework.class_room_id and student.section_record_id:
        if student.section_record.class_room_id != homework.class_room_id:
            return False
    elif (homework.class_name or '').strip().lower() not in {'all', 'all classes', 'all-classes'}:
        if not _match_class_identifiers(student.class_name, homework.class_name):
            return False
    if homework.section_id and student.section_record_id != homework.section_id:
        return False
    if not homework.section_id and homework.section_name and homework.section_name.strip().lower() not in {'all', 'all sections'}:
        if not _match_section_identifiers(student.section, homework.section_name):
            return False
    return True


class HomeworkPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        action = getattr(view, 'action', None)
        if action == 'submit_homework':
            return request.user.role in [User.Role.STUDENT, User.Role.PARENT, User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        if action == 'grade_submission':
            return request.user.role in [User.Role.TEACHER, User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role in [User.Role.TEACHER, User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == User.Role.SUPER_ADMIN:
            return True
        if user.role == User.Role.SCHOOL_ADMIN:
            return str(obj.school_id or '') == str(user.school_id or '')
        if user.role == User.Role.TEACHER:
            if request.method in permissions.SAFE_METHODS:
                return str(obj.school_id or '') == str(user.school_id or '')
            teacher = _active_teacher_profile(user)
            return bool(teacher and obj.teacher_id == teacher.id)
        if user.role in [User.Role.STUDENT, User.Role.PARENT]:
            if getattr(view, 'action', None) == 'submit_homework':
                return str(obj.school_id or '') == str(user.school_id or '')
            return request.method in permissions.SAFE_METHODS and str(obj.school_id or '') == str(user.school_id or '')
        return False


def _legacy_homework_file_uploads(attachments):
    """Decode pre-multipart data URLs into temporary byte uploads for migration."""
    uploads = []
    for attachment in attachments or []:
        if not isinstance(attachment, dict):
            continue
        url = attachment.get('url')
        if not isinstance(url, str) or not url.startswith('data:'):
            continue
        header, separator, encoded = url.partition(',')
        if not separator or ';base64' not in header:
            raise serializers.ValidationError({'attachments': 'A legacy attachment is malformed.'})
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise serializers.ValidationError({'attachments': 'A legacy attachment is not valid base64 data.'}) from exc
        filename = Path(str(attachment.get('name') or 'attachment.bin')).name
        content_type = header[5:].split(';', 1)[0].lower()
        # Old browser code converted all images to JPEG while keeping the old
        # filename. Align the temporary extension with the actual byte format.
        if content_type == 'image/jpeg' and Path(filename).suffix.lower() not in {'.jpg', '.jpeg'}:
            filename = f'{Path(filename).stem}.jpg'
        uploads.append(SimpleUploadedFile(filename, content, content_type=content_type))
    return uploads


def _homework_file_payload(item, homework_id):
    return {
        'id': item.pk,
        'name': item.file_name,
        'url': f'/api/v1/homework/{homework_id}/attachments/{item.pk}/?view=1',
        'type': item.content_type,
        'size': item.file_size,
    }


def _request_attachment_ids(request):
    raw_ids = request.data.get('attachmentIds')
    if raw_ids is None:
        return None
    if isinstance(raw_ids, list):
        return raw_ids
    try:
        value = json.loads(raw_ids or '[]')
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError({'attachmentIds': 'Attachment IDs must be a JSON list.'}) from exc
    if not isinstance(value, list):
        raise serializers.ValidationError({'attachmentIds': 'Attachment IDs must be a JSON list.'})
    return value


def _store_homework_attachments(homework, request, *, student=None, keep_ids=None, legacy=None):
    """Persist multipart or legacy files as raw bytes and return DB metadata."""
    from .homework_files import save_homework_uploads

    legacy = list(legacy if legacy is not None else (homework.attachments or []))
    old_inline_uploads = _legacy_homework_file_uploads(legacy)
    uploads = list(request.FILES.getlist('attachments')) + old_inline_uploads

    try:
        if student is None and keep_ids is not None:
            keep_ids = {int(value) for value in keep_ids if str(value).isdigit()}
            HomeworkFileAttachment.objects.filter(
                homework=homework, submission_student_id='',
            ).exclude(pk__in=keep_ids).delete()
        if student is not None:
            HomeworkFileAttachment.objects.filter(
                homework=homework, submission_student_id=str(student.pk),
            ).delete()
        created = save_homework_uploads(homework, uploads, student=student)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({'attachments': exc.messages}) from exc

    # Strip legacy data URLs from the JSON column. Ordinary external links stay
    # as metadata, while uploaded file bytes live only in BinaryField rows.
    metadata = [
        item for item in legacy
        if isinstance(item, dict)
        and not (isinstance(item.get('url'), str) and item['url'].startswith('data:'))
        and not (isinstance(item.get('id'), int) and '/attachments/' in str(item.get('url') or ''))
    ]
    if student is None:
        homework.attachments = metadata
        homework.save(update_fields=['attachments'])
    return [*metadata, *[_homework_file_payload(item, homework.pk) for item in created]]


class HomeworkViewSet(TenantScopedViewSet):
    queryset = Homework.objects.select_related(
        'teacher', 'teacher__user', 'class_room', 'section', 'subject'
    ).prefetch_related(
        Prefetch(
            'file_attachments',
            queryset=HomeworkFileAttachment.objects.defer('file_data'),
        )
    ).order_by('-due_date', '-created_at')
    serializer_class = HomeworkSerializer
    permission_classes = [HomeworkPermission]

    def get_serializer(self, *args, **kwargs):
        # Files arrive in request.FILES for multipart. They are persisted as
        # bytes separately from the JSON metadata serializer field.
        data = kwargs.get('data')
        if data is not None:
            data = data.copy()
            data.pop('attachmentIds', None)
            if getattr(self.request, 'FILES', None):
                data.pop('attachments', None)
            kwargs['data'] = data
        return super().get_serializer(*args, **kwargs)

    def create(self, request, *args, **kwargs):
        with transaction.atomic():
            return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        with transaction.atomic():
            return super().update(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Homework.objects.none()

        # Keep queryset tenancy behavior aligned with HomeworkPermission:
        # super-admins are permitted across tenants; other users remain scoped
        # to their assigned school (or receive no rows when unassigned).
        qs = self.get_tenant_queryset().select_related(
            'teacher', 'teacher__user', 'class_room', 'section', 'subject'
        ).order_by('-due_date', '-created_at')

        # Filter by role
        if user.role == User.Role.STUDENT:
            from apps.sis.models import Student
            from apps.accounts.models import StudentProfile
            # Try multiple lookup paths to robustly find the student
            student = None
            student_profile = getattr(user, 'student_profile', None)
            if student_profile:
                student = getattr(student_profile, 'student', None)
            if not student:
                sp = StudentProfile.objects.filter(user=user).select_related('student').first()
                if sp:
                    student = sp.student
            if not student:
                student = Student.objects.filter(login_profile__user=user).first()
            if not student:
                clean_email = (user.email or '').strip()
                prefix = clean_email.split('@')[0] if clean_email else ''
                student = (
                    Student.objects.filter(school_id=user.school_id, login_profile__user=user).first()
                    or Student.objects.filter(school_id=user.school_id, name__iexact=user.get_full_name()).first()
                    or Student.objects.filter(school_id=user.school_id, admission_no__iexact=prefix).first()
                    or Student.objects.filter(school_id=user.school_id, name__istartswith=prefix).first()
                )
            if student and student.school_id != user.school_id:
                student = None
            if student and student.class_name:
                q = (
                    _normalize_class_q(student.class_name)
                    | Q(class_name__iexact='all')
                    | Q(class_name__iexact='all classes')
                    | Q(class_name__iexact='all-classes')
                )
                if student.section:
                    q &= (
                        Q(section_name__iexact=student.section)
                        | Q(section_name='')
                        | Q(section_name__isnull=True)
                        | Q(section_name__iexact='all')
                    )
                qs = qs.filter(q)
            else:
                qs = qs.none()

        elif user.role == User.Role.PARENT:
            from apps.sis.models import Student
            from apps.accounts.models import ParentProfile
            parent_prof = getattr(user, 'parent_profile', None) or ParentProfile.objects.filter(user=user).first()
            linked_students = parent_prof.students.filter(school_id=user.school_id) if parent_prof else Student.objects.filter(parent_email__iexact=user.email, school_id=user.school_id)
            if linked_students.exists():
                pq = Q()
                for st in linked_students:
                    sq = (
                        _normalize_class_q(st.class_name)
                        | Q(class_name__iexact='all')
                        | Q(class_name__iexact='all classes')
                        | Q(class_name__iexact='all-classes')
                    )
                    if st.section:
                        sq &= (
                            Q(section_name__iexact=st.section)
                            | Q(section_name='')
                            | Q(section_name__isnull=True)
                            | Q(section_name__iexact='all')
                        )
                    pq |= sq
                qs = qs.filter(pq)
            else:
                qs = qs.none()

        elif user.role == User.Role.TEACHER:
            teacher = _active_teacher_profile(user)
            if teacher:
                # RBAC Rule 2 (Subject Teacher): View and manage ONLY their own assigned homework
                tq = Q(teacher=teacher)

                # RBAC Rule 3 (Class Teacher): View ALL subjects' homework for their assigned class
                managed_classes = Class.objects.filter(school_id=user.school_id, class_teacher=teacher)
                managed_sections = Section.objects.filter(school_id=user.school_id, class_teacher=teacher)

                class_teacher_q = Q()
                for c in managed_classes:
                    class_teacher_q |= Q(class_room=c) | _normalize_class_q(c.name)

                for s in managed_sections:
                    class_teacher_q |= Q(section=s) | (_normalize_class_q(s.class_room.name) & Q(section_name__iexact=s.name))

                qs = qs.filter(tq | class_teacher_q)
            else:
                qs = qs.none()

        # Optional query param filters
        class_name = self.request.query_params.get('class_name')
        if class_name and class_name != 'All' and class_name.lower() not in ['all', 'all classes', 'all-classes']:
            qs = qs.filter(
                _normalize_class_q(class_name)
                | Q(class_name__iexact='all')
                | Q(class_name__iexact='all classes')
                | Q(class_name__iexact='all-classes')
            )

        section_name = self.request.query_params.get('section_name')
        if section_name and section_name != 'All' and section_name.lower() not in ['all', 'all sections', '']:
            qs = qs.filter(
                Q(section_name__iexact=section_name)
                | Q(section_name='')
                | Q(section_name__isnull=True)
                | Q(section_name__iexact='all')
            )

        subject_name = self.request.query_params.get('subject_name')
        if subject_name and subject_name != 'All':
            qs = qs.filter(subject_name__icontains=subject_name)

        status_param = self.request.query_params.get('status')
        if status_param and status_param != 'All':
            qs = qs.filter(status=status_param)

        return qs

    def perform_create(self, serializer):
        from apps.staff.models import Teacher
        from apps.sis.models import Student
        from apps.accounts.models import ParentProfile, StudentProfile, User
        from apps.notifications.tasks import fanout_notification_task
        from rest_framework.exceptions import PermissionDenied
        import logging

        user = self.request.user
        teacher = _active_teacher_profile(user)
        assigned_teacher = serializer.validated_data.get('teacher')
        teacher_name = serializer.validated_data.get('teacher_name', '').strip()

        # RBAC Check
        if user.role in [User.Role.SUPER_ADMIN, User.Role.SCHOOL_ADMIN]:
            # Administrators can create, assign, and manage homework across all classes and subjects
            target_school = user.school if user.role == User.Role.SCHOOL_ADMIN else serializer.validated_data.get('school')
            if not target_school:
                raise PermissionDenied('Select a school before creating homework.')
            final_teacher = assigned_teacher or None
            if final_teacher and not teacher_name and getattr(final_teacher, 'user', None):
                teacher_name = final_teacher.user.get_full_name() or final_teacher.user.username
            elif not teacher_name:
                teacher_name = f"Admin ({user.get_full_name() or user.username})"

            instance = serializer.save(
                school=target_school,
                teacher=final_teacher,
                teacher_name=teacher_name,
            )
        elif user.role == User.Role.TEACHER:
            if not teacher:
                raise PermissionDenied("An active teacher profile is required to assign homework.")

            target_class = (serializer.validated_data.get('class_name') or (serializer.validated_data.get('class_room').name if serializer.validated_data.get('class_room') else '')).strip()
            target_sec = (serializer.validated_data.get('section_name') or (serializer.validated_data.get('section').name if serializer.validated_data.get('section') else '')).strip()
            target_subj = (serializer.validated_data.get('subject_name') or (serializer.validated_data.get('subject').name if serializer.validated_data.get('subject') else '')).strip()

            is_authorized = False

            # Check 1: Explicit teaching assignments (Class + Section + Subject)
            ta_qs = teacher.teaching_assignments.select_related('section', 'section__class_room', 'subject')
            for ta in ta_qs:
                cls_match = _match_class_identifiers(ta.section.class_room.name, target_class)
                sec_match = _match_section_identifiers(ta.section.name, target_sec)
                sub_match = _match_subject_identifiers(ta.subject.name, target_subj)
                if cls_match and sec_match and sub_match:
                    is_authorized = True
                    break

            # Check 2: Canonical sections and teacher assigned subjects
            if not is_authorized:
                canonical_secs = teacher.sections.select_related('class_room')
                teacher_subjects = [s.lower() for s in (teacher.subjects or [])] + [s.name.lower() for s in teacher.subject_records.all()]
                sub_match = not target_subj or not teacher_subjects or any(_match_subject_identifiers(ts, target_subj) for ts in teacher_subjects)
                for cs in canonical_secs:
                    cls_match = _match_class_identifiers(cs.class_room.name, target_class)
                    sec_match = _match_section_identifiers(cs.name, target_sec)
                    if cls_match and sec_match and sub_match:
                        is_authorized = True
                        break

            # Check 3: teacher.assigned_sections strings (e.g. "class 1-A", "Class 1 - A", "1-A")
            if not is_authorized and teacher.assigned_sections:
                teacher_subjects = [s.lower() for s in (teacher.subjects or [])] + [s.name.lower() for s in teacher.subject_records.all()]
                sub_match = not target_subj or not teacher_subjects or any(_match_subject_identifiers(ts, target_subj) for ts in teacher_subjects)
                for as_label in teacher.assigned_sections:
                    as_str = str(as_label).strip()
                    parts = as_str.split('-')
                    if len(parts) >= 2:
                        p_cls = parts[0].strip()
                        p_sec = parts[1].strip()
                        if _match_class_identifiers(p_cls, target_class) and _match_section_identifiers(p_sec, target_sec) and sub_match:
                            is_authorized = True
                            break
                    elif _match_class_identifiers(as_str, target_class) and sub_match:
                        is_authorized = True
                        break

            if not is_authorized:
                section_str = f" Section {target_sec}" if target_sec and target_sec != 'All' else ""
                subj_str = f" for {target_subj}" if target_subj else ""
                raise PermissionDenied(
                    f"Access Denied: Only specific class-taking teachers can assign homework. You are not assigned to teach Class {target_class}{section_str}{subj_str}."
                )

            # Auto-resolve classroom, section, subject foreign keys
            school_id = user.school_id
            resolved_classroom = None
            resolved_section = None
            resolved_subject = None

            for c in Class.objects.filter(school_id=school_id):
                if _match_class_identifiers(c.name, target_class):
                    resolved_classroom = c
                    break

            if resolved_classroom:
                for s in resolved_classroom.sections.all():
                    if _match_section_identifiers(s.name, target_sec):
                        resolved_section = s
                        break

            for sub in Subject.objects.filter(school_id=school_id):
                if _match_subject_identifiers(sub.name, target_subj):
                    resolved_subject = sub
                    break

            real_teacher_name = (teacher.user.get_full_name() or teacher.user.username) if getattr(teacher, 'user', None) else (user.get_full_name() or user.username or 'Teacher')
            instance = serializer.save(
                school_id=school_id,
                teacher=teacher,
                teacher_name=real_teacher_name,
                class_room=resolved_classroom or serializer.validated_data.get('class_room'),
                section=resolved_section or serializer.validated_data.get('section'),
                subject=resolved_subject or serializer.validated_data.get('subject'),
            )

        _store_homework_attachments(
            instance,
            self.request,
            keep_ids=_request_attachment_ids(self.request),
            legacy=instance.attachments,
        )

        # Real-time WebSocket Broadcast across the entire school via Redis Channels
        try:
            from apps.common.realtime import broadcast_sync_event
            broadcast_sync_event(
                school_id=instance.school_id,
                entity='homework',
                action='created',
                entity_id=instance.id,
                data={
                    'title': instance.title,
                    'className': instance.class_name,
                    'sectionName': instance.section_name or '',
                    'subjectName': instance.subject_name,
                    'teacherName': instance.teacher_name,
                    'dueDate': str(instance.due_date),
                }
            )
        except Exception:
            pass

        # Notify Students & Parents
        try:
            student_qs = Student.objects.filter(
                school_id=instance.school_id,
                status=Student.Status.ACTIVE,
            )
            is_all_classes = (instance.class_name or '').strip().lower() in ['all', 'all classes', 'all-classes']
            if not is_all_classes:
                student_qs = student_qs.filter(_normalize_class_q(instance.class_name))

            if not is_all_classes and instance.section_name and instance.section_name.lower() != 'all':
                student_qs = student_qs.filter(Q(section__iexact=instance.section_name) | Q(section=''))

            student_ids = list(student_qs.values_list('id', flat=True))
            if student_ids:
                student_user_ids = list(
                    StudentProfile.objects.filter(
                        student_id__in=student_ids,
                        user__school_id=instance.school_id,
                        user__is_active=True,
                    ).values_list('user_id', flat=True).distinct()
                )
                parent_user_ids = list(
                    ParentProfile.objects.filter(
                        students__id__in=student_ids,
                        user__school_id=instance.school_id,
                        user__is_active=True,
                    ).values_list('user_id', flat=True).distinct()
                )

                target_class = 'all' if is_all_classes else instance.class_name
                common_related = {
                    'homeworkId': instance.id,
                    'title': instance.title,
                    'subject': instance.subject_name,
                    'dueDate': str(instance.due_date),
                    'maxMarks': instance.max_marks,
                    'targetClass': target_class,
                    'targetSection': instance.section_name or '',
                }

                def queue_fanout(recipient_ids, *, channel, title, body):
                    if not recipient_ids:
                        return
                    payload = {
                        'school_id': instance.school_id,
                        'sender_id': user.pk,
                        'recipient_ids': recipient_ids,
                        'channel': channel,
                        'category': 'Homework',
                        'title': title,
                        'body': body,
                        'related': common_related,
                    }

                    def enqueue():
                        try:
                            fanout_notification_task.delay(**payload)
                        except Exception:
                            # Homework is already saved; notification broker
                            # outages must not turn a successful save into a
                            # failed/timeout HTTP request.
                            logging.getLogger(__name__).exception(
                                'Could not queue homework notifications for homework %s', instance.pk
                            )

                    transaction.on_commit(enqueue)

                queue_fanout(
                    student_user_ids,
                    channel='teacher-to-students',
                    title=f"New Homework: {instance.subject_name} - {instance.title}",
                    body=f"Class {instance.class_name} ({instance.section_name or 'All Sections'}). Due: {instance.due_date}. Instructions: {instance.description[:140]}",
                )
                queue_fanout(
                    parent_user_ids,
                    channel='teacher-to-parents',
                    title=f"New Homework Assigned: {instance.subject_name} - {instance.title}",
                    body=f"For Class {instance.class_name} ({instance.section_name or 'All Sections'}). Due: {instance.due_date}. Instructions: {instance.description[:140]}",
                )
        except Exception as e:
            logging.getLogger(__name__).warning("Failed to auto-send homework notifications: %s", e)

    def perform_update(self, serializer):
        from rest_framework.exceptions import PermissionDenied
        user = self.request.user
        instance = self.get_object()

        # Admin: Full management across all classes
        if user.role in [User.Role.SUPER_ADMIN, User.Role.SCHOOL_ADMIN]:
            saved_instance = serializer.save()
            _store_homework_attachments(
                saved_instance,
                self.request,
                keep_ids=_request_attachment_ids(self.request),
                legacy=saved_instance.attachments,
            )
            try:
                from apps.common.realtime import broadcast_sync_event
                broadcast_sync_event(
                    school_id=saved_instance.school_id,
                    entity='homework',
                    action='updated',
                    entity_id=saved_instance.id,
                    data={'title': saved_instance.title, 'className': saved_instance.class_name, 'subjectName': saved_instance.subject_name}
                )
            except Exception:
                pass
            return

        # Subject Teacher: Only edit homework they personally assigned
        if user.role == User.Role.TEACHER:
            teacher = _active_teacher_profile(user)
            if teacher and instance.teacher_id == teacher.id:
                saved_instance = serializer.save()
                _store_homework_attachments(
                    saved_instance,
                    self.request,
                    keep_ids=_request_attachment_ids(self.request),
                    legacy=saved_instance.attachments,
                )
                try:
                    from apps.common.realtime import broadcast_sync_event
                    broadcast_sync_event(
                        school_id=saved_instance.school_id,
                        entity='homework',
                        action='updated',
                        entity_id=saved_instance.id,
                        data={'title': saved_instance.title, 'className': saved_instance.class_name, 'subjectName': saved_instance.subject_name}
                    )
                except Exception:
                    pass
                return
            raise PermissionDenied("You are only authorized to edit homework that you personally assigned.")

        raise PermissionDenied("You do not have permission to edit homework.")

    def perform_destroy(self, instance):
        from rest_framework.exceptions import PermissionDenied
        user = self.request.user
        school_id = instance.school_id
        homework_id = instance.id

        # Admin: Can remove homework across all classes
        if user.role in [User.Role.SUPER_ADMIN, User.Role.SCHOOL_ADMIN]:
            instance.delete()
            try:
                from apps.common.realtime import broadcast_sync_event
                broadcast_sync_event(school_id=school_id, entity='homework', action='deleted', entity_id=homework_id)
            except Exception:
                pass
            return

        # Subject Teacher: Only remove homework they personally assigned
        if user.role == User.Role.TEACHER:
            teacher = _active_teacher_profile(user)
            if teacher and instance.teacher_id == teacher.id:
                instance.delete()
                try:
                    from apps.common.realtime import broadcast_sync_event
                    broadcast_sync_event(school_id=school_id, entity='homework', action='deleted', entity_id=homework_id)
                except Exception:
                    pass
                return
            raise PermissionDenied(
                "You are only authorized to remove homework that you personally assigned. Contact your school administrator to remove homework assigned by other teachers."
            )

        raise PermissionDenied("You do not have permission to remove homework.")

    @action(detail=True, methods=['get'], url_path=r'attachments/(?P<attachment_id>[^/.]+)')
    def download_attachment(self, request, pk=None, attachment_id=None):
        homework = self.get_object()
        attachment = HomeworkFileAttachment.objects.filter(
            homework=homework, school_id=homework.school_id, pk=attachment_id,
        ).first()
        if not attachment:
            raise Http404

        user = request.user
        if attachment.submission_student_id and user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            if not profile or str(profile.student_id) != attachment.submission_student_id:
                raise Http404
        elif attachment.submission_student_id and user.role == User.Role.PARENT:
            from apps.accounts.models import ParentProfile
            profile = getattr(user, 'parent_profile', None) or ParentProfile.objects.filter(user=user).first()
            if not profile or not profile.students.filter(pk=attachment.submission_student_id).exists():
                raise Http404

        inline_image = (
            request.query_params.get('view') == '1'
            and attachment.content_type in {
                'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
            }
        )
        response = FileResponse(
            BytesIO(bytes(attachment.file_data)),
            as_attachment=not inline_image,
            filename=attachment.file_name,
            content_type=attachment.content_type,
        )
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        response['X-Frame-Options'] = 'SAMEORIGIN'
        return response

    @action(detail=True, methods=['post'], url_path='submit')
    @transaction.atomic
    def submit_homework(self, request, pk=None):
        instance = self.get_object()
        user = request.user
        from apps.sis.models import Student
        import datetime

        student_id = request.data.get('student_id')
        student_name = request.data.get('student_name')
        admission_no = request.data.get('admission_no', '')
        submission_text = request.data.get('submission_text', 'Marked as completed')
        uploaded_attachments = request.FILES.getlist('attachments')
        attachments = [] if uploaded_attachments else request.data.get('attachments', [])

        submitted_by = ''
        if user.role == User.Role.PARENT:
            from apps.accounts.models import ParentProfile
            parent_prof = getattr(user, 'parent_profile', None) or ParentProfile.objects.filter(user=user).first()
            if not parent_prof:
                return Response({'error': 'Parent profile not found.'}, status=status.HTTP_403_FORBIDDEN)
            if not student_id:
                child = parent_prof.students.filter(school_id=instance.school_id).first()
                if not child:
                    return Response({'error': 'No linked children found.'}, status=status.HTTP_403_FORBIDDEN)
            else:
                child = parent_prof.students.filter(school_id=instance.school_id).filter(
                    Q(id=student_id if str(student_id).isdigit() else None) | Q(admission_no=str(student_id))
                ).first()
                if not child:
                    return Response({'error': 'Permission denied. You can only submit homework for your own children.'}, status=status.HTTP_403_FORBIDDEN)
            student_id = str(child.id)
            student_name = child.name
            admission_no = child.admission_no
            parent_display = user.get_full_name() or user.username or 'Parent'
            submitted_by = f"Parent ({parent_display})"
        elif user.role == User.Role.STUDENT:
            student_profile = getattr(user, 'student_profile', None)
            student = getattr(student_profile, 'student', None) if student_profile else None
            if not student:
                student = Student.objects.filter(login_profile__user=user, school_id=instance.school_id).first()
            if not student:
                student = Student.objects.filter(school_id=user.school_id, name__iexact=user.get_full_name()).first()
            if not student or student.school_id != instance.school_id:
                return Response({'error': 'Student profile not found.'}, status=status.HTTP_403_FORBIDDEN)
            student_id = str(student.id)
            student_name = student.name
            admission_no = student.admission_no
            submitted_by = f"Student ({student_name})"
        elif user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            submitted_by = f"{user.get_full_name() or user.username} ({user.role})"
            candidate_id = str(student_id or '').strip()
            if not candidate_id:
                return Response({'error': 'student_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
            candidate_qs = Student.objects.filter(school_id=instance.school_id)
            student = candidate_qs.filter(pk=candidate_id).first() if candidate_id.isdigit() else candidate_qs.filter(admission_no=candidate_id).first()
            if not _homework_targets_student(instance, student):
                return Response({'error': 'Student is not assigned to this homework.'}, status=status.HTTP_404_NOT_FOUND)
            student_id = str(student.pk)
            student_name = student.name
            admission_no = student.admission_no
        else:
            return Response({'error': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        if user.role in [User.Role.STUDENT, User.Role.PARENT]:
            student_obj = Student.objects.filter(pk=student_id, school_id=instance.school_id).first()
            if not _homework_targets_student(instance, student_obj):
                return Response({'error': 'Student is not assigned to this homework.'}, status=status.HTTP_404_NOT_FOUND)

        if not student_id:
            student_id = str(user.id)
            student_name = student_name or user.get_full_name() or user.username

        attachments = _store_homework_attachments(
            instance,
            request,
            student=student,
            legacy=attachments,
        )

        submissions = list(instance.submissions or [])
        existing = next((s for s in submissions if str(s.get('student_id')) == str(student_id)), None)
        today_iso = datetime.datetime.now().isoformat()

        if existing:
            existing['status'] = 'Submitted'
            existing['submitted_at'] = today_iso
            existing['submission_text'] = submission_text
            existing['submitted_by'] = submitted_by
            if attachments is not None:
                existing['attachments'] = attachments
        else:
            submissions.append({
                'student_id': str(student_id),
                'student_name': student_name or f"Student {student_id}",
                'admission_no': admission_no,
                'submitted_by': submitted_by,
                'status': 'Submitted',
                'submitted_at': today_iso,
                'submission_text': submission_text,
                'attachments': attachments or [],
                'marks_obtained': None,
                'teacher_feedback': '',
            })

        instance.submissions = submissions
        instance.save(update_fields=['submissions', 'updated_at'])

        try:
            from apps.common.realtime import broadcast_sync_event
            broadcast_sync_event(
                school_id=instance.school_id,
                entity='homework',
                action='submitted',
                entity_id=instance.id,
                data={'studentId': student_id, 'studentName': student_name, 'status': 'Submitted'}
            )
        except Exception:
            pass

        # Notify teacher that a student/parent submitted homework
        try:
            if instance.teacher and getattr(instance.teacher, 'user', None):
                from apps.notifications.services import create_notification
                submitter_label = f"{student_name} ({submitted_by})" if submitted_by else student_name
                create_notification(
                    school=instance.school,
                    recipient=instance.teacher.user,
                    title=f"Homework Submitted: {instance.subject_name}",
                    body=f"{submitter_label} submitted homework '{instance.title}' for Class {instance.class_name}.",
                    category="Homework",
                    channel="school-to-teachers",
                    sender=user,
                    related={"homeworkId": instance.id, "studentId": student_id},
                )
        except Exception:
            pass

        return Response({
            'message': 'Homework submitted successfully',
            'homework': HomeworkSerializer(instance, context={'request': request}).data
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='grade')
    def grade_submission(self, request, pk=None):
        instance = self.get_object()
        user = request.user
        if user.role not in [User.Role.TEACHER, User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'error': 'Permission denied. Only teachers and school administrators can grade submissions.'}, status=status.HTTP_403_FORBIDDEN)

        if user.role == User.Role.TEACHER:
            teacher = _active_teacher_profile(user)
            if not teacher:
                return Response({'error': 'Teacher profile not found.'}, status=status.HTTP_403_FORBIDDEN)
            is_assigned = (instance.teacher_id == teacher.id)
            is_class_teacher = (
                (instance.class_room and instance.class_room.class_teacher_id == teacher.id) or
                (instance.section and instance.section.class_teacher_id == teacher.id)
            )
            if not is_assigned and not is_class_teacher:
                return Response({'error': 'Permission denied. You are not authorized to grade submissions for this homework.'}, status=status.HTTP_403_FORBIDDEN)

        student_id = request.data.get('student_id')
        marks = request.data.get('marks_obtained')
        feedback = request.data.get('teacher_feedback', '')

        if not student_id:
            return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        submissions = list(instance.submissions or [])
        existing = next((s for s in submissions if str(s.get('student_id')) == str(student_id)), None)
        if not existing:
            return Response({'error': 'Student submission not found'}, status=status.HTTP_404_NOT_FOUND)
        from apps.sis.models import Student
        target_student_qs = Student.objects.filter(school_id=instance.school_id)
        target_student = target_student_qs.filter(pk=student_id).first() if str(student_id).isdigit() else target_student_qs.filter(admission_no=str(student_id)).first()
        if not _homework_targets_student(instance, target_student):
            return Response({'error': 'Student is not assigned to this homework.'}, status=status.HTTP_404_NOT_FOUND)

        existing['status'] = 'Graded'
        existing['marks_obtained'] = marks
        existing['teacher_feedback'] = feedback

        instance.submissions = submissions
        instance.save(update_fields=['submissions', 'updated_at'])

        # Notify student and parents that homework was graded
        try:
            from apps.notifications.services import notify_student_and_parents
            if target_student:
                notify_student_and_parents(
                    target_student,
                    title=f"Homework Graded: {instance.subject_name}",
                    body=f"Your submission for '{instance.title}' was evaluated. Score: {marks}/{instance.max_marks}. Feedback: {feedback or 'Checked'}.",
                    category="Homework",
                    channel="school-to-students",
                    sender=request.user,
                    related={"homeworkId": instance.id, "marks": marks, "maxMarks": instance.max_marks},
                )
        except Exception:
            pass

        return Response({
            'message': 'Submission graded successfully',
            'homework': HomeworkSerializer(instance, context={'request': request}).data
        }, status=status.HTTP_200_OK)

