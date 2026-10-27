# Generated manually for the store payment webhook secret.
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('store', '0002_store_index_names'),
    ]

    operations = [
        migrations.AddField(
            model_name='storepaymentsettings',
            name='encrypted_webhook_secret',
            field=models.TextField(blank=True),
        ),
    ]
