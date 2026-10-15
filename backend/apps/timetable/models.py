from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class TimetableSlot(models.Model):
    """One canonical teaching period for a section in an academic year."""

    class Day(models.TextChoices):
        MONDAY = 'Monday', 'Monday'
        TUESDAY = 'Tuesday', 'Tuesday'
        WEDNESDAY = 'Wednesday', 'Wednesday'
        THURSDAY = 'Thursday', 'Thursday'
        FRIDAY = 'Friday', 'Friday'
        SATURDAY = 'Saturday', 'Saturday'

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='timetable_slots',
    )
    academic_year = models.ForeignKey(
        'academics.AcademicYear', on_delete=models.CASCADE,
        related_name='timetable_slots',
    )
    section = models.ForeignKey(
        'academics.Section', on_delete=models.CASCADE,
        related_name='timetable_slots',
    )
    subject = models.ForeignKey(
        'academics.Subject', on_delete=models.CASCADE,
        related_name='timetable_slots',
    )
    teacher = models.ForeignKey(
        'staff.Teacher', on_delete=models.CASCADE,
        related_name='timetable_slots',
    )
    day = models.CharField(max_length=9, choices=Day.choices)
    period = models.PositiveSmallIntegerField()
    time_label = models.CharField(max_length=64)
    classroom = models.CharField(max_length=120, default='Default')
    published = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='created_timetable_slots',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(period__gte=1), name='timetable_period_at_least_one',
            ),
            models.UniqueConstraint(
                fields=['school', 'academic_year', 'section', 'day', 'period'],
                name='unique_section_timetable_period',
            ),
            models.UniqueConstraint(
                fields=['school', 'academic_year', 'teacher', 'day', 'period'],
                name='unique_teacher_timetable_period',
            ),
        ]
        indexes = [
            models.Index(
                fields=['school', 'academic_year', 'section', 'published'],
                name='timetable_section_lookup_idx',
            ),
            models.Index(
                fields=['school', 'academic_year', 'teacher', 'published'],
                name='timetable_teacher_lookup_idx',
            ),
        ]
        ordering = ['academic_year__starts_on', 'section_id', 'day', 'period']

    def clean(self):
        school_ids = {
            self.academic_year.school_id if self.academic_year_id else None,
            self.section.school_id if self.section_id else None,
            self.subject.school_id if self.subject_id else None,
            self.teacher.school_id if self.teacher_id else None,
        }
        school_ids.discard(None)
        if self.school_id and any(school_id != self.school_id for school_id in school_ids):
            raise ValidationError('Every timetable relation must belong to the same school.')

    def __str__(self):
        return (
            f'{self.section.class_room.name}-{self.section.name}: '
            f'{self.day} period {self.period}'
        )
