import uuid
from django.db import models
from django.conf import settings


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
