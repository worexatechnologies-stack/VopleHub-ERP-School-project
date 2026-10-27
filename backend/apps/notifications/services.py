import logging
import uuid
from django.db import transaction

from apps.accounts.models import ParentProfile, StudentProfile, User
from apps.staff.models import Teacher
from .models import Notification
from .tasks import enqueue_fcm_notification

logger = logging.getLogger(__name__)



from django.utils import timezone

def _dispatch_ws_notification(user_id: int, notif):
    try:
        from apps.chat.outbox import record_outbox_event
        payload = {
            "id": getattr(notif, "id", None),
            "title": getattr(notif, "title", ""),
            "body": getattr(notif, "body", ""),
            "category": getattr(notif, "category", "General"),
            "channel": getattr(notif, "channel", "system"),
            "createdAt": timezone.now().isoformat(),
            "related": getattr(notif, "related_object", {}) or {},
        }
        record_outbox_event(
            event_type="notification.created",
            channel_name=f"user_{user_id}",
            payload=payload,
        )
    except Exception as exc:
        logger.warning("Could not record outbox event for notification: %s", exc)

def create_notification(
    school,
    recipient,
    title: str,
    body: str,
    category: str = 'General',
    channel: str = 'system',
    sender=None,
    related: dict = None,
    status: str = 'Pending',
):
    """Dispatch a single database notification and best-effort push notification."""
    if not recipient or not getattr(recipient, 'id', None) or not school:
        return None

    school_id = getattr(school, 'id', school)
    recipient_school = getattr(recipient, 'school_id', None)
    if recipient_school and recipient_school != school_id:
        return None

    related_data = related or {}
    notif = Notification.objects.create(
        school_id=school_id,
        sender=sender,
        recipient_id=recipient.id,
        category=category,
        title=title,
        body=body,
        channel=channel,
        status=status,
        related_object=related_data,
    )

    try:
        transaction.on_commit(lambda: enqueue_fcm_notification(
            [recipient.id],
            title=title,
            body=body,
            category=category,
            data=related_data,
        ))
    except Exception as exc:
        logger.warning('Could not enqueue FCM notification: %s', exc)

    try:
        _dispatch_ws_notification(recipient.id, notif)
    except Exception:
        pass

    return notif


def create_bulk_notifications(
    school,
    recipients,
    title: str,
    body: str,
    category: str = 'General',
    channel: str = 'system',
    sender=None,
    sender_id=None,
    related: dict = None,
    status: str = 'Pending',
    broadcast_id=None,
):
    """Dispatch bulk database notifications and FCM push notifications efficiently."""
    school_id = getattr(school, 'id', school)
    if not school_id or not recipients:
        return 0

    recipient_map = {}
    for user in recipients:
        if user and getattr(user, 'id', None):
            user_school = getattr(user, 'school_id', None)
            if not user_school or user_school == school_id:
                recipient_map[user.id] = user

    if not recipient_map:
        return 0

    related_data = related or {}
    broadcast_id = broadcast_id or uuid.uuid4()
    if not isinstance(broadcast_id, uuid.UUID):
        broadcast_id = uuid.UUID(str(broadcast_id))
    existing_ids = set(
        Notification.objects.filter(
            broadcast_id=broadcast_id,
            recipient_id__in=recipient_map.keys(),
        ).values_list('recipient_id', flat=True)
    )
    recipient_map = {
        uid: user for uid, user in recipient_map.items() if uid not in existing_ids
    }
    if not recipient_map:
        return 0
    rows = [
        Notification(
            school_id=school_id,
            sender=sender,
            sender_id=sender_id if sender is None else None,
            recipient_id=uid,
            channel=channel,
            category=category,
            title=title,
            body=body,
            broadcast_id=broadcast_id,
            status=status,
            related_object=related_data,
        )
        for uid in recipient_map.keys()
    ]

    Notification.objects.bulk_create(rows)

    try:
        user_ids = sorted(recipient_map.keys())
        transaction.on_commit(lambda: enqueue_fcm_notification(
            user_ids,
            title=title,
            body=body,
            category=category,
            data=related_data,
        ))
    except Exception as exc:
        logger.warning('Could not enqueue bulk FCM notifications: %s', exc)

    try:
        for row in rows:
            _dispatch_ws_notification(row.recipient_id, row)
    except Exception:
        pass

    return len(rows)


def notify_parents_of_student(
    student,
    title: str,
    body: str,
    category: str = 'General',
    channel: str = 'school-to-parents',
    sender=None,
    related: dict = None,
):
    """Notify all parents linked to a student."""
    if not student:
        return 0
    parent_profiles = student.parent_profiles.select_related('user').all()
    parent_users = [p.user for p in parent_profiles if p.user and p.user.is_active]
    meta = related or {}
    meta.setdefault('studentId', student.id)
    meta.setdefault('studentName', student.name)
    meta.setdefault('admissionNo', student.admission_no)
    return create_bulk_notifications(
        school=student.school,
        recipients=parent_users,
        title=title,
        body=body,
        category=category,
        channel=channel,
        sender=sender,
        related=meta,
    )


def notify_student_user(
    student,
    title: str,
    body: str,
    category: str = 'General',
    channel: str = 'school-to-students',
    sender=None,
    related: dict = None,
):
    """Notify student's own portal user account."""
    if not student:
        return None
    student_profile = getattr(student, 'login_profile', None)
    if not student_profile:
        student_profile = StudentProfile.objects.filter(student=student).select_related('user').first()

    if student_profile and student_profile.user and student_profile.user.is_active:
        meta = related or {}
        meta.setdefault('studentId', student.id)
        meta.setdefault('studentName', student.name)
        return create_notification(
            school=student.school,
            recipient=student_profile.user,
            title=title,
            body=body,
            category=category,
            channel=channel,
            sender=sender,
            related=meta,
        )
    return None


def notify_student_and_parents(
    student,
    title: str,
    body: str,
    category: str = 'General',
    channel: str = 'general',
    sender=None,
    related: dict = None,
):
    """Notify both student user and linked parents."""
    if not student:
        return 0
    count = 0
    st_notif = notify_student_user(student, title, body, category=category, channel=channel, sender=sender, related=related)
    if st_notif:
        count += 1
    count += notify_parents_of_student(student, title, body, category=category, channel=channel, sender=sender, related=related)
    return count


def notify_class_students_and_parents(
    school,
    students,
    title: str,
    body: str,
    category: str = 'General',
    channel: str = 'general',
    sender=None,
    related: dict = None,
):
    """Notify students and parents across a list of students."""
    if not students:
        return 0

    student_list = list(students)
    student_ids = [s.id for s in student_list]

    # Collect student portal users
    student_user_ids = list(StudentProfile.objects.filter(student_id__in=student_ids).values_list('user_id', flat=True))
    student_users = list(User.objects.filter(id__in=student_user_ids, is_active=True))

    # Collect parent portal users
    parent_profiles = ParentProfile.objects.filter(students__in=student_list).select_related('user').distinct()
    parent_users = [p.user for p in parent_profiles if p.user and p.user.is_active]

    all_users = list({u.id: u for u in (student_users + parent_users)}.values())
    meta = related or {}
    meta.setdefault('studentCount', len(student_list))
    meta.setdefault('studentIds', student_ids[:20])

    return create_bulk_notifications(
        school=school,
        recipients=all_users,
        title=title,
        body=body,
        category=category,
        channel=channel,
        sender=sender,
        related=meta,
    )


def notify_school_admins(
    school,
    title: str,
    body: str,
    category: str = 'System',
    channel: str = 'system',
    sender=None,
    related: dict = None,
):
    """Notify school administrator accounts of a tenant school."""
    school_id = getattr(school, 'id', school)
    if not school_id:
        return 0
    admins = list(User.objects.filter(school_id=school_id, role=User.Role.SCHOOL_ADMIN, is_active=True))
    return create_bulk_notifications(
        school=school,
        recipients=admins,
        title=title,
        body=body,
        category=category,
        channel=channel,
        sender=sender,
        related=related or {},
    )


def notify_teacher_user(
    teacher,
    title: str,
    body: str,
    category: str = 'Staff',
    channel: str = 'school-to-teachers',
    sender=None,
    related: dict = None,
):
    """Notify a specific teacher."""
    if not teacher or not getattr(teacher, 'user', None) or not teacher.user.is_active:
        return None
    return create_notification(
        school=teacher.school,
        recipient=teacher.user,
        title=title,
        body=body,
        category=category,
        channel=channel,
        sender=sender,
        related=related or {},
    )


def notify_all_teachers(
    school,
    title: str,
    body: str,
    category: str = 'Staff',
    channel: str = 'school-to-teachers',
    sender=None,
    related: dict = None,
):
    """Notify all active teachers in a school tenant."""
    school_id = getattr(school, 'id', school)
    if not school_id:
        return 0
    teachers = Teacher.objects.filter(school_id=school_id, status=Teacher.Status.ACTIVE).select_related('user')
    teacher_users = [t.user for t in teachers if t.user and t.user.is_active]
    return create_bulk_notifications(
        school=school,
        recipients=teacher_users,
        title=title,
        body=body,
        category=category,
        channel=channel,
        sender=sender,
        related=related or {},
    )
