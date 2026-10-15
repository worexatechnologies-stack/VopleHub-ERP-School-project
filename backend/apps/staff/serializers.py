from pathlib import Path

from rest_framework import serializers

from apps.academics.models import Section, Subject
from apps.accounts.models import User
from apps.common.validators import (
    detected_content_type,
    optimize_raster_image,
    validate_student_document,
    validate_student_photo,
)

from .models import Teacher, TeacherDocument, TeacherTeachingAssignment, StaffSalaryPayment


def validate_teaching_scope(serializer, attrs):
    """Subjects must be configured for at least one assigned class."""
    instance = getattr(serializer, 'instance', None)
    if instance is not None and not {'sections', 'subject_records'}.intersection(attrs):
        return attrs

    sections = list(attrs.get('sections', instance.sections.all() if instance else []))
    subjects = list(attrs.get('subject_records', instance.subject_records.all() if instance else []))
    if not sections:
        raise serializers.ValidationError({
            'assignedSectionIds': 'Assign at least one class section to this teacher.',
        })

    # Derive the tenant from the sections the caller is assigning. Every
    # section has already passed the school-boundary validator, so all belong
    # to one tenant. Explicitly filtering subjects by that tenant prevents a
    # corrupted/legacy M2M row from ever crossing a school boundary.
    tenant_id = sections[0].school_id if sections else getattr(
        getattr(getattr(serializer, 'instance', None), 'school_id', None), None, None,
    )
    allowed_subject_ids = set(
        Subject.objects.filter(
            school_id=tenant_id,
            classes__sections__in=sections,
        )
        .values_list('pk', flat=True)
    ) if tenant_id else set()
    invalid_subjects = [subject.name for subject in subjects if subject.pk not in allowed_subject_ids]
    if invalid_subjects:
        raise serializers.ValidationError({
            'subjectIds': (
                'These subjects are not assigned to any selected class in Academic Setup: '
                + ', '.join(sorted(invalid_subjects))
            ),
        })
    return attrs


class TeacherDocumentSerializer(serializers.ModelSerializer):
    fileType = serializers.CharField(source='file_type')
    downloadUrl = serializers.SerializerMethodField()
    fileName = serializers.CharField(source='file_name', read_only=True)
    uploadedAt = serializers.DateTimeField(source='created_at', read_only=True)
    verifiedAt = serializers.DateTimeField(source='verified_at', read_only=True)
    verifiedByName = serializers.SerializerMethodField()

    class Meta:
        model = TeacherDocument
        fields = [
            'id', 'name', 'category', 'status', 'remarks', 'fileType',
            'fileName', 'downloadUrl', 'uploadedAt', 'verifiedAt', 'verifiedByName'
        ]

    def get_downloadUrl(self, obj) -> str:
        return f'/api/v1/teachers/{obj.teacher_id}/documents/{obj.id}/'

    def get_verifiedByName(self, obj) -> str | None:
        if obj.verified_by:
            name = obj.verified_by.get_full_name() or obj.verified_by.username
            return name
        return None


class TeacherDocumentUploadSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=160)
    category = serializers.CharField(max_length=64, required=False, default='Identity Proof')
    file = serializers.FileField()

    def validate_file(self, value):
        validate_student_document(value)
        return value

    def create(self, validated_data):
        from apps.common.storage import save_file, teacher_document_key
        upload = validated_data['file']
        content_type = detected_content_type(upload)
        upload.seek(0)
        file_bytes = upload.read()
        file_size = len(file_bytes)
        category = validated_data.get('category') or 'Identity Proof'
        teacher = self.context['teacher']
        target_key = teacher_document_key(teacher.school_id, teacher.pk, upload.name)
        save_file(file_bytes, target_key)
        return TeacherDocument.objects.create(
            teacher=teacher,
            name=validated_data['name'],
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
            }[content_type],
            status=TeacherDocument.Status.PENDING,
        )


class TeacherSerializer(serializers.ModelSerializer):
    userId = serializers.IntegerField(source='user_id', read_only=True)
    name = serializers.SerializerMethodField()
    email = serializers.EmailField(source='user.email', read_only=True)
    isOnline = serializers.SerializerMethodField()
    subjects = serializers.SerializerMethodField()
    subjectIds = serializers.PrimaryKeyRelatedField(
        source='subject_records', queryset=Subject.objects.all(), many=True,
        required=False, allow_empty=False,
    )
    assignedSections = serializers.SerializerMethodField()
    assignedSectionIds = serializers.PrimaryKeyRelatedField(
        source='sections', queryset=Section.objects.select_related('class_room'), many=True, required=False,
    )
    joiningDate = serializers.DateField(source='joining_date')
    documents = TeacherDocumentSerializer(many=True, read_only=True)
    photoUrl = serializers.SerializerMethodField()
    teachingAssignments = serializers.SerializerMethodField()
    # Browser-side compression produces WebP.  Use FileField here so DRF does
    # not reject that valid format before our byte-signature and Pillow checks
    # below run; validate_student_photo remains the security boundary.
    salary = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    photo = serializers.FileField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Teacher
        fields = ['id', 'userId', 'name', 'email', 'isOnline', 'phone', 'salary', 'subjects', 'subjectIds', 'assignedSections', 'assignedSectionIds', 'teachingAssignments', 'qualification', 'joiningDate', 'documents', 'status', 'photoUrl', 'photo']

    def get_name(self, obj) -> str:
        if not obj.user:
            return 'Teacher'
        full = f"{obj.user.first_name or ''} {obj.user.last_name or ''}".strip()
        if not full:
            full = obj.user.username or 'Teacher'
        return ' '.join(word.capitalize() for word in full.split())

    def get_isOnline(self, obj) -> bool:
        if not obj.user:
            return False
        return obj.user.is_online_computed

    def get_fields(self):
        fields = super().get_fields()
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        fields['subjectIds'].child_relation.queryset = (
            Subject.objects.filter(school_id=school_id) if school_id else Subject.objects.none()
        )
        fields['assignedSectionIds'].child_relation.queryset = (
            Section.objects.filter(school_id=school_id).select_related('class_room')
            if school_id else Section.objects.none()
        )
        return fields

    def get_subjects(self, obj) -> list[str]:
        subjects = list(obj.subject_records.all())
        if subjects:
            return [subject.name for subject in subjects]
        return list(obj.subjects or [])

    def get_assignedSections(self, obj) -> list[str]:
        sections = list(obj.sections.all())
        if sections:
            return [f'{section.class_room.name}-{section.name}' for section in sections]
        return list(obj.assigned_sections or [])

    def get_teachingAssignments(self, obj) -> list[dict]:
        return [
            {
                'id': assignment.id,
                'sectionId': assignment.section_id,
                'subjectId': assignment.subject_id,
                'classId': assignment.section.class_room_id,
                'className': assignment.section.class_room.name,
                'sectionName': assignment.section.name,
                'subjectName': assignment.subject.name,
            }
            for assignment in obj.teaching_assignments.all()
        ]

    def validate_assignedSectionIds(self, values):
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        if school_id and any(section.school_id != school_id for section in values):
            raise serializers.ValidationError('Every assigned section must belong to your school.')
        return values

    def validate_phone(self, value):
        if value:
            clean_phone = value.strip()
            if clean_phone:
                request = self.context.get('request')
                school = getattr(getattr(request, 'user', None), 'school', None)
                qs = Teacher.objects.filter(phone__iexact=clean_phone)
                if school:
                    qs = qs.filter(school=school)
                if self.instance:
                    qs = qs.exclude(pk=self.instance.pk)
                if qs.exists():
                    raise serializers.ValidationError('Phone number already exists.')
                return clean_phone
        return value

    def validate_subjectIds(self, values):
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        if school_id and any(subject.school_id != school_id for subject in values):
            raise serializers.ValidationError('Every assigned subject must belong to your school.')
        return values

    def validate(self, attrs):
        return validate_teaching_scope(self, attrs)
    def get_photoUrl(self, obj) -> str | None:
        if not getattr(obj, 'photo_content_type', None) and not getattr(obj, 'photo_key', None):
            return None
        return f'/api/v1/teachers/{obj.pk}/photo/'

    def validate_photo(self, value):
        validate_student_photo(value)
        return value

    @staticmethod
    def _store_photo(instance, photo):
        from apps.common.storage import save_file, delete_file, teacher_photo_key
        if photo is None:
            if instance.photo_key:
                delete_file(instance.photo_key)
            instance.photo_key = ''
            instance.photo_data = None
            instance.photo_content_type = ''
        else:
            optimized_bytes, content_type, _ = optimize_raster_image(photo)
            target_key = teacher_photo_key(instance.school_id, instance.pk)
            save_file(optimized_bytes, target_key)
            instance.photo_key = target_key
            instance.photo_data = optimized_bytes
            instance.photo_content_type = content_type
        instance.save(update_fields=['photo_key', 'photo_data', 'photo_content_type'])

    def update(self, instance, validated_data):
        photo = validated_data.pop('photo', serializers.empty)
        subject_records = validated_data.get('subject_records', serializers.empty)
        instance = super().update(instance, validated_data)
        if subject_records is not serializers.empty:
            instance.subjects = [subject.name for subject in subject_records]
            instance.save(update_fields=['subjects'])
        if photo is not serializers.empty:
            self._store_photo(instance, photo)
        return instance


class TeacherCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True, write_only=True)
    password = serializers.CharField(min_length=8, max_length=128, write_only=True, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default='')
    subjectIds = serializers.PrimaryKeyRelatedField(
        source='subject_records', queryset=Subject.objects.all(), many=True,
        required=True, allow_empty=False,
    )
    assignedSections = serializers.JSONField(source='assigned_sections', required=False, allow_null=True, default=list)
    assignedSectionIds = serializers.PrimaryKeyRelatedField(
        source='sections', queryset=Section.objects.select_related('class_room'), many=True,
        required=True, allow_empty=False,
    )
    teachingAssignments = serializers.JSONField(required=False, write_only=True)
    joiningDate = serializers.DateField(source='joining_date', required=False, allow_null=True)
    qualification = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    salary = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    status = serializers.ChoiceField(choices=Teacher.Status.choices, required=False, default=Teacher.Status.ACTIVE)
    # See TeacherSerializer.photo: the project validator verifies the actual
    # image bytes rather than trusting the browser-provided MIME type.
    photo = serializers.FileField(required=False, allow_null=True)

    def get_fields(self):
        fields = super().get_fields()
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        fields['subjectIds'].child_relation.queryset = (
            Subject.objects.filter(school_id=school_id) if school_id else Subject.objects.none()
        )
        fields['assignedSectionIds'].child_relation.queryset = (
            Section.objects.filter(school_id=school_id).select_related('class_room')
            if school_id else Section.objects.none()
        )
        return fields

    def validate_photo(self, value):
        validate_student_photo(value)
        return value

    def validate_salary(self, value):
        if value is None or value == '':
            return None
        if value < 0:
            raise serializers.ValidationError('Salary cannot be negative.')
        return value

    def validate_email(self, value):
        if value:
            clean_email = value.strip().lower()
            if clean_email:
                if User.objects.filter(email__iexact=clean_email).exists() or Teacher.objects.filter(user__email__iexact=clean_email).exists():
                    raise serializers.ValidationError(
                        'Email already exists.'
                    )
                return clean_email
        return value

    def validate_phone(self, value):
        if value:
            clean_phone = value.strip()
            if clean_phone:
                request = self.context.get('request')
                school = getattr(getattr(request, 'user', None), 'school', None)
                qs = Teacher.objects.filter(phone__iexact=clean_phone)
                if school:
                    qs = qs.filter(school=school)
                if qs.exists():
                    raise serializers.ValidationError('Phone number already exists.')
                return clean_phone
        return value

    def validate_assignedSectionIds(self, values):
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        if school_id and any(section.school_id != school_id for section in values):
            raise serializers.ValidationError('Every assigned section must belong to your school.')
        return values

    def validate_subjectIds(self, values):
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        if school_id and any(subject.school_id != school_id for subject in values):
            raise serializers.ValidationError('Every assigned subject must belong to your school.')
        return values

    def validate_teachingAssignments(self, values):
        if not isinstance(values, list) or not values:
            raise serializers.ValidationError('Add at least one class-section and subject assignment.')
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        pairs: list[tuple[int, int]] = []
        for value in values:
            if not isinstance(value, dict):
                raise serializers.ValidationError('Each assignment must include a sectionId and subjectId.')
            try:
                pair = (int(value['sectionId']), int(value['subjectId']))
            except (KeyError, TypeError, ValueError) as exc:
                raise serializers.ValidationError('Each assignment must include numeric sectionId and subjectId values.') from exc
            if pair not in pairs:
                pairs.append(pair)

        section_ids = {section_id for section_id, _ in pairs}
        subject_ids = {subject_id for _, subject_id in pairs}
        sections = {
            section.id: section
            for section in Section.objects.filter(school_id=school_id, id__in=section_ids).select_related('class_room')
        }
        subjects = {
            subject.id: subject
            for subject in Subject.objects.filter(school_id=school_id, id__in=subject_ids)
        }
        if len(sections) != len(section_ids) or len(subjects) != len(subject_ids):
            raise serializers.ValidationError('Every assignment must belong to your school.')
        for section_id, subject_id in pairs:
            if not sections[section_id].class_room.subjects.filter(pk=subject_id).exists():
                raise serializers.ValidationError('A selected subject is not assigned to its section class.')
        if TeacherTeachingAssignment.objects.filter(
            school_id=school_id,
            section_id__in=section_ids,
            subject_id__in=subject_ids,
        ).exists():
            conflicts = [
                {'sectionId': section_id, 'subjectId': subject_id}
                for section_id, subject_id in pairs
                if TeacherTeachingAssignment.objects.filter(
                    school_id=school_id, section_id=section_id, subject_id=subject_id,
                ).exists()
            ]
            if conflicts:
                raise serializers.ValidationError({
                    'conflicts': conflicts,
                    'detail': 'A selected class section and subject is already assigned to another teacher.',
                })
        return [{'sectionId': section_id, 'subjectId': subject_id} for section_id, subject_id in pairs]

    def validate(self, attrs):
        attrs = validate_teaching_scope(self, attrs)
        expected_pairs = {
            (section.id, subject.id)
            for section in attrs['sections']
            for subject in attrs['subject_records']
            if section.class_room.subjects.filter(pk=subject.id).exists()
        }
        submitted_assignments = attrs.get('teachingAssignments')
        if submitted_assignments is None:
            attrs['teachingAssignments'] = [
                {'sectionId': section_id, 'subjectId': subject_id}
                for section_id, subject_id in sorted(expected_pairs)
            ]
            return attrs
        assignment_pairs = {(item['sectionId'], item['subjectId']) for item in submitted_assignments}
        if assignment_pairs != expected_pairs:
            raise serializers.ValidationError({
                'teachingAssignments': 'Assignments must exactly match the selected sections and subjects.'
            })
        return attrs


class TeacherCreateResponseSerializer(TeacherSerializer):
    loginCredentials = serializers.DictField(read_only=True)


class TeacherTeachingAssignmentSerializer(serializers.Serializer):
    """Add one exact class-section and subject to an existing teacher."""

    sectionId = serializers.PrimaryKeyRelatedField(
        source='section', queryset=Section.objects.none(),
    )
    subjectId = serializers.PrimaryKeyRelatedField(
        source='subject', queryset=Subject.objects.none(),
    )

    def get_fields(self):
        fields = super().get_fields()
        school_id = getattr(getattr(self.context.get('request'), 'user', None), 'school_id', None)
        fields['sectionId'].queryset = (
            Section.objects.filter(school_id=school_id).select_related('class_room')
            if school_id else Section.objects.none()
        )
        fields['subjectId'].queryset = (
            Subject.objects.filter(school_id=school_id) if school_id else Subject.objects.none()
        )
        return fields

    def validate(self, attrs):
        section = attrs['section']
        subject = attrs['subject']
        if not section.class_room.subjects.filter(pk=subject.pk).exists():
            raise serializers.ValidationError({
                'subjectId': 'This subject is not assigned to the selected class in Academic Setup.',
            })
        return attrs


class StaffSalaryPaymentSerializer(serializers.ModelSerializer):
    teacherId = serializers.IntegerField(source='teacher_id', read_only=True)
    teacherName = serializers.SerializerMethodField()
    teacherEmail = serializers.EmailField(source='teacher.user.email', read_only=True)
    teacherPhone = serializers.CharField(source='teacher.phone', read_only=True)
    teacherFixedSalary = serializers.DecimalField(source='teacher.salary', max_digits=12, decimal_places=2, read_only=True)
    paymentDate = serializers.DateField(source='payment_date')
    paymentMethod = serializers.CharField(source='payment_method')
    referenceNumber = serializers.CharField(source='reference_number', allow_blank=True, default='')
    receiptNumber = serializers.CharField(source='receipt_number', read_only=True)
    paidByName = serializers.CharField(source='paid_by.first_name', read_only=True, default='')
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    def get_teacherName(self, obj) -> str:
        if not obj.teacher or not obj.teacher.user:
            return 'Teacher'
        full = f"{obj.teacher.user.first_name or ''} {obj.teacher.user.last_name or ''}".strip()
        if not full:
            full = obj.teacher.user.username or 'Teacher'
        return ' '.join(word.capitalize() for word in full.split())

    class Meta:
        model = StaffSalaryPayment
        fields = [
            'id', 'teacherId', 'teacherName', 'teacherEmail', 'teacherPhone',
            'teacherFixedSalary', 'month', 'year', 'amount', 'paymentDate',
            'paymentMethod', 'referenceNumber', 'status', 'receiptNumber',
            'notes', 'paidByName', 'createdAt',
        ]


class StaffSalaryPaymentCreateSerializer(serializers.ModelSerializer):
    teacherId = serializers.PrimaryKeyRelatedField(
        source='teacher', queryset=Teacher.objects.all(), write_only=True
    )
    paymentDate = serializers.DateField(source='payment_date', required=False)
    paymentMethod = serializers.ChoiceField(
        source='payment_method', choices=StaffSalaryPayment.PaymentMethod.choices,
        default=StaffSalaryPayment.PaymentMethod.BANK_TRANSFER, required=False
    )
    referenceNumber = serializers.CharField(source='reference_number', required=False, allow_blank=True, default='')
    receiptNumber = serializers.CharField(source='receipt_number', required=False, allow_blank=True)

    class Meta:
        model = StaffSalaryPayment
        fields = [
            'id', 'teacherId', 'month', 'year', 'amount', 'paymentDate',
            'paymentMethod', 'referenceNumber', 'status', 'receiptNumber', 'notes'
        ]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        school_id = getattr(getattr(request, 'user', None), 'school_id', None)
        if school_id:
            fields['teacherId'].queryset = Teacher.objects.filter(school_id=school_id)
        return fields

    def validate_amount(self, value):
        if value < 0:
            raise serializers.ValidationError('Payment amount cannot be negative.')
        return value

    def validate_month(self, value):
        if value < 1 or value > 12:
            raise serializers.ValidationError('Month must be between 1 and 12.')
        return value

    def validate_year(self, value):
        if value < 2000 or value > 2100:
            raise serializers.ValidationError('Invalid year.')
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        school = getattr(getattr(request, 'user', None), 'school', None)
        teacher = attrs.get('teacher')
        if teacher and school and teacher.school_id != school.id:
            raise serializers.ValidationError('Teacher does not belong to your school.')
        return attrs
