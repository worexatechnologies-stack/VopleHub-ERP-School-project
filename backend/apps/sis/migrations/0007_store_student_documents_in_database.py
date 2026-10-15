from mimetypes import guess_type
from pathlib import Path

from django.db import migrations, models


def migrate_document_bytes(apps, schema_editor):
    StudentDocument = apps.get_model('sis', 'StudentDocument')
    for document in StudentDocument.objects.exclude(file='').exclude(file__isnull=True).iterator(chunk_size=100):
        if document.file_data:
            continue
        try:
            with document.file.open('rb') as legacy_file:
                document.file_data = legacy_file.read()
        except OSError:
            # Do not fail deployment for a historical file that was already
            # removed from the old filesystem. It can be uploaded again.
            continue
        document.file_content_type = guess_type(document.file.name)[0] or 'application/octet-stream'
        document.file_name = Path(document.file.name).name
        document.save(update_fields=['file_data', 'file_content_type', 'file_name'])


class Migration(migrations.Migration):
    dependencies = [('sis', '0006_optimize_database_student_photos')]

    operations = [
        migrations.AddField(model_name='studentdocument', name='file_data', field=models.BinaryField(blank=True, editable=False, null=True)),
        migrations.AddField(model_name='studentdocument', name='file_content_type', field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name='studentdocument', name='file_name', field=models.CharField(blank=True, max_length=255)),
        migrations.RunPython(migrate_document_bytes, migrations.RunPython.noop),
    ]
