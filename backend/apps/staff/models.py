from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

class Teacher(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'Active', 'Active'
        INACTIVE = 'Inactive', 'Inactive'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='teachers')
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='teacher_profile')
    subjects = models.JSONField(default=list, blank=True)
    subject_records = models.ManyToManyField('academics.Subject', related_name='teachers', blank=True)
    assigned_sections = models.JSONField(default=list, blank=True)
    # Canonical assignments used for authorization. The JSON field above is
    # retained temporarily so older records can be migrated safely.
    sections = models.ManyToManyField('academics.Section', related_name='teachers', blank=True)
    qualification = models.CharField(max_length=255, blank=True)
    joining_date = models.DateField()
    phone = models.CharField(max_length=30)
    salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Retained only to preserve old free-text notes during the database
    # transition. Actual teacher documents are stored as bytes below.
    legacy_document_notes = models.JSONField(default=list, blank=True)
    # Profile images can be stored in object storage (S3/MinIO) or fallback to bytea.
    photo_key = models.CharField(max_length=512, blank=True, default='')
    photo_data = models.BinaryField(blank=True, null=True, editable=False)
    photo_content_type = models.CharField(max_length=32, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', 'id']
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['school', 'phone']),
        ]


class TeacherTeachingAssignment(models.Model):
    """An exact subject a teacher is authorized to teach in one section."""

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE,
        related_name='teacher_teaching_assignments',
    )
    teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name='teaching_assignments',
    )
    section = models.ForeignKey(
        'academics.Section', on_delete=models.CASCADE,
        related_name='teacher_assignments',
    )
    subject = models.ForeignKey(
        'academics.Subject', on_delete=models.CASCADE,
        related_name='teacher_assignments',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='created_teacher_teaching_assignments',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'teacher', 'section', 'subject'],
                name='unique_teacher_section_subject_assignment',
            ),
            models.UniqueConstraint(
                fields=['school', 'section', 'subject'],
                name='unique_teacher_for_section_subject',
            ),
        ]
        indexes = [
            models.Index(
                fields=['school', 'teacher'], name='staff_assignment_teacher_idx',
            ),
            models.Index(
                fields=['school', 'section', 'subject'],
                name='staff_assignment_scope_idx',
            ),
        ]
        ordering = ['section_id', 'subject_id', 'id']

    def clean(self):
        relation_school_ids = {
            self.teacher.school_id if self.teacher_id else None,
            self.section.school_id if self.section_id else None,
            self.subject.school_id if self.subject_id else None,
        }
        relation_school_ids.discard(None)
        if self.school_id and any(
            school_id != self.school_id for school_id in relation_school_ids
        ):
            raise ValidationError(
                'Teacher, section, subject, and assignment must belong to one school.',
            )
        if (
            self.section_id and self.subject_id
            and not self.section.class_room.subjects.filter(pk=self.subject_id).exists()
        ):
            raise ValidationError({
                'subject': 'Subject is not configured for the selected section class.',
            })
        if (
            self.created_by_id and self.created_by.school_id
            and self.created_by.school_id != self.school_id
        ):
            raise ValidationError({'created_by': 'Creator is outside the assignment tenant.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class TeacherDocument(models.Model):
    """A verified teacher document stored directly in PostgreSQL."""

    class Status(models.TextChoices):
        PENDING = 'Pending', 'Pending'
        VERIFIED = 'Verified', 'Verified'
        REJECTED = 'Rejected', 'Rejected'
        UPLOADED = 'Uploaded', 'Uploaded'

    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name='documents')
    name = models.CharField(max_length=160)
    category = models.CharField(max_length=64, blank=True, default='Identity Proof')
    # Documents can be stored in object storage (S3/MinIO) or fallback to bytea.
    file_key = models.CharField(max_length=512, blank=True, default='')
    file_size = models.PositiveIntegerField(default=0)
    file_data = models.BinaryField(blank=True, null=True, editable=False)
    file_content_type = models.CharField(max_length=100)
    file_name = models.CharField(max_length=255)
    file_type = models.CharField(max_length=16)
    status = models.CharField(max_length=32, default=Status.PENDING)
    remarks = models.CharField(max_length=255, blank=True, default='')
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='verified_teacher_documents'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['teacher', 'created_at'])]
        ordering = ['-created_at']


class StaffSalaryPayment(models.Model):
    """Monthly salary payment recorded for a teacher."""

    class Status(models.TextChoices):
        PAID = 'Paid', 'Paid'
        PENDING = 'Pending', 'Pending'

    class PaymentMethod(models.TextChoices):
        BANK_TRANSFER = 'Bank Transfer', 'Bank Transfer'
        CASH = 'Cash', 'Cash'
        CHEQUE = 'Cheque', 'Cheque'
        UPI = 'UPI', 'UPI'
        DIRECT_DEPOSIT = 'Direct Deposit', 'Direct Deposit'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='staff_salary_payments')
    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name='salary_payments')
    month = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField(default=timezone.now)
    payment_method = models.CharField(max_length=32, choices=PaymentMethod.choices, default=PaymentMethod.BANK_TRANSFER)
    reference_number = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PAID)
    receipt_number = models.CharField(max_length=64, db_index=True)
    notes = models.TextField(blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='paid_staff_salaries',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'teacher', 'year', 'month'],
                name='unique_teacher_monthly_salary',
            ),
            models.UniqueConstraint(
                fields=['school', 'receipt_number'],
                name='unique_school_salary_receipt_number',
            ),
        ]
        indexes = [
            models.Index(fields=['school', 'year', 'month']),
            models.Index(fields=['teacher', 'year', 'month']),
            models.Index(fields=['receipt_number']),
        ]
        ordering = ['-year', '-month', '-created_at']

    def clean(self):
        if self.teacher_id and self.school_id and self.teacher.school_id != self.school_id:
            raise ValidationError('Teacher does not belong to this school.')
        if self.month < 1 or self.month > 12:
            raise ValidationError({'month': 'Month must be between 1 and 12.'})
        if self.amount < 0:
            raise ValidationError({'amount': 'Amount cannot be negative.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
