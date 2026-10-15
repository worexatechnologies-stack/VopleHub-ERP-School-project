from django.db import migrations, models


def keep_one_active_year_per_school(apps, schema_editor):
    AcademicYear = apps.get_model('academics', 'AcademicYear')
    school_ids = (
        AcademicYear.objects.filter(is_active=True)
        .values_list('school_id', flat=True).distinct()
    )
    for school_id in school_ids.iterator(chunk_size=500):
        keep_id = (
            AcademicYear.objects.filter(school_id=school_id, is_active=True)
            .order_by('-starts_on', '-pk')
            .values_list('pk', flat=True)
            .first()
        )
        AcademicYear.objects.filter(
            school_id=school_id, is_active=True,
        ).exclude(pk=keep_id).update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0006_link_teacher_subjects_to_classes'),
    ]

    operations = [
        migrations.RunPython(keep_one_active_year_per_school, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='academicyear',
            constraint=models.UniqueConstraint(
                condition=models.Q(('is_active', True)), fields=('school',),
                name='unique_active_academic_year_per_school',
            ),
        ),
    ]
