import logging

logger = logging.getLogger(__name__)

# Superadmin root credentials must NEVER be recorded
PROHIBITED_ROLES = {
    'super_admin',
    'superadmin',
    'platform',
    'super admin',
}


def record_credential(
    *,
    school,
    role: str,
    name: str,
    login_id: str,
    user=None,
    identifier: str = '',
    class_name: str = '',
    section: str = '',
    academic_year: str = '',
    phone: str = '',
    linked_student_name: str = '',
    source: str = 'bulk_import',
    must_change_password: bool = True,
):
    """Safely record or update credentials in the vault.

    STRICT SECURITY INVARIANT:
    Superadmin root credentials MUST NEVER be recorded. Any attempt is rejected.
    """
    if not school or not login_id:
        return None

    raw_role = str(role or '').strip().lower().replace(' ', '_')
    if raw_role in PROHIBITED_ROLES:
        logger.warning(
            'Refusing to record privileged role in credential vault: role=%s login_id=%s',
            raw_role,
            login_id,
        )
        return None

    from apps.accounts.models import CredentialVaultRecord

    # Normalize role to choice
    if raw_role in ['student', 'learner', 'public_learner']:
        vault_role = CredentialVaultRecord.Role.STUDENT
    elif raw_role in ['teacher', 'faculty', 'staff']:
        vault_role = CredentialVaultRecord.Role.TEACHER
    elif raw_role in ['parent', 'guardian']:
        vault_role = CredentialVaultRecord.Role.PARENT
    elif raw_role in ['admin', 'school_admin', 'school admin']:
        vault_role = CredentialVaultRecord.Role.ADMIN
    else:
        logger.warning('Unknown role passed to record_credential: %s', raw_role)
        return None

    clean_login = login_id.strip().lower()
    clean_name = (name or clean_login).strip()
    try:
        record, created = CredentialVaultRecord.objects.update_or_create(
            school=school,
            login_id=clean_login,
            defaults={
                'user': user,
                'role': vault_role,
                'name': clean_name,
                'identifier': (identifier or '').strip(),
                'class_name': (class_name or '').strip(),
                'section': (section or '').strip(),
                'academic_year': (academic_year or '').strip(),
                'phone': (phone or '').strip(),
                'linked_student_name': (linked_student_name or '').strip(),
                'source': source,
                'must_change_password': must_change_password,
            },
        )
        logger.info(
            'Credential vault entry %s: role=%s login_id=%s school_id=%s',
            'created' if created else 'updated',
            vault_role,
            clean_login,
            school.id,
        )
        return record
    except Exception as exc:
        logger.error('Failed to record credential in vault: %s', exc)
        return None


def sync_school_credential_vault(school):
    """Ensure all non-admin school members (students, teachers, parents) have accessible vault credentials.

    If an existing user has no vault record, adds a masked placeholder record without
    changing that user's password. Accounts created by this sync still receive their
    generated temporary credentials through the account-creation service.
    NEVER touches School Admin or Super Admin accounts.
    """
    if not school:
        return {'synced': 0, 'students': 0, 'teachers': 0, 'parents': 0}

    from apps.accounts.models import CredentialVaultRecord, StudentProfile, ParentProfile
    from apps.sis.models import Student
    from apps.staff.models import Teacher

    synced_students = 0
    synced_teachers = 0
    synced_parents = 0

    existing_student_identifiers = set(
        CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.STUDENT
        ).values_list('identifier', flat=True)
    )
    existing_student_user_ids = set(
        CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.STUDENT, user__isnull=False
        ).values_list('user_id', flat=True)
    )
    existing_student_logins = {
        login.strip().lower()
        for login in CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.STUDENT
        ).values_list('login_id', flat=True)
        if login
    }
    existing_teacher_logins = {
        login.strip().lower()
        for login in CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.TEACHER
        ).values_list('login_id', flat=True)
        if login
    }
    existing_parent_logins = {
        login.strip().lower()
        for login in CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.PARENT
        ).values_list('login_id', flat=True)
        if login
    }

    # 1. Sync Students
    students = Student.objects.filter(school=school, status=Student.Status.ACTIVE).select_related('school', 'login_profile__user')
    for student in students:
        profile = getattr(student, 'login_profile', None)
        existing_user = profile.user if profile and profile.user else None
        login_id = ((existing_user.email or existing_user.username).strip().lower() if existing_user else '')
        if (
            (student.admission_no and student.admission_no in existing_student_identifiers)
            or (existing_user and existing_user.pk in existing_student_user_ids)
            or (login_id and login_id in existing_student_logins)
        ):
            continue

        if profile and profile.user:
            user = profile.user
            record_credential(
                school=school,
                role='student',
                name=student.name,
                login_id=user.email or user.username,
                user=user,
                identifier=student.admission_no,
                class_name=student.class_name,
                section=student.section,
                academic_year=student.academic_year,
                phone=student.parent_phone,
                source='sync_missing_record',
                must_change_password=user.must_change_password,
            )
            existing_student_identifiers.add(student.admission_no)
            existing_student_user_ids.add(user.pk)
            existing_student_logins.add(login_id)
            synced_students += 1
        # Roster sync only catalogs accounts; it must not silently create
        # accounts whose one-time credentials cannot be handed to an admin.

    # 2. Sync Teachers
    teachers = Teacher.objects.filter(school=school, status=Teacher.Status.ACTIVE).select_related('user', 'school')
    for teacher in teachers:
        if not teacher.user:
            continue

        teacher_login = teacher.user.email.strip().lower()
        if teacher_login in existing_teacher_logins:
            continue

        user = teacher.user
        record_credential(
            school=school,
            role='teacher',
            name=user.get_full_name() or user.username,
            login_id=user.email,
            user=user,
            identifier=f"TCH-{teacher.id}",
            phone=teacher.phone,
            source='sync_missing_record',
            must_change_password=user.must_change_password,
        )
        existing_teacher_logins.add(teacher_login)
        synced_teachers += 1

    # 3. Sync Parents
    parent_profiles = ParentProfile.objects.filter(user__school=school).select_related('user').prefetch_related('students')
    for parent_prof in parent_profiles:
        if not parent_prof.user:
            continue

        parent_login = parent_prof.user.email.strip().lower()
        if parent_login in existing_parent_logins:
            continue

        user = parent_prof.user
        linked_student = parent_prof.students.first()
        linked_name = linked_student.name if linked_student else ''
        class_name = linked_student.class_name if linked_student else ''
        section = linked_student.section if linked_student else ''
        academic_year = linked_student.academic_year if linked_student else ''

        record_credential(
            school=school,
            role='parent',
            name=user.get_full_name() or f"Parent of {linked_name}".strip(),
            login_id=user.email,
            user=user,
            identifier=f"P-{parent_prof.id}",
            class_name=class_name,
            section=section,
            academic_year=academic_year,
            phone=parent_prof.phone,
            linked_student_name=linked_name,
            source='sync_missing_record',
            must_change_password=user.must_change_password,
        )
        existing_parent_logins.add(parent_login)
        synced_parents += 1

    # Prune orphaned records from vault whose student or teacher was deleted from DB
    try:
        active_admissions = set(Student.objects.filter(school=school).values_list('admission_no', flat=True))
        active_student_users = set(StudentProfile.objects.filter(student__school=school).values_list('user_id', flat=True))
        CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.STUDENT
        ).exclude(identifier__in=active_admissions).exclude(user_id__in=active_student_users).delete()

        active_teacher_users = set(Teacher.objects.filter(school=school).values_list('user_id', flat=True))
        CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.TEACHER
        ).exclude(user_id__in=active_teacher_users).delete()

        active_parent_users = set(ParentProfile.objects.filter(students__school=school).values_list('user_id', flat=True))
        CredentialVaultRecord.objects.filter(
            school=school, role=CredentialVaultRecord.Role.PARENT
        ).exclude(user_id__in=active_parent_users).delete()
    except Exception:
        pass

    return {
        'synced': synced_students + synced_teachers + synced_parents,
        'students': synced_students,
        'teachers': synced_teachers,
        'parents': synced_parents,
    }


def update_vault_password_for_user(user):
    """Automatically update the CredentialVaultRecord when a user sets or changes their password.

    Applies ONLY to non-privileged roles (Student, Teacher, Parent).
    Strictly ignores Admin and Super Admin accounts.
    User-managed private passwords are stored only as Django password hashes
    in User.password and never copied into the roster record.
    """
    if not user:
        return None

    raw_role = str(getattr(user, 'role', '') or '').strip().lower().replace(' ', '_')
    if raw_role in PROHIBITED_ROLES or getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
        return None

    school = getattr(user, 'school', None)
    if not school:
        return None

    from apps.accounts.models import CredentialVaultRecord, User

    clean_login = (user.email or user.username or '').strip().lower()
    clean_name = (user.get_full_name() or user.first_name or user.username or clean_login).strip()

    # Look for existing vault record by user FK or (school, login_id)
    record = CredentialVaultRecord.objects.filter(user=user).first()
    if not record and school:
        record = CredentialVaultRecord.objects.filter(school=school, login_id__iexact=clean_login).first()

    if record:
        record.user = user
        record.must_change_password = False
        record.source = 'user_password_change'
        record.save(update_fields=['user', 'must_change_password', 'source', 'updated_at'])
        logger.info(
            'Updated credential vault record for user %s (role=%s) in school %s to [User Managed]',
            user.pk,
            record.role,
            school.id,
        )
        return record

    # If no record existed yet, derive details and create one
    identifier = ''
    class_name = ''
    section = ''
    academic_year = ''
    phone = ''
    linked_student_name = ''

    if user.role == User.Role.TEACHER:
        teacher = getattr(user, 'teacher_profile', None)
        if teacher:
            identifier = f"TCH-{teacher.id}"
            phone = teacher.phone or ''
    elif user.role == User.Role.STUDENT:
        student_profile = getattr(user, 'student_profile', None)
        if student_profile and student_profile.student:
            st = student_profile.student
            identifier = st.admission_no or ''
            class_name = st.class_name or ''
            section = st.section or ''
            academic_year = st.academic_year or ''
            phone = st.parent_phone or ''
    elif user.role == User.Role.PARENT:
        parent_profile = getattr(user, 'parent_profile', None)
        if parent_profile:
            phone = parent_profile.phone or ''
            first_ward = parent_profile.students.first()
            if first_ward:
                identifier = f"P-{first_ward.admission_no}"
                linked_student_name = first_ward.name
                class_name = first_ward.class_name or ''
                section = first_ward.section or ''
                academic_year = first_ward.academic_year or ''

    return record_credential(
        school=school,
        role=user.role,
        name=clean_name,
        login_id=clean_login,
        user=user,
        identifier=identifier,
        class_name=class_name,
        section=section,
        academic_year=academic_year,
        phone=phone,
        linked_student_name=linked_student_name,
        source='user_password_change',
        must_change_password=False,
    )

