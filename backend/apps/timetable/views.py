from django.db import transaction
from django.db.models import Case, IntegerField, Value, When
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.accounts.models import User
from apps.academics.models import Section
from apps.common.tenancy import TenantScopedViewSet
from apps.staff.models import Teacher

from .models import TimetableSlot
from .serializers import (
    TimetablePublishResponseSerializer,
    TimetablePublishSerializer,
    TimetableSlotSerializer,
)


class TimetableSlotPagination(PageNumberPagination):
    page_size = 500
    page_size_query_param = 'page_size'
    max_page_size = 1000


def _order_slots(queryset):
    day_order = Case(
        When(day=TimetableSlot.Day.MONDAY, then=Value(1)),
        When(day=TimetableSlot.Day.TUESDAY, then=Value(2)),
        When(day=TimetableSlot.Day.WEDNESDAY, then=Value(3)),
        When(day=TimetableSlot.Day.THURSDAY, then=Value(4)),
        When(day=TimetableSlot.Day.FRIDAY, then=Value(5)),
        When(day=TimetableSlot.Day.SATURDAY, then=Value(6)),
        default=Value(7),
        output_field=IntegerField(),
    )
    return queryset.annotate(_day_order=day_order)


class TimetableAccessPermission(permissions.BasePermission):
    allowed_roles = {
        User.Role.SCHOOL_ADMIN, User.Role.TEACHER,
        User.Role.STUDENT, User.Role.PARENT,
    }

    def has_permission(self, request, view):
        if (
            not request.user.is_authenticated
            or request.user.role not in self.allowed_roles
            or not request.user.school_id
        ):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role == User.Role.SCHOOL_ADMIN


def _student_section_ids(students, school_id):
    """Return canonical sections, safely resolving any remaining legacy rows."""
    section_ids = set(
        students.exclude(section_record_id=None)
        .values_list('section_record_id', flat=True)
    )
    legacy_pairs = set(
        students.filter(section_record_id=None)
        .values_list('class_name', 'section')
    )
    if legacy_pairs:
        for class_name, section_name in legacy_pairs:
            matches = list(Section.objects.filter(
                school_id=school_id,
                class_room__name__iexact=class_name, name__iexact=section_name,
            ).values_list('pk', flat=True)[:2])
            # Ambiguous legacy labels fail closed instead of revealing another
            # section. New records always carry the canonical foreign key.
            if len(matches) == 1:
                section_ids.add(matches[0])
    return section_ids


class TimetableSlotViewSet(TenantScopedViewSet):
    """Persisted timetable slots, always restricted to the caller's role."""

    permission_classes = [TimetableAccessPermission]
    serializer_class = TimetableSlotSerializer
    pagination_class = TimetableSlotPagination
    queryset = TimetableSlot.objects.select_related(
        'school', 'academic_year', 'section__class_room', 'subject',
        'teacher__user',
    )

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, 'swagger_fake_view', False):
            return queryset.none()
        user = self.request.user
        if user.role == User.Role.SCHOOL_ADMIN:
            pass
        elif user.role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None)
            queryset = queryset.filter(
                teacher_id=teacher.pk, published=True,
            ) if (
                teacher
                and teacher.user_id == user.pk
                and teacher.school_id == user.school_id
                and teacher.status == Teacher.Status.ACTIVE
            ) else queryset.none()
        elif user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            has_tenant_student = (
                profile
                and profile.user_id == user.pk
                and profile.student.school_id == user.school_id
                and profile.student.section_record_id
            )
            queryset = queryset.filter(
                section_id=profile.student.section_record_id, published=True,
            ) if has_tenant_student else queryset.none()
        elif user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            if not profile or profile.user_id != user.pk:
                queryset = queryset.none()
            else:
                students = profile.students.filter(school_id=user.school_id)
                queryset = queryset.filter(
                    section_id__in=_student_section_ids(students, user.school_id),
                    published=True,
                )
        else:
            queryset = queryset.none()

        if academic_year := self.request.query_params.get('academicYear'):
            queryset = queryset.filter(academic_year__name__iexact=academic_year)
        if section_id := self.request.query_params.get('sectionId'):
            queryset = queryset.filter(section_id=section_id)
        return _order_slots(queryset).order_by('section_id', '_day_order', 'period', 'pk')

    @extend_schema(
        request=TimetablePublishSerializer,
        responses={status.HTTP_200_OK: TimetablePublishResponseSerializer},
    )
    @action(detail=False, methods=['post'], url_path='publish')
    def publish(self, request):
        validator = TimetablePublishSerializer(
            data=request.data, context={'request': request},
        )
        validator.is_valid(raise_exception=True)
        data = validator.validated_data
        slots = self.get_tenant_queryset().filter(
            academic_year__name__iexact=data['academicYear'],
            section_id=data['sectionId'],
        )
        with transaction.atomic():
            updated = slots.filter(published=False).update(published=True)

        # Notify students and parents of published timetable
        try:
            from apps.sis.models import Student
            from apps.notifications.services import notify_class_students_and_parents
            section_obj = Section.objects.filter(pk=data['sectionId'], school_id=request.user.school_id).select_related('class_room').first()
            if section_obj:
                cls_name = section_obj.class_room.name if section_obj.class_room else 'Class'
                students = Student.objects.filter(school_id=request.user.school_id, section_record=section_obj, status=Student.Status.ACTIVE)
                notify_class_students_and_parents(
                    school=request.user.school,
                    students=students,
                    title="Timetable Published",
                    body=f"The official class schedule for {cls_name} - Section {section_obj.name} has been published.",
                    category="Timetable",
                    channel="timetable",
                    sender=request.user,
                    related={'sectionId': section_obj.id, 'className': cls_name, 'sectionName': section_obj.name},
                )
        except Exception:
            pass

        response_slots = _order_slots(
            self.queryset.filter(pk__in=slots.values('pk'))
        ).order_by('_day_order', 'period', 'pk')
        return Response({
            'updated': updated,
            'slots': self.get_serializer(response_slots, many=True).data,
        }, status=status.HTTP_200_OK)
