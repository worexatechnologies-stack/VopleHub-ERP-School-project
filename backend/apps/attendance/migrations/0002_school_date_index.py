from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('attendance', '0001_initial')]

    operations = [
        migrations.AddIndex(
            model_name='attendancerecord',
            index=models.Index(fields=['school', 'date'], name='attendance_school_date_idx'),
        ),
    ]
