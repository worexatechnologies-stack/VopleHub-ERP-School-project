"""Role-based authorization and permission rules for School Messaging Platform.

Strictly enforces:
1. Tenant Isolation: All actions must be within the user's school.
2. Parent Boundary: Parents can only message teachers assigned to their active enrolled children.
3. Teacher Boundary: Teachers can only message parents of students in their assigned sections/subjects, or school admins.
4. Admin Boundary: School admins can communicate with teachers (no surveillance or unrestricted read into private parent-teacher messages).
5. Student Restriction: Direct student messaging is prohibited.
"""
from rest_framework import permissions
from apps.accounts.models import ParentProfile, User
from apps.staff.models import Teacher
from apps.sis.models import Student
from .models import Conversation, DirectMessage, MessageAttachment


def check_teacher_matches_student(teacher: Teacher, student: Student) -> bool:
    """Validate whether teacher teaches the given student via canonical or assigned sections."""
    if not teacher or teacher.status != Teacher.Status.ACTIVE or not student or student.status != 'Active':
        return False

    s_class = (student.class_name or '').replace('Class', '').strip().lower()
    s_sec = (student.section or '').replace('Section', '').replace('Sec', '').strip().lower()
    s_sec_id = student.section_record_id

    # 1. Direct section record link
    if s_sec_id:
        if teacher.sections.filter(id=s_sec_id).exists() or teacher.teaching_assignments.filter(section_id=s_sec_id).exists():
            return True

    # 2. Section and class name via teaching assignments
    for ta in teacher.teaching_assignments.select_related('section__class_room').all():
        if not ta.section:
            continue
        ta_class = (ta.section.class_room.name or '').replace('Class', '').strip().lower() if hasattr(ta.section, 'class_room') and ta.section.class_room else ''
        ta_sec = (ta.section.name or '').replace('Section', '').replace('Sec', '').strip().lower()
        if (s_sec_id and ta.section_id == s_sec_id) or (ta_sec == s_sec and (not ta_class or ta_class == s_class)):
            return True

    # 3. Canonical sections M2M
    for sec in teacher.sections.select_related('class_room').all():
        sec_class = (sec.class_room.name or '').replace('Class', '').strip().lower() if hasattr(sec, 'class_room') and sec.class_room else ''
        sec_name = (sec.name or '').replace('Section', '').replace('Sec', '').strip().lower()
        if (s_sec_id and sec.id == s_sec_id) or (sec_name == s_sec and (not sec_class or sec_class == s_class)):
            return True

    # 4. Fallback text assigned_sections
    if teacher.assigned_sections:
        for asec in teacher.assigned_sections:
            asec_clean = asec.replace('Class', '').replace('Section', '').replace('Sec', '').strip().lower()
            if ' - ' in asec:
                parts = asec.split(' - ')
                c_part = parts[0].replace('Class', '').strip().lower()
                s_part = parts[1].replace('Sec', '').replace('Section', '').strip().lower()
                if c_part == s_class and s_part == s_sec:
                    return True
            elif f'{s_class}-{s_sec}' in asec_clean.replace(' ', '') or (s_class in asec_clean and s_sec in asec_clean):
                return True

    return False


def can_initiate_conversation(user: User, target_user: User, student: Student = None) -> tuple[bool, str, Student | None]:
    """Validate if user is authorized to create/access a conversation with target_user."""
    if not user.is_authenticated or not target_user:
        return False, 'Authentication required.', None

    if user.id == target_user.id:
        return False, 'Cannot start a conversation with yourself.', None

    # Tenant check
    if user.school_id != target_user.school_id:
        return False, 'Cross-school messaging is prohibited.', None

    # Student accounts blocked from direct chat
    if user.role == User.Role.STUDENT or target_user.role == User.Role.STUDENT:
        return False, 'Direct messaging is not available for student accounts.', None

    # 1. School Admin
    if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
        if target_user.role != User.Role.TEACHER:
            return False, 'School Admins can only direct chat with teachers.', None
        return True, '', None

    # 2. Teacher
    if user.role == User.Role.TEACHER:
        teacher_profile = getattr(user, 'teacher_profile', None)
        if not teacher_profile or teacher_profile.status != Teacher.Status.ACTIVE:
            return False, 'Active teacher profile required.', None

        # Teacher to Admin
        if target_user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return True, '', None

        # Teacher to Parent
        if target_user.role == User.Role.PARENT:
            parent_profile = getattr(target_user, 'parent_profile', None)
            if not parent_profile:
                return False, 'Parent profile not found.', None

            linked_students = list(parent_profile.students.filter(school_id=user.school_id, status='Active'))
            matched_student = None

            if student:
                if student in linked_students and check_teacher_matches_student(teacher_profile, student):
                    matched_student = student
                else:
                    return False, 'You are not assigned to teach this student.', None
            else:
                for st in linked_students:
                    if check_teacher_matches_student(teacher_profile, st):
                        matched_student = st
                        break

            if not matched_student:
                return False, 'You can only message parents of students assigned to your classes.', None

            return True, '', matched_student

        return False, 'Teachers may only message School Admins or parents of assigned students.', None

    # 3. Parent
    if user.role == User.Role.PARENT:
        if target_user.role != User.Role.TEACHER:
            return False, "Parents can only direct chat with their children's teachers.", None

        parent_profile = getattr(user, 'parent_profile', None)
        if not parent_profile:
            return False, 'Parent profile not found.', None

        teacher_profile = getattr(target_user, 'teacher_profile', None)
        if not teacher_profile or teacher_profile.status != Teacher.Status.ACTIVE:
            return False, 'Teacher profile not found or inactive.', None

        linked_students = list(parent_profile.students.filter(school_id=user.school_id, status='Active'))
        matched_student = None

        if student:
            if student in linked_students and check_teacher_matches_student(teacher_profile, student):
                matched_student = student
            else:
                return False, 'This teacher is not assigned to the specified child.', None
        else:
            for st in linked_students:
                if check_teacher_matches_student(teacher_profile, st):
                    matched_student = st
                    break

        if not matched_student:
            return False, 'You can only message teachers currently assigned to your children.', None

        return True, '', matched_student

    return False, 'Unauthorized role for messaging.', None


def is_user_in_conversation(user: User, conversation: Conversation) -> bool:
    """Check if the user is a participant in the conversation within the same school."""
    if not user.is_authenticated or not conversation:
        return False
    if conversation.school_id != user.school_id:
        return False
    return conversation.participants.filter(user_id=user.id).exists() or user.id in (
        conversation.participant1_id, conversation.participant2_id
    )


class IsConversationParticipant(permissions.BasePermission):
    """Ensure requesting user is an authorized participant in the conversation."""

    def has_object_permission(self, request, view, obj):
        if not request.user.is_authenticated:
            return False
        conversation = obj if isinstance(obj, Conversation) else getattr(obj, 'conversation', None)
        if not conversation:
            return False
        return is_user_in_conversation(request.user, conversation)
