from django.db import migrations


def seed_default_class_sections(apps, schema_editor):
    School = apps.get_model('schools', 'School')
    Classroom = apps.get_model('academics', 'Class')
    Section = apps.get_model('academics', 'Section')

    for school in School.objects.all().iterator():
        for number in range(1, 11):
            classroom, _ = Classroom.objects.get_or_create(
                school_id=school.id,
                code=f'class-{number}',
                defaults={'name': f'Class {number}'},
            )
            for section_name in ('A', 'B', 'C', 'D'):
                Section.objects.get_or_create(
                    school_id=school.id,
                    class_room_id=classroom.id,
                    name=section_name,
                )


class Migration(migrations.Migration):
    dependencies = [('academics', '0001_initial')]

    operations = [migrations.RunPython(seed_default_class_sections, migrations.RunPython.noop)]
