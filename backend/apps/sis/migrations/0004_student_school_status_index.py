from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('sis', '0003_student_photo')]

    operations = [
        migrations.AddIndex(
            model_name='student',
            index=models.Index(fields=['school', 'status'], name='sis_student_school_status_idx'),
        ),
    ]
