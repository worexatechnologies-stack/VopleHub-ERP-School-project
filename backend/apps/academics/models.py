from django.db import models


class AcademicYear(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='academic_years')
    name = models.CharField(max_length=20)
    starts_on = models.DateField()
    ends_on = models.DateField()
    is_active = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['school', 'name'], name='unique_school_academic_year'),
            models.UniqueConstraint(
                fields=['school'], condition=models.Q(is_active=True),
                name='unique_active_academic_year_per_school',
            ),
        ]
        indexes = [models.Index(fields=['school', 'is_active'])]
        ordering = ['-starts_on']


class Class(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='classes')
    name = models.CharField(max_length=80)
    code = models.SlugField(max_length=80)
    sort_order = models.PositiveIntegerField(default=0)
    subjects = models.ManyToManyField('Subject', related_name='classes', blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['school', 'code'], name='unique_school_class_code')]
        ordering = ['sort_order', 'name']


class Section(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='sections')
    class_room = models.ForeignKey(Class, on_delete=models.CASCADE, related_name='sections')
    name = models.CharField(max_length=20)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['school', 'class_room', 'name'], name='unique_school_class_section')]
        ordering = ['class_room__name', 'name']

    def clean(self):
        if self.class_room_id and self.school_id and self.class_room.school_id != self.school_id:
            from django.core.exceptions import ValidationError
            raise ValidationError({'class_room': 'Class must belong to the same school as the section.'})


class Subject(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='subjects')
    name = models.CharField(max_length=120)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['school', 'name'], name='unique_school_subject_name')]
        ordering = ['name']


class Homework(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'Active', 'Active'
        COMPLETED = 'Completed', 'Completed'
        ARCHIVED = 'Archived', 'Archived'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='homeworks')
    teacher = models.ForeignKey('staff.Teacher', on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_homeworks')
    teacher_name = models.CharField(max_length=150, blank=True)
    academic_year = models.CharField(max_length=50, default='2026-2027')
    class_room = models.ForeignKey(Class, on_delete=models.CASCADE, related_name='homeworks', null=True, blank=True)
    class_name = models.CharField(max_length=80)
    section = models.ForeignKey(Section, on_delete=models.SET_NULL, null=True, blank=True, related_name='homeworks')
    section_name = models.CharField(max_length=40, blank=True)
    subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, null=True, blank=True, related_name='homeworks')
    subject_name = models.CharField(max_length=120)
    title = models.CharField(max_length=200)
    description = models.TextField()
    due_date = models.DateField()
    max_marks = models.PositiveIntegerField(default=20)
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_url = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    submissions = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-due_date', '-created_at']
        indexes = [
            models.Index(fields=['school', 'class_name', 'section_name']),
            models.Index(fields=['school', 'due_date']),
        ]

    def __str__(self):
        return f"{self.subject_name} - {self.title} (Class {self.class_name})"

