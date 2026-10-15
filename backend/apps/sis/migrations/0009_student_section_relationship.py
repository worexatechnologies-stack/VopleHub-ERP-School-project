import re

import django.db.models.deletion
from django.db import migrations, models


def link_existing_students(apps, schema_editor):
    Student = apps.get_model('sis', 'Student')
    Section = apps.get_model('academics', 'Section')

    for student in Student.objects.filter(section_record__isnull=True).iterator(chunk_size=500):
        match = re.search(r'(?:class|grade)?\s*(10|[1-9])', student.class_name or '', re.IGNORECASE)
        section_name = (student.section or '').strip().upper()
        if not match or section_name not in {'A', 'B', 'C', 'D'}:
            continue
        number = int(match.group(1))
        section = Section.objects.filter(
            school_id=student.school_id,
            class_room__code=f'class-{number}',
            name=section_name,
        ).first()
        if section:
            student.section_record_id = section.id
            student.class_name = f'Class {number}'
            student.section = section_name
            student.save(update_fields=['section_record', 'class_name', 'section'])


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0002_seed_default_class_sections'),
        ('sis', '0008_remove_legacy_media_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='student',
            name='section_record',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='students', to='academics.section'),
        ),
        migrations.RunPython(link_existing_students, migrations.RunPython.noop),
    ]
