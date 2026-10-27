from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('store', '0004_storeproduct_image_data_storeproduct_image_content_type'),
    ]

    operations = [
        migrations.AddField(
            model_name='storeproduct',
            name='category',
            field=models.CharField(default='Other', max_length=40),
        ),
        migrations.AddField(
            model_name='storeproduct',
            name='size_label',
            field=models.CharField(blank=True, max_length=30),
        ),
        migrations.AddField(
            model_name='storeproduct',
            name='target_classes',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='storeproduct',
            name='uniform_type',
            field=models.CharField(blank=True, max_length=80),
        ),
    ]
