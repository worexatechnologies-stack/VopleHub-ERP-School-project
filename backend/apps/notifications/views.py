from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from rest_framework import permissions, status, serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from django.utils import timezone

from apps.accounts.models import ParentProfile, User
from apps.sis.access import teacher_student_queryset
from apps.sis.models import Student
from apps.staff.models import Teacher

from .models import DeviceToken, Notification
from .serializers import DeviceTokenRegistrationSerializer, DeviceTokenSerializer, NotificationComposerSerializer, NotificationSerializer
from .tasks import enqueue_fcm_notification


import uuid

def create_rows(sender, recipients, channel, category, title, body, related=None):
    sender_school_id = getattr(sender, 'school_id', None)
    recipient_ids = set()
    for user in recipients:
        if not user or not getattr(user, 'id', None):
            continue
        user_school_id = getattr(user, 'school_id', None)
        if sender_school_id is None or user_school_id == sender_school_id or user_school_id is None:
            recipient_ids.add(user.id)

    b_id = uuid.uuid4()
    school = getattr(sender, 'school', None)
    rows = []
    for user_id in recipient_ids:
        target_school = school
        if target_school is None:
            target_user = next((u for u in recipients if getattr(u, 'id', None) == user_id), None)
            target_school = getattr(target_user, 'school', None) if target_user else None
        rows.append(
            Notification(
                school=target_school,
                sender=sender,
                recipient_id=user_id,
                channel=channel,
                category=category,
                title=title,
                body=body,
                broadcast_id=b_id,
                related_object=related or {},
            )
        )
    Notification.objects.bulk_create(rows)
    if recipient_ids:
        # FCM delivery only starts after the database notification transaction
        # has committed. The task resolves active devices at send time.
        transaction.on_commit(lambda: enqueue_fcm_notification(
            sorted(recipient_ids),
            title=title,
            body=body,
            category=category,
            data=related or {},
        ))
    try:
        from .services import _dispatch_ws_notification
        for row in rows:
            _dispatch_ws_notification(row.recipient_id, row)
    except Exception:
        pass
    return len(rows)


class DeviceTokenView(APIView):
    """Register, list, and deactivate the current user's FCM devices."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'fcm_device'

    @extend_schema(responses=DeviceTokenSerializer(many=True))
    def get(self, request):
        devices = DeviceToken.objects.filter(user=request.user).order_by('-last_seen_at')
        return Response(DeviceTokenSerializer(devices, many=True).data)

    @extend_schema(request=DeviceTokenRegistrationSerializer, responses=DeviceTokenSerializer)
    def post(self, request):
        serializer = DeviceTokenRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.validated_data['token']
        raw_platform = serializer.validated_data.get('platform')
        if raw_platform in [DeviceToken.Platform.WEB, DeviceToken.Platform.ANDROID, DeviceToken.Platform.IOS]:
            platform = raw_platform
        else:
            ua = request.META.get('HTTP_USER_AGENT', '').lower()
            if 'android' in ua:
                platform = DeviceToken.Platform.ANDROID
            elif 'iphone' in ua or 'ipad' in ua or 'ios' in ua:
                platform = DeviceToken.Platform.IOS
            else:
                platform = DeviceToken.Platform.WEB

        device, created = DeviceToken.objects.get_or_create(
            token=token,
            defaults={
                'user': request.user,
                'platform': platform,
                'device_name': serializer.validated_data.get('deviceName', ''),
                'user_agent': request.META.get('HTTP_USER_AGENT', '')[:512],
                'is_active': True,
                'failure_count': 0,
                'last_error': '',
                'last_failure_at': None,
            },
        )
        if not created and device.user_id != request.user.pk:
            return Response(
                {'detail': 'This device token is already registered to another account.'},
                status=status.HTTP_409_CONFLICT,
            )
        if not created:
            device.platform = platform
            device.device_name = serializer.validated_data.get('deviceName', '')
            device.user_agent = request.META.get('HTTP_USER_AGENT', '')[:512]
            device.is_active = True
            device.failure_count = 0
            device.last_error = ''
            device.last_failure_at = None
            device.save(update_fields=[
                'platform', 'device_name', 'user_agent', 'is_active',
                'failure_count', 'last_error', 'last_failure_at', 'last_seen_at',
            ])
        return Response(DeviceTokenSerializer(device).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=DeviceTokenRegistrationSerializer, responses={204: None})
    def delete(self, request):
        serializer = DeviceTokenRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        DeviceToken.objects.filter(user=request.user, token=serializer.validated_data['token']).update(is_active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SchoolToTeachersView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=NotificationComposerSerializer, responses={200: dict})
    def post(self, request):
        if request.user.role != User.Role.SCHOOL_ADMIN:
            return Response({'detail': 'Only school admins can notify teachers.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = NotificationComposerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        mode = serializer.validated_data.get('recipientMode', 'all')
        recipient_values = serializer.validated_data.get('recipients', []) if mode != 'all' else []

        teachers = list(Teacher.objects.filter(school=request.user.school, status=Teacher.Status.ACTIVE).select_related('user'))

        if recipient_values:
            normalize = lambda value: ' '.join(str(value).casefold().split())
            wanted = {normalize(item) for item in recipient_values}
            matched_teachers = []
            for teacher in teachers:
                candidates = [
                    normalize(teacher.pk),
                ]
                if teacher.user_id:
                    candidates.append(normalize(teacher.user_id))

                try:
                    user_obj = teacher.user
                    if user_obj:
                        if getattr(user_obj, 'first_name', None):
                            candidates.append(normalize(user_obj.first_name))
                        if getattr(user_obj, 'last_name', None):
                            candidates.append(normalize(user_obj.last_name))
                        if getattr(user_obj, 'email', None):
                            candidates.append(normalize(user_obj.email))
                        if getattr(user_obj, 'username', None):
                            candidates.append(normalize(user_obj.username))
                        if hasattr(user_obj, 'get_full_name'):
                            full_name = user_obj.get_full_name()
                            if full_name:
                                candidates.append(normalize(full_name))
                except Exception:
                    pass

                if any(c in wanted for c in candidates):
                    matched_teachers.append(teacher)
            teachers = matched_teachers

        if not teachers and recipient_values:
            return Response(
                {'recipients': ['No active teacher matches the selected recipient(s).']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        recipients = []
        for teacher in teachers:
            try:
                if teacher.user:
                    recipients.append(teacher.user)
            except Exception:
                pass

        if not recipients and recipient_values:
            return Response(
                {'recipients': ['Selected teacher(s) do not have active user accounts linked.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        count = create_rows(request.user, recipients, 'school-to-teachers', serializer.validated_data['category'], serializer.validated_data['title'], serializer.validated_data['body'])
        return Response({'created': count})


class TeacherToAdminView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=NotificationComposerSerializer, responses={200: dict})
    def post(self, request):
        if request.user.role != User.Role.TEACHER:
            return Response({'detail': 'Only teachers can send messages to the school admin.'}, status=status.HTTP_403_FORBIDDEN)
        teacher = getattr(request.user, 'teacher_profile', None)
        if not teacher or teacher.status != Teacher.Status.ACTIVE:
            return Response({'detail': 'An active teacher profile is required.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = NotificationComposerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        admins = User.objects.filter(school=request.user.school, role=User.Role.SCHOOL_ADMIN, is_active=True)
        if not admins.exists():
            return Response({'detail': 'No active school admin found for this school.'}, status=status.HTTP_400_BAD_REQUEST)

        count = create_rows(request.user, list(admins), 'teacher-to-admin', serializer.validated_data['category'], serializer.validated_data['title'], serializer.validated_data['body'])
        return Response({'created': count})


class NotificationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=NotificationSerializer(many=True))
    def get(self, request):
        if request.user.role == User.Role.SUPER_ADMIN:
            base_qs = Notification.objects.all().select_related('sender', 'recipient')
        else:
            base_qs = Notification.objects.filter(
                Q(school_id=request.user.school_id) | Q(school__isnull=True)
            ).select_related('sender', 'recipient')

        box_type = request.query_params.get('type', 'inbox')
        if box_type == 'sent':
            sent_qs = base_qs.filter(sender=request.user)
            seen_broadcasts = set()
            seen_keys = set()
            unique_sent = []
            for item in sent_qs.order_by('-created_at')[:100]:
                if item.broadcast_id:
                    if item.broadcast_id in seen_broadcasts:
                        continue
                    seen_broadcasts.add(item.broadcast_id)
                else:
                    key = (item.category, item.title, item.body, item.created_at.strftime('%Y-%m-%d %H:%M:%S'))
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                unique_sent.append(item)
            return Response(NotificationSerializer(unique_sent[:50], many=True).data)

        # Default inbox:
        if request.user.role == User.Role.SUPER_ADMIN:
            # Super Admin strictly receives notifications directly addressed to them or global system notices
            received_qs = base_qs.filter(
                Q(recipient=request.user) |
                Q(recipient__isnull=True, school__isnull=True, channel='system')
            ).exclude(status='Acknowledged')
        elif request.user.role == User.Role.SCHOOL_ADMIN:
            # School Admin receives direct notices, administrative broadcasts, and staff requests
            received_qs = base_qs.filter(
                Q(recipient=request.user) |
                Q(channel='teacher-to-admin', school_id=request.user.school_id)
            ).exclude(
                channel__in=['teacher-to-parents', 'teacher-to-students', 'school-to-parents', 'school-to-teachers']
            ).exclude(category='Homework').exclude(status='Acknowledged')
            # For chat messages, ensure recipient is strictly this admin
            received_qs = received_qs.filter(
                ~Q(channel='chat') | Q(recipient=request.user)
            )
        elif request.user.role == User.Role.TEACHER:
            # Teachers receive direct notices to them and school-to-teachers announcements
            received_qs = base_qs.filter(
                Q(recipient=request.user) |
                Q(channel='school-to-teachers', school_id=request.user.school_id)
            ).exclude(
                channel__in=['teacher-to-parents', 'teacher-to-students', 'school-to-parents', 'teacher-to-admin']
            ).exclude(status='Acknowledged')
            received_qs = received_qs.filter(
                ~Q(channel='chat') | Q(recipient=request.user)
            )
        elif request.user.role == User.Role.PARENT:
            cutoff = timezone.now() - timedelta(days=7)
            received_qs = base_qs.filter(
                Q(recipient=request.user) |
                Q(channel__in=['teacher-to-parents', 'school-to-parents'], school_id=request.user.school_id)
            ).exclude(
                channel__in=['school-to-teachers', 'teacher-to-admin', 'teacher-to-students']
            ).exclude(status='Acknowledged').filter(
                Q(sender__school_id=request.user.school_id) | Q(sender__isnull=True),
                created_at__gte=cutoff,
            )
            received_qs = received_qs.filter(
                ~Q(channel='chat') | Q(recipient=request.user)
            )
            profile = getattr(request.user, 'parent_profile', None)
            ward_ids = {int(sid) for sid in profile.students.values_list('id', flat=True)} if profile else set()
            filtered_items = []
            for item in received_qs.order_by('-created_at')[:100]:
                if item.category == 'Attendance Alert' or item.channel == 'attendance-alert':
                    # Attendance alerts must be strictly addressed to this parent
                    if item.recipient_id != request.user.id:
                        continue
                    rel = item.related_object or {}
                    s_id = rel.get('studentId')
                    if s_id is not None:
                        try:
                            if int(s_id) not in ward_ids:
                                continue
                        except (ValueError, TypeError):
                            continue
                filtered_items.append(item)
            return Response(NotificationSerializer(filtered_items[:50], many=True).data)
        elif request.user.role == User.Role.STUDENT:
            received_qs = base_qs.filter(
                Q(recipient=request.user) |
                Q(channel__in=['teacher-to-students', 'school-to-students'], school_id=request.user.school_id)
            ).exclude(
                channel__in=['school-to-teachers', 'teacher-to-admin', 'teacher-to-parents', 'school-to-parents']
            ).exclude(status='Acknowledged')
            received_qs = received_qs.filter(
                ~Q(channel='chat') | Q(recipient=request.user)
            )
        else:
            received_qs = base_qs.filter(recipient=request.user).exclude(status='Acknowledged')

        recent_received = list(received_qs.order_by('-created_at')[:50])
        return Response(NotificationSerializer(recent_received, many=True).data)


class NotificationReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: NotificationSerializer, 404: OpenApiResponse(description='Not found')})
    def patch(self, request, notification_id):
        qs = Notification.objects.filter(pk=notification_id)
        if request.user.role == User.Role.SUPER_ADMIN:
            notification = qs.first()
        elif request.user.role == User.Role.SCHOOL_ADMIN:
            allowed = Q(recipient=request.user)
            if request.user.school_id:
                allowed |= (
                    Q(school_id=request.user.school_id, recipient__isnull=True) |
                    Q(school_id=request.user.school_id, channel='teacher-to-admin')
                )
            notification = qs.filter(allowed).first()
        else:
            allowed = Q(recipient=request.user)
            if request.user.school_id:
                allowed |= Q(school_id=request.user.school_id, recipient__isnull=True)
            notification = qs.filter(allowed).first()
        if not notification:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=['read_at'])
        return Response(NotificationSerializer(notification).data)


class NotificationDecisionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        request=inline_serializer('NotificationDecisionRequest', {
            'status': serializers.ChoiceField(choices=['Approved', 'Declined', 'Rejected'], required=False),
            'action': serializers.ChoiceField(choices=['Approve', 'Reject', 'Decline', 'Approved', 'Declined'], required=False),
            'note': serializers.CharField(required=False, allow_blank=True),
        }),
        responses={200: NotificationSerializer},
    )
    def patch(self, request, notification_id):
        return self._handle_decision(request, notification_id)

    def post(self, request, notification_id):
        return self._handle_decision(request, notification_id)

    def _handle_decision(self, request, notification_id):
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only school administrators can resolve leave requests.'}, status=status.HTTP_403_FORBIDDEN)

        qs = Notification.objects.filter(
            pk=notification_id,
            channel='teacher-to-admin',
            category='Leave Request',
        )
        if request.user.role == User.Role.SCHOOL_ADMIN:
            if not request.user.school_id:
                return Response({'detail': 'A school context is required.'}, status=status.HTTP_403_FORBIDDEN)
            qs = qs.filter(school_id=request.user.school_id)
        notification = qs.first()
        if not notification:
            return Response({'detail': 'Notification not found.'}, status=status.HTTP_404_NOT_FOUND)

        raw_action = str(request.data.get('action') or request.data.get('status') or '').strip().lower()
        if raw_action in ['approve', 'approved']:
            new_status = 'Approved'
        elif raw_action in ['reject', 'rejected', 'decline', 'declined']:
            new_status = 'Declined'
        else:
            return Response({'detail': 'Status must be Approved or Declined.'}, status=status.HTTP_400_BAD_REQUEST)

        notification.status = new_status
        if not notification.read_at:
            notification.read_at = timezone.now()

        related = dict(notification.related_object or {})
        admin_name = request.user.get_full_name() or request.user.email
        related['decision'] = new_status
        related['decision_by'] = admin_name
        related['decision_at'] = timezone.now().isoformat()
        if request.data.get('note'):
            related['decision_note'] = str(request.data.get('note')).strip()
        notification.related_object = related
        notification.save(update_fields=['status', 'read_at', 'related_object'])

        # Notify the requesting teacher/staff member
        if notification.sender and notification.sender != request.user:
            try:
                create_rows(
                    request.user,
                    [notification.sender],
                    'school-to-teachers',
                    'Leave Request',
                    f"Leave Request {new_status}: {notification.title}",
                    f"Your request '{notification.title}' has been {new_status.lower()} by {admin_name}.",
                    related={
                        'decision': new_status,
                        'originalNotificationId': notification.id,
                        'category': 'Leave Request',
                    }
                )
            except Exception:
                pass

        return Response(NotificationSerializer(notification).data)


class NotificationAcknowledgeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses={200: NotificationSerializer})
    def patch(self, request, notification_id):
        qs = Notification.objects.filter(pk=notification_id)
        if request.user.role == User.Role.SUPER_ADMIN:
            notification = qs.first()
        elif request.user.role == User.Role.SCHOOL_ADMIN:
            allowed = Q(recipient=request.user)
            if request.user.school_id:
                allowed |= (
                    Q(school_id=request.user.school_id, recipient__isnull=True) |
                    Q(school_id=request.user.school_id, channel='teacher-to-admin')
                )
            notification = qs.filter(allowed).first()
        else:
            allowed = Q(recipient=request.user)
            if request.user.school_id:
                allowed |= Q(school_id=request.user.school_id, recipient__isnull=True)
            notification = qs.filter(allowed).first()
        if not notification:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        notification.status = 'Acknowledged'
        notification.save(update_fields=['status'])
        return Response(NotificationSerializer(notification).data)


class NotificationClearAllView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={204: None})
    def delete(self, request):
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'detail': 'Only administrators can clear all notifications.'}, status=status.HTTP_403_FORBIDDEN)

        if request.user.role == User.Role.SUPER_ADMIN:
            Notification.objects.all().delete()
        else:
            if not request.user.school_id:
                return Response({'detail': 'A school context is required.'}, status=status.HTTP_403_FORBIDDEN)
            Notification.objects.filter(school_id=request.user.school_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminScopedComposerBase(APIView):
    permission_classes = [permissions.IsAuthenticated]
    channel = ''

    def get_students(self, request, validated_data):
        qs = Student.objects.filter(
            school=request.user.school,
            status=Student.Status.ACTIVE,
        ).select_related('section_record', 'section_record__class_room')

        if request.user.role == User.Role.TEACHER:
            qs = teacher_student_queryset(
                getattr(request.user, 'teacher_profile', None),
                qs,
                school_id=request.user.school_id,
            )

        mode = validated_data.get('recipientMode', 'all')
        target_class = str(validated_data.get('targetClass', '')).strip()
        target_section = str(validated_data.get('targetSection', '')).strip()
        target_class_id = validated_data.get('targetClassId')
        target_section_id = validated_data.get('targetSectionId')
        recipient_values = validated_data.get('recipients', [])

        if target_class_id:
            qs = qs.filter(section_record__class_room_id=target_class_id)
        elif target_class and target_class != 'All':
            clean_cls = target_class.replace('Class', '').replace('class', '').replace('-', '').strip()
            qs = qs.filter(
                Q(class_name__iexact=target_class) |
                Q(class_name__iexact=f"Class {clean_cls}") |
                Q(class_name__iexact=clean_cls) |
                Q(section_record__class_room__name__iexact=target_class) |
                Q(section_record__class_room__name__iexact=f"Class {clean_cls}") |
                Q(section_record__class_room__name__iexact=clean_cls)
            )

        if target_section_id:
            qs = qs.filter(section_record_id=target_section_id)
        elif target_section and target_section != 'All':
            clean_sec = target_section.replace('Section', '').replace('section', '').replace('-', '').strip()
            qs = qs.filter(
                Q(section__iexact=target_section) |
                Q(section__iexact=clean_sec) |
                Q(section_record__name__iexact=target_section) |
                Q(section_record__name__iexact=clean_sec)
            )

        if mode == 'individual' and recipient_values:
            normalize = lambda value: ' '.join(str(value).casefold().split())
            wanted = {normalize(item) for item in recipient_values}
            matched = [
                student for student in qs
                if normalize(student.pk) in wanted
                or normalize(student.admission_no) in wanted
                or normalize(student.name) in wanted
                or normalize(f'{student.class_name}-{student.section}') in wanted
                or normalize(f'{student.class_name} - {student.section}') in wanted
            ]
            return matched

        return list(qs)

    @extend_schema(request=NotificationComposerSerializer, responses={200: dict})
    def post(self, request):
        if request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER]:
            return Response(
                {'detail': 'Only school administrators and assigned teachers can publish these notifications.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if request.user.role == User.Role.TEACHER:
            teacher = getattr(request.user, 'teacher_profile', None)
            if not teacher or teacher.status != Teacher.Status.ACTIVE:
                return Response(
                    {'detail': 'An active teacher profile is required.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        serializer = NotificationComposerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        students = self.get_students(request, serializer.validated_data)
        if not students and (serializer.validated_data.get('recipientMode') != 'all' or request.user.role == User.Role.TEACHER):
            return Response(
                {'recipients': ['No active student in the selected class/section matches the criteria.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        recipients = self.resolve_recipients(students)
        target_class = str(serializer.validated_data.get('targetClass', '')).strip()
        target_section = str(serializer.validated_data.get('targetSection', '')).strip()
        recipient_mode = serializer.validated_data.get('recipientMode', 'all')
        related_meta = {
            'targetClass': target_class,
            'targetClassId': serializer.validated_data.get('targetClassId'),
            'targetSection': target_section,
            'targetSectionId': serializer.validated_data.get('targetSectionId'),
            'recipientMode': recipient_mode,
            'studentIds': [s.id for s in students],
            'studentNames': [s.name for s in students],
            'studentClasses': list(set(f"{s.class_name}-{s.section}".strip('-') for s in students)),
        }
        count = create_rows(
            request.user,
            recipients,
            self.channel,
            serializer.validated_data['category'],
            serializer.validated_data['title'],
            serializer.validated_data['body'],
            related=related_meta,
        )
        return Response({'created': count})


class TeacherToParentsView(AdminScopedComposerBase):
    channel = 'teacher-to-parents'

    def resolve_recipients(self, students):
        parent_profiles = ParentProfile.objects.filter(students__in=students).select_related('user').distinct()
        return [profile.user for profile in parent_profiles]


class TeacherToStudentsView(AdminScopedComposerBase):
    channel = 'teacher-to-students'

    def resolve_recipients(self, students):
        user_ids = [student.login_profile.user_id for student in students if hasattr(student, 'login_profile')]
        return list(User.objects.filter(id__in=user_ids))
