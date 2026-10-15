from mimetypes import guess_type

from django.db import migrations, models


def migrate_photo_bytes(apps, schema_editor):
    Teacher = apps.get_model('staff', 'Teacher')
    for teacher in Teacher.objects.exclude(photo='').exclude(photo__isnull=True):
        if teacher.photo_data:
            continue
        try:
            if isinstance(teacher.photo, (bytes, memoryview)):
                teacher.photo_data = bytes(teacher.photo)
                teacher.photo_content_type = 'image/jpeg'
                teacher.save(update_fields=['photo_data', 'photo_content_type'])
                continue
            if not hasattr(teacher.photo, 'open'):
                continue
            with teacher.photo.open('rb') as file:
                teacher.photo_data = file.read()
            teacher.photo_content_type = guess_type(teacher.photo.name)[0] or 'image/jpeg'
            teacher.save(update_fields=['photo_data', 'photo_content_type'])
        except (OSError, AttributeError):
            continue


class Migration(migrations.Migration):
    dependencies = [('staff', '0002_teacher_photo')]

    operations = [
        migrations.AddField(model_name='teacher', name='photo_data', field=models.BinaryField(blank=True, editable=False, null=True)),
        migrations.AddField(model_name='teacher', name='photo_content_type', field=models.CharField(blank=True, max_length=32)),
        migrations.RunPython(migrate_photo_bytes, migrations.RunPython.noop),
    ]
