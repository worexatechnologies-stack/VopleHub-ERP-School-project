from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('store', '0003_storepaymentsettings_encrypted_webhook_secret'),
    ]

    operations = [
        migrations.AddField(
            model_name='storeproduct',
            name='image_data',
            field=models.BinaryField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name='storeproduct',
            name='image_content_type',
            field=models.CharField(blank=True, editable=False, max_length=32),
        ),
    ]
