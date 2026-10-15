from rest_framework import serializers
from pathlib import Path

from apps.academics.models import AcademicYear, Section
from apps.common.validators import detected_content_type, optimize_raster_image, validate_student_document, validate_student_photo
from .models import Student, StudentDocument, AcademicHistory, EnrollmentLink, EnrollmentApplication

class DocumentSerializer(serializers.ModelSerializer):
    fileType = serializers.CharField(source='file_type')
    fileName = serializers.CharField(source='file_name', read_only=True)
    uploadedAt = serializers.DateTimeField(source='created_at', read_only=True)
    verifiedAt = serializers.DateTimeField(source='verified_at', read_only=True)
    downloadUrl = serializers.SerializerMethodField()

    def get_downloadUrl(self, obj) -> str:
        return f'/api/v1/students/{obj.student_id}/documents/{obj.id}/'

    class Meta:
        model = StudentDocument
        fields = ['id', 'name', 'category', 'status', 'remarks', 'fileType', 'fileName', 'uploadedAt', 'verifiedAt', 'downloadUrl']


class StudentDocumentUploadSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=160, required=False)
    category = serializers.CharField(max_length=64, required=False, default='Aadhaar Card')
    file = serializers.FileField()

    def validate_file(self, value):
        validate_student_document(value)
        return value

    def create(self, validated_data):
        from apps.common.storage import save_file, student_document_key
        upload = validated_data['file']
        content_type = detected_content_type(upload)
        upload.seek(0)
        file_bytes = upload.read()
        file_size = len(file_bytes)
        category = validated_data.get('category') or 'Aadhaar Card'
        name = validated_data.get('name') or category
        student = self.context['student']
        target_key = student_document_key(student.school_id, student.pk, upload.name)
        save_file(file_bytes, target_key)
        return StudentDocument.objects.create(
            student=student,
            name=name,
            category=category,
            file_key=target_key,
            file_size=file_size,
            file_data=file_bytes,
            file_content_type=content_type,
            file_name=Path(upload.name).name[:255],
            file_type={
                'application/pdf': 'PDF',
                'image/jpeg': 'JPG',
                'image/png': 'PNG',
            }.get(content_type, 'PDF'),
            status=StudentDocument.Status.PENDING,
        )
class HistorySerializer(serializers.ModelSerializer):
    academicYear = serializers.CharField(source='academic_year'); className = serializers.CharField(source='class_name', read_only=True)
    class Meta: model = AcademicHistory; fields = ['academicYear', 'className', 'section', 'gpa', 'attendance', 'status']


class TeacherStudentSerializer(serializers.ModelSerializer):
    """Privacy-minimized student profile exposed to an assigned teacher.

    Teachers need enough information to identify a learner, understand their
    current placement, and contact a guardian.  Financial data, medical notes,
    guardian email addresses, documents, and historical records deliberately
    remain available only through the more privileged/self-service serializer.
    """

    admissionNo = serializers.CharField(source='admission_no', read_only=True)
    className = serializers.CharField(source='class_name', read_only=True)
    sectionId = serializers.IntegerField(source='section_record_id', read_only=True)
    rollNo = serializers.IntegerField(source='roll_no', read_only=True)
    parentName = serializers.CharField(source='parent_name', read_only=True)
    parentPhone = serializers.CharField(source='parent_phone', read_only=True)
    academicYear = serializers.CharField(source='academic_year', read_only=True)
    photoUrl = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = [
            'id', 'admissionNo', 'name', 'photoUrl', 'className', 'section',
            'sectionId', 'rollNo', 'dob', 'gender', 'status', 'academicYear',
            'parentName', 'parentPhone',
        ]
        read_only_fields = fields

    def get_photoUrl(self, obj) -> str | None:
        # Teacher collection/detail queries intentionally defer the potentially
        # large bytea column. The content type is set atomically with the bytes.
        if not obj.photo_content_type:
            return None
        return f'/api/v1/students/{obj.pk}/photo/'

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['class'] = data.pop('className')
        return data


class StudentSerializer(serializers.ModelSerializer):
    admissionNo = serializers.CharField(source='admission_no'); class_ = serializers.CharField(source='class_name', required=False); rollNo = serializers.IntegerField(source='roll_no')
    section = serializers.CharField(required=False)
    parentName = serializers.CharField(source='parent_name'); parentPhone = serializers.CharField(source='parent_phone'); parentEmail = serializers.EmailField(source='parent_email')
    academicYear = serializers.CharField(source='academic_year'); attendancePercentage = serializers.DecimalField(source='attendance_percentage', max_digits=5, decimal_places=2, required=False); feeTotal = serializers.DecimalField(source='fee_total', max_digits=12, decimal_places=2, required=False); feePaid = serializers.DecimalField(source='fee_paid', max_digits=12, decimal_places=2, required=False)
    documents = DocumentSerializer(many=True, read_only=True); history = HistorySerializer(many=True, read_only=True)
    photoUrl = serializers.SerializerMethodField()
    # Let the shared byte-signature/Pillow validator handle WebP consistently
    # with teacher and school image uploads.
    photo = serializers.FileField(write_only=True, required=False, allow_null=True)
    sectionId = serializers.PrimaryKeyRelatedField(source='section_record', queryset=Section.objects.select_related('class_room'), required=False, allow_null=True)
    classId = serializers.SerializerMethodField()
    class Meta:
        model = Student
        fields = ['id', 'admissionNo', 'name', 'photoUrl', 'photo', 'class_', 'classId', 'section', 'sectionId', 'rollNo', 'parentName', 'parentPhone', 'parentEmail', 'dob', 'gender', 'address', 'medical_conditions', 'status', 'academicYear', 'attendancePercentage', 'feeTotal', 'feePaid', 'gpa', 'documents', 'history']

    def get_classId(self, obj) -> int | None:
        if obj.section_record_id and obj.section_record:
            return obj.section_record.class_room_id
        return None

    def get_photoUrl(self, obj) -> str | None:
        if not getattr(obj, 'photo_content_type', None) and not getattr(obj, 'photo_key', None):
            return None
        return f'/api/v1/students/{obj.pk}/photo/'

    def validate_photo(self, value):
        validate_student_photo(value)
        return value

    @staticmethod
    def _store_photo(instance, photo):
        from apps.common.storage import save_file, delete_file, student_photo_key
        if photo is None:
            if instance.photo_key:
                delete_file(instance.photo_key)
            instance.photo_key = ''
            instance.photo_data = None
            instance.photo_content_type = ''
        else:
            optimized_bytes, content_type, _ = optimize_raster_image(photo)
            target_key = student_photo_key(instance.school_id, instance.pk)
            save_file(optimized_bytes, target_key)
            instance.photo_key = target_key
            instance.photo_data = optimized_bytes
            instance.photo_content_type = content_type
        instance.save(update_fields=['photo_key', 'photo_data', 'photo_content_type'])

    def create(self, validated_data):
        photo = validated_data.pop('photo', serializers.empty)
        instance = super().create(validated_data)
        if photo is not serializers.empty:
            self._store_photo(instance, photo)
        return instance

    def update(self, instance, validated_data):
        photo = validated_data.pop('photo', serializers.empty)
        instance = super().update(instance, validated_data)
        if photo is not serializers.empty:
            self._store_photo(instance, photo)
        return instance
    def validate(self, attrs):
        request = self.context.get('request')
        school = getattr(getattr(request, 'user', None), 'school', None)
        section_record = attrs.get('section_record', getattr(self.instance, 'section_record', None))
        if section_record:
            if school and section_record.school_id != school.id:
                raise serializers.ValidationError({'sectionId': 'Select a section from your own school.'})
            attrs['class_name'] = section_record.class_room.name
            attrs['section'] = section_record.name
        else:
            raise serializers.ValidationError({'sectionId': 'Select a valid class section.'})

        academic_year_name = attrs.get('academic_year', getattr(self.instance, 'academic_year', '')).strip()
        academic_year = AcademicYear.objects.filter(
            school=school, name__iexact=academic_year_name,
        ).first() if school else None
        if school and not academic_year and not academic_year_name:
            academic_year = AcademicYear.objects.filter(school=school, is_active=True).first()
        if school and not academic_year:
            raise serializers.ValidationError({
                'academicYear': 'Select an academic year created in Academic Setup.',
            })
        if academic_year:
            attrs['academic_year'] = academic_year.name

        admission_no = attrs.get('admission_no', getattr(self.instance, 'admission_no', ''))
        duplicate = Student.objects.filter(
            school=school,
            admission_no=admission_no,
            academic_year=attrs.get('academic_year', academic_year_name),
        )
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if school and duplicate.exists():
            raise serializers.ValidationError({
                'admissionNo': 'This admission number is already used for the selected academic year.',
            })
        return attrs
    def validate_status(self, value):
        if self.instance is None and value != Student.Status.ACTIVE:
            raise serializers.ValidationError('New admission must start as Active.')
        return value
    def to_representation(self, instance):
        data = super().to_representation(instance); data['class'] = data.pop('class_'); data['medicalConditions'] = data.pop('medical_conditions'); return data


class EnrollmentLinkSerializer(serializers.ModelSerializer):
    targetClass = serializers.CharField(source='target_class', required=False, allow_blank=True, default='')
    academicYear = serializers.CharField(source='academic_year')
    durationMinutes = serializers.IntegerField(source='duration_minutes', default=1440)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    firstOpenedAt = serializers.DateTimeField(source='first_opened_at', read_only=True)
    isExpired = serializers.SerializerMethodField()
    remainingSeconds = serializers.SerializerMethodField()
    applicationCount = serializers.SerializerMethodField()
    schoolName = serializers.CharField(source='school.name', read_only=True)
    schoolCode = serializers.CharField(source='school.code', read_only=True)

    def get_isExpired(self, obj) -> bool:
        return obj.is_expired()

    def get_remainingSeconds(self, obj) -> int:
        return obj.remaining_seconds()

    def get_applicationCount(self, obj) -> int:
        return getattr(obj, 'applications', None).count() if hasattr(obj, 'applications') else 0

    class Meta:
        model = EnrollmentLink
        fields = [
            'id', 'token', 'title', 'targetClass', 'academicYear',
            'durationMinutes', 'createdAt', 'firstOpenedAt', 'is_active',
            'isExpired', 'remainingSeconds', 'applicationCount', 'schoolName', 'schoolCode',
        ]
        read_only_fields = ['id', 'token', 'createdAt', 'firstOpenedAt', 'is_active']


class EnrollmentApplicationSerializer(serializers.ModelSerializer):
    applicationNo = serializers.CharField(source='application_no', read_only=True)
    className = serializers.CharField(source='class_name')
    parentName = serializers.CharField(source='parent_name')
    parentPhone = serializers.CharField(source='parent_phone')
    parentEmail = serializers.EmailField(source='parent_email')
    bloodGroup = serializers.CharField(source='blood_group', required=False, allow_blank=True, default='')
    aadhaarNo = serializers.CharField(source='aadhaar_no', required=False, allow_blank=True, default='')
    medicalConditions = serializers.CharField(source='medical_conditions', required=False, allow_blank=True, default='')
    academicYear = serializers.CharField(source='academic_year')
    provisionalUsername = serializers.CharField(source='provisional_username', read_only=True)
    provisionalEmail = serializers.CharField(source='provisional_email', read_only=True)
    submittedAt = serializers.DateTimeField(source='submitted_at', read_only=True)
    approvedAt = serializers.DateTimeField(source='approved_at', read_only=True)
    approvedBy = serializers.CharField(source='approved_by.username', read_only=True, default=None)
    rejectionRemarks = serializers.CharField(source='rejection_remarks', required=False, allow_blank=True, default='')
    createdStudentId = serializers.IntegerField(source='created_student.id', read_only=True, default=None)
    hasPhoto = serializers.SerializerMethodField()
    photoUrl = serializers.SerializerMethodField()
    hasDocument = serializers.SerializerMethodField()
    documentUrl = serializers.SerializerMethodField()
    documentName = serializers.CharField(source='document_name', read_only=True)
    documentCategory = serializers.CharField(source='document_category', read_only=True)

    def get_hasPhoto(self, obj) -> bool:
        return bool(getattr(obj, 'photo_content_type', ''))

    def get_photoUrl(self, obj) -> str | None:
        if not getattr(obj, 'photo_content_type', ''):
            return None
        return f'/api/v1/enrollment-applications/{obj.pk}/photo/'

    def get_hasDocument(self, obj) -> bool:
        return bool(getattr(obj, 'document_name', '') or getattr(obj, 'document_content_type', ''))

    def get_documentUrl(self, obj) -> str | None:
        if not (getattr(obj, 'document_name', '') or getattr(obj, 'document_content_type', '')):
            return None
        return f'/api/v1/enrollment-applications/{obj.pk}/document/'

    class Meta:
        model = EnrollmentApplication
        fields = [
            'id', 'applicationNo', 'name', 'className', 'section', 'dob',
            'gender', 'bloodGroup', 'parentName', 'parentPhone', 'parentEmail',
            'address', 'aadhaarNo', 'medicalConditions', 'academicYear',
            'provisionalUsername', 'provisionalEmail', 'status', 'submittedAt',
            'approvedAt', 'approvedBy', 'rejectionRemarks', 'createdStudentId',
            'hasPhoto', 'photoUrl', 'hasDocument', 'documentUrl', 'documentName', 'documentCategory',
        ]


