from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from apps.finance.models import FeeStructure, FeeQuarter, StudentFeeRecord, FeePayment, FeePaymentSettings, FeePaymentOrder
from apps.academics.models import Class, Section, AcademicYear
from apps.sis.models import Student

class FeeQuarterSerializer(serializers.ModelSerializer):
    fee_structure_id = serializers.IntegerField(source='fee_structure.id', read_only=True)
    quarter_code = serializers.SerializerMethodField()

    class Meta:
        model = FeeQuarter
        fields = '__all__'

    @extend_schema_field(serializers.CharField())
    def get_quarter_code(self, obj):
        return f"Q{obj.quarter_number}"

class FeeStructureSerializer(serializers.ModelSerializer):
    quarter_records = FeeQuarterSerializer(many=True, read_only=True)
    target_class_id = serializers.IntegerField(source='target_class_ref_id', required=False, allow_null=True)
    target_section_id = serializers.IntegerField(source='target_section_ref_id', required=False, allow_null=True)
    academic_year_id = serializers.IntegerField(source='academic_year_ref_id', required=False, allow_null=True)
    total_amount = serializers.FloatField(read_only=True)

    class Meta:
        model = FeeStructure
        fields = [
            'id', 'school', 'name', 'academic_year', 'academic_year_id',
            'academic_year_ref', 'level',
            'target_class', 'target_class_id', 'target_class_ref',
            'target_section', 'target_section_id', 'target_section_ref',
            'target_student_id', 'target_student_ref',
            'items', 'quarters', 'quarter_records', 'total_amount',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'quarter_records']
        extra_kwargs = {
            'target_class_ref': {'read_only': True},
            'target_section_ref': {'read_only': True},
            'target_student_ref': {'read_only': True},
            'academic_year_ref': {'read_only': True},
        }

    def validate(self, attrs):
        user = self.context.get('request').user if self.context.get('request') else None
        if self.instance:
            target_school = self.instance.school
            requested_school = attrs.get('school')
            if requested_school and requested_school.pk != self.instance.school_id:
                raise serializers.ValidationError({'school': 'A fee structure cannot be moved to another school.'})
        elif user and getattr(user, 'role', None) == 'super_admin':
            target_school = attrs.get('school')
        else:
            target_school = getattr(user, 'school', None)
        if not target_school:
            raise serializers.ValidationError({'school': 'A school must be selected for this fee structure.'})

        target_class_id = attrs.get('target_class_ref_id')
        target_section_id = attrs.get('target_section_ref_id')
        academic_year_id = attrs.get('academic_year_ref_id')
        target_student_id = attrs.get('target_student_id')

        if target_section_id:
            sec = Section.objects.filter(pk=target_section_id, school=target_school).select_related('class_room').first()
            if not sec:
                raise serializers.ValidationError({'target_section_id': 'Section is not part of this school.'})
            attrs['target_section_ref'] = sec
            attrs['target_section'] = sec.name
            if not target_class_id:
                attrs['target_class_ref'] = sec.class_room
                attrs['target_class'] = sec.class_room.name
            elif sec.class_room_id != target_class_id:
                raise serializers.ValidationError({'target_class_id': 'Class and section must belong together.'})
        if target_class_id:
            cls_obj = Class.objects.filter(pk=target_class_id, school=target_school).first()
            if not cls_obj:
                raise serializers.ValidationError({'target_class_id': 'Class is not part of this school.'})
            attrs['target_class_ref'] = cls_obj
            attrs['target_class'] = cls_obj.name

        if academic_year_id:
            ay_obj = AcademicYear.objects.filter(pk=academic_year_id, school=target_school).first()
            if not ay_obj:
                raise serializers.ValidationError({'academic_year_id': 'Academic year is not part of this school.'})
            attrs['academic_year_ref'] = ay_obj
            attrs['academic_year'] = ay_obj.name

        if target_student_id:
            st_qs = Student.objects.filter(school=target_school)
            st_obj = st_qs.filter(pk=target_student_id).first() if str(target_student_id).isdigit() else st_qs.filter(admission_no=target_student_id).first()
            if not st_obj:
                raise serializers.ValidationError({'target_student_id': 'Student is not part of this school.'})
            attrs['target_student_ref'] = st_obj
            attrs['target_student_id'] = str(st_obj.id)

        return attrs


class StudentFeeRecordSerializer(serializers.ModelSerializer):
    school = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = StudentFeeRecord
        fields = '__all__'

    def validate(self, attrs):
        student = attrs.get('student')
        if student is None and self.instance:
            student = self.instance.student
        user = self.context.get('request').user if self.context.get('request') else None
        school_id = self.instance.school_id if self.instance else getattr(user, 'school_id', None)
        if user and getattr(user, 'role', None) == 'super_admin' and student:
            school_id = student.school_id
        if not school_id:
            raise serializers.ValidationError({'school': 'A school context is required for fee records.'})
        if student and student.school_id != school_id:
            raise serializers.ValidationError({'student': 'Student must belong to this school.'})
        return attrs

class FeePaymentSettingsSerializer(serializers.ModelSerializer):
    keyId = serializers.CharField(source='key_id', required=False, allow_blank=True)
    testMode = serializers.BooleanField(source='test_mode', required=False)
    keySecret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    webhookSecret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    keySecretConfigured = serializers.SerializerMethodField()
    webhookSecretConfigured = serializers.SerializerMethodField()
    isConnected = serializers.BooleanField(source='is_connected', read_only=True)
    webhookUrl = serializers.SerializerMethodField()
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = FeePaymentSettings
        fields = [
            'id', 'keyId', 'testMode', 'enabled', 'keySecret', 'webhookSecret',
            'keySecretConfigured', 'webhookSecretConfigured', 'isConnected',
            'webhookUrl', 'updatedAt'
        ]

    def get_keySecretConfigured(self, obj) -> bool:
        return bool(obj.encrypted_key_secret)

    def get_webhookSecretConfigured(self, obj) -> bool:
        return bool(obj.encrypted_webhook_secret)

    def get_webhookUrl(self, obj) -> str:
        request = self.context.get('request')
        path = '/api/v1/fee-structures/payments/webhook/'
        if request:
            return request.build_absolute_uri(path)
        return path

    def validate(self, attrs):
        key_id = attrs.get('key_id', getattr(self.instance, 'key_id', '') if self.instance else '')
        test_mode = attrs.get('test_mode', getattr(self.instance, 'test_mode', True) if self.instance else True)
        enabled = attrs.get('enabled', getattr(self.instance, 'enabled', False) if self.instance else False)
        if enabled and key_id:
            expected_prefix = 'rzp_test_' if test_mode else 'rzp_live_'
            if not key_id.startswith(expected_prefix):
                mode_str = 'Test mode' if test_mode else 'Live mode'
                raise serializers.ValidationError({
                    'keyId': f"Invalid Key ID for {mode_str}. Key must start with '{expected_prefix}'."
                })
        return attrs

    def update(self, instance, validated_data):
        key_secret = self.initial_data.get('keySecret') or self.initial_data.get('key_secret')
        webhook_secret = self.initial_data.get('webhookSecret') or self.initial_data.get('webhook_secret')
        if key_secret:
            instance.set_key_secret(key_secret.strip())
        if webhook_secret:
            instance.set_webhook_secret(webhook_secret.strip())
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            instance.updated_by = request.user
        return super().update(instance, validated_data)


class FeePaymentSerializer(serializers.ModelSerializer):
    school = serializers.PrimaryKeyRelatedField(read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True)
    admission_no = serializers.CharField(source='student.admission_no', read_only=True)
    class_name = serializers.CharField(source='student.class_name', read_only=True)
    section_name = serializers.CharField(source='student.section', read_only=True)
    parent_name = serializers.CharField(source='student.parent_name', read_only=True)

    class Meta:
        model = FeePayment
        fields = '__all__'

    def validate(self, attrs):
        user = self.context.get('request').user if self.context.get('request') else None
        student = attrs.get('student', self.instance.student if self.instance else None)
        fee_record = attrs.get('fee_record', self.instance.fee_record if self.instance else None)
        fee_structure = attrs.get('fee_structure', self.instance.fee_structure if self.instance else None)
        quarter = attrs.get('quarter', self.instance.quarter if self.instance else None)
        school_id = self.instance.school_id if self.instance else getattr(user, 'school_id', None)
        if user and getattr(user, 'role', None) == 'super_admin' and student:
            school_id = student.school_id
        if not school_id:
            raise serializers.ValidationError({'school': 'A school context is required for payments.'})
        if student and student.school_id != school_id:
            raise serializers.ValidationError({'student': 'Student must belong to this school.'})
        if fee_record and (fee_record.school_id != school_id or (student and fee_record.student_id != student.pk)):
            raise serializers.ValidationError({'fee_record': 'Fee record must belong to this school and student.'})
        if fee_structure and fee_structure.school_id != school_id:
            raise serializers.ValidationError({'fee_structure': 'Fee structure must belong to this school.'})
        if quarter and quarter.fee_structure.school_id != school_id:
            raise serializers.ValidationError({'quarter': 'Fee quarter must belong to this school.'})
        if quarter and fee_structure and quarter.fee_structure_id != fee_structure.pk:
            raise serializers.ValidationError({'quarter': 'Fee quarter must belong to the selected fee structure.'})
        return attrs


class FeePaymentOrderSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    admission_no = serializers.CharField(source='student.admission_no', read_only=True)
    class_name = serializers.CharField(source='student.class_name', read_only=True)
    section_name = serializers.CharField(source='student.section', read_only=True)

    class Meta:
        model = FeePaymentOrder
        fields = '__all__'
