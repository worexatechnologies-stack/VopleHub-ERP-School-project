from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from django.db.models import Q
from apps.accounts.models import User
from apps.academics.models import Class, Section, Subject
from .models import Exam, ExamResult, ExamSchedule, ExamScheduleItem


class ExamScheduleItemSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all(), required=False, allow_null=True)

    class Meta:
        model = ExamScheduleItem
        fields = [
            'id', 'subject', 'subject_name',
            'exam_date', 'start_time', 'end_time', 'max_marks', 'order',
        ]

    def validate(self, attrs):
        start_time = attrs.get('start_time')
        end_time = attrs.get('end_time')
        if start_time and end_time and end_time <= start_time:
            raise serializers.ValidationError({'end_time': 'End time must be later than start time.'})
        max_marks = attrs.get('max_marks')
        if max_marks is not None and max_marks < 1:
            raise serializers.ValidationError({'max_marks': 'Maximum marks must be at least 1.'})
        return attrs


class ExamScheduleSerializer(serializers.ModelSerializer):
    items = ExamScheduleItemSerializer(many=True, required=False)
    sections = serializers.SerializerMethodField()
    classroom_name = serializers.CharField(source='classroom.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    class_name = serializers.CharField(required=False)

    marks_entry_days = serializers.IntegerField(required=False, default=3)
    marks_entry_deadline = serializers.DateTimeField(required=False, allow_null=True)
    marks_entry_extended = serializers.BooleanField(read_only=True)
    marks_entry_extension_reason = serializers.CharField(read_only=True)
    marks_entry_extended_at = serializers.DateTimeField(read_only=True)
    marks_entry_status = serializers.SerializerMethodField()
    marks_entry_is_open = serializers.SerializerMethodField()
    marks_entry_effective_deadline = serializers.SerializerMethodField()
    exam_completion_date = serializers.SerializerMethodField()
    is_teacher_assigned = serializers.SerializerMethodField()
    teacher_assigned_sections = serializers.SerializerMethodField()
    teacher_assigned_subjects = serializers.SerializerMethodField()
    section_extensions = serializers.JSONField(read_only=True)

    class Meta:
        model = ExamSchedule
        fields = [
            'id', 'name', 'classroom', 'classroom_name', 'class_name',
            'school_name',
            'academic_year', 'status', 'published_at',
            'hall_tickets_generated', 'hall_tickets_released', 'hall_tickets_released_at',
            'marks_published', 'marks_published_at',
            'report_cards_generated', 'report_cards_published', 'report_cards_published_at',
            'marks_entry_days', 'marks_entry_deadline', 'marks_entry_extended',
            'marks_entry_extension_reason', 'marks_entry_extended_at',
            'marks_entry_status', 'marks_entry_is_open', 'marks_entry_effective_deadline',
            'exam_completion_date',
            'is_teacher_assigned', 'teacher_assigned_sections', 'teacher_assigned_subjects',
            'section_extensions',
            'items', 'sections',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def _get_teacher_scope(self):
        if '_teacher_scope_cache' in self.context:
            return self.context['_teacher_scope_cache']
        req = self.context.get('request')
        user = getattr(req, 'user', None)
        if not user or (getattr(user, 'role', '') or '').lower() != 'teacher':
            self.context['_teacher_scope_cache'] = None
            return None
        teacher = getattr(user, 'teacher_profile', None)
        if not teacher:
            self.context['_teacher_scope_cache'] = None
            return None

        ta_list = list(teacher.teaching_assignments.select_related('section', 'section__class_room', 'subject').all())
        sec_list = list(teacher.sections.select_related('class_room').all())
        sub_list = list(teacher.subject_records.filter(school_id=user.school_id).values_list('name', flat=True))

        scope = {
            'teacher': teacher,
            'teaching_assignments': ta_list,
            'sections': sec_list,
            'subject_names': sub_list,
            'assigned_sections': list(teacher.assigned_sections or []),
            'subjects': list(teacher.subjects or []),
        }
        self.context['_teacher_scope_cache'] = scope
        return scope

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_sections(self, obj):
        if not obj.classroom:
            return []
        if hasattr(obj.classroom, '_prefetched_objects_cache') and 'sections' in obj.classroom._prefetched_objects_cache:
            secs = [s for s in obj.classroom.sections.all() if getattr(s, 'school_id', None) == obj.school_id]
            return [s.name for s in sorted(secs, key=lambda x: x.name)]
        return list(obj.classroom.sections.filter(school_id=obj.school_id).values_list('name', flat=True).order_by('name'))

    @extend_schema_field(serializers.BooleanField())
    def get_is_teacher_assigned(self, obj):
        scope = self._get_teacher_scope()
        if not scope:
            return False
        c_id = obj.classroom_id
        c_name_lower = (obj.class_name or '').lower()
        for ta in scope['teaching_assignments']:
            sec = ta.section
            if sec:
                if c_id and sec.class_room_id == c_id:
                    return True
                if sec.class_room and sec.class_room.name.lower() == c_name_lower:
                    return True
        for sec in scope['sections']:
            if c_id and sec.class_room_id == c_id:
                return True
            if sec.class_room and sec.class_room.name.lower() == c_name_lower:
                return True
        for sec_str in scope['assigned_sections']:
            s_clean = str(sec_str).strip().lower()
            if c_name_lower and (c_name_lower in s_clean or s_clean in c_name_lower):
                return True
        return False

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_teacher_assigned_sections(self, obj):
        scope = self._get_teacher_scope()
        if not scope:
            return []
        c_id = obj.classroom_id
        c_name_lower = (obj.class_name or '').lower()
        secs = set()
        for ta in scope['teaching_assignments']:
            sec = ta.section
            if sec:
                if (c_id and sec.class_room_id == c_id) or (sec.class_room and sec.class_room.name.lower() == c_name_lower):
                    secs.add(sec.name)
        for sec in scope['sections']:
            if (c_id and sec.class_room_id == c_id) or (sec.class_room and sec.class_room.name.lower() == c_name_lower):
                secs.add(sec.name)
        all_classroom_secs = set(self.get_sections(obj))
        for s_str in scope['assigned_sections']:
            s_val = str(s_str).strip()
            if s_val in all_classroom_secs:
                secs.add(s_val)
        return sorted(list(secs))

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_teacher_assigned_subjects(self, obj):
        scope = self._get_teacher_scope()
        if not scope:
            return []
        c_id = obj.classroom_id
        c_name_lower = (obj.class_name or '').lower()
        subs = set()
        for ta in scope['teaching_assignments']:
            sec = ta.section
            if sec and ((c_id and sec.class_room_id == c_id) or (sec.class_room and sec.class_room.name.lower() == c_name_lower)):
                if ta.subject and ta.subject.name:
                    subs.add(ta.subject.name)
        subs.update(scope['subject_names'])
        subs.update([str(s).strip() for s in scope['subjects'] if str(s).strip()])
        item_sub_names = {it.subject_name.lower(): it.subject_name for it in obj.items.all() if it.subject_name}
        matching = []
        for s in subs:
            if s.lower() in item_sub_names and item_sub_names[s.lower()] not in matching:
                matching.append(item_sub_names[s.lower()])
        return sorted(matching)

    def _get_marks_window(self, obj):
        if not hasattr(obj, '_cached_window'):
            req = self.context.get('request')
            user = getattr(req, 'user', None)
            obj._cached_window = obj.check_marks_entry_window(user)
        return obj._cached_window

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_marks_entry_effective_deadline(self, obj):
        dl = obj.get_marks_entry_deadline()
        return dl.isoformat() if dl else None

    @extend_schema_field(serializers.CharField())
    def get_marks_entry_status(self, obj):
        win = self._get_marks_window(obj)
        if win.get('is_extended'):
            return 'extended' if win.get('is_open') else 'expired'
        if win.get('is_open'):
            return 'open'
        if not win.get('is_completed'):
            return 'upcoming'
        return 'expired'

    @extend_schema_field(serializers.BooleanField())
    def get_marks_entry_is_open(self, obj):
        return self._get_marks_window(obj)['is_open']

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_exam_completion_date(self, obj):
        dt = obj.get_latest_exam_end_datetime()
        return dt.date().isoformat() if dt else None

    def validate(self, attrs):
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        classroom = attrs.get('classroom', getattr(self.instance, 'classroom', None))
        if classroom and school_id and classroom.school_id != school_id:
            raise serializers.ValidationError({'classroom': 'Classroom does not belong to your school.'})
        if classroom:
            attrs['class_name'] = classroom.name
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        schedule = ExamSchedule.objects.create(**validated_data)
        for index, item_data in enumerate(items_data):
            item_data.setdefault('order', index)
            ExamScheduleItem.objects.create(schedule=schedule, **item_data)
        return schedule

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if items_data is not None:
            existing_ids = set()
            for index, item_data in enumerate(items_data):
                item_id = item_data.get('id')
                if item_id and instance.items.filter(id=item_id).exists():
                    item = instance.items.get(id=item_id)
                    for k, v in item_data.items():
                        if k != 'id':
                            setattr(item, k, v)
                    if 'order' not in item_data:
                        item.order = index
                    item.save()
                    existing_ids.add(item.id)
                else:
                    item_data.pop('id', None)
                    item_data.setdefault('order', index)
                    new_item = ExamScheduleItem.objects.create(schedule=instance, **item_data)
                    existing_ids.add(new_item.id)
            instance.items.exclude(id__in=existing_ids).delete()

        return instance


class ExamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exam
        fields = ['id', 'schedule', 'name', 'class_name', 'section', 'subject', 'date', 'time', 'end_time', 'max_marks', 'marks_entry_deadline']

    def validate(self, attrs):
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        class_name = attrs.get('class_name', getattr(self.instance, 'class_name', '')).strip()
        section_name = attrs.get('section', getattr(self.instance, 'section', '')).strip()
        subject_name = attrs.get('subject', getattr(self.instance, 'subject', '')).strip()

        classroom = Class.objects.filter(school_id=school_id, name__iexact=class_name).first()
        if not classroom:
            raise serializers.ValidationError({'class_name': 'Select a class created in Academic Setup.'})
        section = Section.objects.filter(
            school_id=school_id, class_room=classroom, name__iexact=section_name,
        ).first()
        if not section:
            raise serializers.ValidationError({'section': 'Select a section assigned to this class.'})
        subject = Subject.objects.filter(school_id=school_id, name__iexact=subject_name).first()
        if not subject:
            raise serializers.ValidationError({'subject': 'Select a subject created by the School Admin.'})
        if not classroom.subjects.filter(pk=subject.pk).exists():
            raise serializers.ValidationError({'subject': 'Select a subject assigned to this class in Academic Setup.'})

        attrs['class_name'] = classroom.name
        attrs['section'] = section.name
        attrs['subject'] = subject.name
        return attrs


class ExamResultSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    admission_no = serializers.CharField(source='student.admission_no', read_only=True)
    exam_id = serializers.IntegerField(source='exam.id', read_only=True)
    exam_name = serializers.CharField(source='exam.name', read_only=True)
    subject = serializers.CharField(source='exam.subject', read_only=True)
    max_marks = serializers.IntegerField(source='exam.max_marks', read_only=True)
    exam_date = serializers.DateField(source='exam.date', read_only=True)

    class Meta:
        model = ExamResult
        fields = ['student', 'student_name', 'admission_no', 'exam_id', 'exam_name', 'subject', 'max_marks', 'exam_date', 'marks_obtained', 'remarks', 'status', 'submitted_at']
