import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


def enable_timetable_rls(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    table = 'timetable_timetableslot'
    policy = 'timetable_timetableslot_tenant_policy'
    with schema_editor.connection.cursor() as cursor:
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


def disable_timetable_rls(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    table = 'timetable_timetableslot'
    policy = 'timetable_timetableslot_tenant_policy'
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f'DROP POLICY IF EXISTS {policy} ON {table}')
        cursor.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
        cursor.execute(f'ALTER TABLE {table} DISABLE ROW LEVEL SECURITY')


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('academics', '0008_class_sort_order'),
        ('accounts', '0004_parentprofile_phone_not_global'),
        ('schools', '0011_remove_legacy_logo_file'),
        ('staff', '0009_teacher_subject_relationship'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TimetableSlot',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('day', models.CharField(choices=[('Monday', 'Monday'), ('Tuesday', 'Tuesday'), ('Wednesday', 'Wednesday'), ('Thursday', 'Thursday'), ('Friday', 'Friday'), ('Saturday', 'Saturday')], max_length=9)),
                ('period', models.PositiveSmallIntegerField()),
                ('time_label', models.CharField(max_length=64)),
                ('classroom', models.CharField(default='Default', max_length=120)),
                ('published', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('academic_year', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='timetable_slots', to='academics.academicyear')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_timetable_slots', to=settings.AUTH_USER_MODEL)),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='timetable_slots', to='schools.school')),
                ('section', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='timetable_slots', to='academics.section')),
                ('subject', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='timetable_slots', to='academics.subject')),
                ('teacher', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='timetable_slots', to='staff.teacher')),
            ],
            options={
                'ordering': ['academic_year__starts_on', 'section_id', 'day', 'period'],
                'indexes': [
                    models.Index(fields=['school', 'academic_year', 'section', 'published'], name='timetable_section_lookup_idx'),
                    models.Index(fields=['school', 'academic_year', 'teacher', 'published'], name='timetable_teacher_lookup_idx'),
                ],
                'constraints': [
                    models.CheckConstraint(check=Q(('period__gte', 1)), name='timetable_period_at_least_one'),
                    models.UniqueConstraint(fields=('school', 'academic_year', 'section', 'day', 'period'), name='unique_section_timetable_period'),
                    models.UniqueConstraint(fields=('school', 'academic_year', 'teacher', 'day', 'period'), name='unique_teacher_timetable_period'),
                ],
            },
        ),
        migrations.RunPython(enable_timetable_rls, disable_timetable_rls),
    ]
