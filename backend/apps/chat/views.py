import uuid
import mimetypes
from django.db import transaction
from django.db.models import Q, Prefetch, Max
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import serializers
from drf_spectacular.utils import OpenApiResponse, OpenApiTypes, extend_schema, inline_serializer

from apps.accounts.models import ParentProfile, User
from apps.staff.models import Teacher
from apps.sis.models import Student
from .models import (
    ChatAuditLog,
    ChatbotInteraction,
    Conversation,
    ConversationParticipant,
    DirectMessage,
    MessageAttachment,
    OutboxEvent,
)
from .serializers import (
    ConversationSerializer,
    DirectMessageSerializer,
    MessageAttachmentSerializer,
)
from .permissions import (
    can_initiate_conversation,
    check_teacher_matches_student,
    is_user_in_conversation,
)
from .outbox import record_outbox_event
from .services import answer_question, student_snapshot


def get_teacher_permitted_students(teacher, school_id):
    if not teacher or teacher.status != Teacher.Status.ACTIVE:
        return Student.objects.none()

    section_ids = list(teacher.sections.values_list('id', flat=True))
    assignment_section_ids = list(teacher.teaching_assignments.values_list('section_id', flat=True))
    all_section_ids = set(section_ids + assignment_section_ids)

    text_sections = teacher.assigned_sections or []

    qs = Student.objects.filter(school_id=school_id, status='Active')
    filters = Q()
    if all_section_ids:
        filters |= Q(section_record_id__in=all_section_ids)

    if text_sections:
        for tsec in text_sections:
            if ' - ' in tsec:
                parts = tsec.split(' - ')
                c_part = parts[0].replace('Class', '').strip()
                s_part = parts[1].replace('Sec', '').replace('Section', '').strip()
                filters |= Q(class_name__icontains=c_part, section__iexact=s_part)
            else:
                tsec_clean = tsec.replace('Class', '').replace('Section', '').replace('Sec', '').strip()
                parts = tsec_clean.split()
                if len(parts) >= 2:
                    filters |= Q(class_name__icontains=parts[0], section__icontains=parts[1])
                elif len(parts) == 1:
                    filters |= Q(section__iexact=parts[0])

    if not filters:
        return Student.objects.none()
    return qs.filter(filters).distinct()


class ChatContactsListView(APIView):
    """Returns role-scoped chat contacts with rich differentiation:
    - School Admin: Teachers with assigned classes, sections, and subjects.
    - Teacher: School Admin (Office Desk) + Parents of assigned students.
    - Parent: Teachers of all linked active children.
    """
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        user = request.user
        school = user.school
        if not school:
            return Response([])

        search_q = request.GET.get('search', '').strip()

        # 1. ADMIN
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            contacts = []
            other_admin = User.objects.filter(school=school, role=User.Role.SCHOOL_ADMIN, is_active=True).exclude(pk=user.id).first()
            if other_admin:
                contacts.append({
                    'id': f'admin-{other_admin.id}',
                    'userId': other_admin.id,
                    'name': other_admin.get_full_name() or other_admin.username or 'Administrative Office',
                    'role': 'School Admin',
                    'email': other_admin.email,
                    'phone': '',
                    'isOnline': other_admin.is_online_computed,
                    'lastSeenAt': other_admin.last_seen_at.isoformat() if other_admin.last_seen_at else None,
                    'isOfficeDesk': True,
                })

            teachers_qs = Teacher.objects.filter(school=school, status='Active').select_related('user').prefetch_related(
                'sections__class_room', 'subject_records', 'teaching_assignments__section__class_room', 'teaching_assignments__subject'
            )
            if search_q:
                teachers_qs = teachers_qs.filter(
                    Q(user__first_name__icontains=search_q) |
                    Q(user__last_name__icontains=search_q) |
                    Q(user__email__icontains=search_q) |
                    Q(subjects__icontains=search_q) |
                    Q(phone__icontains=search_q)
                )[:25]
            else:
                teachers_qs = teachers_qs[:35]

            for t in teachers_qs:
                assigned_sections = list(t.assigned_sections or [])
                for s in t.sections.all():
                    label = f"{s.class_room.name} - Sec {s.name}" if hasattr(s, 'class_room') and s.class_room else f"Sec {s.name}"
                    if label not in assigned_sections:
                        assigned_sections.append(label)
                for ta in t.teaching_assignments.all():
                    label = f"{ta.section.class_room.name} - Sec {ta.section.name}" if hasattr(ta.section, 'class_room') and ta.section.class_room else f"Sec {ta.section.name}"
                    if label not in assigned_sections:
                        assigned_sections.append(label)

                subjects = list(t.subjects or [])
                for sub in t.subject_records.all():
                    if sub.name not in subjects:
                        subjects.append(sub.name)
                for ta in t.teaching_assignments.all():
                    if ta.subject and ta.subject.name not in subjects:
                        subjects.append(ta.subject.name)

                assignments_data = [
                    {
                        'classId': ta.section.class_room_id if hasattr(ta.section, 'class_room') and ta.section.class_room else None,
                        'className': ta.section.class_room.name if hasattr(ta.section, 'class_room') and ta.section.class_room else '',
                        'sectionId': ta.section_id,
                        'sectionName': ta.section.name if ta.section else '',
                        'subjectId': ta.subject_id,
                        'subjectName': ta.subject.name if ta.subject else '',
                    }
                    for ta in t.teaching_assignments.all()
                ]

                contacts.append({
                    'id': t.id,
                    'userId': t.user_id,
                    'name': t.user.get_full_name() or t.user.username or f"Teacher #{t.id}",
                    'role': 'Teacher',
                    'email': t.user.email,
                    'phone': t.phone or '',
                    'isOnline': t.user.is_online_computed,
                    'lastSeenAt': t.user.last_seen_at.isoformat() if t.user.last_seen_at else None,
                    'assignedSections': assigned_sections,
                    'subjects': subjects,
                    'teachingAssignments': assignments_data,
                })

            # Include active parents for the Admin (both in search and initial contacts)
            parents_qs = ParentProfile.objects.filter(
                user__school=school, user__is_active=True
            ).exclude(user=user)
            if search_q:
                parents_qs = parents_qs.filter(
                    Q(user__first_name__icontains=search_q) |
                    Q(user__last_name__icontains=search_q) |
                    Q(user__email__icontains=search_q) |
                    Q(phone__icontains=search_q) |
                    Q(students__name__icontains=search_q) |
                    Q(students__admission_no__icontains=search_q)
                ).distinct().select_related('user').prefetch_related('students')[:25]
            else:
                parents_qs = parents_qs.distinct().select_related('user').prefetch_related('students')[:25]

            for pp in parents_qs:
                p_user = pp.user
                if not p_user or p_user.id == user.id:
                    continue
                st_list = [
                    {
                        'id': s.id,
                        'name': s.name,
                        'className': s.class_name,
                        'section': s.section,
                        'rollNo': s.roll_no,
                        'admissionNo': s.admission_no,
                    }
                    for s in pp.students.filter(school=school, status='Active')
                ]
                summaries = [f"{s['name']} ({s['className']} - Sec {s['section']})" for s in st_list]
                contacts.append({
                    'id': f'parent-{p_user.id}',
                    'userId': p_user.id,
                    'name': p_user.get_full_name() or p_user.username,
                    'role': 'Parent',
                    'email': p_user.email,
                    'phone': pp.phone or '',
                    'isOnline': p_user.is_online_computed,
                    'lastSeenAt': p_user.last_seen_at.isoformat() if p_user.last_seen_at else None,
                    'students': st_list,
                    'studentSummary': f"Parent of {', '.join(summaries)}" if summaries else 'Parent',
                    'studentNames': [s['name'] for s in st_list],
                })

            contacts = [c for c in contacts if c.get('userId') != user.id]
            return Response(contacts)

        # 2. TEACHER
        elif user.role == User.Role.TEACHER:
            teacher_profile = getattr(user, 'teacher_profile', None)
            if not teacher_profile:
                return Response([])

            contacts = []
            admin_user = User.objects.filter(school=school, role=User.Role.SCHOOL_ADMIN, is_active=True).first()
            if admin_user:
                contacts.append({
                    'id': 'admin-office',
                    'userId': admin_user.id,
                    'name': 'School Admin / Office Desk',
                    'role': 'School Admin',
                    'email': admin_user.email,
                    'phone': '',
                    'isOnline': admin_user.is_online_computed,
                    'lastSeenAt': admin_user.last_seen_at.isoformat() if admin_user.last_seen_at else None,
                    'isOfficeDesk': True,
                })

            permitted_students_qs = get_teacher_permitted_students(teacher_profile, school.id)
            if search_q:
                permitted_students_qs = permitted_students_qs.filter(
                    Q(name__icontains=search_q) |
                    Q(admission_no__icontains=search_q) |
                    Q(roll_no__icontains=search_q) |
                    Q(parent_name__icontains=search_q) |
                    Q(parent_profiles__user__first_name__icontains=search_q) |
                    Q(parent_profiles__user__last_name__icontains=search_q) |
                    Q(parent_profiles__phone__icontains=search_q)
                ).distinct()[:30]
            else:
                # Limit initial contacts scan to 25 to guarantee instant load times without lag
                permitted_students_qs = permitted_students_qs[:25]

            permitted_students = permitted_students_qs.prefetch_related('parent_profiles__user')
            parent_map = {}
            for student in permitted_students:
                for pp in student.parent_profiles.all():
                    p_user = pp.user
                    if not p_user or not p_user.is_active:
                        continue
                    p_key = p_user.id
                    if p_key not in parent_map:
                        parent_map[p_key] = {
                            'id': f'parent-{p_user.id}',
                            'userId': p_user.id,
                            'name': p_user.get_full_name() or student.parent_name or p_user.username,
                            'role': 'Parent',
                            'email': p_user.email,
                            'phone': pp.phone or student.parent_phone or '',
                            'isOnline': p_user.is_online_computed,
                    'lastSeenAt': p_user.last_seen_at.isoformat() if p_user.last_seen_at else None,
                            'students': [],
                            'assignedSections': [],
                        }

                    s_info = {
                        'id': student.id,
                        'name': student.name,
                        'className': student.class_name,
                        'section': student.section,
                        'rollNo': student.roll_no,
                        'admissionNo': student.admission_no,
                    }
                    if not any(s['id'] == student.id for s in parent_map[p_key]['students']):
                        parent_map[p_key]['students'].append(s_info)

                    c_label = f"{student.class_name} - Sec {student.section}"
                    if c_label not in parent_map[p_key]['assignedSections']:
                        parent_map[p_key]['assignedSections'].append(c_label)

            for p_dict in parent_map.values():
                summaries = [f"{s['name']} ({s['className']} - Sec {s['section']}, Roll #{s['rollNo']})" for s in p_dict['students']]
                p_dict['studentSummary'] = f"Parent of {', '.join(summaries)}"
                p_dict['studentNames'] = [s['name'] for s in p_dict['students']]
                contacts.append(p_dict)

            return Response(contacts)

        # 3. PARENT
        elif user.role == User.Role.PARENT:
            parent_profile = getattr(user, 'parent_profile', None)
            if not parent_profile:
                return Response([])

            contacts = []
            admin_user = User.objects.filter(school=school, role__in=[User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN], is_active=True).first()
            if admin_user:
                contacts.append({
                    'id': 'admin-office',
                    'userId': admin_user.id,
                    'name': 'School Admin / Office Desk',
                    'role': 'School Admin',
                    'email': admin_user.email,
                    'phone': '',
                    'isOnline': admin_user.is_online_computed,
                    'lastSeenAt': admin_user.last_seen_at.isoformat() if admin_user.last_seen_at else None,
                    'isOfficeDesk': True,
                })

            linked_students = list(parent_profile.students.filter(school=school, status='Active'))
            if not linked_students:
                return Response(contacts)

            teachers_qs = Teacher.objects.filter(school=school, status='Active').select_related('user').prefetch_related(
                'sections__class_room', 'subject_records', 'teaching_assignments__section__class_room', 'teaching_assignments__subject'
            )
            if search_q:
                teachers_qs = teachers_qs.filter(
                    Q(user__first_name__icontains=search_q) |
                    Q(user__last_name__icontains=search_q) |
                    Q(subjects__icontains=search_q)
                )

            teachers = list(teachers_qs)

            for t in teachers:
                child_mappings = []
                assigned_sections = list(t.assigned_sections or [])
                for s in t.sections.all():
                    label = f"{s.class_room.name} - Sec {s.name}" if hasattr(s, 'class_room') and s.class_room else f"Sec {s.name}"
                    if label not in assigned_sections:
                        assigned_sections.append(label)

                teacher_subjects = list(t.subjects or [])
                for sub in t.subject_records.all():
                    if sub.name not in teacher_subjects:
                        teacher_subjects.append(sub.name)

                for st in linked_students:
                    if check_teacher_matches_student(t, st):
                        matched_subs = set()
                        for ta in t.teaching_assignments.all():
                            ta_class = (ta.section.class_room.name or '').replace('Class', '').strip().lower() if hasattr(ta.section, 'class_room') and ta.section.class_room else ''
                            ta_sec = (ta.section.name or '').replace('Section', '').replace('Sec', '').strip().lower() if ta.section else ''
                            st_class = (st.class_name or '').replace('Class', '').strip().lower()
                            st_sec = (st.section or '').replace('Section', '').replace('Sec', '').strip().lower()
                            if (st.section_record_id and ta.section_id == st.section_record_id) or (ta_sec == st_sec and (not ta_class or ta_class == st_class)):
                                if ta.subject:
                                    matched_subs.add(ta.subject.name)

                        final_subs = list(matched_subs) if matched_subs else teacher_subjects
                        child_mappings.append({
                            'studentId': st.id,
                            'studentName': st.name,
                            'className': st.class_name,
                            'sectionName': st.section,
                            'subjects': final_subs,
                        })

                if child_mappings:
                    contacts.append({
                        'id': t.id,
                        'userId': t.user_id,
                        'name': t.user.get_full_name() or t.user.username or f"Teacher #{t.id}",
                        'role': 'Teacher',
                        'email': t.user.email,
                        'phone': t.phone or '',
                        'isOnline': t.user.is_online_computed,
                    'lastSeenAt': t.user.last_seen_at.isoformat() if t.user.last_seen_at else None,
                        'assignedSections': assigned_sections,
                        'subjects': teacher_subjects,
                        'childMappings': child_mappings,
                    })

            return Response(contacts)

        # 4. STUDENT
        if user.role == User.Role.STUDENT:
            contacts = []
            admin_user = User.objects.filter(school=school, role=User.Role.SCHOOL_ADMIN, is_active=True).first()
            if admin_user:
                contacts.append({
                    'id': 'admin-office',
                    'userId': admin_user.id,
                    'name': 'School Admin / Office Desk',
                    'role': 'School Admin',
                    'email': admin_user.email,
                    'phone': '',
                    'isOnline': admin_user.is_online_computed,
                    'lastSeenAt': admin_user.last_seen_at.isoformat() if admin_user.last_seen_at else None,
                    'isOfficeDesk': True,
                })

            student_profile = getattr(user, 'student_profile', None)
            student = getattr(student_profile, 'student', None) if student_profile else None
            if not student:
                return Response(contacts)

            teachers_qs = Teacher.objects.filter(school=school, status='Active').select_related('user').prefetch_related(
                'sections__class_room', 'subject_records', 'teaching_assignments__section__class_room', 'teaching_assignments__subject'
            )
            if search_q:
                teachers_qs = teachers_qs.filter(
                    Q(user__first_name__icontains=search_q) |
                    Q(user__last_name__icontains=search_q) |
                    Q(subjects__icontains=search_q)
                )

            for t in teachers_qs:
                if check_teacher_matches_student(t, student):
                    assigned_sections = list(t.assigned_sections or [])
                    teacher_subjects = list(t.subjects or [])
                    for sub in t.subject_records.all():
                        if sub.name not in teacher_subjects:
                            teacher_subjects.append(sub.name)

                    contacts.append({
                        'id': t.id,
                        'userId': t.user_id,
                        'name': t.user.get_full_name() or t.user.username or f"Teacher #{t.id}",
                        'role': 'Teacher',
                        'email': t.user.email,
                        'phone': t.phone or '',
                        'isOnline': t.user.is_online_computed,
                    'lastSeenAt': t.user.last_seen_at.isoformat() if t.user.last_seen_at else None,
                        'assignedSections': assigned_sections,
                        'subjects': teacher_subjects,
                    })
            return Response(contacts)

        return Response([])


class ConversationListView(APIView):
    """List and create conversations for authorized participants."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=ConversationSerializer(many=True))
    def get(self, request):
        conversations = Conversation.objects.filter(
            Q(participant1=request.user) | Q(participant2=request.user),
            school=request.user.school,
        ).select_related(
            'participant1', 'participant2', 'school', 'student'
        ).prefetch_related(
            'participants',
            Prefetch(
                'messages',
                queryset=DirectMessage.objects.select_related('sender', 'recipient').prefetch_related('attachments').order_by('-created_at')
            )
        )

        # Apply strict role filters
        if request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            conversations = [
                c for c in conversations
                if c.get_other_participant(request.user).role in [User.Role.TEACHER, User.Role.PARENT, User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
            ]
        elif request.user.role == User.Role.TEACHER:
            teacher_profile = getattr(request.user, 'teacher_profile', None)
            if not teacher_profile:
                return Response([])
            permitted_students = get_teacher_permitted_students(teacher_profile, school_id=request.user.school_id)
            parent_user_ids = set(
                ParentProfile.objects.filter(
                    students__in=permitted_students, user__school=request.user.school
                ).values_list('user_id', flat=True)
            )
            admin_user_ids = set(
                User.objects.filter(school=request.user.school, role__in=[User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]).values_list('id', flat=True)
            )
            allowed_partner_ids = parent_user_ids | admin_user_ids
            conversations = [
                c for c in conversations
                if c.get_other_participant(request.user).id in allowed_partner_ids
            ]
        elif request.user.role == User.Role.PARENT:
            parent_profile = getattr(request.user, 'parent_profile', None)
            if not parent_profile:
                return Response([])
            linked_students = list(parent_profile.students.filter(school=request.user.school, status='Active'))
            teachers = Teacher.objects.filter(school=request.user.school, status='Active').select_related('user')
            allowed_teacher_user_ids = {
                t.user_id for t in teachers if any(check_teacher_matches_student(t, st) for st in linked_students)
            }
            admin_user_ids = set(
                User.objects.filter(school=request.user.school, role__in=[User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]).values_list('id', flat=True)
            )
            allowed_partner_ids = allowed_teacher_user_ids | admin_user_ids
            conversations = [
                c for c in conversations
                if c.get_other_participant(request.user).id in allowed_partner_ids
            ]
        elif request.user.role == User.Role.STUDENT:
            student_profile = getattr(request.user, 'student_profile', None)
            student = getattr(student_profile, 'student', None) if student_profile else None
            teachers = Teacher.objects.filter(school=request.user.school, status='Active').select_related('user')
            allowed_teacher_user_ids = {
                t.user_id for t in teachers if student and check_teacher_matches_student(t, student)
            }
            admin_user_ids = set(
                User.objects.filter(school=request.user.school, role__in=[User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]).values_list('id', flat=True)
            )
            allowed_partner_ids = allowed_teacher_user_ids | admin_user_ids
            conversations = [
                c for c in conversations
                if c.get_other_participant(request.user).id in allowed_partner_ids
            ]

        serializer = ConversationSerializer(conversations, many=True, context={'request': request})
        return Response(serializer.data)

    @extend_schema(
        request=inline_serializer('StartConversationPayload', {
            'targetUserId': serializers.IntegerField(required=False),
            'teacherId': serializers.IntegerField(required=False),
            'studentId': serializers.IntegerField(required=False),
        }),
        responses=ConversationSerializer,
    )
    def post(self, request):
        return StartConversationView().post(request)


class ConversationDetailView(APIView):
    """Retrieve details for a single authorized conversation."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=ConversationSerializer)
    def get(self, request, conversation_id):
        conv = Conversation.objects.filter(
            Q(pk=conversation_id) | Q(uuid=conversation_id) if isinstance(conversation_id, uuid.UUID) else Q(pk=conversation_id),
            school=request.user.school,
        ).select_related('participant1', 'participant2', 'school', 'student').prefetch_related('participants').first()

        if not conv or not is_user_in_conversation(request.user, conv):
            return Response({'detail': 'Conversation not found or access denied.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(ConversationSerializer(conv, context={'request': request}).data)


class StartConversationView(APIView):
    """Idempotently initiate or fetch a conversation with student context."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=inline_serializer('StartConversationRequestSchema', {
            'targetUserId': serializers.IntegerField(required=False),
            'target_user_id': serializers.IntegerField(required=False),
            'teacherId': serializers.IntegerField(required=False),
            'teacher_id': serializers.IntegerField(required=False),
            'studentId': serializers.IntegerField(required=False),
            'student_id': serializers.IntegerField(required=False),
        }),
        responses={200: ConversationSerializer},
    )
    def post(self, request):
        target_user_id = request.data.get('targetUserId') or request.data.get('target_user_id')
        teacher_id = request.data.get('teacherId') or request.data.get('teacher_id')
        student_id = request.data.get('studentId') or request.data.get('student_id')

        target_user = None
        student_obj = None

        if request.user.role == User.Role.STUDENT and not student_id:
            student_obj = getattr(getattr(request.user, 'student_profile', None), 'student', None)
        elif student_id:
            student_obj = Student.objects.filter(pk=student_id, school=request.user.school).first()

        user_school = request.user.school
        if str(target_user_id).lower() in ['admin-office', 'admin']:
            target_user = User.objects.filter(school=user_school, role=User.Role.SCHOOL_ADMIN, is_active=True).exclude(pk=request.user.id).first()
            if not target_user and request.user.role != User.Role.SCHOOL_ADMIN:
                target_user = User.objects.filter(school=user_school, role=User.Role.SCHOOL_ADMIN, is_active=True).first()
        elif target_user_id:
            try:
                target_user_qs = User.objects.filter(pk=int(target_user_id))
                if user_school:
                    target_user_qs = target_user_qs.filter(school=user_school)
                target_user = target_user_qs.first()
            except (ValueError, TypeError):
                target_user = None
        elif teacher_id:
            try:
                t_qs = Teacher.objects.filter(pk=int(teacher_id))
                if user_school:
                    t_qs = t_qs.filter(school=user_school)
                teacher = t_qs.select_related('user').first()
                if teacher:
                    target_user = teacher.user
            except (ValueError, TypeError):
                teacher = None
        elif student_obj:
            parent_profile = student_obj.parent_profiles.select_related('user').first()
            if parent_profile and parent_profile.user:
                target_user = parent_profile.user

        if not target_user:
            return Response({'detail': 'Target user not found.'}, status=status.HTTP_404_NOT_FOUND)

        if target_user.id == request.user.id:
            return Response({'detail': 'You cannot start a chat conversation with your own account.'}, status=status.HTTP_400_BAD_REQUEST)

        # Validate permission boundary
        allowed, error_msg, matched_student = can_initiate_conversation(request.user, target_user, student_obj)
        if not allowed:
            return Response({'detail': error_msg}, status=status.HTTP_403_FORBIDDEN)

        conv_student = matched_student or student_obj
        conv_school = user_school or getattr(target_user, 'school', None)
        conv, created = Conversation.get_or_create_between(
            conv_school, request.user, target_user, student=conv_student
        )

        conv = Conversation.objects.filter(id=conv.id).select_related(
            'participant1', 'participant2', 'student', 'school',
            'participant1__teacher_profile', 'participant2__teacher_profile',
            'participant1__parent_profile', 'participant2__parent_profile',
        ).prefetch_related(
            'participants',
            'participant1__teacher_profile__sections__class_room',
            'participant1__teacher_profile__subject_records',
            'participant1__teacher_profile__teaching_assignments__section__class_room',
            'participant1__teacher_profile__teaching_assignments__subject',
            'participant2__teacher_profile__sections__class_room',
            'participant2__teacher_profile__subject_records',
            'participant2__teacher_profile__teaching_assignments__section__class_room',
            'participant2__teacher_profile__teaching_assignments__subject',
        ).first() or conv

        return Response(ConversationSerializer(conv, context={'request': request}).data, status=status.HTTP_200_OK)


class ConversationMessagesView(APIView):
    """Cursor-paginated message history and idempotent message creation."""
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_conversation(self, request, conversation_id):
        conv = Conversation.objects.filter(
            pk=conversation_id, school=request.user.school
        ).select_related('participant1', 'participant2').prefetch_related('participants').first()

        if not conv:
            return None, Response({'detail': 'Conversation not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_user_in_conversation(request.user, conv):
            return None, Response({'detail': 'You are not a participant in this conversation.'}, status=status.HTTP_403_FORBIDDEN)
        return conv, None

    @extend_schema(responses=DirectMessageSerializer(many=True))
    def get(self, request, conversation_id):
        conv, err_resp = self.get_conversation(request, conversation_id)
        if err_resp:
            return err_resp

        # Mark unread messages as read
        DirectMessage.objects.filter(
            conversation=conv,
            recipient=request.user,
            read_at__isnull=True,
        ).update(read_at=timezone.now())

        ConversationParticipant.objects.filter(
            conversation=conv, user=request.user
        ).update(last_read_at=timezone.now())

        # Cursor pagination
        limit = min(int(request.query_params.get('limit', 50)), 100)
        before_id = request.query_params.get('before')
        after_id = request.query_params.get('after')

        qs = conv.messages.select_related('sender', 'recipient').prefetch_related('attachments').order_by('created_at')

        if before_id:
            qs = qs.filter(id__lt=before_id)
        elif after_id:
            qs = qs.filter(id__gt=after_id)

        messages = list(qs[:limit])
        return Response(DirectMessageSerializer(messages, many=True, context={'request': request}).data)

    @extend_schema(
        request=inline_serializer('SendDirectMessageRequest', {
            'message': serializers.CharField(required=False),
            'client_idempotency_key': serializers.CharField(required=False),
            'reply_to_id': serializers.IntegerField(required=False),
        }),
        responses=DirectMessageSerializer,
    )
    def post(self, request, conversation_id):
        conv, err_resp = self.get_conversation(request, conversation_id)
        if err_resp:
            return err_resp

        body = str(request.data.get('message', '')).strip()
        client_key = request.headers.get('Idempotency-Key') or request.data.get('client_idempotency_key') or request.data.get('clientKey')
        reply_to_id = request.data.get('reply_to_id') or request.data.get('replyToId')

        # Idempotency Check
        if client_key:
            existing = DirectMessage.objects.filter(
                conversation=conv,
                client_idempotency_key=client_key,
            ).select_related('sender', 'recipient').prefetch_related('attachments').first()
            if existing:
                return Response(DirectMessageSerializer(existing, context={'request': request}).data, status=status.HTTP_200_OK)

        if not body and not request.FILES:
            return Response({'detail': 'Message content or attachment is required.'}, status=status.HTTP_400_BAD_REQUEST)

        recipient = conv.get_other_participant(request.user)

        with transaction.atomic():
            dm = DirectMessage.objects.create(
                conversation=conv,
                sender=request.user,
                recipient=recipient,
                body=body,
                client_idempotency_key=client_key,
                reply_to_id=reply_to_id if reply_to_id else None,
                message_type=DirectMessage.MessageType.TEXT if body else DirectMessage.MessageType.ATTACHMENT,
            )

            # Handle file attachments if present (avoid duplicates)
            uploaded_files = []
            if 'files' in request.FILES:
                uploaded_files.extend(request.FILES.getlist('files'))
            else:
                for key in request.FILES:
                    uploaded_files.extend(request.FILES.getlist(key))

            for file_obj in uploaded_files:
                content_type = file_obj.content_type or mimetypes.guess_type(file_obj.name)[0] or 'application/octet-stream'
                file_bytes = file_obj.read()
                MessageAttachment.objects.create(
                    message=dm,
                    original_name=file_obj.name,
                    content_type=content_type,
                    file_size=len(file_bytes),
                    file_data=file_bytes,
                )
                if dm.message_type != DirectMessage.MessageType.ATTACHMENT:
                    dm.message_type = DirectMessage.MessageType.ATTACHMENT
                    dm.save(update_fields=['message_type'])

            # Update conversation metadata
            conv.last_message_preview = body[:120] if body else ('[Photo]' if any(f.name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')) for f in uploaded_files) else '[Attachment]')
            conv.last_message_at = timezone.now()
            conv.updated_at = timezone.now()
            conv.save(update_fields=['last_message_preview', 'last_message_at', 'updated_at'])

            # Transactional Outbox Event
            msg_payload = DirectMessageSerializer(dm, context={'request': request}).data
            record_outbox_event(
                event_type='message.created',
                channel_name=f"conversation_{conv.id}",
                payload=msg_payload,
            )
            # Also notify recipient personal channel
            record_outbox_event(
                event_type='message.created',
                channel_name=f"user_{recipient.id}",
                payload=msg_payload,
            )
            # Dispatch unread_count.updated for recipient personal channel
            recipient_unread = DirectMessage.objects.filter(
                recipient=recipient,
                read_at__isnull=True,
                is_deleted=False,
            ).count()
            record_outbox_event(
                event_type='unread_count.updated',
                channel_name=f"user_{recipient.id}",
                payload={
                    'totalUnread': recipient_unread,
                    'conversationId': conv.id,
                    'conversationUnread': DirectMessage.objects.filter(
                        conversation=conv,
                        recipient=recipient,
                        read_at__isnull=True,
                        is_deleted=False,
                    ).count(),
                },
            )

        # Enqueue Push Notification (best effort outside transaction)
        try:
            from apps.chat.models import ConversationParticipant
            from apps.notifications.services import create_notification
            is_muted = ConversationParticipant.objects.filter(
                conversation=conv,
                user=recipient,
                is_muted=True,
            ).exists()
            if not is_muted:
                sender_name = request.user.get_full_name() or request.user.email
                notif_preview = body[:140] if body else ('Sent an image' if any(f.name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')) for f in uploaded_files) else 'Sent an attachment')
                create_notification(
                    school=request.user.school,
                    recipient=recipient,
                    title=f"New Message from {sender_name}",
                    body=notif_preview,
                    category='Message',
                    channel='chat',
                    sender=request.user,
                    related={
                        'type': 'chat_message',
                        'conversationId': str(conv.id),
                        'messageId': str(dm.id),
                        'studentId': str(conv.student_id or ''),
                        'studentName': conv.student.name if conv.student else '',
                        'senderId': str(request.user.id),
                        'senderName': sender_name,
                        'clickUrl': f'/app?tab=chat&conversationId={conv.id}',
                    },
                )
        except Exception:
            pass

        return Response(DirectMessageSerializer(dm, context={'request': request}).data, status=status.HTTP_201_CREATED)


class MessageDetailView(APIView):
    """Edit or soft-delete existing messages."""
    permission_classes = [permissions.IsAuthenticated]

    def get_message(self, request, message_id):
        msg = DirectMessage.objects.filter(pk=message_id, conversation__school=request.user.school).select_related('conversation', 'sender').first()
        if not msg:
            return None, Response({'detail': 'Message not found.'}, status=status.HTTP_404_NOT_FOUND)
        if msg.sender_id != request.user.id:
            return None, Response({'detail': 'You can only edit or delete your own messages.'}, status=status.HTTP_403_FORBIDDEN)
        return msg, None

    @extend_schema(
        request=inline_serializer('EditMessageRequest', {'message': serializers.CharField()}),
        responses={200: DirectMessageSerializer},
    )
    def patch(self, request, message_id):
        msg, err = self.get_message(request, message_id)
        if err:
            return err

        new_body = str(request.data.get('message', '')).strip()
        if not new_body:
            return Response({'detail': 'Message body cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            msg.body = new_body
            msg.edited_at = timezone.now()
            msg.save(update_fields=['body', 'edited_at'])

            payload = DirectMessageSerializer(msg, context={'request': request}).data
            record_outbox_event(
                event_type='message.updated',
                channel_name=f"conversation_{msg.conversation_id}",
                payload=payload,
            )

        return Response(payload)

    @extend_schema(
        responses={200: inline_serializer('DeleteMessageResponse', {'id': serializers.IntegerField(), 'conversationId': serializers.IntegerField(), 'isDeleted': serializers.BooleanField()})},
    )
    def delete(self, request, message_id):
        msg, err = self.get_message(request, message_id)
        if err:
            return err

        with transaction.atomic():
            msg.is_deleted = True
            msg.deleted_at = timezone.now()
            msg.save(update_fields=['is_deleted', 'deleted_at'])

            payload = {'id': msg.id, 'conversationId': msg.conversation_id, 'isDeleted': True}
            record_outbox_event(
                event_type='message.deleted',
                channel_name=f"conversation_{msg.conversation_id}",
                payload=payload,
            )

        return Response(payload, status=status.HTTP_200_OK)


class ConversationReadView(APIView):
    """Acknowledge reading a conversation up to a given message."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=None,
        responses={200: inline_serializer('ConversationReadResponse', {'success': serializers.BooleanField(), 'markedRead': serializers.IntegerField()})},
    )
    def post(self, request, conversation_id):
        conv = Conversation.objects.filter(pk=conversation_id, school=request.user.school).first()
        if not conv or not is_user_in_conversation(request.user, conv):
            return Response({'detail': 'Conversation not found or access denied.'}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        with transaction.atomic():
            updated = DirectMessage.objects.filter(
                conversation=conv,
                recipient=request.user,
                read_at__isnull=True,
            ).update(read_at=now)

            ConversationParticipant.objects.filter(
                conversation=conv, user=request.user
            ).update(last_read_at=now)

            event_payload = {
                'conversationId': conv.id,
                'userId': request.user.id,
                'readAt': now.isoformat(),
            }
            record_outbox_event(
                event_type='conversation.read',
                channel_name=f"conversation_{conv.id}",
                payload=event_payload,
            )
            # Dispatch unread_count.updated for authenticated user personal channel
            user_unread = DirectMessage.objects.filter(
                recipient=request.user,
                read_at__isnull=True,
                is_deleted=False,
            ).count()
            record_outbox_event(
                event_type='unread_count.updated',
                channel_name=f"user_{request.user.id}",
                payload={
                    'totalUnread': user_unread,
                    'conversationId': conv.id,
                    'conversationUnread': 0,
                },
            )

        return Response({'success': True, 'markedRead': updated})


class UnreadCountView(APIView):
    """Returns total unread count and per-conversation counts for the authenticated user."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        responses={200: inline_serializer('UnreadCountResponse', {'totalUnread': serializers.IntegerField(), 'conversations': serializers.DictField(child=serializers.IntegerField())})},
    )
    def get(self, request):
        if not request.user.is_authenticated or not request.user.school_id:
            return Response({'totalUnread': 0, 'conversations': {}})

        unreads = DirectMessage.objects.filter(
            conversation__school_id=request.user.school_id,
            recipient=request.user,
            read_at__isnull=True,
            is_deleted=False,
        ).values('conversation_id')

        conv_counts = {}
        total = 0
        for item in unreads:
            cid = item['conversation_id']
            conv_counts[cid] = conv_counts.get(cid, 0) + 1
            total += 1

        return Response({'totalUnread': total, 'conversations': conv_counts})


class AttachmentDownloadView(APIView):
    """Protected attachment download: verifies user is an authorized conversation participant."""
    permission_classes = [permissions.AllowAny]

    def options(self, request, *args, **kwargs):
        from django.http import HttpResponse
        response = HttpResponse()
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
        return response

    @extend_schema(
        responses={200: OpenApiResponse(description='Raw binary file stream')},
    )
    def get(self, request, attachment_id):
        user = request.user
        if not user or not user.is_authenticated:
            token_str = request.query_params.get('token')
            if token_str:
                try:
                    token_str = token_str.replace('Bearer ', '').strip()
                    from rest_framework_simplejwt.tokens import AccessToken
                    access_token = AccessToken(token_str)
                    user_id = access_token.get('user_id') or access_token.get('id') or access_token.get('sub')
                    user = User.objects.filter(pk=user_id).first()
                except Exception:
                    return Response({'detail': 'Invalid or expired token.'}, status=status.HTTP_401_UNAUTHORIZED)
            if not user or not user.is_authenticated:
                return Response({'detail': 'Authentication credentials were not provided.'}, status=status.HTTP_401_UNAUTHORIZED)

        import uuid
        att_id_str = str(attachment_id).strip()
        try:
            att_uuid = uuid.UUID(att_id_str)
        except Exception:
            return Response({'detail': 'Attachment not found.'}, status=status.HTTP_404_NOT_FOUND)

        attachment = MessageAttachment.objects.filter(pk=att_uuid).select_related('message__conversation').first()
        if not attachment:
            return Response({'detail': 'Attachment not found.'}, status=status.HTTP_404_NOT_FOUND)

        if (
            not is_user_in_conversation(user, attachment.message.conversation)
            and attachment.message.sender_id != user.id
            and attachment.message.recipient_id != user.id
            and user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        ):
            return Response({'detail': 'Access to this attachment is denied.'}, status=status.HTTP_403_FORBIDDEN)

        raw_bytes = None
        if attachment.file_data:
            data = attachment.file_data
            if isinstance(data, memoryview):
                raw_bytes = data.tobytes()
            elif isinstance(data, (bytes, bytearray)):
                raw_bytes = bytes(data)
            elif isinstance(data, str):
                import base64
                try:
                    raw_bytes = base64.b64decode(data)
                except Exception:
                    raw_bytes = data.encode('utf-8')
            else:
                raw_bytes = bytes(data)

        if not raw_bytes and attachment.file_key:
            from django.core.files.storage import default_storage
            try:
                if default_storage.exists(attachment.file_key):
                    with default_storage.open(attachment.file_key, 'rb') as f:
                        raw_bytes = f.read()
            except Exception:
                pass

        if not raw_bytes:
            return Response({'detail': 'File data not available.'}, status=status.HTTP_404_NOT_FOUND)

        from django.http import HttpResponse
        response = HttpResponse(raw_bytes, content_type=attachment.content_type or 'application/octet-stream')
        response['Content-Disposition'] = f'inline; filename="{attachment.original_name}"'
        response['Content-Length'] = len(raw_bytes)
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response['Access-Control-Allow-Headers'] = '*'
        return response


class ChatClearAllView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={204: None})
    def delete(self, request):
        if request.user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'Only school admins can clear all chat data.'}, status=status.HTTP_403_FORBIDDEN)

        DirectMessage.objects.filter(conversation__school_id=request.user.school_id).delete()
        Conversation.objects.filter(school_id=request.user.school_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ParentChatbotAskView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'parent_chatbot'

    @extend_schema(
        request=inline_serializer('ParentChatbotAskRequest', {'student_id': serializers.IntegerField(), 'message': serializers.CharField()}),
        responses={200: inline_serializer('ParentChatbotAskResponse', {'response': serializers.CharField(), 'interaction_id': serializers.IntegerField(), 'token_usage': serializers.IntegerField()}), 403: OpenApiResponse(description='Forbidden')},
    )
    def post(self, request):
        if request.user.role != User.Role.PARENT:
            return Response({'detail': 'Only linked parents may use the academic assistant.'}, status=status.HTTP_403_FORBIDDEN)
        student_id, message = request.data.get('student_id'), str(request.data.get('message', '')).strip()
        if not student_id or not message:
            return Response({'errors': [{'field': 'student_id' if not student_id else 'message', 'error': 'required'}]}, status=status.HTTP_400_BAD_REQUEST)
        profile = getattr(request.user, 'parent_profile', None)
        student = Student.objects.filter(pk=student_id, school=request.user.school).first()
        if not profile or not student or not profile.students.filter(pk=student.pk).exists():
            return Response({'detail': 'You may ask only about a linked student.'}, status=status.HTTP_403_FORBIDDEN)
        snapshot = student_snapshot(student)
        response_text, token_usage = answer_question(snapshot=snapshot, message=message)
        interaction = ChatbotInteraction.objects.create(school=student.school, parent=request.user, student=student, question=message, response=response_text, token_usage=token_usage)
        return Response({'response': response_text, 'interaction_id': interaction.id, 'token_usage': token_usage})


class ChatbotInteractionListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: inline_serializer('ChatbotInteractionResponse', {'id': serializers.IntegerField(), 'parent_id': serializers.IntegerField(), 'student_id': serializers.IntegerField(), 'question': serializers.CharField(), 'response': serializers.CharField(), 'token_usage': serializers.IntegerField(), 'created_at': serializers.DateTimeField()}, many=True), 403: OpenApiResponse(description='Forbidden')})
    def get(self, request):
        if request.user.role == User.Role.SUPER_ADMIN:
            return Response({'detail': 'Super Admin access to parent chatbot interactions is denied.'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'School Admin access is required.'}, status=status.HTTP_403_FORBIDDEN)
        records = ChatbotInteraction.objects.filter(school=request.user.school).select_related('parent', 'student')
        return Response([{'id': row.id, 'parent_id': row.parent_id, 'student_id': row.student_id, 'question': row.question, 'response': row.response, 'token_usage': row.token_usage, 'created_at': row.created_at} for row in records])
