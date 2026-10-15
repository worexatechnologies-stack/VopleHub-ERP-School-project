from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from .models import AttendanceRecord, AttendanceAuditLog


class AttendanceAuditLogSerializer(serializers.ModelSerializer):
    changedByName = serializers.SerializerMethodField()
    studentId = serializers.IntegerField(source='student_id', read_only=True)
    studentName = serializers.SerializerMethodField()
    subjectName = serializers.SerializerMethodField()
    dayOfWeek = serializers.CharField(source='day_of_week', read_only=True)

    class Meta:
        model = AttendanceAuditLog
        fields = ['id', 'studentId', 'studentName', 'period', 'subjectName', 'dayOfWeek', 'old_status', 'new_status', 'changedByName', 'reason', 'created_at']

    def get_changedByName(self, obj) -> str:
        if not obj.changed_by:
            return 'System'
        return obj.changed_by.get_full_name() or obj.changed_by.email

    def get_studentName(self, obj) -> str:
        return getattr(obj.student, 'name', '') if obj.student else ''

    def get_subjectName(self, obj) -> str:
        return getattr(obj.subject, 'name', '') if obj.subject else ''


class AttendanceRecordSerializer(serializers.ModelSerializer):
    studentId = serializers.IntegerField(source='student_id', read_only=True)
    studentName = serializers.SerializerMethodField()
    dayOfWeek = serializers.SerializerMethodField()
    subjectId = serializers.IntegerField(source='subject_id', read_only=True, allow_null=True)
    subjectName = serializers.SerializerMethodField()
    teacherId = serializers.IntegerField(source='subject_teacher_id', read_only=True, allow_null=True)
    teacherName = serializers.SerializerMethodField()
    timeLabel = serializers.CharField(source='time_label', read_only=True)
    markedByName = serializers.SerializerMethodField()
    auditLogs = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRecord
        fields = [
            'id', 'studentId', 'studentName', 'date', 'dayOfWeek', 'period', 'timeLabel',
            'subjectId', 'subjectName', 'teacherId', 'teacherName',
            'status', 'marked_by', 'markedByName', 'updated_at', 'auditLogs',
        ]

    @extend_schema_field(AttendanceAuditLogSerializer(many=True))
    def get_auditLogs(self, obj):
        if hasattr(obj, '_prefetched_objects_cache') and 'audit_logs' in obj._prefetched_objects_cache:
            return AttendanceAuditLogSerializer(obj.audit_logs.all(), many=True).data
        return []

    def get_dayOfWeek(self, obj) -> str:
        if obj.day_of_week:
            return obj.day_of_week
        return obj.date.strftime('%A') if obj.date else ''

    def get_studentName(self, obj) -> str:
        return getattr(obj.student, 'name', '') if obj.student else ''

    def get_subjectName(self, obj) -> str:
        return getattr(obj.subject, 'name', '') if obj.subject else ''

    def get_teacherName(self, obj) -> str:
        if not obj.subject_teacher:
            return ''
        if obj.subject_teacher.user:
            return obj.subject_teacher.user.get_full_name() or obj.subject_teacher.user.email
        return f'Teacher #{obj.subject_teacher.id}'

    def get_markedByName(self, obj) -> str:
        if not obj.marked_by:
            return ''
        return obj.marked_by.get_full_name() or obj.marked_by.email
