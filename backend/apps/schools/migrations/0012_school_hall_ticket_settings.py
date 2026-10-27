from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('schools', '0011_remove_legacy_logo_file')]

    operations = [
        migrations.AddField(
            model_name='school',
            name='hall_ticket_settings',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
