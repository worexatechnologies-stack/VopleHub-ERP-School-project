from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import migrations


def optimize_existing_logos(apps, schema_editor):
    from apps.common.validators import optimize_raster_image

    School = apps.get_model('schools', 'School')
    for school in School.objects.exclude(logo_data__isnull=True).iterator(chunk_size=100):
        content_type = school.logo_content_type or 'image/png'
        extension = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}.get(content_type, '.png')
        upload = SimpleUploadedFile(f'school-logo{extension}', bytes(school.logo_data), content_type=content_type)
        try:
            data, content_type, _ = optimize_raster_image(upload)
        except Exception:
            continue
        if data != bytes(school.logo_data) or content_type != school.logo_content_type:
            school.logo_data = data
            school.logo_content_type = content_type
            school.save(update_fields=['logo_data', 'logo_content_type'])


class Migration(migrations.Migration):
    dependencies = [('schools', '0009_store_logos_in_database')]
    operations = [migrations.RunPython(optimize_existing_logos, migrations.RunPython.noop)]
