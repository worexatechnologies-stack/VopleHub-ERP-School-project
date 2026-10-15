import secrets
from django.db import models
from django.utils import timezone


def generate_ticket_code():
    """Generate human-readable ticket code e.g. SCH-A44C97."""
    code = secrets.token_hex(3).upper()
    return f'SCH-{code}'


class SchoolEvent(models.Model):
    class EventKind(models.TextChoices):
        SCHOOL_EVENT = 'School event', 'School event'
        WORKSHOP = 'Workshop', 'Workshop'
        COMPETITION = 'Competition', 'Competition'
        SEMINAR = 'Seminar', 'Seminar'
        SPORTS = 'Sports', 'Sports'
        CULTURAL = 'Cultural', 'Cultural'

    class Status(models.TextChoices):
        DRAFT = 'Draft', 'Draft'
        PUBLISHED = 'Published', 'Published'
        COMPLETED = 'Completed', 'Completed'
        CANCELLED = 'Cancelled', 'Cancelled'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='events',
    )
    title = models.CharField(max_length=200)
    kind = models.CharField(
        max_length=40,
        choices=EventKind.choices,
        default=EventKind.SCHOOL_EVENT,
    )
    description = models.TextField(blank=True)
    date = models.DateTimeField(help_text='Event start date and time')
    end_date = models.DateTimeField(null=True, blank=True, help_text='Event end date and time')
    registration_deadline = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Deadline date and time after which registrations are closed',
    )
    venue = models.CharField(max_length=200)
    capacity = models.PositiveIntegerField(default=100)
    ticket_required = models.BooleanField(default=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PUBLISHED,
    )
    audience = models.CharField(
        max_length=100,
        default='Teachers, students and parents',
    )
    created_by = models.ForeignKey(
        'accounts.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_events',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date']
        indexes = [
            models.Index(fields=['school', 'date']),
            models.Index(fields=['school', 'status']),
            models.Index(fields=['school', 'registration_deadline']),
        ]

    def __str__(self):
        return f'{self.title} ({self.date.strftime("%Y-%m-%d")})'

    @property
    def is_deadline_passed(self) -> bool:
        if not self.registration_deadline:
            return False
        return timezone.now() > self.registration_deadline

    @property
    def registered_count(self) -> int:
        return self.registrations.filter(status=EventRegistration.RegistrationStatus.CONFIRMED).count()

    @property
    def is_registration_open(self) -> bool:
        if self.status != self.Status.PUBLISHED:
            return False
        if self.is_deadline_passed:
            return False
        if self.registered_count >= self.capacity:
            return False
        return True


class EventRegistration(models.Model):
    class RegistrationStatus(models.TextChoices):
        CONFIRMED = 'Confirmed', 'Confirmed'
        ATTENDED = 'Attended', 'Attended'
        CANCELLED = 'Cancelled', 'Cancelled'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='event_registrations',
    )
    event = models.ForeignKey(
        SchoolEvent,
        on_delete=models.CASCADE,
        related_name='registrations',
    )
    user = models.ForeignKey(
        'accounts.User',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='event_registrations',
    )
    student = models.ForeignKey(
        'sis.Student',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='event_registrations',
    )
    attendee_name = models.CharField(max_length=160)
    attendee_email = models.EmailField(blank=True)
    attendee_phone = models.CharField(max_length=30, blank=True)
    class_name = models.CharField(max_length=40, blank=True)
    section = models.CharField(max_length=40, blank=True)
    roll_no = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    ticket_code = models.CharField(max_length=32, unique=True, default=generate_ticket_code)
    status = models.CharField(
        max_length=20,
        choices=RegistrationStatus.choices,
        default=RegistrationStatus.CONFIRMED,
    )
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-registered_at']
        indexes = [
            models.Index(fields=['school', 'event']),
            models.Index(fields=['ticket_code']),
            models.Index(fields=['school', 'user']),
            models.Index(fields=['school', 'student']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['event', 'student'],
                condition=models.Q(student__isnull=False, status='Confirmed'),
                name='unique_event_student_active_reg',
            ),
            models.UniqueConstraint(
                fields=['event', 'user'],
                condition=models.Q(user__isnull=False, status='Confirmed'),
                name='unique_event_user_active_reg',
            ),
        ]

    def __str__(self):
        return f'{self.attendee_name} - {self.event.title} ({self.ticket_code})'


class CommunityPost(models.Model):
    class PostKind(models.TextChoices):
        ANNOUNCEMENT = 'Announcement', 'Announcement'
        AWARENESS = 'Awareness campaign', 'Awareness campaign'
        ACHIEVEMENT = 'School achievement', 'School achievement'
        SOCIAL = 'Social update', 'Social update'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='community_posts',
    )
    kind = models.CharField(
        max_length=40,
        choices=PostKind.choices,
        default=PostKind.ANNOUNCEMENT,
    )
    title = models.CharField(max_length=200)
    body = models.TextField()
    audience = models.CharField(
        max_length=100,
        default='Teachers, students and parents',
    )
    channels = models.JSONField(default=list, blank=True)
    author = models.ForeignKey(
        'accounts.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='community_posts',
    )
    author_name = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'created_at']),
            models.Index(fields=['school', 'kind']),
        ]

    def __str__(self):
        return f'[{self.kind}] {self.title}'
