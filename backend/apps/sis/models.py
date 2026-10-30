import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone
class Student(models.Model):
    class Status(models.TextChoices): ACTIVE = 'Active'; PROMOTED = 'Promoted'; TC_ISSUED = 'TC_Issued'
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='students')
    admission_no = models.CharField(max_length=50)
    name = models.CharField(max_length=160)
    # Profile images can be stored in object storage (S3/MinIO) or fallback to bytea.
    photo_key = models.CharField(max_length=512, blank=True, default='')
    photo_data = models.BinaryField(blank=True, null=True, editable=False)
    photo_content_type = models.CharField(max_length=32, blank=True)
    class_name = models.CharField(max_length=40)
    section = models.CharField(max_length=40)
    # Canonical section assignment. Legacy class/section text remains for API
    # compatibility and reporting while all new admissions use this relation.
    section_record = models.ForeignKey(
        'academics.Section', on_delete=models.SET_NULL, related_name='students',
        null=True, blank=True,
    )
    roll_no = models.PositiveIntegerField()
    parent_name = models.CharField(max_length=160)
    parent_phone = models.CharField(max_length=30)
    parent_email = models.EmailField()
    dob = models.DateField()
    gender = models.CharField(max_length=32)
    address = models.TextField(blank=True)
    medical_conditions = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    academic_year = models.CharField(max_length=40)
    attendance_percentage = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    fee_total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fee_paid = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    gpa = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['school', 'admission_no', 'academic_year'], name='unique_admission_year')]
        indexes = [
            models.Index(fields=['school', 'class_name', 'section']),
            models.Index(fields=['school', 'academic_year']),
            models.Index(fields=['school', 'status'], name='sis_student_school_status_idx'),
            models.Index(fields=['school', 'academic_year', 'status']),
            models.Index(fields=['school', 'section_record']),
            models.Index(fields=['school', 'roll_no', 'id'], name='sis_stu_sch_roll_id_idx'),
            models.Index(fields=['school', 'academic_year', 'class_name', 'section', 'roll_no'], name='sis_stu_roster_idx'),
        ]

class StudentDocument(models.Model):
    class Status(models.TextChoices):
        PENDING = 'Pending', 'Pending'
        VERIFIED = 'Verified', 'Verified'
        REJECTED = 'Rejected', 'Rejected'
        UPLOADED = 'Uploaded', 'Uploaded'

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='documents')
    name = models.CharField(max_length=160)
    category = models.CharField(max_length=64, blank=True, default='Aadhaar Card')
    # Documents can be stored in object storage (S3/MinIO) or fallback to bytea.
    file_key = models.CharField(max_length=512, blank=True, default='')
    file_size = models.PositiveIntegerField(default=0)
    file_data = models.BinaryField(blank=True, null=True, editable=False)
    file_content_type = models.CharField(max_length=255, blank=True)
    file_name = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=32, default=Status.PENDING)
    file_type = models.CharField(max_length=12)
    remarks = models.CharField(max_length=255, blank=True, default='')
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='verified_student_documents'
    )
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['-created_at', '-id'], include=['student'], name='sis_doc_created_id_idx'),
        ]

class AcademicHistory(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='history')
    academic_year = models.CharField(max_length=40)
    class_name = models.CharField(max_length=40)
    section = models.CharField(max_length=40)
    gpa = models.DecimalField(max_digits=4, decimal_places=2, null=True)
    attendance = models.DecimalField(max_digits=5, decimal_places=2, null=True)
    status = models.CharField(max_length=32)


class EnrollmentLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='enrollment_links')
    token = models.CharField(max_length=64, unique=True, db_index=True)
    title = models.CharField(max_length=120, blank=True, default='Online Student Admission Link')
    target_class = models.CharField(max_length=40, blank=True, default='')  # Empty means all classes allowed
    academic_year = models.CharField(max_length=40)
    duration_minutes = models.PositiveIntegerField(default=1440)
    first_opened_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='created_enrollment_links')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def is_expired(self):
        if not self.is_active:
            return True
        if self.first_opened_at:
            return timezone.now() > self.first_opened_at + timezone.timedelta(minutes=self.duration_minutes)
        return False

    def remaining_seconds(self):
        if not self.is_active:
            return 0
        if not self.first_opened_at:
            return self.duration_minutes * 60
        elapsed = (timezone.now() - self.first_opened_at).total_seconds()
        remaining = (self.duration_minutes * 60) - elapsed
        return max(0, int(remaining))


class EnrollmentApplication(models.Model):
    class Status(models.TextChoices):
        PENDING = 'Pending', 'Pending Admin Approval'
        APPROVED = 'Approved', 'Approved'
        REJECTED = 'Rejected', 'Rejected'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='enrollment_applications')
    link = models.ForeignKey(EnrollmentLink, null=True, blank=True, on_delete=models.SET_NULL, related_name='applications')
    application_no = models.CharField(max_length=64, unique=True, db_index=True)
    name = models.CharField(max_length=160)
    class_name = models.CharField(max_length=40)
    section = models.CharField(max_length=40, default='A')
    dob = models.DateField()
    gender = models.CharField(max_length=32)
    blood_group = models.CharField(max_length=16, blank=True, default='')
    parent_name = models.CharField(max_length=160)
    parent_phone = models.CharField(max_length=30)
    parent_email = models.EmailField()
    address = models.TextField(blank=True, default='')
    aadhaar_no = models.CharField(max_length=32, blank=True, default='')
    medical_conditions = models.TextField(blank=True, default='')
    photo_key = models.CharField(max_length=512, blank=True, default='')
    photo_data = models.BinaryField(blank=True, null=True, editable=False)
    photo_content_type = models.CharField(max_length=32, blank=True, default='')
    document_key = models.CharField(max_length=512, blank=True, default='')
    document_size = models.PositiveIntegerField(default=0)
    document_data = models.BinaryField(blank=True, null=True, editable=False)
    document_name = models.CharField(max_length=255, blank=True, default='')
    document_content_type = models.CharField(max_length=120, blank=True, default='')
    document_category = models.CharField(max_length=64, blank=True, default='')
    academic_year = models.CharField(max_length=40)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='enrollment_applications')
    provisional_username = models.CharField(max_length=150)
    provisional_email = models.EmailField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='approved_enrollments')
    rejection_remarks = models.TextField(blank=True, default='')
    created_student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.SET_NULL, related_name='admission_applications')

    class Meta:
        ordering = ['-submitted_at', '-id']
        indexes = [
            models.Index(fields=['school', '-submitted_at', '-id'], name='sis_app_sch_sub_id_idx'),
        ]

