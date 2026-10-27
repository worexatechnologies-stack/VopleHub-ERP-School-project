from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('community', '0002_schoolevent_details'),
    ]

    operations = [
        migrations.AddField(
            model_name='schoolevent',
            name='image_content_type',
            field=models.CharField(blank=True, editable=False, max_length=32),
        ),
        migrations.AddField(
            model_name='schoolevent',
            name='image_data',
            field=models.BinaryField(blank=True, editable=False, null=True),
        ),
    ]
