from mimetypes import guess_type

from django.db import migrations, models


def migrate_logo_bytes(apps, schema_editor):
    School = apps.get_model('schools', 'School')
    for school in School.objects.exclude(logo='').exclude(logo__isnull=True):
        if school.logo_data:
            continue
        try:
            if isinstance(school.logo, (bytes, memoryview)):
                school.logo_data = bytes(school.logo)
                school.logo_content_type = 'image/png'
                school.save(update_fields=['logo_data', 'logo_content_type'])
                continue
            if not hasattr(school.logo, 'open'):
                continue
            with school.logo.open('rb') as file:
                school.logo_data = file.read()
            school.logo_content_type = guess_type(school.logo.name)[0] or 'image/png'
            school.save(update_fields=['logo_data', 'logo_content_type'])
        except (OSError, AttributeError):
            
            continue


class Migration(migrations.Migration):
    dependencies = [('schools', '0008_remove_retired_signup_billing')]

    operations = [
        migrations.AddField(model_name='school', name='logo_data', field=models.BinaryField(blank=True, editable=False, null=True)),
        migrations.AddField(model_name='school', name='logo_content_type', field=models.CharField(blank=True, max_length=32)),
        migrations.RunPython(migrate_logo_bytes, migrations.RunPython.noop),
    ]
