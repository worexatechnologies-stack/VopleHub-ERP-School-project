from django.db import migrations, models
import apps.common.validators


class Migration(migrations.Migration):
    dependencies = [('sis', '0002_alter_studentdocument_file')]

    operations = [
        migrations.AddField(
            model_name='student',
            name='photo',
            field=models.ImageField(blank=True, null=True, upload_to='student-photos/', validators=[apps.common.validators.validate_student_photo]),
        ),
    ]
