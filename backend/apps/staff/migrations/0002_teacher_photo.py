from django.db import migrations, models
import apps.common.validators


class Migration(migrations.Migration):
    dependencies = [
        ('staff', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='teacher',
            name='photo',
            field=models.ImageField(blank=True, null=True, upload_to='teacher-photos/', validators=[apps.common.validators.validate_student_photo]),
        ),
    ]
