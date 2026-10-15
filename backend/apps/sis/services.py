import re
import secrets
import string

from django.db import IntegrityError
from django.utils.text import slugify
from rest_framework import serializers

from apps.accounts.models import ParentProfile, StudentProfile, User
from apps.accounts.credential_generator import create_user_with_credentials


TEMP_PASSWORD_ALPHABET = string.ascii_letters + string.digits + '!@#$%^&*'


def generate_student_username(student):
    school_code = slugify(getattr(student.school, 'code', '') or f'school-{student.school_id}')
    admission = slugify(student.admission_no)
    username = f'{school_code}-{admission}'.strip('-')
    return re.sub(r'[^a-zA-Z0-9.@+-_]', '_', username)[:150]


def generate_parent_username(student):
    school_code = slugify(getattr(student.school, 'code', '') or f'school-{student.school_id}')
    phone = re.sub(r'\D+', '', student.parent_phone)[-10:] or slugify(student.parent_email.split('@')[0])
    username = f'{school_code}-parent-{phone}'.strip('-')
    return re.sub(r'[^a-zA-Z0-9.@+-_]', '_', username)[:150]


def generate_temporary_password(length=16):
    while True:
        password = ''.join(secrets.choice(TEMP_PASSWORD_ALPHABET) for _ in range(length))
        if (
            any(c.islower() for c in password)
            and any(c.isupper() for c in password)
            and any(c.isdigit() for c in password)
            and any(c in '!@#$%^&*' for c in password)
        ):
            return password


def create_student_login(student, password=None, email=None):
    try:
        user, credentials = create_user_with_credentials(
            person=student,
            role=User.Role.STUDENT,
            school=student.school,
            email=email,
        )
        if password:
            user.set_password(password)
            user.must_change_password = False
            user.save(update_fields=['password', 'must_change_password'])
            credentials['plaintext_password'] = password
            credentials['mustChangePassword'] = False

        StudentProfile.objects.create(user=user, student=student)
        try:
            from apps.accounts.credential_vault import record_credential
            record_credential(
                school=student.school,
                role='student',
                name=student.name,
                login_id=credentials['login_id'],
                plaintext_password=credentials['plaintext_password'],
                user=user,
                identifier=student.admission_no,
                class_name=student.class_name,
                section=student.section,
                academic_year=student.academic_year,
                phone=student.parent_phone,
                source='sis_registration',
                must_change_password=credentials.get('mustChangePassword', True),
            )
        except Exception:
            pass
    except IntegrityError as exc:
        raise serializers.ValidationError({
            'admissionNo': 'Could not create a unique student login for this admission.'
        }) from exc

    return {
        'username': credentials['login_id'].split('@')[0],
        'email': credentials['login_id'],
        'temporaryPassword': credentials['plaintext_password'],
        'userId': user.id,
        'mustChangePassword': credentials.get('mustChangePassword', True),
    }


def create_or_link_parent_login(student, password=None, email=None):
    # Parent accounts and their wards must stay inside one school tenant.
    # Never link on a globally matching phone number.
    existing_profile = ParentProfile.objects.select_related('user').filter(
        phone=student.parent_phone,
        user__school=student.school,
    ).first()
    if existing_profile:
        existing_profile.students.add(student)
        return {
            'created': False,
            'email': existing_profile.user.email,
            'userId': existing_profile.user_id,
            'message': 'Existing parent account linked to the new student. No new password was generated.',
        }

    parent_email_query = email or student.parent_email
    existing_parent_user = User.objects.filter(
        email__iexact=parent_email_query,
        role=User.Role.PARENT,
        school=student.school,
    ).first()
    if existing_parent_user and not hasattr(existing_parent_user, 'parent_profile'):
        profile = ParentProfile.objects.create(user=existing_parent_user, phone=student.parent_phone)
        profile.students.add(student)
        return {
            'created': False,
            'email': existing_parent_user.email,
            'userId': existing_parent_user.id,
            'message': 'Existing parent account linked to the new student. No new password was generated.',
        }

    try:
        candidate_email = email
        if candidate_email and User.objects.filter(email__iexact=candidate_email).exists():
            candidate_email = None

        user, credentials = create_user_with_credentials(
            person=student.parent_name,
            role=User.Role.PARENT,
            school=student.school,
            email=candidate_email,
        )
        if password:
            user.set_password(password)
            user.must_change_password = False
            user.save(update_fields=['password', 'must_change_password'])
            credentials['plaintext_password'] = password
            credentials['mustChangePassword'] = False

        profile = ParentProfile.objects.create(user=user, phone=student.parent_phone)
        profile.students.add(student)
        try:
            from apps.accounts.credential_vault import record_credential
            record_credential(
                school=student.school,
                role='parent',
                name=student.parent_name or f"Parent of {student.name}",
                login_id=credentials['login_id'],
                plaintext_password=credentials['plaintext_password'],
                user=user,
                identifier=f"P-{student.admission_no}",
                class_name=student.class_name,
                section=student.section,
                academic_year=student.academic_year,
                phone=student.parent_phone,
                linked_student_name=student.name,
                source='sis_registration',
                must_change_password=credentials.get('mustChangePassword', True),
            )
        except Exception:
            pass
    except IntegrityError as exc:
        raise serializers.ValidationError({
            'parentEmail': 'Could not create a unique parent login for this admission.'
        }) from exc

    return {
        'created': True,
        'username': credentials['login_id'].split('@')[0],
        'email': credentials['login_id'],
        'temporaryPassword': credentials['plaintext_password'],
        'userId': user.id,
        'mustChangePassword': True,
    }


def deactivate_login_if_student_left(student):
    if hasattr(student, 'login_profile'):
        user = student.login_profile.user
        if user.is_active:
            user.is_active = False
            user.save(update_fields=['is_active'])

    for parent_profile in student.parent_profiles.select_related('user').all():
        has_other_active_child = parent_profile.students.filter(
            school=student.school,
            status=student.Status.ACTIVE,
        ).exclude(id=student.id).exists()
        if not has_other_active_child and parent_profile.user.is_active:
            parent_profile.user.is_active = False
            parent_profile.user.save(update_fields=['is_active'])
