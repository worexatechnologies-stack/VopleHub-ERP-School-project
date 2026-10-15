from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import migrations


def optimize_existing_photos(apps, schema_editor):
    from apps.common.validators import optimize_raster_image

    Teacher = apps.get_model('staff', 'Teacher')
    for teacher in Teacher.objects.exclude(photo_data__isnull=True).iterator(chunk_size=100):
        content_type = teacher.photo_content_type or 'image/jpeg'
        extension = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}.get(content_type, '.jpg')
        upload = SimpleUploadedFile(f'teacher-image{extension}', bytes(teacher.photo_data), content_type=content_type)
        try:
            data, content_type, _ = optimize_raster_image(upload)
        except Exception:
            continue
        if data != bytes(teacher.photo_data) or content_type != teacher.photo_content_type:
            teacher.photo_data = data
            teacher.photo_content_type = content_type
            teacher.save(update_fields=['photo_data', 'photo_content_type'])


class Migration(migrations.Migration):
    dependencies = [('staff', '0003_store_teacher_photos_in_database')]
    operations = [migrations.RunPython(optimize_existing_photos, migrations.RunPython.noop)]
