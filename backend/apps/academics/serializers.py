from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from .models import AcademicYear, Class, Section, Subject, Homework
from apps.schools.models import School


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
        user_school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        submitted_school = attrs.get('school')
        if submitted_school is not None and submitted_school.pk != user_school_id:
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

    class Meta:
        model = Class
        fields = ['id', 'name', 'code', 'sortOrder', 'subjectIds', 'schoolId']
        validators = []

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        fields['subjectIds'].child_relation.queryset = (
            Subject.objects.filter(school_id=school_id) if school_id else Subject.objects.none()
        )
        return fields

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

    class Meta:
        model = Section
        fields = ['id', 'classId', 'name', 'schoolId']
        validators = []

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        fields['classId'].queryset = Class.objects.filter(school_id=school_id) if school_id else Class.objects.none()
        return fields

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
    attachmentUrl = serializers.CharField(source='attachment_url', required=False, allow_blank=True, default='')
    schoolId = serializers.IntegerField(source='school_id', read_only=True)

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_assignedDate(self, obj):
        """Return the date the homework was created/assigned."""
        if obj.created_at:
            return obj.created_at.date().isoformat()
        return None

    class Meta:
        model = Homework
        fields = [
            'id', 'schoolId', 'title', 'description', 'status',
            'className', 'sectionName', 'subjectName',
            'classId', 'sectionId', 'subjectId',
            'dueDate', 'assignedDate', 'maxMarks',
            'teacherName', 'attachmentName', 'attachmentUrl',
            'submissions', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'schoolId', 'created_at', 'updated_at']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        classroom = attrs.get('class_room')
        if classroom and not attrs.get('class_name'):
            attrs['class_name'] = classroom.name
        section = attrs.get('section')
        if section and not attrs.get('section_name'):
            attrs['section_name'] = section.name
        subject = attrs.get('subject')
        if subject and not attrs.get('subject_name'):
            attrs['subject_name'] = subject.name
        return attrs

