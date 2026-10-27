from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('community', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='schoolevent',
            name='organizer',
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name='schoolevent',
            name='contact_details',
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name='schoolevent',
            name='meeting_url',
            field=models.URLField(blank=True, max_length=500),
        ),
    ]
