import re

from django.db import migrations


def link_compact_section_assignments(apps, schema_editor):
    Teacher = apps.get_model('staff', 'Teacher')
    Section = apps.get_model('academics', 'Section')
    through = Teacher.sections.through

    for teacher in Teacher.objects.all().iterator(chunk_size=500):
        section_ids = set()
        for raw_value in teacher.assigned_sections or []:
            match = re.fullmatch(
                r'(?:class|grade)?\s*(10|[1-9])\s*([A-D])',
                str(raw_value).strip(),
                re.IGNORECASE,
            )
            if not match:
                continue
            number, section_name = int(match.group(1)), match.group(2).upper()
            section_ids.update(Section.objects.filter(
                school_id=teacher.school_id,
                class_room__code=f'class-{number}',
                name=section_name,
            ).values_list('id', flat=True))

        through.objects.bulk_create(
            [through(teacher_id=teacher.id, section_id=section_id) for section_id in section_ids],
            ignore_conflicts=True,
        )


class Migration(migrations.Migration):
    dependencies = [('staff', '0007_teacher_section_relationship')]

    operations = [migrations.RunPython(link_compact_section_assignments, migrations.RunPython.noop)]
