from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from apps.finance.models import FeeStructure, FeeQuarter, StudentFeeRecord, FeePayment
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
        target_class_id = attrs.get('target_class_ref_id')
        target_section_id = attrs.get('target_section_ref_id')
        academic_year_id = attrs.get('academic_year_ref_id')
        target_student_id = attrs.get('target_student_id')

        if target_section_id:
            sec = Section.objects.filter(pk=target_section_id).select_related('class_room').first()
            if sec:
                attrs['target_section_ref'] = sec
                attrs['target_section'] = sec.name
                if not target_class_id:
                    attrs['target_class_ref'] = sec.class_room
                    attrs['target_class'] = sec.class_room.name
        if target_class_id:
            cls_obj = Class.objects.filter(pk=target_class_id).first()
            if cls_obj:
                attrs['target_class_ref'] = cls_obj
                attrs['target_class'] = cls_obj.name

        if academic_year_id:
            ay_obj = AcademicYear.objects.filter(pk=academic_year_id).first()
            if ay_obj:
                attrs['academic_year_ref'] = ay_obj
                attrs['academic_year'] = ay_obj.name

        if target_student_id:
            st_obj = Student.objects.filter(pk=target_student_id).first() if str(target_student_id).isdigit() else Student.objects.filter(admission_no=target_student_id).first()
            if st_obj:
                attrs['target_student_ref'] = st_obj
                attrs['target_student_id'] = str(st_obj.id)

        return attrs


class StudentFeeRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentFeeRecord
        fields = '__all__'

class FeePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeePayment
        fields = '__all__'
