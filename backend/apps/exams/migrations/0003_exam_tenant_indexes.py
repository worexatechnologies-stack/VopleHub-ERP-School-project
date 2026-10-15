from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('exams', '0002_examresult_school_entered_by')]

    operations = [
        migrations.AddIndex(
            model_name='exam',
            index=models.Index(fields=['school', '-date'], name='exams_school_date_idx'),
        ),
        migrations.AddIndex(
            model_name='exam',
            index=models.Index(fields=['school', 'class_name', 'section'], name='exams_school_class_section_idx'),
        ),
    ]
