from django.conf import settings
from django.db import models


class ExamSchedule(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='exam_schedules')
    name = models.CharField(max_length=160)
    classroom = models.ForeignKey('academics.Class', on_delete=models.CASCADE, related_name='exam_schedules')
    class_name = models.CharField(max_length=80)
    academic_year = models.CharField(max_length=40, default='2026-2027')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    published_at = models.DateTimeField(null=True, blank=True)
    hall_tickets_generated = models.BooleanField(default=False)
    hall_tickets_released = models.BooleanField(default=False)
    hall_tickets_released_at = models.DateTimeField(null=True, blank=True)
    marks_published = models.BooleanField(default=False)
    marks_published_at = models.DateTimeField(null=True, blank=True)
    report_cards_generated = models.BooleanField(default=False)
    report_cards_published = models.BooleanField(default=False)
    report_cards_published_at = models.DateTimeField(null=True, blank=True)
    marks_entry_days = models.PositiveIntegerField(
        default=3,
        help_text="Allowed number of days for teachers to enter marks after exam completion"
    )
    marks_entry_deadline = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Custom or extended deadline for marks entry set by admin"
    )
    marks_entry_extended = models.BooleanField(
        default=False,
        help_text="Indicates whether the marks entry period has been extended by an administrator"
    )
    marks_entry_extension_reason = models.CharField(
        max_length=255,
        blank=True,
        default=''
    )
    marks_entry_extended_at = models.DateTimeField(null=True, blank=True)
    marks_entry_extended_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='extended_exam_schedules'
    )
    section_extensions = models.JSONField(
        default=dict,
        blank=True,
        help_text="Custom per-section extension configurations"
    )
    subject_extensions = models.JSONField(
        default=dict,
        blank=True,
        help_text="Custom per-subject marks entry deadlines set by administrators"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['school', 'status'], name='exam_sched_school_status_idx'),
            models.Index(fields=['school', 'classroom', 'status'], name='exam_sched_school_cls_stat_idx'),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} - {self.class_name} ({self.status})"

    def get_latest_exam_end_datetime(self):
        """Returns the datetime when the latest subject exam in this schedule completes."""
        import datetime
        from django.utils import timezone
        items = list(self.items.all())
        if not items:
            return None
        latest = None
        for it in items:
            if not it.exam_date:
                continue
            t = it.end_time or it.start_time or datetime.time(23, 59, 59)
            dt = datetime.datetime.combine(it.exam_date, t)
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            if latest is None or dt > latest:
                latest = dt
        return latest

    def get_subject_end_datetime(self, subject_name=None):
        """Returns the datetime when a specific subject exam completes."""
        import datetime
        from django.utils import timezone
        if not subject_name:
            return self.get_latest_exam_end_datetime()
        items = list(self.items.all())
        it = next((x for x in items if x.subject_name and x.subject_name.lower() == str(subject_name).lower()), None)
        if not it or not it.exam_date:
            return self.get_latest_exam_end_datetime()
        t = it.end_time or it.start_time or datetime.time(23, 59, 59)
        dt = datetime.datetime.combine(it.exam_date, t)
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt

    def get_marks_entry_deadline(self, subject_name=None, section_name=None):
        """
        Calculates the effective marks entry deadline.
        If section_name has a specific extension in section_extensions, uses that.
        If admin explicitly extended or set marks_entry_deadline, use it.
        Otherwise, default to subject completion datetime + marks_entry_days (default 3 days).
        """
        import datetime
        from django.utils import timezone

        if subject_name and isinstance(self.subject_extensions, dict):
            for subject_key, subject_data in self.subject_extensions.items():
                if str(subject_key).strip().lower() == str(subject_name).strip().lower():
                    if isinstance(subject_data, dict) and subject_data.get('extended') and subject_data.get('deadline'):
                        try:
                            d = datetime.datetime.fromisoformat(str(subject_data['deadline']).replace('Z', '+00:00'))
                            if timezone.is_naive(d):
                                d = timezone.make_aware(d, timezone.get_current_timezone())
                            return d
                        except (TypeError, ValueError):
                            pass

        if section_name and isinstance(self.section_extensions, dict):
            for sec_key, sec_data in self.section_extensions.items():
                if str(sec_key).strip().lower() == str(section_name).strip().lower():
                    if isinstance(sec_data, dict) and sec_data.get('extended') and sec_data.get('deadline'):
                        try:
                            d = datetime.datetime.fromisoformat(str(sec_data['deadline']).replace('Z', '+00:00'))
                            if timezone.is_naive(d):
                                d = timezone.make_aware(d, timezone.get_current_timezone())
                            return d
                        except Exception:
                            pass

        subject_end = self.get_subject_end_datetime(subject_name)
        if not subject_end:
            return self.marks_entry_deadline

        default_deadline = subject_end + datetime.timedelta(days=self.marks_entry_days or 3)
        if self.marks_entry_deadline:
            if self.marks_entry_extended:
                return max(self.marks_entry_deadline, default_deadline)
            return self.marks_entry_deadline
        return default_deadline

    def check_marks_entry_window(self, user, subject_name=None, section_name=None):
        """
        Evaluates whether marks entry is currently open for the given user.
        Administrators always have full access.
        Teachers have a 3-day window from subject exam completion, extendable by admin (schedule-wide or per-section).
        """
        import datetime
        from django.utils import timezone

        user_role = getattr(user, 'role', '')
        is_admin = user_role in ['School Admin', 'Super Admin', 'school_admin', 'super_admin']

        now = timezone.now()
        subject_end = self.get_subject_end_datetime(subject_name)
        deadline = self.get_marks_entry_deadline(subject_name, section_name=section_name)

        is_completed = bool(subject_end and now >= (subject_end - datetime.timedelta(minutes=30)))

        # Check section-specific extension
        sec_ext = None
        if section_name and isinstance(self.section_extensions, dict):
            for sec_key, sec_data in self.section_extensions.items():
                if str(sec_key).strip().lower() == str(section_name).strip().lower():
                    if isinstance(sec_data, dict) and sec_data.get('extended') and sec_data.get('deadline'):
                        sec_ext = sec_data
                        break

        subject_ext = None
        if subject_name and isinstance(self.subject_extensions, dict):
            for subject_key, subject_data in self.subject_extensions.items():
                if str(subject_key).strip().lower() == str(subject_name).strip().lower():
                    if isinstance(subject_data, dict) and subject_data.get('extended') and subject_data.get('deadline'):
                        subject_ext = subject_data
                        break

        if is_admin:
            return {
                'is_open': True,
                'is_completed': is_completed,
                'is_expired': False,
                'is_extended': bool(sec_ext or subject_ext or (self.marks_entry_extended and self.marks_entry_deadline)),
                'deadline': deadline,
                'reason': 'Full access granted for Administrator',
                'days_remaining': round((deadline - now).total_seconds() / 86400.0, 1) if deadline else None,
                'section_extended': bool(sec_ext),
                'section_name': section_name,
            }

        # If section-specific extension exists
        if sec_ext and deadline:
            sec_reason = sec_ext.get('reason', '')
            if now <= deadline:
                remaining_secs = (deadline - now).total_seconds()
                return {
                    'is_open': True,
                    'is_completed': True,
                    'is_expired': False,
                    'is_extended': True,
                    'deadline': deadline,
                    'reason': f"Extended for Section {section_name} until {deadline.strftime('%b %d, %Y %I:%M %p')}" + (f" ({sec_reason})" if sec_reason else ""),
                    'days_remaining': round(remaining_secs / 86400.0, 1),
                    'section_extended': True,
                    'section_name': section_name,
                }

        if subject_ext and deadline:
            subject_reason = subject_ext.get('reason', '')
            if now <= deadline:
                remaining_secs = (deadline - now).total_seconds()
                return {
                    'is_open': True,
                    'is_completed': True,
                    'is_expired': False,
                    'is_extended': True,
                    'deadline': deadline,
                    'reason': f"Extended for {subject_name} until {deadline.strftime('%b %d, %Y %I:%M %p')}" + (f" ({subject_reason})" if subject_reason else ""),
                    'days_remaining': round(remaining_secs / 86400.0, 1),
                    'section_extended': False,
                    'section_name': section_name,
                }
            else:
                return {
                    'is_open': False,
                    'is_completed': True,
                    'is_expired': True,
                    'is_extended': True,
                    'deadline': deadline,
                    'reason': f"Marks entry window for {subject_name} closed on {deadline.strftime('%b %d, %Y %I:%M %p')}. Contact an administrator for extension.",
                    'days_remaining': 0,
                    'section_extended': False,
                    'section_name': section_name,
                }

        is_extended = bool(subject_ext or (self.marks_entry_extended and self.marks_entry_deadline))

        # If admin specifically extended the schedule-level deadline and current time is within it
        if is_extended and deadline and now <= deadline:
            remaining_secs = (deadline - now).total_seconds()
            return {
                'is_open': True,
                'is_completed': True,
                'is_expired': False,
                'is_extended': True,
                'deadline': deadline,
                'reason': f"Extended by Administrator until {deadline.strftime('%b %d, %Y %I:%M %p')}",
                'days_remaining': round(remaining_secs / 86400.0, 1),
                'section_extended': False,
                'section_name': section_name,
            }

        if subject_end and not is_completed:
            return {
                'is_open': False,
                'is_completed': False,
                'is_expired': False,
                'is_extended': False,
                'deadline': deadline,
                'reason': f"Exam scheduled for {subject_end.strftime('%b %d, %Y %I:%M %p')}. Marks entry opens upon exam completion.",
                'days_remaining': None,
                'section_extended': False,
                'section_name': section_name,
            }

        if deadline and now > deadline:
            return {
                'is_open': False,
                'is_completed': True,
                'is_expired': True,
                'is_extended': is_extended,
                'deadline': deadline,
                'reason': f"Marks entry window closed on {deadline.strftime('%b %d, %Y %I:%M %p')} (3 days after exam completion). Contact an administrator for extension.",
                'days_remaining': 0,
                'section_extended': False,
                'section_name': section_name,
            }

        remaining_secs = (deadline - now).total_seconds() if deadline else 0
        return {
            'is_open': True,
            'is_completed': True,
            'is_expired': False,
            'is_extended': is_extended,
            'deadline': deadline,
            'reason': f"Open until {deadline.strftime('%b %d, %Y %I:%M %p') if deadline else 'N/A'}",
            'days_remaining': round(remaining_secs / 86400.0, 1) if deadline else None,
            'section_extended': False,
            'section_name': section_name,
        }


class ExamScheduleItem(models.Model):
    schedule = models.ForeignKey(ExamSchedule, on_delete=models.CASCADE, related_name='items')
    subject = models.ForeignKey('academics.Subject', on_delete=models.SET_NULL, null=True, blank=True, related_name='exam_schedule_items')
    subject_name = models.CharField(max_length=100)
    exam_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    max_marks = models.PositiveIntegerField(default=100)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['exam_date', 'start_time', 'order']

    def __str__(self):
        return f"{self.schedule.name} - {self.subject_name} ({self.exam_date})"


class Exam(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='exams')
    schedule = models.ForeignKey(ExamSchedule, on_delete=models.SET_NULL, null=True, blank=True, related_name='exams')
    name = models.CharField(max_length=160)
    class_name = models.CharField(max_length=40)
    section = models.CharField(max_length=40)
    subject = models.CharField(max_length=100)
    date = models.DateField()
    time = models.TimeField()
    end_time = models.TimeField(null=True, blank=True)
    max_marks = models.PositiveIntegerField()
    marks_entry_deadline = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Custom or extended deadline for marks entry for this exam"
    )

    class Meta:
        indexes = [
            models.Index(fields=['school', '-date'], name='exams_school_date_idx'),
            models.Index(fields=['school', 'class_name', 'section'], name='exams_school_class_section_idx'),
        ]


class ExamResult(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        SUBMITTED = 'submitted', 'Submitted'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='exam_results')
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='results')
    student = models.ForeignKey('sis.Student', on_delete=models.CASCADE, related_name='exam_results')
    marks_obtained = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    entered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='entered_exam_results')
    entered_at = models.DateTimeField(auto_now=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['exam', 'student'], name='unique_exam_result_per_student')]
        indexes = [
            models.Index(fields=['school', 'student']),
            models.Index(fields=['school', 'exam', 'status'], name='exam_res_sch_exam_stat_idx'),
        ]
