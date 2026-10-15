from django.db import migrations


def link_teacher_subjects_to_classes(apps, schema_editor):
    """Infer existing class-subject links from canonical teacher assignments.

    There was no class/subject relationship before this migration. A teacher
    assigned to a section and a subject is the only unambiguous existing link
    available, so preserve those associations without inventing any others.
    """
    Classroom = apps.get_model('academics', 'Class')
    Teacher = apps.get_model('staff', 'Teacher')
    class_subject_through = Classroom.subjects.through
    teacher_section_through = Teacher.sections.through
    teacher_subject_through = Teacher.subject_records.through

    class_field = next(
        field for field in class_subject_through._meta.fields
        if field.is_relation and field.related_model == Classroom
    )
    subject_field = next(
        field for field in class_subject_through._meta.fields
        if field.is_relation and field.related_model._meta.label_lower == 'academics.subject'
    )

    pending = []
    for teacher in Teacher.objects.all().iterator(chunk_size=500):
        class_ids = set(
            teacher_section_through.objects.filter(
                teacher_id=teacher.id,
                section__school_id=teacher.school_id,
                section__class_room__school_id=teacher.school_id,
            )
            .values_list('section__class_room_id', flat=True)
        )
        subject_ids = set(
            teacher_subject_through.objects.filter(
                teacher_id=teacher.id, subject__school_id=teacher.school_id,
            )
            .values_list('subject_id', flat=True)
        )
        for class_id in class_ids:
            for subject_id in subject_ids:
                pending.append(class_subject_through(**{
                    class_field.attname: class_id,
                    subject_field.attname: subject_id,
                }))
        if len(pending) >= 1000:
            class_subject_through.objects.bulk_create(pending, ignore_conflicts=True)
            pending.clear()

    if pending:
        class_subject_through.objects.bulk_create(pending, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0005_class_subjects'),
        ('staff', '0009_teacher_subject_relationship'),
    ]

    operations = [
        migrations.RunPython(link_teacher_subjects_to_classes, migrations.RunPython.noop),
    ]
