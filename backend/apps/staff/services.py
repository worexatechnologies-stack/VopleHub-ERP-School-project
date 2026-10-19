from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.credential_generator import create_user_with_credentials
from apps.common.validators import optimize_raster_image

from .models import Teacher, TeacherTeachingAssignment


def create_teacher_with_login(*, school, data, created_by=None):
    with transaction.atomic():
        try:
            section_records = data.get('sections', [])
            subject_records = data['subject_records']
            teaching_assignments = data['teachingAssignments']
            email = data.get('email')
            password = data.get('password')
            user, credentials = create_user_with_credentials(person=data['name'], role=User.Role.TEACHER, school=school, email=email)
            if password:
                user.set_password(password)
                user.must_change_password = False
                user.save(update_fields=['password', 'must_change_password'])
                credentials['plaintext_password'] = password
                credentials['mustChangePassword'] = False
            photo = data.get('photo')
            if photo:
                photo_bytes, photo_content_type, _ = optimize_raster_image(photo)
            else:
                photo_content_type = ''
                photo_bytes = None
            teacher = Teacher.objects.create(
                school=school,
                user=user,
                subjects=[subject.name for subject in subject_records],
                assigned_sections=data.get('assigned_sections') or [
                    f'{section.class_room.name}-{section.name}' for section in section_records
                ],
                qualification=data.get('qualification', ''),
                joining_date=data.get('joining_date') or timezone.now().date(),
                phone=data.get('phone') or '',
                salary=data.get('salary'),
                photo_data=photo_bytes,
                photo_content_type=photo_content_type,
                status=data.get('status', Teacher.Status.ACTIVE),
            )
            if photo_bytes:
                from apps.common.storage import save_file, teacher_photo_key
                target_key = teacher_photo_key(school.id, teacher.id)
                save_file(photo_bytes, target_key)
                teacher.photo_key = target_key
                teacher.save(update_fields=['photo_key'])
            if section_records:
                teacher.sections.set(section_records)
            teacher.subject_records.set(subject_records)
            TeacherTeachingAssignment.objects.bulk_create([
                TeacherTeachingAssignment(
                    school=school,
                    teacher=teacher,
                    section_id=assignment['sectionId'],
                    subject_id=assignment['subjectId'],
                    created_by=created_by,
                )
                for assignment in teaching_assignments
            ], ignore_conflicts=True)
        except IntegrityError as exc:
            if email and User.objects.filter(email__iexact=email).exists():
                raise serializers.ValidationError({
                    'email': 'Email already exists.',
                }) from exc
            if data.get('phone') and Teacher.objects.filter(phone__iexact=data['phone'], school=school).exists():
                raise serializers.ValidationError({
                    'phone': 'Phone number already exists.',
                }) from exc
            raise serializers.ValidationError({
                'detail': 'The teacher account could not be created because a unique record already exists.',
            }) from exc

    try:
        from apps.accounts.credential_vault import record_credential
        record_credential(
            school=school,
            role='teacher',
            name=user.get_full_name() or user.username or data.get('name', ''),
            login_id=credentials['login_id'],
            plaintext_password=credentials['plaintext_password'],
            user=user,
            identifier=f"TCH-{teacher.id}",
            phone=teacher.phone or '',
            source='staff_service',
            must_change_password=credentials.get('mustChangePassword', True),
        )
    except Exception:
        pass


    return teacher, {
        'username': credentials['login_id'],
        'password': credentials['plaintext_password'],
        'userId': user.id,
        'mustChangePassword': credentials.get('mustChangePassword', True),
    }

