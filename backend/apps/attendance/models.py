from datetime import datetime
from django.conf import settings
from django.db import models


class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PRESENT = 'Present', 'Present'
        ABSENT = 'Absent', 'Absent'
        LATE = 'Late', 'Late'
        HALF_DAY = 'Half-day', 'Half-day'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='attendance_records')
    student = models.ForeignKey('sis.Student', on_delete=models.CASCADE, related_name='attendance_records')
    date = models.DateField()
    day_of_week = models.CharField(max_length=15, blank=True, default='')
    period = models.PositiveSmallIntegerField(default=1)
    time_label = models.CharField(max_length=64, blank=True, default='')
    subject = models.ForeignKey('academics.Subject', on_delete=models.SET_NULL, null=True, blank=True, related_name='attendance_records')
    subject_teacher = models.ForeignKey('staff.Teacher', on_delete=models.SET_NULL, null=True, blank=True, related_name='subject_attendance_records')
    timetable_slot = models.ForeignKey('timetable.TimetableSlot', on_delete=models.SET_NULL, null=True, blank=True, related_name='attendance_records')
    status = models.CharField(max_length=15, choices=Status.choices)
    marked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='marked_attendance')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['student', 'date', 'period'], name='unique_student_date_period')
        ]
        indexes = [
            models.Index(fields=['school', 'date'], name='attendance_school_date_idx'),
            models.Index(fields=['student', 'date'], name='attendance_student_date_idx'),
            models.Index(fields=['school', 'date', 'period'], name='att_school_date_period_idx'),
            models.Index(fields=['school', 'date', 'status'], name='att_school_dt_status_idx'),
            models.Index(fields=['school', 'day_of_week'], name='att_school_day_idx'),
            models.Index(fields=['school', '-date', 'period', 'id'], name='att_sch_dt_per_id_idx'),
            models.Index(fields=['student', '-date'], name='att_student_dt_desc_idx'),
        ]
        ordering = ['-date', 'period', 'id']

    def save(self, *args, **kwargs):
        if self.date:
            if isinstance(self.date, str):
                try:
                    self.day_of_week = datetime.strptime(self.date, '%Y-%m-%d').strftime('%A')
                except ValueError:
                    pass
            elif hasattr(self.date, 'strftime'):
                self.day_of_week = self.date.strftime('%A')
        super().save(*args, **kwargs)


class AttendanceAuditLog(models.Model):
    attendance_record = models.ForeignKey(AttendanceRecord, on_delete=models.CASCADE, related_name='audit_logs')
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='attendance_audit_logs')
    student = models.ForeignKey('sis.Student', on_delete=models.CASCADE, related_name='attendance_audit_logs')
    period = models.PositiveSmallIntegerField(default=1)
    subject = models.ForeignKey('academics.Subject', on_delete=models.SET_NULL, null=True, blank=True)
    day_of_week = models.CharField(max_length=15, blank=True, default='')
    old_status = models.CharField(max_length=15, blank=True, null=True)
    new_status = models.CharField(max_length=15)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='attendance_changes')
    reason = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', '-created_at'], name='att_audit_school_date_idx'),
            models.Index(fields=['student', '-created_at'], name='att_audit_student_date_idx'),
            models.Index(fields=['attendance_record', '-created_at'], name='att_audit_record_date_idx'),
        ]
