from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('sis', '0007_store_student_documents_in_database')]

    operations = [
        migrations.RemoveField(model_name='student', name='photo'),
        migrations.RemoveField(model_name='studentdocument', name='file'),
    ]
