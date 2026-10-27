import datetime
from math import isfinite

from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import OpenApiResponse, extend_schema

from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet
from apps.sis.models import Student
from apps.sis.access import teacher_can_access_student
from apps.staff.models import Teacher, TeacherTeachingAssignment
from .models import Exam, ExamResult, ExamSchedule, ExamScheduleItem
from .serializers import (
    ExamResultSerializer,
    ExamSerializer,
    ExamScheduleSerializer,
    ExamScheduleItemSerializer,
)


class ExamSchedulePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return request.user.role in [
                User.Role.SCHOOL_ADMIN,
                User.Role.TEACHER,
                User.Role.PARENT,
                User.Role.STUDENT,
                User.Role.SUPER_ADMIN,
            ]
        if getattr(view, 'action', None) in ['save_marks_sheet']:
            return request.user.role in [
                User.Role.SCHOOL_ADMIN,
                User.Role.SUPER_ADMIN,
                User.Role.TEACHER,
            ]
        return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]


class ExamScheduleViewSet(TenantScopedViewSet):
    """Tenant-scoped exam schedule CRUD and publish/unpublish lifecycle actions."""
    queryset = ExamSchedule.objects.select_related('school', 'classroom').prefetch_related('items', 'classroom__sections').order_by('-created_at')
    serializer_class = ExamScheduleSerializer
    permission_classes = [ExamSchedulePermission]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role in [User.Role.SUPER_ADMIN, User.Role.SCHOOL_ADMIN]:
            return qs

        # Non-admins can only see PUBLISHED schedules
        qs = qs.filter(status=ExamSchedule.Status.PUBLISHED)

        if user.role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None)
            if not teacher:
                return qs.none()
            assigned_class_ids = teacher.sections.filter(
                school_id=user.school_id,
            ).values_list('class_room_id', flat=True)
            assigned_class_ids = list(assigned_class_ids)
            if not assigned_class_ids:
                assigned_class_ids = list(
                    TeacherTeachingAssignment.objects.filter(
                        teacher=teacher,
                        section__school_id=user.school_id,
                    ).values_list('section__class_room_id', flat=True).distinct()
                )
            return qs.filter(classroom_id__in=assigned_class_ids).distinct()

        if user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            if not profile or profile.student.school_id != user.school_id:
                return qs.none()
            student = profile.student
            if student.section_record and student.section_record.class_room_id:
                return qs.filter(
                    Q(classroom_id=student.section_record.class_room_id)
                    | Q(class_name__iexact=student.class_name)
                )
            return qs.filter(class_name__iexact=student.class_name)

        if user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            if not profile:
                return qs.none()
            parent_students = profile.students.filter(school_id=user.school_id)
            class_ids = parent_students.filter(
                section_record__class_room__isnull=False
            ).values_list('section_record__class_room_id', flat=True)
            class_names = parent_students.values_list('class_name', flat=True)
            return qs.filter(
                Q(classroom_id__in=class_ids) | Q(class_name__in=class_names)
            ).distinct()

        return qs.none()

    def perform_create(self, serializer):
        user = self.request.user
        classroom = serializer.validated_data.get('classroom')
        school = classroom.school if user.role == User.Role.SUPER_ADMIN and classroom else user.school
        if not school or not classroom or classroom.school_id != school.id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'classroom': 'Select a classroom in the school you manage.'})
        serializer.save(school=school)

    @action(detail=True, methods=['post'], url_path='publish')
    def publish(self, request, pk=None):
        schedule = self.get_object()
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        items = schedule.items.all()
        if not items.exists():
            return Response(
                {'detail': 'Cannot publish an empty exam timetable. Add at least one subject.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        errors = []
        for item in items:
            if not item.exam_date:
                errors.append(f"{item.subject_name}: Exam date is required.")
            if not item.start_time:
                errors.append(f"{item.subject_name}: Start time is required.")
            if not item.end_time:
                errors.append(f"{item.subject_name}: End time is required.")
            elif item.start_time and item.end_time <= item.start_time:
                errors.append(f"{item.subject_name}: End time must be later than start time.")
            if not item.max_marks or item.max_marks < 1:
                errors.append(f"{item.subject_name}: Maximum marks must be at least 1.")

        if errors:
            return Response(
                {'detail': 'Validation failed before publishing.', 'errors': errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule.status = ExamSchedule.Status.PUBLISHED
        schedule.published_at = timezone.now()
        schedule.save()

        # Synchronize / create Exam records for all sections of this class
        sections = schedule.classroom.sections.filter(school=schedule.school)
        section_names = list(sections.values_list('name', flat=True)) if sections.exists() else ['A']

        for sec_name in section_names:
            for item in items:
                Exam.objects.update_or_create(
                    school=schedule.school,
                    name=schedule.name,
                    class_name=schedule.class_name,
                    section=sec_name,
                    subject=item.subject_name,
                    defaults={
                        'schedule': schedule,
                        'date': item.exam_date,
                        'time': item.start_time,
                        'end_time': item.end_time,
                        'max_marks': item.max_marks,
                    },
                )

        # Broadcast notification specifically to Students, Parents, and Teachers related to this class
        class_students = Student.objects.filter(
            school=schedule.school,
            status=Student.Status.ACTIVE,
        ).filter(
            Q(section_record__class_room=schedule.classroom) |
            Q(class_name__iexact=schedule.class_name)
        )

        student_user_ids = list(class_students.filter(login_profile__isnull=False).values_list('login_profile__user_id', flat=True))
        parent_user_ids = list(User.objects.filter(parent_profile__students__in=class_students).values_list('id', flat=True).distinct())
        teacher_user_ids = list(User.objects.filter(
            Q(teacher_profile__sections__class_room=schedule.classroom)
            | Q(teacher_profile__teaching_assignments__section__class_room=schedule.classroom),
            teacher_profile__school=schedule.school,
            teacher_profile__status=Teacher.Status.ACTIVE,
        ).values_list('id', flat=True).distinct())

        all_target_ids = set(student_user_ids + parent_user_ids + teacher_user_ids)
        student_names = list(class_students.values_list('name', flat=True)[:10])
        student_ids = list(class_students.values_list('id', flat=True))
        from apps.notifications.tasks import enqueue_notification_fanout
        enqueue_notification_fanout(
            school_id=schedule.school_id,
            sender_id=request.user.id,
            recipient_ids=list(all_target_ids),
            channel='exam-schedule',
            category='Academic',
            title=f'Exam Timetable Published: {schedule.name}',
            body=f'Official exam timetable for {schedule.class_name} ({schedule.name}) is now published with {items.count()} subjects.',
            related={
                'schedule_id': schedule.id,
                'class_name': schedule.class_name,
                'targetClass': schedule.class_name,
                'studentNames': student_names,
                'studentIds': student_ids,
            },
        )

        return Response(ExamScheduleSerializer(schedule, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='unpublish')
    def unpublish(self, request, pk=None):
        schedule = self.get_object()
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        schedule.status = ExamSchedule.Status.DRAFT
        schedule.hall_tickets_released = False
        schedule.save()
        return Response(ExamScheduleSerializer(schedule, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='generate-hall-tickets')
    def generate_hall_tickets(self, request, pk=None):
        schedule = self.get_object()
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can generate hall tickets.'}, status=status.HTTP_403_FORBIDDEN)

        if schedule.status != ExamSchedule.Status.PUBLISHED:
            return Response(
                {'detail': 'Exam schedule must be published before generating hall tickets.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule.hall_tickets_generated = True
        schedule.save(update_fields=['hall_tickets_generated', 'updated_at'])

        class_students_count = Student.objects.filter(
            school=schedule.school,
            status=Student.Status.ACTIVE,
        ).filter(
            Q(section_record__class_room=schedule.classroom) |
            Q(class_name__iexact=schedule.class_name)
        ).count()

        return Response({
            'detail': f'Hall tickets generated for {class_students_count} active students in {schedule.class_name}. Ready for administrator review and distribution.',
            'count': class_students_count,
            'schedule': ExamScheduleSerializer(schedule, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='release-hall-tickets')
    def release_hall_tickets(self, request, pk=None):
        schedule = self.get_object()
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can approve and release hall tickets.'}, status=status.HTTP_403_FORBIDDEN)

        if schedule.status != ExamSchedule.Status.PUBLISHED:
            return Response(
                {'detail': 'Exam schedule must be published before releasing hall tickets.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule.hall_tickets_generated = True
        schedule.hall_tickets_released = True
        schedule.hall_tickets_released_at = timezone.now()
        schedule.save(update_fields=['hall_tickets_generated', 'hall_tickets_released', 'hall_tickets_released_at', 'updated_at'])

        # Notify Students and Parents ONLY (Not teachers)
        class_students = Student.objects.filter(
            school=schedule.school,
            status=Student.Status.ACTIVE,
        ).filter(
            Q(section_record__class_room=schedule.classroom) |
            Q(class_name__iexact=schedule.class_name)
        )

        student_user_ids = list(class_students.filter(login_profile__isnull=False).values_list('login_profile__user_id', flat=True))
        parent_user_ids = list(User.objects.filter(parent_profile__students__in=class_students).values_list('id', flat=True).distinct())

        target_recipient_ids = set(student_user_ids + parent_user_ids)
        student_names = list(class_students.values_list('name', flat=True)[:10])
        student_ids = list(class_students.values_list('id', flat=True))
        from apps.notifications.tasks import enqueue_notification_fanout
        enqueue_notification_fanout(
            school_id=schedule.school_id,
            sender_id=request.user.id,
            recipient_ids=list(target_recipient_ids),
            channel='exam-hallticket',
            category='Academic',
            title=f'Official Hall Tickets Released: {schedule.name}',
            body=f'Official exam admit cards / hall tickets for {schedule.class_name} ({schedule.name}) have been approved and released by administration.',
            related={
                'schedule_id': schedule.id,
                'class_name': schedule.class_name,
                'targetClass': schedule.class_name,
                'hall_ticket_released': True,
                'studentNames': student_names,
                'studentIds': student_ids,
            },
        )

        return Response({
            'detail': f'Hall tickets approved and released to {len(student_user_ids)} students and {len(parent_user_ids)} parents.',
            'released_at': schedule.hall_tickets_released_at,
            'schedule': ExamScheduleSerializer(schedule, context={'request': request}).data,
        })

    @action(detail=True, methods=['get'], url_path='hall-tickets')
    def get_hall_tickets(self, request, pk=None):
        schedule = self.get_object()
        user = request.user

        if user.role == User.Role.TEACHER:
            return Response(
                {'detail': 'Hall tickets are distributed directly to students and parents only.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        items = list(schedule.items.all().order_by('exam_date', 'start_time'))

        # Helper to construct hall ticket payload for a student
        def build_ticket(student):
            papers = [
                {
                    'subject_name': it.subject_name,
                    'exam_date': str(it.exam_date),
                    'start_time': str(it.start_time)[:5] if it.start_time else '',
                    'end_time': str(it.end_time)[:5] if it.end_time else '',
                    'max_marks': it.max_marks,
                    'room_number': getattr(student.section_record, 'room_number', '') or (f"Room {student.section}" if student.section else 'Main Hall'),
                }
                for it in items
            ]
            school_obj = getattr(schedule, 'school', None) or getattr(student, 'school', None)
            school_name = school_obj.name if school_obj else ''
            return {
                'id': f"HT-{schedule.id}-{student.id}",
                'hall_ticket_no': f"HT/{student.academic_year or '2026'}/{schedule.id}/{student.roll_no or student.id:03d}",
                'schedule_id': schedule.id,
                'exam_name': schedule.name,
                'academic_year': schedule.academic_year or '2026-2027',
                'school_name': school_name,
                'class_name': student.class_name or schedule.class_name,
                'section': student.section or (student.section_record.name if student.section_record else 'A'),
                'student_id': student.id,
                'student_name': student.name,
                'admission_no': student.admission_no,
                'roll_no': student.roll_no or student.id,
                'parent_name': student.parent_name or getattr(student, 'father_name', '') or getattr(student, 'mother_name', ''),
                'photo_url': getattr(student, 'photo_url', '') or '',
                'emergency_contact': student.parent_phone or '',
                'papers': papers,
                'status': 'released' if schedule.hall_tickets_released else ('pending_approval' if schedule.hall_tickets_generated else 'draft'),
                'is_released': schedule.hall_tickets_released,
                'released_at': schedule.hall_tickets_released_at,
                'instructions': [
                    '1. Candidates must arrive at the examination hall at least 15 minutes before the scheduled start time.',
                    '2. Carrying this Hall Ticket / Admit Card and the valid Student ID is strictly mandatory for admission.',
                    '3. Electronic gadgets including mobile phones, smartwatches, and programmable calculators are strictly prohibited.',
                    '4. Follow all instructions given by the invigilator and maintain absolute silence in the examination room.',
                ],
            }

        # For Admin: Return all students in class
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            class_students = Student.objects.filter(
                school=schedule.school,
                status=Student.Status.ACTIVE,
            ).filter(
                Q(section_record__class_room=schedule.classroom) |
                Q(class_name__iexact=schedule.class_name)
            ).select_related('section_record').order_by('roll_no', 'name')

            tickets = [build_ticket(s) for s in class_students]
            return Response({
                'status': 'released' if schedule.hall_tickets_released else ('pending_approval' if schedule.hall_tickets_generated else 'draft'),
                'is_released': schedule.hall_tickets_released,
                'released_at': schedule.hall_tickets_released_at,
                'schedule_id': schedule.id,
                'schedule_name': schedule.name,
                'class_name': schedule.class_name,
                'hall_tickets': tickets,
            })

        # For Student:
        if user.role == User.Role.STUDENT:
            if not schedule.hall_tickets_released:
                return Response({
                    'status': 'pending_approval',
                    'is_released': False,
                    'message': f'Hall tickets for {schedule.name} ({schedule.class_name}) are awaiting administrator approval and distribution.',
                    'hall_tickets': [],
                })
            profile = getattr(user, 'student_profile', None)
            if not profile or profile.student.school_id != schedule.school_id:
                return Response({'status': 'not_found', 'is_released': False, 'hall_tickets': []})
            tickets = [build_ticket(profile.student)]
            return Response({
                'status': 'released',
                'is_released': True,
                'released_at': schedule.hall_tickets_released_at,
                'hall_tickets': tickets,
            })

        # For Parent:
        if user.role == User.Role.PARENT:
            if not schedule.hall_tickets_released:
                return Response({
                    'status': 'pending_approval',
                    'is_released': False,
                    'message': f'Hall tickets for {schedule.name} ({schedule.class_name}) are awaiting administrator approval and distribution.',
                    'hall_tickets': [],
                })
            profile = getattr(user, 'parent_profile', None)
            if not profile:
                return Response({'status': 'not_found', 'is_released': False, 'hall_tickets': []})
            parent_students = profile.students.filter(
                school_id=schedule.school_id,
                status=Student.Status.ACTIVE,
            ).filter(
                Q(section_record__class_room=schedule.classroom) |
                Q(class_name__iexact=schedule.class_name)
            ).select_related('section_record').order_by('name')

            tickets = [build_ticket(s) for s in parent_students]
            return Response({
                'status': 'released',
                'is_released': True,
                'released_at': schedule.hall_tickets_released_at,
                'hall_tickets': tickets,
            })

        return Response({'status': 'forbidden', 'is_released': False, 'hall_tickets': []}, status=status.HTTP_403_FORBIDDEN)

    @action(detail=True, methods=['get'], url_path='marks-sheet')
    def get_marks_sheet(self, request, pk=None):
        schedule = self.get_object()
        user = request.user
        is_admin = user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        is_teacher = user.role == User.Role.TEACHER

        if not is_admin and not is_teacher:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        teacher_subject_names = set()
        teacher_sections = []
        teacher = None
        if is_teacher:
            teacher = Teacher.objects.filter(user=user, school_id=user.school_id, status=Teacher.Status.ACTIVE).first()
            if not teacher:
                return Response({'detail': 'Teacher profile not found or inactive.'}, status=status.HTTP_403_FORBIDDEN)

            if schedule.classroom_id:
                teacher_sections.extend(list(teacher.sections.filter(school_id=user.school_id, class_room_id=schedule.classroom_id).values_list('name', flat=True)))
                teacher_sections.extend(list(teacher.teaching_assignments.filter(school_id=user.school_id, section__class_room_id=schedule.classroom_id).values_list('section__name', flat=True)))
            else:
                teacher_sections.extend(list(teacher.sections.filter(school_id=user.school_id, class_room__name__iexact=schedule.class_name).values_list('name', flat=True)))
                teacher_sections.extend(list(teacher.teaching_assignments.filter(school_id=user.school_id, section__class_room__name__iexact=schedule.class_name).values_list('section__name', flat=True)))

            if isinstance(teacher.assigned_sections, list):
                teacher_sections.extend([str(sec).strip() for sec in teacher.assigned_sections if str(sec).strip()])
            teacher_sections = list(dict.fromkeys([s for s in teacher_sections if s]))

        # Available sections
        all_sections = list(schedule.classroom.sections.filter(school_id=schedule.school_id).values_list('name', flat=True)) if schedule.classroom else []
        if not all_sections:
            all_sections = ['A']

        # Normalize teacher_sections to match section names (e.g. 'Class 1-B' -> 'B')
        normalized_teacher_secs = []
        for s in teacher_sections:
            s_str = str(s).strip()
            if s_str in all_sections:
                normalized_teacher_secs.append(s_str)
            elif '-' in s_str:
                sec_part = s_str.split('-')[-1].strip()
                if sec_part in all_sections:
                    normalized_teacher_secs.append(sec_part)
                else:
                    normalized_teacher_secs.append(s_str)
            else:
                normalized_teacher_secs.append(s_str)
        teacher_sections = list(dict.fromkeys(normalized_teacher_secs))

        active_sections = all_sections if is_admin else (teacher_sections if teacher_sections else all_sections)

        requested_section = request.query_params.get('section', '').strip()
        if requested_section and requested_section in all_sections:
            target_section = requested_section
        else:
            target_section = active_sections[0] if active_sections else 'A'

        has_specific_assignments = False
        if is_teacher and teacher:
            # Collect subjects assigned to this teacher for this class / section
            sec_assignments = teacher.teaching_assignments.filter(
                school_id=user.school_id
            ).filter(
                Q(section__class_room=schedule.classroom) | Q(section__class_room__name__iexact=schedule.class_name)
            )
            has_specific_assignments = sec_assignments.exists()
            if target_section:
                assigned_in_sec = sec_assignments.filter(section__name__iexact=target_section)
                if assigned_in_sec.exists():
                    teacher_subject_names.update(assigned_in_sec.values_list('subject__name', flat=True))
            if not has_specific_assignments:
                teacher_subject_names.update(teacher.subject_records.filter(school_id=user.school_id).values_list('name', flat=True))
                if isinstance(teacher.subjects, list):
                    teacher_subject_names.update([str(s).strip() for s in teacher.subjects if str(s).strip()])

        teacher_subs_lower = {s.lower() for s in teacher_subject_names}

        # Schedule items (Subjects in this exam)
        items = list(schedule.items.all().order_by('order', 'exam_date', 'start_time'))

        # Ensure Exam objects exist for this section and subjects
        for item in items:
            Exam.objects.get_or_create(
                school=schedule.school,
                schedule=schedule,
                name=schedule.name,
                class_name=schedule.class_name,
                section=target_section,
                subject=item.subject_name,
                defaults={
                    'date': item.exam_date,
                    'time': item.start_time,
                    'end_time': item.end_time,
                    'max_marks': item.max_marks,
                },
            )

        # Active students in this class section
        students = Student.objects.filter(
            school_id=schedule.school_id,
            status=Student.Status.ACTIVE,
        ).filter(
            Q(section_record__class_room=schedule.classroom, section_record__name__iexact=target_section) |
            Q(class_name__iexact=schedule.class_name, section__iexact=target_section)
        ).order_by('roll_no', 'name')

        # Existing results
        results = ExamResult.objects.filter(
            exam__schedule=schedule,
            exam__section__iexact=target_section,
        ).select_related('exam')

        result_map = {}
        for r in results:
            result_map[(r.student_id, r.exam.subject)] = r

        # Collect teachers assigned to this class and target_section
        assignments = TeacherTeachingAssignment.objects.filter(
            school_id=schedule.school_id,
            section__class_room=schedule.classroom,
            section__name__iexact=target_section,
        ).select_related('teacher__user', 'subject')

        subject_teachers = {}
        assigned_teachers_list = []
        seen_assignments = set()
        for a in assignments:
            u = a.teacher.user if a.teacher else None
            t_name = f"{u.first_name} {u.last_name}".strip() if u else ""
            if not t_name and u:
                t_name = u.username
            sub_name = a.subject.name if a.subject else ""
            if sub_name:
                subject_teachers[sub_name.lower()] = t_name
                key = (t_name, sub_name)
                if key not in seen_assignments:
                    seen_assignments.add(key)
                    assigned_teachers_list.append({
                        'teacher_id': a.teacher_id,
                        'teacher_name': t_name,
                        'teacher_email': u.email if u else '',
                        'subject_name': sub_name,
                        'section': target_section,
                    })

        section_teachers_qs = Teacher.objects.filter(
            school_id=schedule.school_id,
            status=Teacher.Status.ACTIVE,
        ).filter(
            Q(sections__class_room=schedule.classroom, sections__name__iexact=target_section) |
            Q(assigned_sections__contains=target_section)
        ).select_related('user').prefetch_related('subject_records')

        for t in section_teachers_qs:
            u = t.user
            t_name = f"{u.first_name} {u.last_name}".strip() if u else (u.username if u else "")
            for s_obj in t.subject_records.all():
                if s_obj.name.lower() not in subject_teachers:
                    subject_teachers[s_obj.name.lower()] = t_name
                key = (t_name, s_obj.name)
                if key not in seen_assignments:
                    seen_assignments.add(key)
                    assigned_teachers_list.append({
                        'teacher_id': t.id,
                        'teacher_name': t_name,
                        'teacher_email': u.email if u else '',
                        'subject_name': s_obj.name,
                        'section': target_section,
                    })
            if isinstance(t.subjects, list):
                for s_name in t.subjects:
                    s_str = str(s_name).strip()
                    if s_str and s_str.lower() not in subject_teachers:
                        subject_teachers[s_str.lower()] = t_name
                    if s_str:
                        key = (t_name, s_str)
                        if key not in seen_assignments:
                            seen_assignments.add(key)
                            assigned_teachers_list.append({
                                'teacher_id': t.id,
                                'teacher_name': t_name,
                                'teacher_email': u.email if u else '',
                                'subject_name': s_str,
                                'section': target_section,
                            })

        is_section_assigned = True
        if is_teacher and teacher_sections:
            is_section_assigned = target_section.lower() in [s.lower() for s in teacher_sections]

        overall_window = schedule.check_marks_entry_window(user, section_name=target_section)
        subjects_payload = []
        for it in items:
            subject_window = schedule.check_marks_entry_window(user, it.subject_name, section_name=target_section)
            if is_teacher:
                if not is_section_assigned:
                    is_subject_assigned = False
                elif teacher_subs_lower:
                    is_subject_assigned = it.subject_name.lower() in teacher_subs_lower
                elif has_specific_assignments:
                    is_subject_assigned = False
                else:
                    is_subject_assigned = True
            else:
                is_subject_assigned = True
            can_edit = is_admin or (is_subject_assigned and subject_window['is_open'])
            subjects_payload.append({
                'subject_name': it.subject_name,
                'max_marks': it.max_marks,
                'exam_date': it.exam_date.isoformat() if it.exam_date else None,
                'start_time': it.start_time.strftime('%H:%M') if it.start_time else None,
                'end_time': it.end_time.strftime('%H:%M') if it.end_time else None,
                'teacher_name': subject_teachers.get(it.subject_name.lower(), 'Unassigned'),
                'can_edit': can_edit,
                'marks_entry_open': subject_window['is_open'],
                'marks_entry_completed': subject_window['is_completed'],
                'marks_entry_expired': subject_window['is_expired'],
                'marks_entry_extended': subject_window['is_extended'],
                'marks_entry_deadline': subject_window['deadline'].isoformat() if subject_window['deadline'] else None,
                'marks_entry_reason': subject_window['reason'],
                'days_remaining': subject_window['days_remaining'],
            })

        student_rows = []
        for s in students:
            student_marks = {}
            for it in items:
                res = result_map.get((s.id, it.subject_name))
                subject_window = schedule.check_marks_entry_window(user, it.subject_name, section_name=target_section)
                is_subject_assigned = (it.subject_name.lower() in teacher_subs_lower) if teacher_subs_lower else True
                can_edit = is_admin or (is_subject_assigned and subject_window['is_open'])
                student_marks[it.subject_name] = {
                    'marks_obtained': res.marks_obtained if res and res.marks_obtained is not None else '',
                    'remarks': res.remarks if res else '',
                    'status': res.status if res else 'draft',
                    'can_edit': can_edit,
                }
            student_rows.append({
                'student_id': s.id,
                'student_name': s.name,
                'admission_no': s.admission_no,
                'roll_no': s.roll_no or s.id,
                'photo_url': getattr(s, 'photo_url', '') or '',
                'marks': student_marks,
            })

        all_published = results.exists() and not results.filter(status=ExamResult.Status.DRAFT).exists()

        unique_section_teachers = []
        seen_t_names = set()
        for t in assigned_teachers_list:
            if t['teacher_name'] and t['teacher_name'] not in seen_t_names:
                seen_t_names.add(t['teacher_name'])
                unique_section_teachers.append(t)

        return Response({
            'schedule_id': schedule.id,
            'schedule_name': schedule.name,
            'class_name': schedule.class_name,
            'academic_year': schedule.academic_year,
            'section': target_section,
            'sections': active_sections,
            'all_sections': all_sections,
            'subjects': subjects_payload,
            'students': student_rows,
            'is_admin': is_admin,
            'all_published': all_published,
            'teacher_subjects': list(teacher_subject_names) if is_teacher else [],
            'assigned_teachers': assigned_teachers_list,
            'section_teachers': unique_section_teachers,
            'section_extensions': schedule.section_extensions or {},
            'subject_extensions': schedule.subject_extensions or {},
            'marks_entry_days': schedule.marks_entry_days,
            'marks_entry_deadline': overall_window['deadline'].isoformat() if overall_window.get('deadline') else (schedule.marks_entry_deadline.isoformat() if schedule.marks_entry_deadline else None),
            'marks_entry_extended': overall_window.get('is_extended', False),
            'marks_entry_extension_reason': overall_window.get('reason', schedule.marks_entry_extension_reason),
            'marks_entry_extended_at': schedule.marks_entry_extended_at.isoformat() if schedule.marks_entry_extended_at else None,
            'overall_marks_entry_open': overall_window['is_open'],
            'overall_marks_entry_reason': overall_window['reason'],
            'overall_days_remaining': overall_window['days_remaining'],
            'section_extended': overall_window.get('section_extended', False),
        })

    @action(detail=True, methods=['post'], url_path='save-marks-sheet')
    def save_marks_sheet(self, request, pk=None):
        schedule = self.get_object()
        user = request.user
        is_admin = user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        is_teacher = user.role == User.Role.TEACHER

        if not is_admin and not is_teacher:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        teacher_subject_names = set()
        teacher_sections = []
        if is_teacher:
            teacher = Teacher.objects.filter(user=user, school_id=user.school_id, status=Teacher.Status.ACTIVE).first()
            if not teacher:
                return Response({'detail': 'Teacher profile not found.'}, status=status.HTTP_403_FORBIDDEN)

            if schedule.classroom_id:
                teacher_sections.extend(list(teacher.sections.filter(school_id=user.school_id, class_room_id=schedule.classroom_id).values_list('name', flat=True)))
                teacher_sections.extend(list(teacher.teaching_assignments.filter(school_id=user.school_id, section__class_room_id=schedule.classroom_id).values_list('section__name', flat=True)))
            else:
                teacher_sections.extend(list(teacher.sections.filter(school_id=user.school_id, class_room__name__iexact=schedule.class_name).values_list('name', flat=True)))
                teacher_sections.extend(list(teacher.teaching_assignments.filter(school_id=user.school_id, section__class_room__name__iexact=schedule.class_name).values_list('section__name', flat=True)))

            if isinstance(teacher.assigned_sections, list):
                teacher_sections.extend([str(sec).strip() for sec in teacher.assigned_sections if str(sec).strip()])
            teacher_sections = list(dict.fromkeys([s for s in teacher_sections if s]))

            # Collect assigned subjects for this section
            sec_assignments = teacher.teaching_assignments.filter(
                school_id=user.school_id
            ).filter(
                Q(section__class_room=schedule.classroom) | Q(section__class_room__name__iexact=schedule.class_name)
            )
            has_specific_assignments = sec_assignments.exists()
            section_name_param = request.data.get('section', 'A')
            if section_name_param:
                assigned_in_sec = sec_assignments.filter(section__name__iexact=section_name_param)
                if assigned_in_sec.exists():
                    teacher_subject_names.update(assigned_in_sec.values_list('subject__name', flat=True))
            if not has_specific_assignments:
                teacher_subject_names.update(teacher.subject_records.filter(school_id=user.school_id).values_list('name', flat=True))
                if isinstance(teacher.subjects, list):
                    teacher_subject_names.update([str(s).strip() for s in teacher.subjects if str(s).strip()])

        teacher_subs_lower = {s.lower() for s in teacher_subject_names}

        section_name = request.data.get('section', 'A')
        target_status = request.data.get('status', 'draft')
        entries = request.data.get('entries', [])

        # Normalize teacher_sections
        normalized_teacher_secs = []
        for s in teacher_sections:
            s_str = str(s).strip()
            if '-' in s_str:
                normalized_teacher_secs.append(s_str.split('-')[-1].strip())
            else:
                normalized_teacher_secs.append(s_str)
        teacher_sections = list(dict.fromkeys(normalized_teacher_secs))

        if is_teacher and teacher_sections and section_name.lower() not in [s.lower() for s in teacher_sections]:
            return Response({'detail': f'You are not assigned to Section {section_name}.'}, status=status.HTTP_403_FORBIDDEN)

        # Enforce marks entry window for teachers (3 days after exam completion unless extended)
        if is_teacher:
            for entry in entries:
                sub_name = entry.get('subject_name', '')
                if not sub_name:
                    continue
                window = schedule.check_marks_entry_window(user, sub_name, section_name=section_name)
                if not window['is_open']:
                    return Response({
                        'detail': f'Marks entry for {sub_name} (Section {section_name}) is closed: {window["reason"]}'
                    }, status=status.HTTP_403_FORBIDDEN)

        updated_count = 0
        for entry in entries:
            student_id = entry.get('student_id')
            subject_name = entry.get('subject_name', '')
            raw_marks = entry.get('marks_obtained')
            remarks = entry.get('remarks', '')

            if not student_id or not subject_name:
                continue

            if is_teacher and teacher_subs_lower and subject_name.lower() not in teacher_subs_lower:
                continue

            exam = Exam.objects.filter(
                schedule=schedule,
                section__iexact=section_name,
                subject__iexact=subject_name,
            ).first()

            if not exam:
                continue

            marks_val = None
            if raw_marks is not None and str(raw_marks).strip() != '':
                try:
                    m = float(raw_marks)
                    if 0 <= m <= exam.max_marks:
                        marks_val = m
                except (ValueError, TypeError):
                    marks_val = None

            result, _ = ExamResult.objects.get_or_create(
                exam=exam,
                student_id=student_id,
                defaults={'school': schedule.school, 'entered_by': user}
            )

            result.marks_obtained = marks_val
            result.remarks = remarks or ''
            result.status = target_status
            result.entered_by = user
            if target_status == ExamResult.Status.SUBMITTED:
                result.submitted_at = timezone.now()
            result.save()
            updated_count += 1

        return Response({
            'detail': f'Marks successfully saved for {updated_count} entries.',
            'updated': updated_count,
        })

    @action(detail=True, methods=['post'], url_path='publish-marks-sheet')
    def publish_marks_sheet(self, request, pk=None):
        schedule = self.get_object()
        user = request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can verify and publish marks.'}, status=status.HTTP_403_FORBIDDEN)

        section_name = request.data.get('section', '')
        qs = ExamResult.objects.filter(exam__schedule=schedule)
        if section_name:
            qs = qs.filter(exam__section__iexact=section_name)

        now = timezone.now()
        updated = qs.update(status=ExamResult.Status.SUBMITTED, submitted_at=now)

        schedule.marks_published = True
        schedule.marks_published_at = now
        schedule.save(update_fields=['marks_published', 'marks_published_at', 'updated_at'])

        target_students = Student.objects.filter(
            school=schedule.school,
            status=Student.Status.ACTIVE,
        ).filter(
            Q(section_record__class_room=schedule.classroom)
            | Q(class_name__iexact=schedule.class_name)
        )
        if section_name:
            target_students = target_students.filter(
                Q(section_record__name__iexact=section_name) | Q(section__iexact=section_name)
            )
        target_ids = set(target_students.filter(login_profile__isnull=False).values_list('login_profile__user_id', flat=True))
        target_ids.update(User.objects.filter(parent_profile__students__in=target_students).values_list('id', flat=True))
        from apps.notifications.tasks import enqueue_notification_fanout
        enqueue_notification_fanout(
            school_id=schedule.school_id,
            sender_id=user.id,
            recipient_ids=list(target_ids),
            channel='exam-result',
            category='Academic',
            title=f'Marks Published: {schedule.name}',
            body=f'Marks for {schedule.class_name} ({section_name or "all sections"}) have been verified and published.',
            related={'schedule_id': schedule.id, 'class_name': schedule.class_name, 'section': section_name or 'all'},
        )

        return Response({
            'detail': f'Marks for {schedule.name} ({schedule.class_name} {section_name}) have been verified and published. You can now generate official report cards.',
            'updated': updated,
            'marks_published': True,
        })

    @action(detail=True, methods=['post'], url_path='extend-marks-entry')
    def extend_marks_entry(self, request, pk=None):
        schedule = self.get_object()
        user = request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can extend marks entry deadlines.'}, status=status.HTTP_403_FORBIDDEN)

        target_section = str(request.data.get('section', '')).strip()
        target_subject = str(request.data.get('subject', '')).strip()
        extension_days = request.data.get('extension_days')
        custom_deadline = request.data.get('deadline')
        reason = str(request.data.get('reason', '')).strip() or 'Extension granted by administrator'

        now = timezone.now()
        current_deadline = schedule.get_marks_entry_deadline(
            subject_name=target_subject or None,
            section_name=target_section if target_section else None,
        ) or now

        new_deadline = None
        if custom_deadline:
            try:
                parsed_dt = datetime.datetime.fromisoformat(str(custom_deadline).replace('Z', '+00:00'))
                if timezone.is_naive(parsed_dt):
                    parsed_dt = timezone.make_aware(parsed_dt, timezone.get_current_timezone())
                if parsed_dt <= now:
                    return Response({'detail': 'Extended deadline must be in the future.'}, status=status.HTTP_400_BAD_REQUEST)
                new_deadline = parsed_dt
            except (TypeError, ValueError):
                return Response(
                    {'detail': 'Invalid deadline format. Enter a valid date and time.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif extension_days is not None:
            try:
                days = int(extension_days)
                if days < 1 or days > 60:
                    return Response({'detail': 'Extension days must be between 1 and 60.'}, status=status.HTTP_400_BAD_REQUEST)
                base = max(current_deadline, now)
                new_deadline = base + datetime.timedelta(days=days)
            except (ValueError, TypeError):
                return Response({'detail': 'Invalid extension days value.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            base = max(current_deadline, now)
            new_deadline = base + datetime.timedelta(days=3)

        user_display_name = f"{user.first_name} {user.last_name}".strip() or user.username
        is_specific_section = bool(target_section and target_section.lower() not in ['all', 'all sections', ''])
        is_specific_subject = bool(target_subject and target_subject.lower() not in ['all', 'all subjects', ''])

        if is_specific_subject:
            matched_item = next(
                (item for item in schedule.items.all() if item.subject_name.strip().lower() == target_subject.lower()),
                None,
            )
            if not matched_item:
                return Response({'detail': 'Choose a subject in this exam schedule.'}, status=status.HTTP_400_BAD_REQUEST)
            current_exts = dict(schedule.subject_extensions or {})
            current_exts[matched_item.subject_name] = {
                'extended': True,
                'deadline': new_deadline.isoformat(),
                'reason': reason,
                'extended_at': now.isoformat(),
                'extended_by_id': user.id,
                'extended_by_name': user_display_name,
            }
            schedule.subject_extensions = current_exts
            schedule.save(update_fields=['subject_extensions', 'updated_at'])
            Exam.objects.filter(schedule=schedule, subject__iexact=matched_item.subject_name).update(marks_entry_deadline=new_deadline)
        elif is_specific_section:
            # Store per-section extension
            current_exts = dict(schedule.section_extensions or {})
            current_exts[target_section] = {
                'extended': True,
                'deadline': new_deadline.isoformat(),
                'reason': reason,
                'extended_at': now.isoformat(),
                'extended_by_id': user.id,
                'extended_by_name': user_display_name,
            }
            schedule.section_extensions = current_exts
            schedule.save(update_fields=['section_extensions', 'updated_at'])
            Exam.objects.filter(schedule=schedule, section__iexact=target_section).update(marks_entry_deadline=new_deadline)
        else:
            # Schedule-wide extension replaces scoped overrides so every subject
            # and section receives the same updated deadline.
            schedule.marks_entry_deadline = new_deadline
            schedule.marks_entry_extended = True
            schedule.marks_entry_extension_reason = reason
            schedule.marks_entry_extended_at = now
            schedule.marks_entry_extended_by = user
            schedule.section_extensions = {}
            schedule.subject_extensions = {}
            schedule.save(update_fields=[
                'marks_entry_deadline',
                'marks_entry_extended',
                'marks_entry_extension_reason',
                'marks_entry_extended_at',
                'marks_entry_extended_by',
                'section_extensions',
                'subject_extensions',
                'updated_at',
            ])
            Exam.objects.filter(schedule=schedule).update(marks_entry_deadline=new_deadline)

        # Notify teachers
        try:
            class_teachers_qs = Teacher.objects.filter(
                school_id=schedule.school_id,
                status=Teacher.Status.ACTIVE,
            )
            if is_specific_subject:
                class_teachers_qs = class_teachers_qs.filter(
                    Q(teaching_assignments__section__class_room=schedule.classroom, teaching_assignments__subject__name__iexact=target_subject) |
                    Q(subject_records__name__iexact=target_subject)
                )
            elif is_specific_section:
                class_teachers_qs = class_teachers_qs.filter(
                    Q(sections__class_room=schedule.classroom, sections__name__iexact=target_section) |
                    Q(teaching_assignments__section__class_room=schedule.classroom, teaching_assignments__section__name__iexact=target_section) |
                    Q(assigned_sections__contains=target_section)
                )
            else:
                class_teachers_qs = class_teachers_qs.filter(
                    Q(sections__class_room=schedule.classroom) |
                    Q(teaching_assignments__section__class_room=schedule.classroom) |
                    Q(assigned_sections__contains=schedule.class_name)
                )

            teacher_user_ids = list(class_teachers_qs.distinct().values_list('user_id', flat=True))
            scope_desc = (
                f"{schedule.class_name} - {target_subject}"
                if is_specific_subject else
                f"{schedule.class_name} - Section {target_section}"
                if is_specific_section else
                f"{schedule.class_name} (All Subjects and Sections)"
            )
            from apps.notifications.tasks import enqueue_notification_fanout
            enqueue_notification_fanout(
                school_id=schedule.school_id,
                sender_id=user.id,
                recipient_ids=[uid for uid in teacher_user_ids if uid],
                channel='marks-entry',
                category='Academic',
                title=f'Marks Entry Deadline Extended: {schedule.name}',
                body=f'The marks entry deadline for {scope_desc} ({schedule.name}) has been extended to {new_deadline.strftime("%b %d, %Y %I:%M %p")}. Reason: {reason}',
                related={
                    'schedule_id': schedule.id,
                    'class_name': schedule.class_name,
                    'section': target_section if is_specific_section else 'all',
                    'subject': target_subject if is_specific_subject else 'all',
                    'deadline': new_deadline.isoformat(),
                },
            )
        except Exception:
            pass

        target_label = f"Subject {target_subject}" if is_specific_subject else f"Section {target_section}" if is_specific_section else "all subjects and sections"
        return Response({
            'detail': f'Marks entry deadline for {schedule.class_name} ({target_label}) successfully extended to {new_deadline.strftime("%b %d, %Y %I:%M %p")}.',
            'schedule_id': schedule.id,
            'section': target_section if is_specific_section else 'all',
            'subject': target_subject if is_specific_subject else 'all',
            'marks_entry_deadline': new_deadline.isoformat(),
            'marks_entry_extended': True,
            'marks_entry_extension_reason': reason,
            'section_extensions': schedule.section_extensions or {},
        })

    @action(detail=True, methods=['post'], url_path='reset-marks-entry')
    def reset_marks_entry(self, request, pk=None):
        schedule = self.get_object()
        user = request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can modify deadlines.'}, status=status.HTTP_403_FORBIDDEN)

        target_section = str(request.data.get('section', '')).strip()
        target_subject = str(request.data.get('subject', '')).strip()
        is_specific_section = bool(target_section and target_section.lower() not in ['all', 'all sections', ''])
        is_specific_subject = bool(target_subject and target_subject.lower() not in ['all', 'all subjects', ''])

        if is_specific_subject:
            current_exts = dict(schedule.subject_extensions or {})
            matched_key = next((k for k in current_exts if str(k).strip().lower() == target_subject.lower()), None)
            if matched_key:
                del current_exts[matched_key]
            schedule.subject_extensions = current_exts
            schedule.save(update_fields=['subject_extensions', 'updated_at'])
            Exam.objects.filter(schedule=schedule, subject__iexact=target_subject).update(marks_entry_deadline=None)
            msg = f'Marks entry deadline for {target_subject} now follows this exam schedule’s default deadline.'
        elif is_specific_section:
            current_exts = dict(schedule.section_extensions or {})
            matched_key = None
            for k in current_exts:
                if str(k).strip().lower() == target_section.lower():
                    matched_key = k
                    break
            if matched_key:
                del current_exts[matched_key]
            schedule.section_extensions = current_exts
            schedule.save(update_fields=['section_extensions', 'updated_at'])
            Exam.objects.filter(schedule=schedule, section__iexact=target_section).update(marks_entry_deadline=None)
            msg = f'Marks entry deadline for Section {target_section} has been reset to the standard 3-day post-exam window.'
        else:
            schedule.marks_entry_deadline = None
            schedule.marks_entry_extended = False
            schedule.marks_entry_extension_reason = ''
            schedule.marks_entry_extended_at = None
            schedule.marks_entry_extended_by = None
            schedule.section_extensions = {}
            schedule.subject_extensions = {}
            schedule.save(update_fields=[
                'marks_entry_deadline',
                'marks_entry_extended',
                'marks_entry_extension_reason',
                'marks_entry_extended_at',
                'marks_entry_extended_by',
                'section_extensions',
                'subject_extensions',
                'updated_at',
            ])
            Exam.objects.filter(schedule=schedule).update(marks_entry_deadline=None)
            msg = f'Marks entry deadlines for all subjects and sections of {schedule.class_name} have been reset to the schedule default window.'

        return Response({
            'detail': msg,
            'schedule_id': schedule.id,
            'section': target_section if is_specific_section else 'all',
            'subject': target_subject if is_specific_subject else 'all',
            'marks_entry_extended': False,
            'section_extensions': schedule.section_extensions or {},
        })

    @action(detail=True, methods=['post'], url_path='generate-report-cards')
    def generate_report_cards(self, request, pk=None):
        schedule = self.get_object()
        user = request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can generate report cards.'}, status=status.HTTP_403_FORBIDDEN)

        if not schedule.marks_published:
            return Response(
                {'detail': 'Cannot generate report cards. The administrator must first verify and publish marks for this examination.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule.report_cards_generated = True
        schedule.save(update_fields=['report_cards_generated', 'updated_at'])

        return Response({
            'detail': f'Report cards successfully generated for {schedule.name} ({schedule.class_name}). Ready for administrator verification and publishing to students and parents.',
            'schedule_id': schedule.id,
            'report_cards_generated': True,
        })

    @action(detail=True, methods=['post'], url_path='publish-report-cards')
    def publish_report_cards(self, request, pk=None):
        schedule = self.get_object()
        user = request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can publish official report cards.'}, status=status.HTTP_403_FORBIDDEN)

        if not schedule.marks_published:
            return Response(
                {'detail': 'Cannot publish report cards. Examination marks must first be verified and published.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not schedule.report_cards_generated:
            return Response(
                {'detail': 'Cannot publish report cards. Report cards must first be generated by clicking "Generate Report Cards".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule.report_cards_published = True
        schedule.report_cards_published_at = timezone.now()
        schedule.save(update_fields=['report_cards_published', 'report_cards_published_at', 'updated_at'])

        # Set all linked exam results to submitted
        ExamResult.objects.filter(exam__schedule=schedule).update(
            status=ExamResult.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )

        # Notify Students and Parents ONLY (NOT teachers)
        class_students = Student.objects.filter(
            school=schedule.school,
            status=Student.Status.ACTIVE,
        ).filter(
            Q(section_record__class_room=schedule.classroom) |
            Q(class_name__iexact=schedule.class_name)
        )

        parent_user_ids = list(User.objects.filter(parent_profile__students__in=class_students).values_list('id', flat=True).distinct())
        student_user_ids = list(User.objects.filter(login_profile__student__in=class_students).values_list('id', flat=True).distinct())

        student_names = list(class_students.values_list('name', flat=True)[:10])
        student_ids = list(class_students.values_list('id', flat=True))

        from apps.notifications.tasks import enqueue_notification_fanout
        enqueue_notification_fanout(
            school_id=schedule.school_id,
            sender_id=user.id,
            recipient_ids=list(set(parent_user_ids + student_user_ids)),
            channel='exam-result',
            category='Academic',
            title=f'Official Report Cards Published: {schedule.name}',
            body=f'Official terminal examination report cards for {schedule.class_name} ({schedule.name}) have been verified and published by the administration. You can now view and download your official grade card.',
            related={
                'schedule_id': schedule.id,
                'class_name': schedule.class_name,
                'targetClass': schedule.class_name,
                'report_cards_published': True,
                'studentNames': student_names,
                'studentIds': student_ids,
            },
        )

        return Response({
            'detail': f'Official report cards for {schedule.name} ({schedule.class_name}) have been approved and published to {len(student_user_ids)} students and {len(parent_user_ids)} parents.',
            'published_at': schedule.report_cards_published_at,
            'schedule': ExamScheduleSerializer(schedule, context={'request': request}).data,
        })

    @action(detail=True, methods=['get'], url_path='report-cards')
    def get_report_cards(self, request, pk=None):
        schedule = self.get_object()
        user = request.user

        if user.role == User.Role.TEACHER:
            return Response(
                {'detail': 'Report cards are distributed directly to students and parents only.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        items = list(schedule.items.all().order_by('order', 'exam_date', 'start_time'))
        results = ExamResult.objects.filter(exam__schedule=schedule).select_related('exam')
        result_map = {(r.student_id, r.exam.subject): r for r in results}

        def compute_grade_letter(pct):
            if pct >= 90: return 'A+'
            if pct >= 80: return 'A'
            if pct >= 70: return 'B+'
            if pct >= 60: return 'B'
            if pct >= 50: return 'C+'
            if pct >= 40: return 'C'
            return 'F'

        def build_card(student, rank_num=1, total_count=1):
            papers = []
            tot_obt = 0
            tot_max = 0
            all_pass = True

            for it in items:
                res = result_map.get((student.id, it.subject_name))
                m_val = res.marks_obtained if res and res.marks_obtained is not None else 0
                m_num = float(m_val) if m_val is not None else 0
                max_m = it.max_marks or 100
                pct = round((m_num / max_m) * 100, 1) if max_m > 0 else 0
                grd = compute_grade_letter(pct)
                if pct < 40:
                    all_pass = False
                tot_obt += m_num
                tot_max += max_m

                papers.append({
                    'subject_name': it.subject_name,
                    'max_marks': max_m,
                    'marks_obtained': m_num if res and res.marks_obtained is not None else 0,
                    'percentage': pct,
                    'grade': grd,
                    'remarks': res.remarks if res else '',
                })

            ov_pct = round((tot_obt / tot_max) * 100, 1) if tot_max > 0 else 0
            ov_grd = compute_grade_letter(ov_pct)
            gpa = round(ov_pct / 9.5, 2) if ov_pct > 0 else 0.0

            school_obj = getattr(schedule, 'school', None) or getattr(student, 'school', None)
            school_name = school_obj.name if school_obj else ''

            return {
                'id': f"RC-{schedule.id}-{student.id}",
                'report_card_no': f"RC/{student.academic_year or '2026'}/{schedule.id}/{student.roll_no or student.id:03d}",
                'schedule_id': schedule.id,
                'exam_name': schedule.name,
                'academic_year': schedule.academic_year or '2026-2027',
                'school_name': school_name,
                'class_name': student.class_name or schedule.class_name,
                'section': student.section or (student.section_record.name if student.section_record else 'A'),
                'student_id': student.id,
                'student_name': student.name,
                'admission_no': student.admission_no,
                'roll_no': student.roll_no or student.id,
                'parent_name': student.parent_name or getattr(student, 'father_name', '') or getattr(student, 'mother_name', ''),
                'photo_url': getattr(student, 'photo_url', '') or '',
                'papers': papers,
                'total_obtained': tot_obt,
                'total_max': tot_max,
                'percentage': ov_pct,
                'grade': ov_grd,
                'gpa': min(gpa, 10.0),
                'result_status': 'PASSED' if all_pass else 'PROMOTED / NEEDS IMPROVEMENT',
                'rank': rank_num,
                'total_candidates': total_count,
                'status': 'published' if schedule.report_cards_published else ('generated' if schedule.report_cards_generated else 'draft'),
                'is_published': schedule.report_cards_published,
                'published_at': schedule.report_cards_published_at,
                'conduct_remarks': 'Exemplary conduct, consistent academic diligence and positive classroom participation.',
            }

        # For Admin
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            if not schedule.report_cards_generated and not schedule.report_cards_published:
                return Response({
                    'status': 'not_generated',
                    'marks_published': schedule.marks_published,
                    'marks_published_at': schedule.marks_published_at,
                    'is_published': False,
                    'is_generated': False,
                    'published_at': None,
                    'schedule_id': schedule.id,
                    'schedule_name': schedule.name,
                    'class_name': schedule.class_name,
                    'report_cards': [],
                })

            class_students = list(Student.objects.filter(
                school=schedule.school,
                status=Student.Status.ACTIVE,
            ).filter(
                Q(section_record__class_room=schedule.classroom) |
                Q(class_name__iexact=schedule.class_name)
            ).select_related('section_record').order_by('roll_no', 'name'))

            # Compute ranks by total marks
            student_scores = []
            for s in class_students:
                tot = sum(
                    float(result_map.get((s.id, it.subject_name)).marks_obtained or 0)
                    if result_map.get((s.id, it.subject_name)) and result_map.get((s.id, it.subject_name)).marks_obtained is not None
                    else 0
                    for it in items
                )
                student_scores.append((tot, s))

            student_scores.sort(key=lambda x: x[0], reverse=True)
            rank_map = {}
            for rank_idx, (tot, s) in enumerate(student_scores, 1):
                rank_map[s.id] = rank_idx

            cards = [build_card(s, rank_map.get(s.id, 1), len(class_students)) for s in class_students]
            return Response({
                'status': 'published' if schedule.report_cards_published else ('generated' if schedule.report_cards_generated else 'draft'),
                'marks_published': schedule.marks_published,
                'marks_published_at': schedule.marks_published_at,
                'is_published': schedule.report_cards_published,
                'is_generated': schedule.report_cards_generated,
                'published_at': schedule.report_cards_published_at,
                'schedule_id': schedule.id,
                'schedule_name': schedule.name,
                'class_name': schedule.class_name,
                'report_cards': cards,
            })

        # For Student
        if user.role == User.Role.STUDENT:
            if not schedule.report_cards_published:
                return Response({
                    'status': 'pending_publishing',
                    'is_published': False,
                    'message': f'Official report cards for {schedule.name} ({schedule.class_name}) are awaiting administrator publishing.',
                    'report_cards': [],
                })
            profile = getattr(user, 'student_profile', None)
            if not profile or profile.student.school_id != schedule.school_id:
                return Response({'status': 'not_found', 'is_published': False, 'report_cards': []})
            card = build_card(profile.student)
            return Response({
                'status': 'published',
                'is_published': True,
                'published_at': schedule.report_cards_published_at,
                'report_cards': [card],
            })

        # For Parent
        if user.role == User.Role.PARENT:
            if not schedule.report_cards_published:
                return Response({
                    'status': 'pending_publishing',
                    'is_published': False,
                    'message': f'Official report cards for {schedule.name} ({schedule.class_name}) are awaiting administrator publishing.',
                    'report_cards': [],
                })
            profile = getattr(user, 'parent_profile', None)
            if not profile:
                return Response({'status': 'not_found', 'is_published': False, 'report_cards': []})
            parent_students = profile.students.filter(
                school_id=schedule.school_id,
                status=Student.Status.ACTIVE,
            ).filter(
                Q(section_record__class_room=schedule.classroom) |
                Q(class_name__iexact=schedule.class_name)
            ).select_related('section_record').order_by('name')

            cards = [build_card(s) for s in parent_students]
            return Response({
                'status': 'published',
                'is_published': True,
                'published_at': schedule.report_cards_published_at,
                'report_cards': cards,
            })

        return Response({'status': 'forbidden', 'is_published': False, 'report_cards': []}, status=status.HTTP_403_FORBIDDEN)


def can_enter(teacher, exam):
    if (
        not teacher
        or teacher.status != Teacher.Status.ACTIVE
        or teacher.school_id != exam.school_id
    ):
        return False
    subject_ok = teacher.subject_records.filter(
        school_id=exam.school_id,
        name=exam.subject,
    ).exists()
    section_ok = teacher.sections.filter(
        school_id=exam.school_id,
        class_room__name=exam.class_name,
        name=exam.section,
    ).exists()
    return subject_ok and section_ok


def _exam_scope_for_section_pairs(queryset, sections):
    scope = Q(pk__in=[])
    for section in sections:
        scope |= Q(class_name=section.class_room.name, section=section.name)
    return queryset.filter(scope)


class ExamPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER, User.Role.PARENT, User.Role.STUDENT]
        # Exams and their linked result records are controlled by the school
        # administrator. Teachers can enter results only through the dedicated
        # submit_results action below.
        if view.action == 'submit_results':
            return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER]
        return request.user.role == User.Role.SCHOOL_ADMIN


class ExamViewSet(TenantScopedViewSet):
    """Tenant-scoped exam CRUD plus result actions under one router resource."""
    queryset = Exam.objects.select_related('school').order_by('-date', '-id')
    serializer_class = ExamSerializer
    permission_classes = [ExamPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role == User.Role.TEACHER:
            teacher = Teacher.objects.filter(
                user=user,
                school_id=user.school_id,
                status=Teacher.Status.ACTIVE,
            ).first()
            if not teacher:
                return qs.none()
            exact_assignments = TeacherTeachingAssignment.objects.filter(
                school_id=user.school_id,
                teacher=teacher,
            ).select_related('section__class_room', 'subject')
            if exact_assignments.exists():
                exact_scope = Q(pk__in=[])
                for assignment in exact_assignments:
                    exact_scope |= Q(
                        class_name=assignment.section.class_room.name,
                        section=assignment.section.name,
                        subject=assignment.subject.name,
                    )
                return qs.filter(exact_scope)
            sections = teacher.sections.filter(school_id=user.school_id).select_related('class_room')
            subject_names = teacher.subject_records.filter(
                school_id=user.school_id,
            ).values_list('name', flat=True)
            return _exam_scope_for_section_pairs(qs.filter(subject__in=subject_names), sections)
        if user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            if not profile:
                return qs.none()
            student = profile.student
            # Defense in depth: the profile's student must belong to the
            # caller's tenant even though profile construction is atomic.
            if student.school_id != user.school_id:
                return qs.none()
            return qs.filter(class_name=student.class_name, section=student.section)
        if user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            if not profile:
                return qs.none()
            scope = Q(pk__in=[])
            for class_name, section in profile.students.filter(
                school_id=user.school_id,
            ).values_list('class_name', 'section').distinct():
                scope |= Q(class_name=class_name, section=section)
            return qs.filter(scope)
        if user.role != User.Role.SCHOOL_ADMIN:
            return qs.none()
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        schedule = serializer.validated_data.get('schedule')
        school = schedule.school if user.role == User.Role.SUPER_ADMIN and schedule else user.school
        if not school or (schedule and schedule.school_id != school.id):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'schedule': 'Select an exam schedule in the school you manage, or create this exam from your school account.'})
        serializer.save(school=school)

    @action(detail=True, methods=['get'], url_path='results')
    def results(self, request, pk=None):
        exam = self.get_object()
        school_id = request.user.school_id
        if request.user.role == User.Role.PARENT:
            qs = ExamResult.objects.filter(
                exam=exam,
                school_id=school_id,
                student__parent_profiles__user=request.user,
                status=ExamResult.Status.SUBMITTED,
            )
        elif request.user.role == User.Role.STUDENT and hasattr(request.user, 'student_profile'):
            qs = ExamResult.objects.filter(
                exam=exam,
                school_id=school_id,
                student=request.user.student_profile.student,
                status=ExamResult.Status.SUBMITTED,
            )
        elif request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER]:
            qs = ExamResult.objects.filter(exam=exam, school_id=exam.school_id)
        else:
            return Response({'detail': 'You may only view your own child’s results.'}, status=status.HTTP_403_FORBIDDEN)
        return Response(ExamResultSerializer(qs.select_related('student'), many=True).data)

    @action(detail=True, methods=['post'], url_path='results/submit')
    def submit_results(self, request, pk=None):
        exam = self.get_object()
        is_admin = request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        teacher = Teacher.objects.filter(user=request.user, status=Teacher.Status.ACTIVE).first()
        
        if not is_admin and not can_enter(teacher, exam):
            return Response({'detail': 'Only assigned teachers or school administrators can enter marks for this class, section, and subject.'}, status=status.HTTP_403_FORBIDDEN)
        
        # Check deadline window for teachers
        if not is_admin:
            if exam.schedule:
                win = exam.schedule.check_marks_entry_window(request.user, exam.subject)
                if not win['is_open']:
                    return Response({'detail': win['reason']}, status=status.HTTP_403_FORBIDDEN)
            elif exam.date:
                t = exam.end_time or exam.time or datetime.time(23, 59, 59)
                exam_dt = datetime.datetime.combine(exam.date, t)
                if timezone.is_naive(exam_dt):
                    exam_dt = timezone.make_aware(exam_dt, timezone.get_current_timezone())
                deadline = exam.marks_entry_deadline or (exam_dt + datetime.timedelta(days=3))
                if timezone.now() > deadline:
                    return Response({
                        'detail': f"Marks entry window closed on {deadline.strftime('%b %d, %Y %I:%M %p')}. Contact admin to extend the days."
                    }, status=status.HTTP_403_FORBIDDEN)
        
        entries = request.data.get('results', [])
        if not isinstance(entries, list):
            return Response({'errors': [{'row': None, 'field': 'results', 'error': 'must_be_a_list'}]}, status=status.HTTP_400_BAD_REQUEST)
        
        errors = []
        for index, row in enumerate(entries, start=1):
            student_id = row.get('studentId') if isinstance(row, dict) else None
            context = {'row': index, 'student_id': student_id}
            if not isinstance(row, dict) or not student_id:
                errors.append({**context, 'field': 'student_id', 'error': 'required'})
                continue
            try:
                marks = float(row.get('marksObtained')) if row.get('marksObtained') is not None and str(row.get('marksObtained')).strip() != '' else None
            except (TypeError, ValueError):
                errors.append({**context, 'field': 'marks_obtained', 'error': 'must_be_a_number'})
                continue
            if marks is not None and (not isfinite(marks) or marks < 0 or marks > exam.max_marks):
                errors.append({**context, 'field': 'marks_obtained', 'error': 'exceeds_max_marks'})
            if row.get('status', 'draft') not in ExamResult.Status.values:
                errors.append({**context, 'field': 'status', 'error': 'invalid_choice'})
            
            candidate_students = Student.objects.filter(
                id=student_id,
                school=exam.school,
                class_name=exam.class_name,
                section=exam.section,
            )
            if not is_admin and teacher:
                assigned_section_ids = teacher.sections.filter(
                    school=exam.school,
                    class_room__name=exam.class_name,
                    name=exam.section,
                ).values_list('id', flat=True)
                candidate_students = candidate_students.filter(section_record_id__in=assigned_section_ids)
            if not candidate_students.exists():
                errors.append({**context, 'field': 'student_id', 'error': 'not_found_in_section'})
        
        if errors:
            return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)
        
        for row in entries:
            student_id = row['studentId']
            result, _ = ExamResult.objects.get_or_create(
                exam=exam,
                student_id=student_id,
                defaults={'school': exam.school, 'entered_by': request.user}
            )
            
            # If already submitted and user is a Teacher, they cannot modify unless Admin modifies/unlocks:
            if result.status == ExamResult.Status.SUBMITTED and not is_admin and row.get('status') == 'draft':
                return Response(
                    {'detail': 'Submitted results are locked for teachers. Please contact the administrator to make changes.'},
                    status=status.HTTP_409_CONFLICT,
                )

            marks_val = row.get('marksObtained')
            if marks_val is not None and str(marks_val).strip() != '':
                result.marks_obtained = float(marks_val)
            else:
                result.marks_obtained = None
            
            result.remarks = row.get('remarks', '') or ''
            result.status = row.get('status', 'draft')
            result.entered_by = request.user
            if result.status == ExamResult.Status.SUBMITTED:
                result.submitted_at = timezone.now()
            result.save()

            if result.status == ExamResult.Status.SUBMITTED:
                recipient_ids = list(result.student.parent_profiles.filter(user__is_active=True).values_list('user_id', flat=True))
                student_user_id = result.student.login_profile.user_id if getattr(result.student, 'login_profile', None) else None
                if student_user_id:
                    recipient_ids.append(student_user_id)
                from apps.notifications.tasks import enqueue_notification_fanout
                enqueue_notification_fanout(
                    school_id=exam.school_id,
                    sender_id=request.user.id,
                    recipient_ids=list(set(recipient_ids)),
                    channel='exam-result',
                    category='Academic',
                    title=f'Exam Results Published: {exam.name}',
                    body=f'Official marks for {result.student.name} in {exam.subject} ({exam.class_name} {exam.section}) are now published.',
                    related={
                        'exam_id': exam.id,
                        'student_id': result.student_id,
                        'class_name': exam.class_name,
                        'section': exam.section,
                        'targetClass': exam.class_name,
                    },
                )
        
        return Response({'updated': len(entries), 'detail': f'Marks successfully saved for {len(entries)} students.'})


class StudentResultsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: ExamResultSerializer(many=True), 403: OpenApiResponse(description='Forbidden'), 404: OpenApiResponse(description='Not found')})
    def get(self, request, student_id):
        student_qs = Student.objects.filter(pk=student_id)
        if request.user.role != User.Role.SUPER_ADMIN:
            student_qs = student_qs.filter(school_id=request.user.school_id)
        student = student_qs.first()
        if not student:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role == User.Role.PARENT and (not hasattr(request.user, 'parent_profile') or not request.user.parent_profile.students.filter(pk=student.pk, school_id=request.user.school_id).exists()):
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role == User.Role.STUDENT and (not hasattr(request.user, 'student_profile') or request.user.student_profile.student_id != student.pk or student.school_id != request.user.school_id):
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role not in [User.Role.PARENT, User.Role.STUDENT, User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        results = ExamResult.objects.filter(
            student=student, school_id=student.school_id,
            status=ExamResult.Status.SUBMITTED,
        ).select_related('student', 'exam')
        if request.user.role == User.Role.TEACHER:
            teacher = Teacher.objects.filter(
                user=request.user,
                school_id=request.user.school_id,
                status=Teacher.Status.ACTIVE,
            ).first()
            if not teacher_can_access_student(teacher, student, school_id=request.user.school_id):
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
            exact_subjects = TeacherTeachingAssignment.objects.filter(
                school_id=student.school_id,
                teacher=teacher,
                section_id=student.section_record_id,
            ).values_list('subject__name', flat=True)
            if exact_subjects.exists():
                results = results.filter(exam__subject__in=exact_subjects)
            else:
                # Legacy teachers have separate section and subject links. Keep
                # both boundaries enforced until their exact assignments exist.
                subject_names = teacher.subject_records.filter(
                    school_id=student.school_id,
                ).values_list('name', flat=True)
                results = results.filter(exam__subject__in=subject_names)
        return Response(ExamResultSerializer(results, many=True).data)
