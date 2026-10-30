from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('common', '0003_platformsetting'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='adminauditevent',
            index=models.Index(fields=['school', '-created_at', '-id'], name='aud_school_created_id_idx'),
        ),
    ]
