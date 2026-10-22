from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiResponse

from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet
from apps.sis.models import Student
from .models import SchoolEvent, EventRegistration, CommunityPost
from .serializers import (
    SchoolEventSerializer,
    EventRegistrationSerializer,
    EventRegisterInputSerializer,
    CommunityPostSerializer,
)


class EventPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role in [
            User.Role.SCHOOL_ADMIN,
            User.Role.SUPER_ADMIN,
            User.Role.TEACHER,
        ]


class SchoolEventViewSet(TenantScopedViewSet):
    """Tenant-scoped School Event CRUD, deadline-enforced registration, and attendee management."""
    queryset = SchoolEvent.objects.select_related('school', 'created_by').prefetch_related('registrations')
    serializer_class = SchoolEventSerializer
    permission_classes = [EventPermission]
    search_fields = ['title', 'venue', 'description', 'kind']
    ordering_fields = ['date', 'created_at', 'registration_deadline', 'capacity']
    filterset_fields = ['kind', 'status', 'audience']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        now = timezone.now()

        # Non-admins can only see PUBLISHED events
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            qs = qs.filter(status=SchoolEvent.Status.PUBLISHED)

        activity_status = self.request.query_params.get('activity_status')
        if activity_status == 'active':
            qs = qs.filter(status=SchoolEvent.Status.PUBLISHED).filter(
                Q(registration_deadline__gte=now) | Q(registration_deadline__isnull=True, date__gte=now)
            )
        elif activity_status == 'inactive':
            qs = qs.filter(
                Q(registration_deadline__lt=now) | Q(registration_deadline__isnull=True, date__lt=now) | ~Q(status=SchoolEvent.Status.PUBLISHED)
            )

        return qs

    def perform_create(self, serializer):
        user = self.request.user
        event = serializer.save(
            school_id=user.school_id,
            created_by=user,
        )
        try:
            from apps.notifications.services import create_bulk_notifications
            users = list(User.objects.filter(school_id=user.school_id, is_active=True).exclude(id=user.id))
            create_bulk_notifications(
                school=user.school,
                recipients=users,
                title=f"New School Event: {event.title}",
                body=f"{event.title} is scheduled for {event.date.strftime('%B %d, %Y') if event.date else 'upcoming date'} ({event.venue or 'Campus'}).",
                category="Event",
                channel="events",
                sender=user,
                related={'type': 'event', 'eventId': str(event.id), 'title': event.title},
            )
        except Exception:
            pass

    @extend_schema(
        request=EventRegisterInputSerializer,
        responses={
            201: EventRegistrationSerializer,
            400: OpenApiResponse(description='Deadline passed, event full, or already registered.'),
        },
    )
    @action(methods=['post'], detail=True, permission_classes=[permissions.IsAuthenticated])
    def register(self, request, pk=None):
        """Register the authenticated user or their student record for an event.
        
        Strictly enforces:
        1. Registration deadline check (deadline < current time -> 400 Bad Request)
        2. Event published status check
        3. Event capacity limits
        4. Duplicate registration prevention
        """
        event = self.get_object()
        user = request.user

        # 1. Registration deadline check
        if event.registration_deadline and timezone.now() > event.registration_deadline:
            return Response(
                {
                    'detail': 'Registration deadline has passed. Registrations for this event are closed.',
                    'deadline': event.registration_deadline.isoformat(),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 2. Event status check
        if event.status != SchoolEvent.Status.PUBLISHED:
            return Response(
                {'detail': f'This event is currently {event.status.lower()} and not open for registration.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 3. Capacity check
        active_registrations_count = event.registrations.filter(
            status=EventRegistration.RegistrationStatus.CONFIRMED
        ).count()
        if active_registrations_count >= event.capacity:
            return Response(
                {'detail': 'Event registration is full. No more seats are available.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 4. Resolve Student profile if student user
        student_profile = getattr(user, 'student_profile', None)
        student = student_profile.student if student_profile else None

        # 5. Check duplicate active registration
        existing_reg_qs = EventRegistration.objects.filter(
            event=event,
            school_id=user.school_id,
            status=EventRegistration.RegistrationStatus.CONFIRMED,
        )
        if student:
            has_reg = existing_reg_qs.filter(Q(student=student) | Q(user=user)).exists()
        else:
            has_reg = existing_reg_qs.filter(user=user).exists()

        if has_reg:
            return Response(
                {'detail': 'You have already registered for this event.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 6. Parse and validate input payload
        input_serializer = EventRegisterInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data

        # Fallback values from profile
        attendee_name = data.get('attendee_name') or (student.name if student else user.get_full_name() or user.username)
        attendee_email = data.get('attendee_email') or (student.parent_email if student else user.email)
        attendee_phone = data.get('attendee_phone') or (student.parent_phone if student else '')
        class_name = data.get('class_name') or (student.class_name if student else '')
        section = data.get('section') or (student.section if student else '')
        roll_no = data.get('roll_no') if data.get('roll_no') is not None else (student.roll_no if student else None)
        notes = data.get('notes', '')

        registration = EventRegistration.objects.create(
            school_id=user.school_id,
            event=event,
            user=user,
            student=student,
            attendee_name=attendee_name,
            attendee_email=attendee_email,
            attendee_phone=attendee_phone,
            class_name=class_name,
            section=section,
            roll_no=roll_no,
            notes=notes,
            status=EventRegistration.RegistrationStatus.CONFIRMED,
        )

        # Notify registering user and school admins
        try:
            from apps.notifications.services import create_notification, notify_school_admins
            create_notification(
                school=user.school,
                recipient=user,
                title="Event Registration Confirmed",
                body=f"You are successfully registered for '{event.title}'. Venue: {event.venue or 'Campus'}.",
                category="Event",
                channel="events",
                related={'eventId': event.id, 'registrationId': registration.id},
            )
            notify_school_admins(
                school=user.school,
                title="New Event Registration",
                body=f"{attendee_name} registered for event '{event.title}'.",
                category="Event",
                channel="events",
                related={'eventId': event.id, 'attendee': attendee_name},
            )
        except Exception:
            pass

        return Response(
            EventRegistrationSerializer(registration, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(responses={200: EventRegistrationSerializer(many=True)})
    @action(methods=['get'], detail=True, permission_classes=[permissions.IsAuthenticated])
    def registrations(self, request, pk=None):
        """List registered attendees for this event. Admin and teachers see all, students see their own."""
        event = self.get_object()
        user = request.user
        qs = event.registrations.filter(
            status=EventRegistration.RegistrationStatus.CONFIRMED
        ).select_related('student', 'user')

        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            pass  # Allowed to view full list
        else:
            student_profile = getattr(user, 'student_profile', None)
            if student_profile:
                qs = qs.filter(Q(student=student_profile.student) | Q(user=user))
            else:
                qs = qs.filter(user=user)

        serializer = EventRegistrationSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)

    @action(methods=['post'], detail=True, permission_classes=[permissions.IsAuthenticated])
    def cancel_registration(self, request, pk=None):
        """Cancel an existing registration for this event."""
        event = self.get_object()
        user = request.user
        qs = event.registrations.filter(
            status=EventRegistration.RegistrationStatus.CONFIRMED
        )
        student_profile = getattr(user, 'student_profile', None)
        if student_profile:
            reg = qs.filter(Q(student=student_profile.student) | Q(user=user)).first()
        else:
            reg = qs.filter(user=user).first()

        if not reg:
            return Response(
                {'detail': 'No active registration found for this event.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        reg.status = EventRegistration.RegistrationStatus.CANCELLED
        reg.save(update_fields=['status'])
        return Response({'detail': 'Registration successfully cancelled.'}, status=status.HTTP_200_OK)


class EventRegistrationViewSet(TenantScopedViewSet):
    """Tenant-scoped registration management and ticket querying."""
    queryset = EventRegistration.objects.select_related('school', 'event', 'student', 'user')
    serializer_class = EventRegistrationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            return qs
        student_profile = getattr(user, 'student_profile', None)
        if student_profile:
            return qs.filter(Q(student=student_profile.student) | Q(user=user))
        return qs.filter(user=user)

    @action(methods=['get'], detail=False)
    def my_registrations(self, request):
        """Return all active registrations and tickets for the logged-in user."""
        user = request.user
        qs = self.get_queryset().filter(status=EventRegistration.RegistrationStatus.CONFIRMED)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)


class CommunityPostPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role in [
            User.Role.SCHOOL_ADMIN,
            User.Role.SUPER_ADMIN,
            User.Role.TEACHER,
        ]


class CommunityPostViewSet(TenantScopedViewSet):
    """Tenant-scoped Community Feed Announcements and Updates."""
    queryset = CommunityPost.objects.select_related('school', 'author')
    serializer_class = CommunityPostSerializer
    permission_classes = [CommunityPostPermission]
    search_fields = ['title', 'body', 'author_name']
    ordering_fields = ['created_at']
    filterset_fields = ['kind', 'audience']

    def perform_create(self, serializer):
        user = self.request.user
        author_name = user.get_full_name() or user.username
        post = serializer.save(
            school_id=user.school_id,
            author=user,
            author_name=author_name,
        )
        try:
            from apps.notifications.services import create_bulk_notifications
            users = list(User.objects.filter(school_id=user.school_id, is_active=True).exclude(id=user.id))
            create_bulk_notifications(
                school=user.school,
                recipients=users,
                title=f"New Announcement: {post.title}",
                body=f"{author_name} posted: {post.body[:120]}...",
                category="Notice",
                channel="community",
                sender=user,
                related={'type': 'notice', 'postId': str(post.id), 'title': post.title},
            )
        except Exception:
            pass
