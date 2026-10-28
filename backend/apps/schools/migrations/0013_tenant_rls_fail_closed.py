from django.db import migrations


DIRECT_SCHOOL_TABLES = (
    'sis_student',
    'staff_teacher',
    'attendance_attendancerecord',
    'academics_academicyear',
    'academics_class',
    'academics_section',
    'exams_exam',
    'timetable_timetableslot',
)


def update_tenant_policies(apps, schema_editor, *, missing_superadmin_value):
    if schema_editor.connection.vendor != 'postgresql':
        return

    superadmin_check = (
        "COALESCE(NULLIF(current_setting('app.is_superadmin', true), ''), "
        f"'{missing_superadmin_value}') = 'true'"
    )
    with schema_editor.connection.cursor() as cursor:
        for table in DIRECT_SCHOOL_TABLES:
            cursor.execute(
                f'''ALTER POLICY {table}_tenant_policy ON {table}
                USING ({superadmin_check} OR school_id =
                    NULLIF(current_setting('app.school_id', true), '')::bigint)
                WITH CHECK ({superadmin_check} OR school_id =
                    NULLIF(current_setting('app.school_id', true), '')::bigint)'''
            )

        for table in ('exams_examresult', 'notifications_notification'):
            if table == 'exams_examresult':
                tenant_check = (
                    "EXISTS (SELECT 1 FROM exams_exam exam "
                    "WHERE exam.id = exam_id AND exam.school_id = "
                    "NULLIF(current_setting('app.school_id', true), '')::bigint)"
                )
            else:
                tenant_check = (
                    "EXISTS (SELECT 1 FROM accounts_user recipient_user "
                    "WHERE recipient_user.id = recipient_id AND recipient_user.school_id = "
                    "NULLIF(current_setting('app.school_id', true), '')::bigint)"
                )
            cursor.execute(
                f'''ALTER POLICY {table}_tenant_policy ON {table}
                USING ({superadmin_check} OR {tenant_check})
                WITH CHECK ({superadmin_check} OR {tenant_check})'''
            )


def fail_closed(apps, schema_editor):
    update_tenant_policies(apps, schema_editor, missing_superadmin_value='false')


def restore_previous_behavior(apps, schema_editor):
    update_tenant_policies(apps, schema_editor, missing_superadmin_value='true')


class Migration(migrations.Migration):
    dependencies = [
        ('schools', '0012_school_hall_ticket_settings'),
        ('timetable', '0002_alter_timetableslot_academic_year_and_more'),
    ]

    operations = [migrations.RunPython(fail_closed, restore_previous_behavior)]
