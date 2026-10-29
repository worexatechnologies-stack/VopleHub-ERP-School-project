from datetime import datetime
from django.db import transaction
from django.db.models import Count, Q, Prefetch
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from apps.sis.models import Student
from apps.sis.access import teacher_student_queryset
from apps.accounts.models import User
from apps.academics.models import Subject
from apps.staff.models import Teacher
from apps.timetable.models import TimetableSlot
from apps.common.tenancy import TenantScopedViewSet
from apps.notifications.views import create_rows
from apps.notifications.services import notify_parents_of_student, notify_school_admins
from .models import AttendanceRecord, AttendanceAuditLog
from .serializers import AttendanceRecordSerializer, AttendanceAuditLogSerializer


class AttendanceRecordPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 500


class AttendanceAccess(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in [
                User.Role.SCHOOL_ADMIN,
                User.Role.TEACHER,
                User.Role.PARENT,
                User.Role.STUDENT,
            ]
            and request.user.school_id
        )


class CanViewAttendanceReports(permissions.BasePermission):
    """Only school staff may view attendance aggregates and reports."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.school_id):
            return False
        if user.role == User.Role.SCHOOL_ADMIN:
            return True
        return bool(
            user.role == User.Role.TEACHER
            and getattr(user, 'teacher_profile', None)
            and user.teacher_profile.school_id == user.school_id
            and user.teacher_profile.status == 'Active'
        )


class CanMarkAttendance(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER]


def check_teacher_period_permission(user, student, attendance_date, period, subject_id=None):
    """
    Validates whether the user is authorized to mark/modify attendance for a specific
    student, date, and period slot according to timetable assignments.
    Returns (allowed: bool, slot, subject, subject_teacher).
    """
    if user.role == User.Role.SCHOOL_ADMIN:
        # Admin has full access within tenant school
        subj = Subject.objects.filter(school_id=user.school_id, pk=subject_id).first() if subject_id else None
        return True, None, subj, None

    if user.role != User.Role.TEACHER:
        return False, None, None, None

    teacher = getattr(user, 'teacher_profile', None)
    if (
        not teacher
        or teacher.school_id != user.school_id
        or teacher.status != Teacher.Status.ACTIVE
    ):
        return False, None, None, None

    # Determine day of week
    if isinstance(attendance_date, str):
        try:
            date_obj = datetime.strptime(attendance_date, '%Y-%m-%d').date()
        except ValueError:
            date_obj = datetime.now().date()
    else:
        date_obj = attendance_date

    day_of_week = date_obj.strftime('%A')

    # Look up timetable slot for this student's section, day, and period
    slot = None
    if student.section_record:
        slot = TimetableSlot.objects.filter(
            school_id=user.school_id,
            section=student.section_record,
            academic_year__starts_on__lte=date_obj,
            academic_year__ends_on__gte=date_obj,
            day=day_of_week,
            period=period,
        ).order_by('-published', '-id').select_related('subject', 'teacher', 'teacher__user').first()

    if slot:
        # A timetable slot is the exact authority for a scheduled period.
        # Neither section membership nor teaching the same subject elsewhere
        # allows a teacher to mark another teacher's period.
        if slot.teacher_id != teacher.id or (subject_id and str(slot.subject_id) != str(subject_id)):
            return False, slot, slot.subject, slot.teacher
        return True, slot, slot.subject, slot.teacher

    # Without a timetable slot, only an exact teacher + section + subject
    # assignment can authorize attendance. Section-only access is too broad.
    if not student.section_record_id or not subject_id:
        return False, None, None, None

    from apps.staff.models import TeacherTeachingAssignment
    assignment = TeacherTeachingAssignment.objects.filter(
        school_id=user.school_id,
        teacher=teacher,
        section_id=student.section_record_id,
        subject_id=subject_id,
    ).select_related('subject').first()
    if not assignment:
        return False, None, None, None
    return True, None, assignment.subject, teacher


def get_teacher_display_name(teacher):
    if not teacher:
        return ''
    if getattr(teacher, 'user', None):
        return teacher.user.get_full_name() or teacher.user.email
    return f'Teacher #{teacher.id}'


class AttendanceViewSet(TenantScopedViewSet):
    permission_classes = [AttendanceAccess]
    pagination_class = AttendanceRecordPagination
    serializer_class = AttendanceRecordSerializer
    queryset = AttendanceRecord.objects.select_related(
        'student', 'subject', 'subject_teacher', 'subject_teacher__user', 'marked_by', 'timetable_slot'
    ).order_by('-date', 'period', '-id')
    http_method_names = ['get', 'head', 'options', 'put', 'post', 'patch']

    def get_permissions(self):
        if self.action in ['mark', 'bulk_mark']:
            return [AttendanceAccess(), CanMarkAttendance()]
        if self.action in ['report', 'analytics']:
            return [AttendanceAccess(), CanViewAttendanceReports()]
        return [AttendanceAccess()]

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False) or not self.request.user.is_authenticated:
            return AttendanceRecord.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            qs = qs.filter(student__parent_profiles=profile).distinct() if profile else qs.none()
        elif user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            qs = qs.filter(student_id=profile.student_id) if profile else qs.none()
        elif user.role == User.Role.TEACHER:
            profile = getattr(user, 'teacher_profile', None)
            permitted_students = teacher_student_queryset(
                profile,
                Student.objects.all(),
                school_id=user.school_id,
            )
            qs = qs.filter(student__in=permitted_students)
        elif user.role != User.Role.SCHOOL_ADMIN:
            qs = qs.none()

        if date_val := self.request.query_params.get('date'):
            qs = qs.filter(date=date_val)
        if day_val := self.request.query_params.get('day_of_week'):
            qs = qs.filter(day_of_week__iexact=day_val)
        if period_val := self.request.query_params.get('period'):
            qs = qs.filter(period=period_val)
        if subject_id := self.request.query_params.get('subject_id'):
            qs = qs.filter(subject_id=subject_id)
        if class_name := self.request.query_params.get('class_name'):
            qs = qs.filter(student__class_name=class_name)
        if section_val := self.request.query_params.get('section'):
            qs = qs.filter(student__section=section_val)
        if status_val := self.request.query_params.get('status'):
            qs = qs.filter(status=status_val)
        if student_id := self.request.query_params.get('student_id'):
            qs = qs.filter(student_id=student_id)
        if self.request.query_params.get('include_audit') == 'true':
            qs = qs.prefetch_related(
                Prefetch('audit_logs', queryset=AttendanceAuditLog.objects.select_related('changed_by', 'student', 'subject'))
            )
        return qs

    # Attendance changes must go through mark/bulk_mark, which enforce
    # timetable authorization and write audit records. Do not expose the
    # generic ModelViewSet mutation routes.
    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method)

    def update(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method)

    def partial_update(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method)

    @action(detail=False, methods=['put'], url_path='mark')
    def mark(self, request):
        student_id = request.data.get('studentId')
        attendance_date = request.data.get('date')
        try:
            period = int(request.data.get('period', 1))
        except (ValueError, TypeError):
            return Response({'detail': 'Enter a valid attendance period.'}, status=status.HTTP_400_BAD_REQUEST)
        if period < 1 or period > 6:
            return Response({'detail': 'Attendance period must be between 1 and 6.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            date_obj = datetime.strptime(attendance_date, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            return Response({'detail': 'Enter a valid attendance date.'}, status=status.HTTP_400_BAD_REQUEST)
        attendance_status = request.data.get('status')
        subject_id = request.data.get('subjectId')
        reason = request.data.get('reason', '')

        if attendance_status not in AttendanceRecord.Status.values:
            return Response(
                {'detail': f'status must be one of {list(AttendanceRecord.Status.values)}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user

        # 1. Lookup student in user's tenant school
        try:
            student = Student.objects.filter(school_id=user.school_id).get(pk=student_id)
        except (Student.DoesNotExist, TypeError, ValueError):
            return Response({'detail': 'Student not found.'}, status=status.HTTP_404_NOT_FOUND)

        # 2. Strict Teacher Period Authorization check
        allowed, slot, subject, subject_teacher = check_teacher_period_permission(
            user, student, attendance_date, period, subject_id
        )
        if not allowed:
            return Response(
                {'detail': 'You can mark attendance only for your assigned subject periods. No changes were saved.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Calculate weekday string
        day_str = date_obj.strftime('%A')

        # 3. Capture old status for Audit Trail
        existing_record = AttendanceRecord.objects.filter(student=student, date=attendance_date, period=period).first()
        old_status = existing_record.status if existing_record else None

        # Determine subject & teacher references
        final_subject = subject or (slot.subject if slot else None)
        final_teacher = subject_teacher or (slot.teacher if slot else getattr(user, 'teacher_profile', None))
        time_label = slot.time_label if slot else f'Period {period}'

        # 4. Atomic update_or_create per (student, date, period)
        record, _ = AttendanceRecord.objects.update_or_create(
            student=student,
            date=attendance_date,
            period=period,
            defaults={
                'school': student.school,
                'day_of_week': day_str,
                'status': attendance_status,
                'subject': final_subject,
                'subject_teacher': final_teacher,
                'timetable_slot': slot,
                'time_label': time_label,
                'marked_by': user,
            },
        )

        # 5. Audit Logging when status changes
        if old_status != attendance_status:
            AttendanceAuditLog.objects.create(
                attendance_record=record,
                school=student.school,
                student=student,
                period=period,
                subject=final_subject,
                day_of_week=day_str,
                old_status=old_status,
                new_status=attendance_status,
                changed_by=user,
                reason=reason,
            )

            # 6. Trigger Subject/Period Parent Notification on status update (Present, Absent, Late)
            subj_title = final_subject.name if final_subject else None
            teacher_title = get_teacher_display_name(final_teacher) or (user.get_full_name() or user.email)
            if subj_title:
                desc = f"{subj_title} (Period {period})"
            else:
                desc = f"Period {period}"

            if attendance_status == AttendanceRecord.Status.ABSENT:
                alert_title = f'Absence Alert: {student.name} · {desc}'
                alert_body = f'Dear Parent, your ward {student.name} was marked ABSENT for {desc} today on {day_str}, {attendance_date}. Teacher: {teacher_title}.'
            elif attendance_status == AttendanceRecord.Status.LATE:
                alert_title = f'Late Arrival Alert: {student.name} · {desc}'
                alert_body = f'Dear Parent, your ward {student.name} was marked LATE for {desc} today on {day_str}, {attendance_date}. Teacher: {teacher_title}.'
            else:
                alert_title = f'Attendance: {student.name} · {desc}'
                alert_body = f'Dear Parent, your ward {student.name} was marked PRESENT for {desc} today on {day_str}, {attendance_date}. Teacher: {teacher_title}.'

            try:
                notify_parents_of_student(
                    student,
                    title=alert_title,
                    body=alert_body,
                    category='Attendance Alert',
                    channel='attendance-alert',
                    sender=user,
                    related={'studentId': student.id, 'status': attendance_status, 'period': period, 'date': attendance_date},
                )
            except Exception:
                pass

        try:
            from apps.common.realtime import broadcast_sync_event
            broadcast_sync_event(
                school_id=student.school_id,
                entity='attendance',
                action='marked',
                entity_id=record.id,
                data={
                    'studentId': student.id,
                    'date': str(attendance_date),
                    'period': period,
                    'status': attendance_status,
                },
            )
        except Exception:
            pass

        return Response(self.get_serializer(record).data)

    @action(detail=False, methods=['put', 'post'], url_path='bulk-mark')
    def bulk_mark(self, request):
        """Bulk mark attendance records across multiple students and periods atomically."""
        user = request.user
        data = request.data
        attendance_date = data.get('date') or str(datetime.now().date())
        try:
            date_obj = datetime.strptime(attendance_date, '%Y-%m-%d').date()
            day_str = date_obj.strftime('%A')
        except (TypeError, ValueError):
            return Response({'detail': 'Enter a valid attendance date.'}, status=status.HTTP_400_BAD_REQUEST)

        student_ids = data.get('studentIds') or []
        periods = data.get('periods') or [1, 2, 3, 4, 5, 6]
        status_val = data.get('status', AttendanceRecord.Status.PRESENT)
        items = data.get('items')

        if items:
            work_items = items
        elif student_ids:
            work_items = []
            for s_id in student_ids:
                for p in periods:
                    work_items.append({'studentId': s_id, 'period': p, 'status': status_val})
        else:
            return Response({'detail': 'studentIds or items required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            normalized_items = []
            seen_slots = set()
            for item in work_items:
                student_id = int(item.get('studentId'))
                period = int(item.get('period', 1))
                attendance_status = item.get('status', AttendanceRecord.Status.PRESENT)
                if period < 1 or period > 6:
                    raise ValueError
                if attendance_status not in AttendanceRecord.Status.values:
                    return Response(
                        {'detail': f'status must be one of {list(AttendanceRecord.Status.values)}.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                key = (student_id, period)
                if key in seen_slots:
                    return Response({'detail': 'Each student period can appear only once.'}, status=status.HTTP_400_BAD_REQUEST)
                seen_slots.add(key)
                normalized_items.append({
                    'studentId': student_id,
                    'period': period,
                    'status': attendance_status,
                    'subjectId': item.get('subjectId'),
                })
        except (TypeError, ValueError, AttributeError):
            return Response({'detail': 'Provide a valid student and period for each attendance item.'}, status=status.HTTP_400_BAD_REQUEST)

        if not normalized_items:
            return Response({'detail': 'Provide at least one attendance item.'}, status=status.HTTP_400_BAD_REQUEST)

        unique_student_ids = list({it['studentId'] for it in normalized_items})
        students_by_id = {
            s.id: s for s in Student.objects.filter(school_id=user.school_id, id__in=unique_student_ids).select_related('section_record')
        }

        if len(students_by_id) != len(unique_student_ids):
            return Response({'detail': 'One or more students could not be found in your school. No changes were saved.'}, status=status.HTTP_404_NOT_FOUND)

        # Validate the whole batch before writing any records. A mixed batch
        # must not partially mark periods assigned to other teachers.
        for item in normalized_items:
            student = students_by_id[item['studentId']]
            allowed, _slot, _subject, _subject_teacher = check_teacher_period_permission(
                user, student, attendance_date, item['period'], item['subjectId']
            )
            if not allowed:
                return Response(
                    {'detail': 'You can mark attendance only for your assigned subject periods. No changes were saved.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        updated_count = 0
        attendance_notifications = {}
        with transaction.atomic():
            for it in normalized_items:
                s_id = it['studentId']
                p = it['period']
                st = it['status']
                student = students_by_id.get(s_id)

                allowed, slot, subject, subject_teacher = check_teacher_period_permission(
                    user, student, attendance_date, p, it['subjectId']
                )
                # Recheck inside the write transaction in case the timetable
                # assignment changed after batch validation.
                if not allowed:
                    transaction.set_rollback(True)
                    return Response(
                        {'detail': 'Your timetable assignment changed. No changes were saved; refresh and try again.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                final_subject = subject or (slot.subject if slot else None)
                final_teacher = subject_teacher or (slot.teacher if slot else getattr(user, 'teacher_profile', None))
                time_label = slot.time_label if slot else f'Period {p}'

                existing = AttendanceRecord.objects.filter(student=student, date=attendance_date, period=p).first()
                old_status = existing.status if existing else None

                record, _ = AttendanceRecord.objects.update_or_create(
                    student=student,
                    date=attendance_date,
                    period=p,
                    defaults={
                        'school': student.school,
                        'day_of_week': day_str,
                        'status': st,
                        'subject': final_subject,
                        'subject_teacher': final_teacher,
                        'timetable_slot': slot,
                        'time_label': time_label,
                        'marked_by': user,
                    },
                )
                updated_count += 1

                if old_status != st:
                    AttendanceAuditLog.objects.create(
                        attendance_record=record,
                        school=student.school,
                        student=student,
                        period=p,
                        subject=final_subject,
                        day_of_week=day_str,
                        old_status=old_status,
                        new_status=st,
                        changed_by=user,
                        reason='Bulk Attendance Mark',
                    )
                attendance_notifications[student.id] = (student, st)

        # Dispatch alerts/notices to parents for all marked students (Present, Absent, Late)
        for s_id, (student, st_val) in attendance_notifications.items():
            try:
                subj_tag = f"Class {student.class_name}-{student.section}" if student.class_name else "School"
                last_rec = AttendanceRecord.objects.filter(student=student, date=attendance_date).select_related('subject', 'subject_teacher', 'subject_teacher__user').order_by('-id').first()
                subj_name = last_rec.subject.name if (last_rec and last_rec.subject) else None
                p_num = last_rec.period if last_rec else None

                if subj_name and p_num:
                    target_desc = f"{subj_name} (Period {p_num})"
                elif subj_name:
                    target_desc = subj_name
                elif p_num:
                    target_desc = f"Period {p_num}"
                else:
                    target_desc = subj_tag

                teacher_title = get_teacher_display_name(last_rec.subject_teacher if last_rec else None) or (user.get_full_name() or user.email)

                if st_val == AttendanceRecord.Status.ABSENT:
                    n_title = f'Absence Alert: {student.name} · {target_desc}'
                    n_body = f'Dear Parent, your ward {student.name} was marked ABSENT for {target_desc} today on {day_str}, {attendance_date}. Teacher: {teacher_title}.'
                elif st_val == AttendanceRecord.Status.LATE:
                    n_title = f'Late Arrival Alert: {student.name} · {target_desc}'
                    n_body = f'Dear Parent, your ward {student.name} was marked LATE for {target_desc} today on {day_str}, {attendance_date}. Teacher: {teacher_title}.'
                else:
                    n_title = f'Attendance: {student.name} · {target_desc}'
                    n_body = f'Dear Parent, your ward {student.name} was marked PRESENT for {target_desc} today on {day_str}, {attendance_date}. Teacher: {teacher_title}.'

                notify_parents_of_student(
                    student,
                    title=n_title,
                    body=n_body,
                    category='Attendance Alert',
                    channel='attendance-alert',
                    sender=user,
                    related={'studentId': student.id, 'status': st_val, 'date': attendance_date},
                )
            except Exception:
                pass

        try:
            from apps.common.realtime import broadcast_sync_event
            broadcast_sync_event(
                school_id=user.school_id,
                entity='attendance',
                action='bulk_marked',
                data={
                    'count': updated_count,
                    'date': str(attendance_date),
                },
            )
        except Exception:
            pass

        return Response({
            'success': True,
            'count': updated_count,
            'message': f'Successfully updated {updated_count} attendance records.',
        })

    @action(detail=False, methods=['get'], url_path='report')
    def report(self, request):
        """
        Returns Period-Wise Daily Attendance Summary Report for a date and class/section.
        """
        user = request.user
        date_val = request.query_params.get('date', str(datetime.now().date()))
        class_name = request.query_params.get('class_name', '')
        section_val = request.query_params.get('section', '')

        students_qs = Student.objects.filter(school_id=user.school_id)
        if class_name:
            students_qs = students_qs.filter(class_name=class_name)
        if section_val:
            students_qs = students_qs.filter(section=section_val)

        if user.role == User.Role.TEACHER:
            teacher_profile = getattr(user, 'teacher_profile', None)
            students_qs = teacher_student_queryset(teacher_profile, students_qs, school_id=user.school_id)

        student_ids = list(students_qs.values_list('id', flat=True))
        total_students = len(student_ids)

        records_qs = AttendanceRecord.objects.filter(
            school_id=user.school_id,
            student_id__in=student_ids,
            date=date_val,
        ).select_related('subject', 'subject_teacher', 'subject_teacher__user')

        # Group attendance records by period (All 6 Periods)
        period_data = {}
        for p in range(1, 7):
            period_data[p] = {
                'period': p,
                'timeLabel': f'Period {p}',
                'subjectId': None,
                'subjectName': f'Period {p}',
                'teacherId': None,
                'teacherName': '',
                'presentCount': 0,
                'absentCount': 0,
                'lateCount': 0,
                'halfDayCount': 0,
                'totalStudents': total_students,
                'isEditable': True if user.role == User.Role.SCHOOL_ADMIN else False,
            }

        # Enrich with TimetableSlot definitions if section is specified
        if section_val and students_qs.first() and students_qs.first().section_record:
            try:
                date_obj = datetime.strptime(date_val, '%Y-%m-%d').date()
            except ValueError:
                date_obj = datetime.now().date()
            day_of_week = date_obj.strftime('%A')
            slots = TimetableSlot.objects.filter(
                school_id=user.school_id,
                section=students_qs.first().section_record,
                academic_year__starts_on__lte=date_obj,
                academic_year__ends_on__gte=date_obj,
                day=day_of_week,
            ).order_by('-published', '-id').select_related('subject', 'teacher', 'teacher__user')

            teacher_profile = getattr(user, 'teacher_profile', None)
            processed_periods = set()
            for s in slots:
                if s.period in period_data and s.period not in processed_periods:
                    processed_periods.add(s.period)
                    period_data[s.period]['timeLabel'] = s.time_label or f'Period {s.period}'
                    period_data[s.period]['subjectId'] = s.subject_id
                    period_data[s.period]['subjectName'] = s.subject.name if s.subject else f'Period {s.period}'
                    period_data[s.period]['teacherId'] = s.teacher_id
                    period_data[s.period]['teacherName'] = get_teacher_display_name(s.teacher)
                    if user.role == User.Role.SCHOOL_ADMIN:
                        period_data[s.period]['isEditable'] = True
                    elif teacher_profile and s.teacher_id == teacher_profile.id:
                        period_data[s.period]['isEditable'] = True

            # Fallback for periods without slot: check TeacherTeachingAssignment
            from apps.staff.models import TeacherTeachingAssignment
            teaching_assignments = TeacherTeachingAssignment.objects.filter(
                school_id=user.school_id,
                section=students_qs.first().section_record,
            ).select_related('subject', 'teacher', 'teacher__user')
            first_assign = teaching_assignments.first()
            if first_assign:
                for p in range(1, 7):
                    if not period_data[p]['subjectId']:
                        period_data[p]['subjectId'] = first_assign.subject_id
                        period_data[p]['subjectName'] = first_assign.subject.name
                        if not period_data[p]['teacherName']:
                            period_data[p]['teacherName'] = get_teacher_display_name(first_assign.teacher)

        for r in records_qs:
            p = r.period
            if p not in period_data:
                period_data[p] = {
                    'period': p,
                    'timeLabel': r.time_label or f'Period {p}',
                    'subjectId': r.subject_id,
                    'subjectName': r.subject.name if r.subject else f'Period {p}',
                    'teacherId': r.subject_teacher_id,
                    'teacherName': get_teacher_display_name(r.subject_teacher),
                    'presentCount': 0,
                    'absentCount': 0,
                    'lateCount': 0,
                    'halfDayCount': 0,
                    'totalStudents': total_students,
                    'isEditable': True if user.role == User.Role.SCHOOL_ADMIN else False,
                }
            if r.status == AttendanceRecord.Status.PRESENT:
                period_data[p]['presentCount'] += 1
            elif r.status == AttendanceRecord.Status.ABSENT:
                period_data[p]['absentCount'] += 1
            elif r.status == AttendanceRecord.Status.LATE:
                period_data[p]['lateCount'] += 1
            elif r.status == AttendanceRecord.Status.HALF_DAY:
                period_data[p]['halfDayCount'] += 1

        return Response(sorted(period_data.values(), key=lambda x: x['period']))

    @action(detail=False, methods=['get'], url_path='analytics')
    def analytics(self, request):
        """
        Database Future Analysis: Returns aggregated attendance trends by day of week,
        subject, period, and overall school metrics.
        """
        user = request.user
        qs = AttendanceRecord.objects.filter(school_id=user.school_id)

        if user.role == User.Role.TEACHER:
            permitted_students = teacher_student_queryset(
                getattr(user, 'teacher_profile', None),
                Student.objects.filter(school_id=user.school_id),
                school_id=user.school_id,
            )
            qs = qs.filter(student__in=permitted_students)

        if class_name := request.query_params.get('class_name'):
            qs = qs.filter(student__class_name=class_name)
        if section_val := request.query_params.get('section'):
            qs = qs.filter(student__section=section_val)

        # 1. Day of Week Analysis
        days_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        day_stats = []
        for day_name in days_order:
            day_records = qs.filter(day_of_week__iexact=day_name)
            total = day_records.count()
            present = day_records.filter(status=AttendanceRecord.Status.PRESENT).count()
            absent = day_records.filter(status=AttendanceRecord.Status.ABSENT).count()
            late = day_records.filter(status=AttendanceRecord.Status.LATE).count()
            half_day = day_records.filter(status=AttendanceRecord.Status.HALF_DAY).count()
            rate = Math.round(((present + half_day * 0.5) / total * 100)) if total > 0 else 0
            day_stats.append({
                'day': day_name,
                'total': total,
                'present': present,
                'absent': absent,
                'late': late,
                'halfDay': half_day,
                'attendanceRate': rate,
            })

        # 2. Subject-Wise Analysis
        subject_stats = []
        subjects = Subject.objects.filter(school_id=user.school_id)
        for subj in subjects:
            subj_records = qs.filter(subject=subj)
            total = subj_records.count()
            if total > 0:
                present = subj_records.filter(status=AttendanceRecord.Status.PRESENT).count()
                half_day = subj_records.filter(status=AttendanceRecord.Status.HALF_DAY).count()
                rate = Math.round(((present + half_day * 0.5) / total * 100))
                subject_stats.append({
                    'subjectId': subj.id,
                    'subjectName': subj.name,
                    'totalSessions': total,
                    'attendanceRate': rate,
                })

        # 3. Period-Wise Analysis (Periods 1 to 6)
        period_stats = []
        for p in range(1, 7):
            p_records = qs.filter(period=p)
            total = p_records.count()
            present = p_records.filter(status=AttendanceRecord.Status.PRESENT).count()
            half_day = p_records.filter(status=AttendanceRecord.Status.HALF_DAY).count()
            rate = Math.round(((present + half_day * 0.5) / total * 100)) if total > 0 else 0
            period_stats.append({
                'period': p,
                'totalRecords': total,
                'attendanceRate': rate,
            })

        total_db_records = qs.count()

        return Response({
          'totalDbRecords': total_db_records,
          'dayOfWeekAnalysis': day_stats,
          'subjectAnalysis': subject_stats,
          'periodAnalysis': period_stats,
        })

    @action(detail=False, methods=['get'], url_path='audit-logs')
    def audit_logs(self, request):
        user = request.user
        qs = AttendanceAuditLog.objects.filter(school_id=user.school_id).select_related('student', 'subject', 'changed_by')

        if user.role == User.Role.TEACHER:
            permitted = teacher_student_queryset(
                getattr(user, 'teacher_profile', None),
                Student.objects.filter(school_id=user.school_id),
                school_id=user.school_id,
            )
            qs = qs.filter(student__in=permitted)
        elif user.role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            qs = qs.filter(student__parent_profiles=profile).distinct() if profile else qs.none()
        elif user.role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            qs = qs.filter(student_id=profile.student_id) if profile else qs.none()
        elif user.role != User.Role.SCHOOL_ADMIN:
            qs = qs.none()

        if student_id := request.query_params.get('studentId'):
            qs = qs.filter(student_id=student_id)
        if date_val := request.query_params.get('date'):
            qs = qs.filter(attendance_record__date=date_val)
        if day_val := request.query_params.get('day_of_week'):
            qs = qs.filter(day_of_week__iexact=day_val)
        if period_val := request.query_params.get('period'):
            qs = qs.filter(period=period_val)

        serializer = AttendanceAuditLogSerializer(qs[:100], many=True)
        return Response(serializer.data)


# Python Math helper for division rounding
class Math:
    @staticmethod
    def round(val):
        return round(val)
