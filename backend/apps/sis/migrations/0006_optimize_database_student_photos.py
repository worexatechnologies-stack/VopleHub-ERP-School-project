from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import migrations


def optimize_existing_photos(apps, schema_editor):
    from apps.common.validators import optimize_raster_image

    Student = apps.get_model('sis', 'Student')
    for student in Student.objects.exclude(photo_data__isnull=True).iterator(chunk_size=100):
        content_type = student.photo_content_type or 'image/jpeg'
        extension = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}.get(content_type, '.jpg')
        upload = SimpleUploadedFile(f'student-image{extension}', bytes(student.photo_data), content_type=content_type)
        try:
            data, content_type, _ = optimize_raster_image(upload)
        except Exception:
            continue
        if data != bytes(student.photo_data) or content_type != student.photo_content_type:
            student.photo_data = data
            student.photo_content_type = content_type
            student.save(update_fields=['photo_data', 'photo_content_type'])


class Migration(migrations.Migration):
    dependencies = [('sis', '0005_store_student_photos_in_database')]
    operations = [migrations.RunPython(optimize_existing_photos, migrations.RunPython.noop)]
