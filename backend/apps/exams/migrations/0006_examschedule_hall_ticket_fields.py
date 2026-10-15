from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('exams', '0005_exam_end_time_examschedule_exam_schedule_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='examschedule',
            name='hall_tickets_generated',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='hall_tickets_released',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='hall_tickets_released_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
