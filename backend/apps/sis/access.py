"""Canonical, tenant-safe student access rules shared across applications."""

from django.db.models import QuerySet

from apps.staff.models import Teacher

from .models import Student


def teacher_student_queryset(
    profile: Teacher | None,
    queryset: QuerySet | None = None,
    *,
    school_id: int | None = None,
) -> QuerySet:
    """Return students in sections canonically assigned to an active teacher.

    ``assigned_sections`` is a legacy display/transition field and is never an
    authorization source.  Passing ``school_id`` is recommended at API
    boundaries so a corrupted or incorrectly attached profile also fails
    closed instead of crossing a tenant boundary.
    """

    students = queryset if queryset is not None else Student.objects.all()
    if not profile:
        return students.none()

    tenant_id = school_id if school_id is not None else profile.school_id
    if not tenant_id or profile.school_id != tenant_id or profile.status != Teacher.Status.ACTIVE:
        return students.none()

    assigned_sections = profile.sections.filter(school_id=tenant_id)
    return students.filter(
        school_id=tenant_id,
        section_record__in=assigned_sections,
    ).distinct()


def teacher_can_access_student(
    profile: Teacher | None,
    student: Student,
    *,
    school_id: int | None = None,
) -> bool:
    """Check one student using the same canonical rule as collection access."""

    if not student.section_record_id:
        return False
    tenant_id = school_id if school_id is not None else student.school_id
    if tenant_id != student.school_id:
        return False
    return teacher_student_queryset(
        profile,
        Student.objects.filter(pk=student.pk),
        school_id=tenant_id,
    ).exists()
