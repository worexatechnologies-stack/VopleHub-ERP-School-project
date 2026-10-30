from rest_framework import serializers
from typing import List, Optional
from .models import User

ROLE_MODULES = {
    'super_admin': ['super-admin-dashboard', 'super-admin-schools', 'super-admin-admins', 'super-admin-audit', 'super-admin-sys-settings', 'academic'],
    'school_admin': ['dashboard', 'student', 'teachers', 'passwords', 'academic', 'attendance', 'fees', 'exams', 'promotion', 'communication', 'library', 'transport', 'store', 'developer'],
    'teacher': ['dashboard', 'student', 'academic', 'attendance', 'learning', 'exams', 'communication', 'store'],
    'parent': ['dashboard', 'academic', 'attendance', 'learning', 'fees', 'exams', 'communication', 'transport', 'store'],
    'student': ['dashboard', 'academic', 'learning', 'exams', 'communication', 'transport', 'store'],
    'public_learner': ['public-learning'],
}

class UserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    schoolId = serializers.CharField(source='school_id', read_only=True)
    schoolName = serializers.CharField(source='school.name', read_only=True)
    isActive = serializers.BooleanField(source='is_active', read_only=True)
    mustChangePassword = serializers.BooleanField(source='must_change_password', read_only=True)
    studentId = serializers.SerializerMethodField()
    parentStudentIds = serializers.SerializerMethodField()
    teacherId = serializers.SerializerMethodField()
    managedClasses = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    class Meta:
        model = User
        fields = ['id', 'email', 'name', 'role', 'schoolId', 'schoolName', 'isActive', 'mustChangePassword', 'studentId', 'parentStudentIds', 'teacherId', 'managedClasses', 'permissions']
    def get_name(self, obj) -> str:
        return obj.get_full_name() or obj.username
    def get_permissions(self, obj) -> List[str]:
        return obj.permissions_override or ROLE_MODULES.get(obj.role, [])
    def get_studentId(self, obj) -> Optional[str]:
        if obj.role != User.Role.STUDENT:
            return None
        profile = getattr(obj, 'student_profile', None)
        return str(profile.student_id) if profile else None

    def get_parentStudentIds(self, obj) -> List[str]:
        if obj.role != User.Role.PARENT:
            return []
        profile = getattr(obj, 'parent_profile', None)
        return [str(student.pk) for student in profile.students.all()] if profile else []

    def get_teacherId(self, obj) -> Optional[int]:
        if obj.role != User.Role.TEACHER:
            return None
        prof = getattr(obj, 'teacher_profile', None)
        return prof.id if prof else None

    def get_managedClasses(self, obj) -> List[dict]:
        if obj.role != User.Role.TEACHER:
            return []
        prof = getattr(obj, 'teacher_profile', None)
        if not prof:
            return []
        classes = [
            {'id': classroom.id, 'name': classroom.name, 'code': classroom.code}
            for classroom in prof.managed_classes.all()
        ]
        for sec in prof.managed_sections.all():
            if not any(c['id'] == sec.class_room_id for c in classes):
                classes.append({'id': sec.class_room_id, 'name': f"{sec.class_room.name} ({sec.name})", 'code': sec.class_room.code})
        return classes


class UserCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['email', 'username', 'first_name', 'last_name', 'role', 'school']

    def validate_role(self, value):
        if value in [User.Role.STUDENT, User.Role.PARENT]:
            raise serializers.ValidationError('Student and parent users can only be created through POST /api/v1/students/ admission.')
        if value == User.Role.TEACHER:
            raise serializers.ValidationError('Teacher users can only be created through POST /api/v1/teachers/.')
        return value


class CredentialVaultSerializer(serializers.ModelSerializer):
    schoolId = serializers.IntegerField(source='school_id', read_only=True)
    schoolName = serializers.CharField(source='school.name', read_only=True)
    userId = serializers.IntegerField(source='user_id', read_only=True)
    loginId = serializers.CharField(source='login_id')
    className = serializers.CharField(source='class_name', allow_blank=True, required=False)
    academicYear = serializers.CharField(source='academic_year', allow_blank=True, required=False)
    linkedStudentName = serializers.CharField(source='linked_student_name', allow_blank=True, required=False)
    mustChangePassword = serializers.BooleanField(source='must_change_password', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        from .models import CredentialVaultRecord
        model = CredentialVaultRecord
        fields = [
            'id',
            'schoolId',
            'schoolName',
            'userId',
            'role',
            'name',
            'loginId',
            'identifier',
            'className',
            'section',
            'academicYear',
            'phone',
            'linkedStudentName',
            'source',
            'mustChangePassword',
            'createdAt',
            'updatedAt',
        ]

