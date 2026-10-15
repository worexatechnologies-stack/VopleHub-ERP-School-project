from django.db import migrations, models


def link_existing_teacher_subjects(apps, schema_editor):
    Teacher = apps.get_model('staff', 'Teacher')
    Subject = apps.get_model('academics', 'Subject')
    through = Teacher.subject_records.through

    for teacher in Teacher.objects.all().iterator(chunk_size=500):
        subject_ids = set()
        for raw_name in teacher.subjects or []:
            name = str(raw_name).strip()
            if not name:
                continue
            subject = Subject.objects.filter(school_id=teacher.school_id, name__iexact=name).first()
            if not subject:
                subject = Subject.objects.create(school_id=teacher.school_id, name=name)
            subject_ids.add(subject.id)
        through.objects.bulk_create(
            [through(teacher_id=teacher.id, subject_id=subject_id) for subject_id in subject_ids],
            ignore_conflicts=True,
        )


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0004_subject'),
        ('staff', '0008_link_compact_section_assignments'),
    ]

    operations = [
        migrations.AddField(
            model_name='teacher',
            name='subject_records',
            field=models.ManyToManyField(blank=True, related_name='teachers', to='academics.subject'),
        ),
        migrations.RunPython(link_existing_teacher_subjects, migrations.RunPython.noop),
    ]
