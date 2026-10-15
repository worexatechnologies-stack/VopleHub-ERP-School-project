from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('exams', '0006_examschedule_hall_ticket_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='examschedule',
            name='report_cards_generated',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='report_cards_published',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='report_cards_published_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
