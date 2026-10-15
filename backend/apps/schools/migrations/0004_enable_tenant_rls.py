from django.db import migrations


DIRECT_SCHOOL_TABLES = [
    'sis_student',
    'staff_teacher',
    'attendance_attendancerecord',
    'academics_academicyear',
    'academics_class',
    'academics_section',
    'exams_exam',
]


def enable_rls(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for table in DIRECT_SCHOOL_TABLES:
            policy = f'{table}_tenant_policy'
            cursor.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
            cursor.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
            cursor.execute(
                f'''CREATE POLICY {policy} ON {table}
                USING (
                    COALESCE(NULLIF(current_setting('app.is_superadmin', true), ''), 'true') = 'true'
                    OR school_id = NULLIF(current_setting('app.school_id', true), '')::bigint
                )
                WITH CHECK (
                    COALESCE(NULLIF(current_setting('app.is_superadmin', true), ''), 'true') = 'true'
                    OR school_id = NULLIF(current_setting('app.school_id', true), '')::bigint
                )'''
            )

        # These tables do not yet have a direct school_id column. Batch D will
        # replace these join policies with direct-column policies when it adds it.
        cursor.execute('ALTER TABLE exams_examresult ENABLE ROW LEVEL SECURITY')
        cursor.execute('ALTER TABLE exams_examresult FORCE ROW LEVEL SECURITY')
        cursor.execute('''CREATE POLICY exams_examresult_tenant_policy ON exams_examresult
            USING (COALESCE(NULLIF(current_setting('app.is_superadmin', true), ''), 'true') = 'true' OR EXISTS (
                SELECT 1 FROM exams_exam exam WHERE exam.id = exam_id
                AND exam.school_id = NULLIF(current_setting('app.school_id', true), '')::bigint
            ))
            WITH CHECK (COALESCE(NULLIF(current_setting('app.is_superadmin', true), ''), 'true') = 'true' OR EXISTS (
                SELECT 1 FROM exams_exam exam WHERE exam.id = exam_id
                AND exam.school_id = NULLIF(current_setting('app.school_id', true), '')::bigint
            ))''')
        cursor.execute('ALTER TABLE notifications_notification ENABLE ROW LEVEL SECURITY')
        cursor.execute('ALTER TABLE notifications_notification FORCE ROW LEVEL SECURITY')
        cursor.execute('''CREATE POLICY notifications_notification_tenant_policy ON notifications_notification
            USING (COALESCE(NULLIF(current_setting('app.is_superadmin', true), ''), 'true') = 'true' OR EXISTS (
                SELECT 1 FROM accounts_user recipient_user WHERE recipient_user.id = recipient_id
                AND recipient_user.school_id = NULLIF(current_setting('app.school_id', true), '')::bigint
            ))
            WITH CHECK (COALESCE(NULLIF(current_setting('app.is_superadmin', true), ''), 'true') = 'true' OR EXISTS (
                SELECT 1 FROM accounts_user recipient_user WHERE recipient_user.id = recipient_id
                AND recipient_user.school_id = NULLIF(current_setting('app.school_id', true), '')::bigint
            ))''')


def disable_rls(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    tables = [*DIRECT_SCHOOL_TABLES, 'exams_examresult', 'notifications_notification']
    with schema_editor.connection.cursor() as cursor:
        for table in tables:
            cursor.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
            cursor.execute(f'ALTER TABLE {table} DISABLE ROW LEVEL SECURITY')


class Migration(migrations.Migration):
    dependencies = [
        ('schools', '0003_school_is_demo'),
        ('sis', '0001_initial'),
        ('staff', '0001_initial'),
        ('attendance', '0001_initial'),
        ('academics', '0001_initial'),
        ('exams', '0001_initial'),
        ('notifications', '0001_initial'),
    ]

    operations = [migrations.RunPython(enable_rls, disable_rls)]
