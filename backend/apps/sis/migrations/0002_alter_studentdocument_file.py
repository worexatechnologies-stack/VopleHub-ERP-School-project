from django.db import migrations, models
import apps.common.validators


class Migration(migrations.Migration):
    dependencies = [('sis', '0001_initial')]
    operations = [migrations.AlterField(
        model_name='studentdocument', name='file',
        field=models.FileField(upload_to='student-documents/', validators=[apps.common.validators.validate_student_document]),
    )]
