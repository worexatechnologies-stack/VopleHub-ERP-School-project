from django.db import IntegrityError, transaction
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from apps.academics.models import AcademicYear, Section, Subject
from apps.staff.models import Teacher

from .models import TimetableSlot


class TimetableSlotSerializer(serializers.ModelSerializer):
    """Map the normalized database record to the existing React slot shape."""

    id = serializers.CharField(read_only=True)
    schoolId = serializers.CharField(required=False)
    academicYear = serializers.CharField(max_length=20)
    sectionId = serializers.IntegerField(min_value=1)
    subjectId = serializers.IntegerField(min_value=1)
    teacherId = serializers.IntegerField(min_value=1)
    period = serializers.IntegerField(min_value=1, max_value=32)
    time = serializers.CharField(source='time_label', max_length=64)
    published = serializers.BooleanField(read_only=True)

    class Meta:
        model = TimetableSlot
        fields = [
            'id', 'schoolId', 'academicYear', 'sectionId', 'day', 'period',
            'time', 'subjectId', 'teacherId', 'classroom', 'published',
        ]
        read_only_fields = ['id', 'published']

    def get_fields(self):
        # ``class`` is a reserved Python keyword, so these response-only fields
        # are registered dynamically while remaining visible in API schemas.
        fields = super().get_fields()
        fields['class'] = serializers.CharField(
            source='section.class_room.name', read_only=True,
        )
        fields['section'] = serializers.CharField(source='section.name', read_only=True)
        fields['subject'] = serializers.CharField(source='subject.name', read_only=True)
        fields['teacherName'] = serializers.SerializerMethodField()
        return fields

    @extend_schema_field(serializers.CharField())
    def get_teacherName(self, instance):
        user = instance.teacher.user
        return user.get_full_name().strip() or user.email

    def to_representation(self, instance):
        return {
            'id': str(instance.pk),
            'schoolId': str(instance.school_id),
            'academicYear': instance.academic_year.name,
            'class': instance.section.class_room.name,
            'section': instance.section.name,
            'sectionId': instance.section_id,
            'day': instance.day,
            'period': instance.period,
            'time': instance.time_label,
            'subject': instance.subject.name,
            'subjectId': instance.subject_id,
            'teacherId': str(instance.teacher_id),
            'teacherName': self.get_teacherName(instance),
            'classroom': instance.classroom,
            'published': instance.published,
        }

    def _field_error(self, field, message):
        raise serializers.ValidationError({field: message})

    def validate(self, attrs):
        request = self.context['request']
        school = request.user.school
        if school is None:
            raise serializers.ValidationError({'schoolId': 'A school tenant is required.'})
        instance = self.instance

        submitted_school_id = attrs.pop('schoolId', None)
        if submitted_school_id is not None and str(submitted_school_id) != str(school.pk):
            self._field_error('schoolId', 'School is outside your tenant.')

        year_name = attrs.pop(
            'academicYear', instance.academic_year.name if instance else None,
        )
        section_id = attrs.pop('sectionId', instance.section_id if instance else None)
        subject_id = attrs.pop('subjectId', instance.subject_id if instance else None)
        teacher_id = attrs.pop('teacherId', instance.teacher_id if instance else None)

        try:
            academic_year = AcademicYear.objects.get(
                school_id=school.pk, name__iexact=year_name,
            )
        except AcademicYear.DoesNotExist:
            self._field_error('academicYear', 'Academic year was not found in your school.')
        try:
            section = Section.objects.select_related('class_room').get(
                pk=section_id, school_id=school.pk, class_room__school_id=school.pk,
            )
        except Section.DoesNotExist:
            self._field_error('sectionId', 'Section was not found in your school.')
        try:
            subject = Subject.objects.get(pk=subject_id, school_id=school.pk)
        except Subject.DoesNotExist:
            self._field_error('subjectId', 'Subject was not found in your school.')
        try:
            teacher = Teacher.objects.select_related('user').get(
                pk=teacher_id, school_id=school.pk, user__school_id=school.pk,
                status=Teacher.Status.ACTIVE,
            )
        except Teacher.DoesNotExist:
            self._field_error('teacherId', 'Active teacher was not found in your school.')

        submitted_class = self.initial_data.get('class')
        if submitted_class is not None and submitted_class != section.class_room.name:
            self._field_error('class', 'Class does not match the selected section.')

        if not section.class_room.subjects.filter(pk=subject.pk).exists():
            self._field_error(
                'subjectId', 'Subject is not assigned to the selected section\'s class.',
            )
        if not teacher.sections.filter(pk=section.pk).exists():
            self._field_error(
                'teacherId', 'Teacher is not assigned to the selected section.',
            )
        if not teacher.subject_records.filter(pk=subject.pk).exists():
            self._field_error(
                'teacherId', 'Teacher is not assigned to the selected subject.',
            )

        day = attrs.get('day', instance.day if instance else None)
        period = attrs.get('period', instance.period if instance else None)
        duplicate_section = TimetableSlot.objects.filter(
            school=school, academic_year=academic_year, section=section,
            day=day, period=period,
        )
        duplicate_teacher = TimetableSlot.objects.filter(
            school=school, academic_year=academic_year, teacher=teacher,
            day=day, period=period,
        )
        if instance:
            duplicate_section = duplicate_section.exclude(pk=instance.pk)
            duplicate_teacher = duplicate_teacher.exclude(pk=instance.pk)
        if duplicate_section.exists():
            raise serializers.ValidationError({
                'period': 'This section already has a subject in that day and period.',
            })
        if duplicate_teacher.exists():
            raise serializers.ValidationError({
                'teacherId': 'Teacher is already scheduled in that day and period.',
            })

        attrs.update({
            'school': school,
            'academic_year': academic_year,
            'section': section,
            'subject': subject,
            'teacher': teacher,
        })
        return attrs

    def _save_safely(self, operation):
        try:
            with transaction.atomic():
                return operation()
        except IntegrityError as exc:
            raise serializers.ValidationError({
                'period': 'That section or teacher is already scheduled in this period.',
            }) from exc

    def create(self, validated_data):
        request = self.context['request']
        return self._save_safely(lambda: TimetableSlot.objects.create(
            **validated_data, created_by=request.user,
        ))

    def update(self, instance, validated_data):
        def save():
            for field, value in validated_data.items():
                setattr(instance, field, value)
            # A previously published schedule becomes a draft after any edit.
            # This prevents students and parents seeing unreviewed changes.
            instance.published = False
            instance.save()
            return instance

        return self._save_safely(save)


class TimetablePublishSerializer(serializers.Serializer):
    academicYear = serializers.CharField(max_length=20)
    sectionId = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        school_id = self.context['request'].user.school_id
        if not AcademicYear.objects.filter(
            school_id=school_id, name__iexact=attrs['academicYear'],
        ).exists():
            raise serializers.ValidationError({
                'academicYear': 'Academic year was not found in your school.',
            })
        if not Section.objects.filter(
            pk=attrs['sectionId'], school_id=school_id,
            class_room__school_id=school_id,
        ).exists():
            raise serializers.ValidationError({
                'sectionId': 'Section was not found in your school.',
            })
        return attrs


class TimetablePublishResponseSerializer(serializers.Serializer):
    updated = serializers.IntegerField(min_value=0)
    slots = TimetableSlotSerializer(many=True)
