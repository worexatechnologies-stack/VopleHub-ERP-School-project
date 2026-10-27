from django.db import migrations, models
from django.db.models import Value


class Migration(migrations.Migration):
    dependencies = [
        ('store', '0005_storeproduct_category_storeproduct_size_label_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='storeproduct',
            name='category',
            field=models.CharField(db_default='Other', default='Other', max_length=40),
        ),
        migrations.AlterField(
            model_name='storeproduct',
            name='size_label',
            field=models.CharField(blank=True, db_default='', max_length=30),
        ),
        migrations.AlterField(
            model_name='storeproduct',
            name='target_classes',
            field=models.JSONField(blank=True, db_default=Value([]), default=list),
        ),
        migrations.AlterField(
            model_name='storeproduct',
            name='uniform_type',
            field=models.CharField(blank=True, db_default='', max_length=80),
        ),
    ]
