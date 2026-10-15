from mimetypes import guess_type

from django.db import migrations, models


def migrate_photo_bytes(apps, schema_editor):
    Student = apps.get_model('sis', 'Student')
    for student in Student.objects.exclude(photo='').exclude(photo__isnull=True):
        if student.photo_data:
            continue
        try:
            if isinstance(student.photo, (bytes, memoryview)):
                student.photo_data = bytes(student.photo)
                student.photo_content_type = 'image/jpeg'
                student.save(update_fields=['photo_data', 'photo_content_type'])
                continue
            if not hasattr(student.photo, 'open'):
                continue
            with student.photo.open('rb') as file:
                student.photo_data = file.read()
            student.photo_content_type = guess_type(student.photo.name)[0] or 'image/jpeg'
            student.save(update_fields=['photo_data', 'photo_content_type'])
        except (OSError, AttributeError):
            continue


class Migration(migrations.Migration):
    dependencies = [('sis', '0004_student_school_status_index')]

    operations = [
        migrations.AddField(model_name='student', name='photo_data', field=models.BinaryField(blank=True, editable=False, null=True)),
        migrations.AddField(model_name='student', name='photo_content_type', field=models.CharField(blank=True, max_length=32)),
        migrations.RunPython(migrate_photo_bytes, migrations.RunPython.noop),
    ]
