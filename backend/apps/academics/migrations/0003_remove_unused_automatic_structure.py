from django.db import migrations


def remove_unused_automatic_structure(apps, schema_editor):
    """Remove generated defaults without breaking existing assignments."""
    Classroom = apps.get_model('academics', 'Class')
    Section = apps.get_model('academics', 'Section')
    Student = apps.get_model('sis', 'Student')
    Teacher = apps.get_model('staff', 'Teacher')
    teacher_sections = Teacher.sections.through

    automatic_codes = {f'class-{number}' for number in range(1, 11)}
    automatic_sections = Section.objects.filter(class_room__code__in=automatic_codes)
    for section in automatic_sections.iterator(chunk_size=500):
        is_used = (
            Student.objects.filter(section_record_id=section.id).exists()
            or teacher_sections.objects.filter(section_id=section.id).exists()
        )
        if not is_used:
            section.delete()

    Classroom.objects.filter(code__in=automatic_codes, sections__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0002_seed_default_class_sections'),
        ('sis', '0009_student_section_relationship'),
        ('staff', '0008_link_compact_section_assignments'),
    ]

    operations = [migrations.RunPython(remove_unused_automatic_structure, migrations.RunPython.noop)]
