from decimal import Decimal
from django.db import migrations, models
import django.core.validators


class Migration(migrations.Migration):
    dependencies = [('store', '0001_initial')]

    operations = [
        migrations.RenameIndex(
            model_name='storeorder',
            new_name='store_store_school__7c7fa1_idx',
            old_name='store_storeo_school__b2a0dc_idx',
        ),
        migrations.RenameIndex(
            model_name='storeorder',
            new_name='store_store_buyer_i_0265cd_idx',
            old_name='store_storeo_buyer_i_9936c5_idx',
        ),
        migrations.RenameIndex(
            model_name='storeproduct',
            new_name='store_store_school__84e157_idx',
            old_name='store_storep_school__5f946c_idx',
        ),
        migrations.RenameIndex(
            model_name='storeproduct',
            new_name='store_store_school__89cea8_idx',
            old_name='store_storep_school__3780f9_idx',
        ),
        migrations.AlterField(
            model_name='storeproduct',
            name='price',
            field=models.DecimalField(decimal_places=2, max_digits=12, validators=[django.core.validators.MinValueValidator(Decimal('0.01'))]),
        ),
    ]
