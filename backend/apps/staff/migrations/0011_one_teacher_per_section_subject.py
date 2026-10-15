from django.db import migrations, models


def remove_duplicate_scope_assignments(apps, schema_editor):
    Assignment = apps.get_model('staff', 'TeacherTeachingAssignment')
    seen_scopes = set()
    for assignment in Assignment.objects.order_by('id').iterator():
        scope = (assignment.school_id, assignment.section_id, assignment.subject_id)
        if scope in seen_scopes:
            assignment.delete()
        else:
            seen_scopes.add(scope)


class Migration(migrations.Migration):

    dependencies = [
        ('staff', '0010_teacherteachingassignment'),
    ]

    operations = [
        migrations.RunPython(remove_duplicate_scope_assignments, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='teacherteachingassignment',
            constraint=models.UniqueConstraint(
                fields=('school', 'section', 'subject'),
                name='unique_teacher_for_section_subject',
            ),
        ),
    ]
