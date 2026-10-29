from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from .models import AcademicYear, Class, Section, Subject, Homework
from apps.schools.models import School
from apps.staff.models import Teacher


class TenantCreateSerializer(serializers.ModelSerializer):
    schoolId = serializers.PrimaryKeyRelatedField(source='school', queryset=School.objects.all(), write_only=True, required=False)

    def get_fields(self):
        fields = super().get_fields()
        school_field = fields.get('schoolId')
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        if school_field is not None:
            school_field.queryset = School.objects.filter(pk=school_id) if school_id else School.objects.none()
        return fields

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        user_school_id = getattr(user, 'school_id', None)
        submitted_school = attrs.get('school')
        if (
            submitted_school is not None
            and getattr(user, 'role', None) != 'super_admin'
            and submitted_school.pk != user_school_id
        ):
            raise serializers.ValidationError({'schoolId': 'School is outside your tenant.'})
        return super().validate(attrs)

    def tenant_school_id(self):
        if self.instance is not None:
            return self.instance.school_id
        request = self.context.get('request')
        return getattr(getattr(request, 'user', None), 'school_id', None)


class AcademicYearSerializer(TenantCreateSerializer):
    name = serializers.CharField(max_length=20)
    startsOn = serializers.DateField(source='starts_on')
    endsOn = serializers.DateField(source='ends_on')

    class Meta:
        model = AcademicYear
        fields = ['id', 'name', 'startsOn', 'endsOn', 'is_active', 'schoolId']
        validators = []

    def validate(self, attrs):
        attrs = super().validate(attrs)
        name = attrs.get('name', getattr(self.instance, 'name', '')).strip()
        starts_on = attrs.get('starts_on', getattr(self.instance, 'starts_on', None))
        ends_on = attrs.get('ends_on', getattr(self.instance, 'ends_on', None))
        if starts_on and ends_on and ends_on <= starts_on:
            raise serializers.ValidationError({'endsOn': 'End date must be after the start date.'})

        existing = AcademicYear.objects.filter(school_id=self.tenant_school_id(), name__iexact=name)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError({'name': 'An academic year with this name already exists.'})
        attrs['name'] = name
        return attrs


class ClassSerializer(TenantCreateSerializer):
    name = serializers.CharField(max_length=80)
    sortOrder = serializers.IntegerField(source='sort_order', min_value=0, required=False)
    subjectIds = serializers.PrimaryKeyRelatedField(
        source='subjects', queryset=Subject.objects.all(), many=True, required=False,
    )
    classTeacherId = serializers.PrimaryKeyRelatedField(
        source='class_teacher', queryset=Teacher.objects.all(), required=False, allow_null=True
    )
    classTeacherName = serializers.SerializerMethodField(read_only=True)
    classTeacherEmail = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Class
        fields = [
            'id', 'name', 'code', 'sortOrder', 'subjectIds',
            'classTeacherId', 'classTeacherName', 'classTeacherEmail', 'schoolId'
        ]
        validators = []

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        fields['subjectIds'].child_relation.queryset = (
            Subject.objects.filter(school_id=school_id) if school_id else Subject.objects.none()
        )
        if 'classTeacherId' in fields:
            fields['classTeacherId'].queryset = (
                Teacher.objects.filter(school_id=school_id) if school_id else Teacher.objects.none()
            )
        return fields

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_classTeacherName(self, obj):
        if obj.class_teacher and getattr(obj.class_teacher, 'user', None):
            return obj.class_teacher.user.get_full_name() or obj.class_teacher.user.username or f"Teacher #{obj.class_teacher.id}"
        return None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_classTeacherEmail(self, obj):
        if obj.class_teacher and getattr(obj.class_teacher, 'user', None):
            return obj.class_teacher.user.email
        return None

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Class name cannot be blank.')
        return value

    def validate_code(self, value):
        return value.strip().lower()

    def validate_subjectIds(self, value):
        school_id = self.tenant_school_id()
        if any(subject.school_id != school_id for subject in value):
            raise serializers.ValidationError('One or more subjects are outside your school.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        school_id = self.tenant_school_id()
        existing = Class.objects.filter(school_id=school_id)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.filter(code__iexact=attrs.get('code', getattr(self.instance, 'code', ''))).exists():
            raise serializers.ValidationError({'code': 'A class with this code already exists.'})
        if existing.filter(name__iexact=attrs.get('name', getattr(self.instance, 'name', ''))).exists():
            raise serializers.ValidationError({'name': 'A class with this name already exists.'})
        return attrs


class SectionSerializer(TenantCreateSerializer):
    name = serializers.CharField(max_length=20)
    classId = serializers.PrimaryKeyRelatedField(source='class_room', queryset=Class.objects.all())
    classTeacherId = serializers.PrimaryKeyRelatedField(
        source='class_teacher', queryset=Teacher.objects.all(), required=False, allow_null=True
    )
    classTeacherName = serializers.SerializerMethodField(read_only=True)
    classTeacherEmail = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Section
        fields = ['id', 'classId', 'name', 'classTeacherId', 'classTeacherName', 'classTeacherEmail', 'schoolId']
        validators = []

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        fields['classId'].queryset = Class.objects.filter(school_id=school_id) if school_id else Class.objects.none()
        if 'classTeacherId' in fields:
            fields['classTeacherId'].queryset = (
                Teacher.objects.filter(school_id=school_id) if school_id else Teacher.objects.none()
            )
        return fields

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_classTeacherName(self, obj):
        teacher = obj.class_teacher or getattr(obj.class_room, 'class_teacher', None)
        if teacher and getattr(teacher, 'user', None):
            return teacher.user.get_full_name() or teacher.user.username or f"Teacher #{teacher.id}"
        return None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_classTeacherEmail(self, obj):
        teacher = obj.class_teacher or getattr(obj.class_room, 'class_teacher', None)
        if teacher and getattr(teacher, 'user', None):
            return teacher.user.email
        return None

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Section name cannot be blank.')
        return value

    def validate_classId(self, value):
        request = self.context['request']
        if request.user.role != 'super_admin' and value.school_id != request.user.school_id:
            raise serializers.ValidationError('Class is outside your school.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        classroom = attrs.get('class_room', getattr(self.instance, 'class_room', None))
        name = attrs.get('name', getattr(self.instance, 'name', ''))
        existing = Section.objects.filter(
            school_id=self.tenant_school_id(),
            class_room=classroom,
            name__iexact=name,
        )
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError({'name': 'This section already exists in the selected class.'})
        return attrs


class SubjectSerializer(TenantCreateSerializer):
    name = serializers.CharField(max_length=120)

    class Meta:
        model = Subject
        fields = ['id', 'name', 'schoolId']
        validators = []

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Subject name cannot be blank.')
        existing = Subject.objects.filter(school_id=self.tenant_school_id(), name__iexact=value)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError('A subject with this name already exists.')
        return value


class HomeworkSerializer(TenantCreateSerializer):
    classId = serializers.PrimaryKeyRelatedField(source='class_room', queryset=Class.objects.all(), write_only=True, required=False, allow_null=True)
    sectionId = serializers.PrimaryKeyRelatedField(source='section', queryset=Section.objects.all(), write_only=True, required=False, allow_null=True)
    subjectId = serializers.PrimaryKeyRelatedField(source='subject', queryset=Subject.objects.all(), write_only=True, required=False, allow_null=True)
    className = serializers.CharField(source='class_name', required=False)
    sectionName = serializers.CharField(source='section_name', required=False, allow_blank=True, default='')
    subjectName = serializers.CharField(source='subject_name', required=False)
    dueDate = serializers.DateField(source='due_date')
    assignedDate = serializers.SerializerMethodField()
    maxMarks = serializers.IntegerField(source='max_marks', required=False, default=20)
    teacherName = serializers.CharField(source='teacher_name', required=False, allow_blank=True, default='')
    attachmentName = serializers.CharField(source='attachment_name', required=False, allow_blank=True, default='')
    # Older clients send the first file's data URL in this legacy field as
    # well as in `attachments`. Accept that larger duplicate long enough to
    # normalize it away; the actual file stays in the JSON attachments field.
    attachmentUrl = serializers.CharField(
        source='attachment_url', required=False, allow_blank=True, default='',
        max_length=22 * 1024 * 1024,
    )
    attachments = serializers.JSONField(required=False, default=list)
    schoolId = serializers.PrimaryKeyRelatedField(
        source='school', queryset=School.objects.all(), required=False,
    )

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assignedDate(self, obj):
        """Return the date the homework was created/assigned."""
        if obj.created_at:
            return obj.created_at.date().isoformat()
        return None

    def validate_attachmentUrl(self, value):
        # `attachment_url` is a 500-character compatibility field. Base64 file
        # data belongs only in `attachments`; do not pass it to the DB column.
        if len(value) > 500:
            return ''
        return value

    teacherId = serializers.PrimaryKeyRelatedField(
        source='teacher', queryset=Teacher.objects.all(), required=False, allow_null=True
    )

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            school_id = None
        elif getattr(user, 'role', None) == 'super_admin':
            school_id = None
            fields['schoolId'].queryset = School.objects.all()
        else:
            school_id = user.school_id
            fields['schoolId'].queryset = School.objects.filter(pk=school_id) if school_id else School.objects.none()

        if school_id:
            fields['classId'].queryset = Class.objects.filter(school_id=school_id)
            fields['sectionId'].queryset = Section.objects.filter(school_id=school_id)
            fields['subjectId'].queryset = Subject.objects.filter(school_id=school_id)
            fields['teacherId'].queryset = Teacher.objects.filter(school_id=school_id)
        elif not user or getattr(user, 'role', None) != 'super_admin':
            fields['classId'].queryset = Class.objects.none()
            fields['sectionId'].queryset = Section.objects.none()
            fields['subjectId'].queryset = Subject.objects.none()
            fields['teacherId'].queryset = Teacher.objects.none()
        return fields

    class Meta:
        model = Homework
        fields = [
            'id', 'schoolId', 'title', 'description', 'status',
            'className', 'sectionName', 'subjectName',
            'classId', 'sectionId', 'subjectId', 'teacherId',
            'dueDate', 'assignedDate', 'maxMarks',
            'teacherName', 'attachmentName', 'attachmentUrl', 'attachments',
            'submissions', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if self.instance:
            school_id = self.instance.school_id
            submitted_school = attrs.get('school')
            if submitted_school and submitted_school.pk != school_id:
                raise serializers.ValidationError({'schoolId': 'Homework cannot be moved to another school.'})
        elif getattr(user, 'role', None) == 'super_admin':
            school_id = getattr(attrs.get('school'), 'pk', None)
        else:
            school_id = getattr(user, 'school_id', None)
        if not school_id:
            raise serializers.ValidationError({'schoolId': 'A school is required for homework.'})

        classroom = attrs.get('class_room')
        section = attrs.get('section')
        subject = attrs.get('subject')
        teacher = attrs.get('teacher')
        for field_name, related in (
            ('classId', classroom), ('sectionId', section),
            ('subjectId', subject), ('teacherId', teacher),
        ):
            if related is not None and related.school_id != school_id:
                raise serializers.ValidationError({field_name: 'Related record is outside this school.'})
        if section and classroom and section.class_room_id != classroom.pk:
            raise serializers.ValidationError({'sectionId': 'Section must belong to the selected class.'})
        if section and classroom is None:
            classroom = section.class_room
            attrs['class_room'] = classroom
        if classroom and not attrs.get('class_name'):
            attrs['class_name'] = classroom.name
        if section and not attrs.get('section_name'):
            attrs['section_name'] = section.name
        if subject and not attrs.get('subject_name'):
            attrs['subject_name'] = subject.name
        attachments = attrs.get('attachments')
        if attachments and isinstance(attachments, list) and len(attachments) > 0:
            first_att = attachments[0]
            if isinstance(first_att, dict):
                if not attrs.get('attachment_name') and first_att.get('name'):
                    attrs['attachment_name'] = str(first_att.get('name'))[:255]
                if not attrs.get('attachment_url') and first_att.get('url'):
                    url_str = str(first_att.get('url'))
                    if len(url_str) < 500:
                        attrs['attachment_url'] = url_str
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        file_rows = list(instance.file_attachments.all())

        def attachment_payload(attachment):
            return {
                'id': attachment.pk,
                'name': attachment.file_name,
                'url': f'/api/v1/homework/{instance.pk}/attachments/{attachment.pk}/?view=1',
                'type': attachment.content_type,
                'size': attachment.file_size,
            }

        assignment_files = [attachment_payload(item) for item in file_rows if not item.submission_student_id]
        if assignment_files:
            legacy_metadata = [
                item for item in data.get('attachments', [])
                if isinstance(item, dict)
                and not (isinstance(item.get('url'), str) and item['url'].startswith('data:'))
            ]
            data['attachments'] = [*legacy_metadata, *assignment_files]
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and user.role in ['student', 'parent']:
            if user.role == 'student':
                from apps.sis.models import Student
                profile = getattr(user, 'student_profile', None)
                allowed_student_ids = set(
                    str(student_id)
                    for student_id in Student.objects.filter(
                        pk=profile.student_id, school_id=instance.school_id,
                    ).values_list('pk', flat=True)
                ) if profile and profile.student_id else set()
            else:
                profile = getattr(user, 'parent_profile', None)
                allowed_student_ids = {
                    str(student_id)
                    for student_id in profile.students.filter(school_id=instance.school_id).values_list('pk', flat=True)
                } if profile else set()
            data['submissions'] = [
                submission for submission in data.get('submissions', [])
                if isinstance(submission, dict) and str(submission.get('student_id')) in allowed_student_ids
            ]
        for submission in data['submissions']:
            submission_files = [
                attachment_payload(item) for item in file_rows
                if item.submission_student_id
                and str(item.submission_student_id) == str(submission.get('student_id'))
            ]
            if submission_files:
                submission['attachments'] = submission_files
        return data

