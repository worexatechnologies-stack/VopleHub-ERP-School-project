from decimal import Decimal
from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Value
from django.utils import timezone

from .crypto import decrypt_secret, encrypt_secret


class StoreProduct(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='store_products')
    name = models.CharField(max_length=180)
    sku = models.CharField(max_length=64)
    variant_group = models.UUIDField(null=True, blank=True, editable=False, db_index=True)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=40, default='Other', db_default='Other')
    target_classes = models.JSONField(default=list, db_default=Value([]), blank=True)
    uniform_type = models.CharField(max_length=80, blank=True, db_default='')
    size_label = models.CharField(max_length=30, blank=True, db_default='')
    image_url = models.URLField(max_length=500, blank=True)
    image_data = models.BinaryField(blank=True, null=True, editable=False)
    image_content_type = models.CharField(max_length=32, blank=True, editable=False)
    price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    stock_quantity = models.PositiveIntegerField(default=0)
    reserved_quantity = models.PositiveIntegerField(default=0, editable=False)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='store_products_created')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['school', 'sku'], name='unique_store_product_sku_per_school'),
            models.UniqueConstraint(
                fields=['school', 'variant_group', 'size_label'],
                condition=models.Q(variant_group__isnull=False),
                name='unique_store_variant_size_per_school',
            ),
        ]
        indexes = [models.Index(fields=['school', 'is_active']), models.Index(fields=['school', 'sku'])]

    @property
    def available_stock(self):
        return max(0, self.stock_quantity - self.reserved_quantity)


class StorePaymentSettings(models.Model):
    school = models.OneToOneField('schools.School', on_delete=models.CASCADE, related_name='store_payment_settings')
    key_id = models.CharField(max_length=128, blank=True)
    encrypted_key_secret = models.TextField(blank=True)
    encrypted_webhook_secret = models.TextField(blank=True)
    test_mode = models.BooleanField(default=True)
    enabled = models.BooleanField(default=False)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='store_payment_settings_updates')
    updated_at = models.DateTimeField(auto_now=True)

    def set_key_secret(self, value: str):
        self.encrypted_key_secret = encrypt_secret(value) if value else ''

    def get_key_secret(self) -> str:
        return decrypt_secret(self.encrypted_key_secret)

    def set_webhook_secret(self, value: str):
        self.encrypted_webhook_secret = encrypt_secret(value) if value else ''

    def get_webhook_secret(self) -> str:
        return decrypt_secret(self.encrypted_webhook_secret)


class StoreOrder(models.Model):
    class Status(models.TextChoices):
        PENDING = 'Pending', 'Pending payment'
        PAID = 'Paid', 'Paid'
        FAILED = 'Failed', 'Payment failed'
        CANCELLED = 'Cancelled', 'Cancelled'
        EXPIRED = 'Expired', 'Expired'
        FULFILLED = 'Fulfilled', 'Fulfilled'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='store_orders')
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='store_orders')
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='INR')
    buyer_name = models.CharField(max_length=160)
    buyer_email = models.EmailField()
    buyer_phone = models.CharField(max_length=30, blank=True)
    delivery_address = models.TextField(blank=True)
    gateway_order_id = models.CharField(max_length=100, blank=True, unique=True, null=True)
    gateway_payment_id = models.CharField(max_length=100, blank=True)
    gateway_signature = models.CharField(max_length=128, blank=True)
    expires_at = models.DateTimeField()
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['school', 'status', '-created_at']), models.Index(fields=['buyer', '-created_at'])]


class StoreOrderItem(models.Model):
    order = models.ForeignKey(StoreOrder, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(StoreProduct, on_delete=models.PROTECT, related_name='order_items')
    product_name = models.CharField(max_length=180)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])

    class Meta:
        constraints = [models.UniqueConstraint(fields=['order', 'product'], name='unique_store_order_product')]
