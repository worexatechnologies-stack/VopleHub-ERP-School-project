from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('exams', '0011_examresult_exam_res_sch_exam_stat_idx'),
    ]

    operations = [
        migrations.AddField(
            model_name='examschedule',
            name='subject_extensions',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='Custom per-subject marks entry deadlines set by administrators',
            ),
        ),
    ]
