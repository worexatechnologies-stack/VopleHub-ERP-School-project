import re

from django.db import migrations, models


def link_existing_teachers(apps, schema_editor):
    Teacher = apps.get_model('staff', 'Teacher')
    Section = apps.get_model('academics', 'Section')
    through = Teacher.sections.through

    for teacher in Teacher.objects.all().iterator(chunk_size=500):
        section_ids = set()
        for raw_value in teacher.assigned_sections or []:
            value = str(raw_value).strip()
            if value.lower() == 'all':
                section_ids.update(Section.objects.filter(school_id=teacher.school_id).values_list('id', flat=True))
                continue
            combined = re.fullmatch(r'(?:class|grade)?\s*(10|[1-9])\s*[-/]\s*([A-D])', value, re.IGNORECASE)
            class_only = re.fullmatch(r'(?:class|grade)?\s*(10|[1-9])', value, re.IGNORECASE)
            if combined:
                number, section_name = int(combined.group(1)), combined.group(2).upper()
                section_ids.update(Section.objects.filter(
                    school_id=teacher.school_id,
                    class_room__code=f'class-{number}',
                    name=section_name,
                ).values_list('id', flat=True))
            elif class_only:
                number = int(class_only.group(1))
                section_ids.update(Section.objects.filter(
                    school_id=teacher.school_id,
                    class_room__code=f'class-{number}',
                ).values_list('id', flat=True))
        through.objects.bulk_create(
            [through(teacher_id=teacher.id, section_id=section_id) for section_id in section_ids],
            ignore_conflicts=True,
        )


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0002_seed_default_class_sections'),
        ('staff', '0006_teacher_documents_in_database'),
    ]

    operations = [
        migrations.AddField(
            model_name='teacher',
            name='sections',
            field=models.ManyToManyField(blank=True, related_name='teachers', to='academics.section'),
        ),
        migrations.RunPython(link_existing_teachers, migrations.RunPython.noop),
    ]
