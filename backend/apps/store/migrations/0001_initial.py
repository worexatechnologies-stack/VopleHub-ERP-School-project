from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('schools', '0011_remove_legacy_logo_file'),
    ]

    operations = [
        migrations.CreateModel(
            name='StorePaymentSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key_id', models.CharField(blank=True, max_length=128)),
                ('encrypted_key_secret', models.TextField(blank=True)),
                ('test_mode', models.BooleanField(default=True)),
                ('enabled', models.BooleanField(default=False)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('school', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='store_payment_settings', to='schools.school')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='store_payment_settings_updates', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='StoreProduct',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=180)),
                ('sku', models.CharField(max_length=64)),
                ('description', models.TextField(blank=True)),
                ('image_url', models.URLField(blank=True, max_length=500)),
                ('price', models.DecimalField(decimal_places=2, max_digits=12, validators=[django.core.validators.MinValueValidator(0.01)])),
                ('stock_quantity', models.PositiveIntegerField(default=0)),
                ('reserved_quantity', models.PositiveIntegerField(default=0, editable=False)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='store_products_created', to=settings.AUTH_USER_MODEL)),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='store_products', to='schools.school')),
            ],
            options={'ordering': ['name'], 'indexes': [models.Index(fields=['school', 'is_active'], name='store_storep_school__5f946c_idx'), models.Index(fields=['school', 'sku'], name='store_storep_school__3780f9_idx')], 'constraints': [models.UniqueConstraint(fields=('school', 'sku'), name='unique_store_product_sku_per_school')]},
        ),
        migrations.CreateModel(
            name='StoreOrder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('Pending', 'Pending payment'), ('Paid', 'Paid'), ('Failed', 'Payment failed'), ('Cancelled', 'Cancelled'), ('Expired', 'Expired'), ('Fulfilled', 'Fulfilled')], default='Pending', max_length=16)),
                ('subtotal', models.DecimalField(decimal_places=2, max_digits=12)),
                ('currency', models.CharField(default='INR', max_length=3)),
                ('buyer_name', models.CharField(max_length=160)),
                ('buyer_email', models.EmailField(max_length=254)),
                ('buyer_phone', models.CharField(blank=True, max_length=30)),
                ('delivery_address', models.TextField(blank=True)),
                ('gateway_order_id', models.CharField(blank=True, max_length=100, null=True, unique=True)),
                ('gateway_payment_id', models.CharField(blank=True, max_length=100)),
                ('gateway_signature', models.CharField(blank=True, max_length=128)),
                ('expires_at', models.DateTimeField()),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('buyer', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='store_orders', to=settings.AUTH_USER_MODEL)),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='store_orders', to='schools.school')),
            ],
            options={'ordering': ['-created_at'], 'indexes': [models.Index(fields=['school', 'status', '-created_at'], name='store_storeo_school__b2a0dc_idx'), models.Index(fields=['buyer', '-created_at'], name='store_storeo_buyer_i_9936c5_idx')]},
        ),
        migrations.CreateModel(
            name='StoreOrderItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('product_name', models.CharField(max_length=180)),
                ('unit_price', models.DecimalField(decimal_places=2, max_digits=12)),
                ('quantity', models.PositiveIntegerField(validators=[django.core.validators.MinValueValidator(1)])),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='store.storeorder')),
                ('product', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='order_items', to='store.storeproduct')),
            ],
            options={'constraints': [models.UniqueConstraint(fields=('order', 'product'), name='unique_store_order_product')]},
        ),
    ]
