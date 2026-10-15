from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('exams', '0007_examschedule_report_card_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='examschedule',
            name='marks_published',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='marks_published_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
