import uuid
from django.db import models
from django.conf import settings
from django.utils import timezone


class ExportJob(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'

    class ResourceType(models.TextChoices):
        STUDENTS = 'students', 'Students'
        ATTENDANCE = 'attendance', 'Attendance Records'
        FEE_RECORDS = 'fee_records', 'Fee Records'
        FEE_PAYMENTS = 'fee_payments', 'Fee Payments'
        EXAM_RESULTS = 'exam_results', 'Exam Results'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='export_jobs',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='export_jobs',
    )
    resource_type = models.CharField(
        max_length=50,
        choices=ResourceType.choices,
    )
    file_format = models.CharField(max_length=10, default='csv')
    filters = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    total_records = models.IntegerField(default=0)
    processed_records = models.IntegerField(default=0)
    file_path = models.CharField(max_length=500, blank=True)
    file_size = models.BigIntegerField(default=0)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'status', '-created_at'], name='exp_sch_stat_dt_idx'),
        ]

    def __str__(self):
        return f"Export {self.resource_type} ({self.status}) - {self.id}"


class AdminAuditEvent(models.Model):
    """Append-only record of privileged actions across school tenants."""

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='admin_audit_events')
    school = models.ForeignKey('schools.School', null=True, blank=True, on_delete=models.SET_NULL, related_name='admin_audit_events')
    action = models.CharField(max_length=80)
    object_type = models.CharField(max_length=80, blank=True)
    object_id = models.CharField(max_length=120, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    remote_addr = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['school', '-created_at', '-id'], name='aud_school_created_id_idx'),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError('Admin audit events are immutable.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError('Admin audit events are immutable.')

    def __str__(self):
        return f'{self.action} by {self.actor_id} at {self.created_at}'


class PlatformSetting(models.Model):
    """Allowlisted platform-wide configuration controlled by Super Admins."""

    key = models.CharField(max_length=80, primary_key=True)
    value = models.JSONField(default=dict)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key
