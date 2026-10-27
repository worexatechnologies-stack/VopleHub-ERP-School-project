from decimal import Decimal
import re
import uuid

from django.db import transaction
from rest_framework import serializers

from apps.common.validators import optimize_raster_image, validate_raster_image_upload

from .models import StoreProduct, StorePaymentSettings, StoreOrder, StoreOrderItem


class StoreProductSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(read_only=True)
    variantGroup = serializers.UUIDField(source='variant_group', read_only=True)
    availableStock = serializers.IntegerField(source='available_stock', read_only=True)
    imageUrl = serializers.URLField(source='image_url', read_only=True)
    category = serializers.CharField(max_length=40, required=False)
    targetClasses = serializers.JSONField(source='target_classes', required=False)
    uniformType = serializers.CharField(source='uniform_type', max_length=80, required=False, allow_blank=True)
    sizeLabel = serializers.CharField(source='size_label', max_length=30, required=False, allow_blank=True)
    stockQuantity = serializers.IntegerField(source='stock_quantity', required=False, min_value=0)
    isActive = serializers.BooleanField(source='is_active', required=False, default=True)
    imageFile = serializers.FileField(write_only=True, required=False, allow_null=True)
    sizeVariants = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = StoreProduct
        fields = ['id', 'name', 'sku', 'variantGroup', 'description', 'category', 'targetClasses', 'uniformType', 'sizeLabel', 'sizeVariants', 'imageUrl', 'imageFile', 'price', 'stockQuantity', 'availableStock', 'isActive', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at', 'availableStock']

    def validate(self, attrs):
        if self.instance and 'stock_quantity' in attrs and attrs['stock_quantity'] < self.instance.reserved_quantity:
            raise serializers.ValidationError({'stockQuantity': f'Stock cannot be lower than the {self.instance.reserved_quantity} units currently reserved.'})
        target_classes = attrs.get('target_classes', getattr(self.instance, 'target_classes', []))
        if not isinstance(target_classes, list) or any(str(value) not in {str(grade) for grade in range(1, 11)} for value in target_classes):
            raise serializers.ValidationError({'targetClasses': 'Choose grades from 1 to 10.'})
        category = attrs.get('category', getattr(self.instance, 'category', 'Other'))
        uniform_type = attrs.get('uniform_type', getattr(self.instance, 'uniform_type', ''))
        size_label = attrs.get('size_label', getattr(self.instance, 'size_label', ''))
        variants = attrs.get('sizeVariants')
        if variants is not None:
            if self.instance:
                raise serializers.ValidationError({'sizeVariants': 'Edit one size variant at a time.'})
            if category != 'Uniforms':
                raise serializers.ValidationError({'sizeVariants': 'Size variants are only available for uniforms.'})
            if not isinstance(variants, list) or not 1 <= len(variants) <= 20:
                raise serializers.ValidationError({'sizeVariants': 'Add between 1 and 20 size variants.'})
            normalized = []
            seen = set()
            for variant in variants:
                if not isinstance(variant, dict):
                    raise serializers.ValidationError({'sizeVariants': 'Each size needs a size label and stock quantity.'})
                label = str(variant.get('sizeLabel', '')).strip()
                try:
                    quantity = int(variant.get('stockQuantity'))
                except (TypeError, ValueError):
                    raise serializers.ValidationError({'sizeVariants': 'Enter a whole stock quantity for each size.'})
                if not label or len(label) > 30 or quantity < 0:
                    raise serializers.ValidationError({'sizeVariants': 'Each size needs a label (up to 30 characters) and a stock quantity of 0 or more.'})
                normalized_label = label.casefold()
                if normalized_label in seen:
                    raise serializers.ValidationError({'sizeVariants': f'Size "{label}" is listed more than once.'})
                seen.add(normalized_label)
                normalized.append({'size_label': label, 'stock_quantity': quantity})
            attrs['sizeVariants'] = normalized
        if category == 'Uniforms' and (not uniform_type.strip() or (variants is None and not size_label.strip())):
            raise serializers.ValidationError({'uniformType': 'Choose a uniform type and add at least one size with its stock quantity.'})
        return attrs

    def validate_imageFile(self, value):
        if value is not None:
            validate_raster_image_upload(value)
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.image_data:
            data['imageUrl'] = f'/api/v1/store/products/{instance.pk}/image/'
        return data

    @staticmethod
    def _store_image(instance, image_file):
        if image_file is None:
            instance.image_data = None
            instance.image_content_type = ''
        else:
            instance.image_data, instance.image_content_type, _ = optimize_raster_image(image_file)
        instance.save(update_fields=['image_data', 'image_content_type'])

    def create(self, validated_data):
        image_file = validated_data.pop('imageFile', serializers.empty)
        variants = validated_data.pop('sizeVariants', None)
        school_id = validated_data.pop('school_id', None)
        created_by = validated_data.pop('created_by', None)
        if not variants:
            validated_data['sku'] = f'ST-{uuid.uuid4().hex[:16].upper()}'
            instance = StoreProduct.objects.create(school_id=school_id, created_by=created_by, **validated_data)
            if image_file is not serializers.empty:
                self._store_image(instance, image_file)
            return instance

        validated_data.pop('stock_quantity', None)
        group_id = uuid.uuid4()
        first = None
        with transaction.atomic():
            for index, variant in enumerate(variants):
                instance = StoreProduct.objects.create(
                    school_id=school_id,
                    created_by=created_by,
                    sku=f'ST-{uuid.uuid4().hex[:16].upper()}',
                    variant_group=group_id,
                    size_label=variant['size_label'],
                    stock_quantity=variant['stock_quantity'],
                    **validated_data,
                )
                if first is None:
                    first = instance
            if first and image_file is not serializers.empty:
                self._store_image(first, image_file)
        return first

    def update(self, instance, validated_data):
        image_file = validated_data.pop('imageFile', serializers.empty)
        instance = super().update(instance, validated_data)
        if image_file is not serializers.empty:
            self._store_image(instance, image_file)
        return instance


class StorePaymentSettingsSerializer(serializers.ModelSerializer):
    keyId = serializers.CharField(source='key_id', required=False, allow_blank=True)
    keySecret = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    webhookSecret = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    keySecretConfigured = serializers.SerializerMethodField(read_only=True)
    webhookSecretConfigured = serializers.SerializerMethodField(read_only=True)
    testMode = serializers.BooleanField(source='test_mode', required=False)
    enabled = serializers.BooleanField(required=False)

    class Meta:
        model = StorePaymentSettings
        fields = ['keyId', 'keySecret', 'keySecretConfigured', 'webhookSecret', 'webhookSecretConfigured', 'testMode', 'enabled', 'updated_at']
        read_only_fields = ['updated_at', 'keySecretConfigured', 'webhookSecretConfigured']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance
        key_id = attrs.get('key_id', getattr(instance, 'key_id', ''))
        test_mode = attrs.get('test_mode', getattr(instance, 'test_mode', True))
        enabled = attrs.get('enabled', getattr(instance, 'enabled', False))
        expected_prefix = 'rzp_test_' if test_mode else 'rzp_live_'

        if key_id and not key_id.startswith(expected_prefix):
            mode_name = 'Test' if test_mode else 'Live'
            raise serializers.ValidationError({
                'keyId': f'{mode_name} mode requires a Razorpay Key ID starting with {expected_prefix}.'
            })

        if instance and test_mode != instance.test_mode and not attrs.get('keySecret'):
            raise serializers.ValidationError({
                'keySecret': 'Razorpay uses separate secrets for test and live keys. Enter the secret for the selected mode.'
            })

        if instance and test_mode != instance.test_mode and not attrs.get('webhookSecret'):
            raise serializers.ValidationError({
                'webhookSecret': 'Enter the webhook secret configured for the selected Razorpay mode.'
            })

        has_key_secret = bool(attrs.get('keySecret')) or bool(instance and instance.encrypted_key_secret)
        has_webhook_secret = bool(attrs.get('webhookSecret')) or bool(instance and instance.encrypted_webhook_secret)
        if enabled and (not key_id or not has_key_secret or not has_webhook_secret):
            raise serializers.ValidationError({
                'enabled': 'Enter a matching Razorpay Key ID, Key Secret, and Webhook Secret before enabling payments.'
            })
        return attrs

    def get_keySecretConfigured(self, obj):
        return bool(obj.encrypted_key_secret)

    def get_webhookSecretConfigured(self, obj):
        return bool(obj.encrypted_webhook_secret)

    def update(self, instance, validated_data):
        secret = validated_data.pop('keySecret', serializers.empty)
        webhook_secret = validated_data.pop('webhookSecret', serializers.empty)
        instance = super().update(instance, validated_data)
        update_fields = ['updated_at']
        if secret is not serializers.empty:
            instance.set_key_secret(secret)
            update_fields.append('encrypted_key_secret')
        if webhook_secret is not serializers.empty:
            instance.set_webhook_secret(webhook_secret)
            update_fields.append('encrypted_webhook_secret')
        if len(update_fields) > 1:
            instance.save(update_fields=update_fields)
        return instance


class StoreOrderItemSerializer(serializers.ModelSerializer):
    productId = serializers.IntegerField(source='product_id', read_only=True)
    unitPrice = serializers.DecimalField(source='unit_price', max_digits=12, decimal_places=2, read_only=True)
    productName = serializers.CharField(source='product_name', read_only=True)
    category = serializers.CharField(source='product.category', read_only=True)
    uniformType = serializers.CharField(source='product.uniform_type', read_only=True)

    class Meta:
        model = StoreOrderItem
        fields = ['productId', 'productName', 'category', 'uniformType', 'unitPrice', 'quantity']


class StoreOrderSerializer(serializers.ModelSerializer):
    buyerName = serializers.CharField(source='buyer_name', read_only=True)
    buyerRole = serializers.CharField(source='buyer.role', read_only=True)
    buyerEmail = serializers.EmailField(source='buyer_email', read_only=True)
    buyerPhone = serializers.CharField(source='buyer_phone', read_only=True)
    deliveryAddress = serializers.CharField(source='delivery_address', read_only=True)
    gatewayOrderId = serializers.CharField(source='gateway_order_id', read_only=True)
    paymentId = serializers.CharField(source='gateway_payment_id', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    paidAt = serializers.DateTimeField(source='paid_at', read_only=True)
    items = StoreOrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = StoreOrder
        fields = ['id', 'status', 'subtotal', 'currency', 'buyerName', 'buyerRole', 'buyerEmail', 'buyerPhone', 'deliveryAddress', 'gatewayOrderId', 'paymentId', 'items', 'createdAt', 'paidAt', 'expires_at']


class StoreOrderCreateSerializer(serializers.Serializer):
    items = serializers.ListField(child=serializers.DictField(), allow_empty=False)
    buyerName = serializers.CharField(max_length=160, required=True, allow_blank=False, trim_whitespace=True)
    buyerPhone = serializers.RegexField(
        regex=r'^\+?[0-9][0-9\s()-]{7,18}$',
        max_length=30,
        required=True,
        error_messages={'invalid': 'Enter a valid phone number with at least 9 digits.'},
    )
    deliveryAddress = serializers.CharField(max_length=1000, required=False, allow_blank=True)

    def validate_buyerPhone(self, value):
        if len(re.sub(r'\D', '', value)) < 9:
            raise serializers.ValidationError('Enter a valid phone number with at least 9 digits.')
        return value

    def validate_items(self, value):
        normalized = []
        seen = set()
        for item in value:
            try:
                product_id = int(item.get('productId'))
                quantity = int(item.get('quantity'))
            except (TypeError, ValueError):
                raise serializers.ValidationError('Each item needs a valid productId and quantity.')
            if product_id in seen or quantity < 1 or quantity > 100:
                raise serializers.ValidationError('Items must be unique and quantities must be between 1 and 100.')
            seen.add(product_id)
            normalized.append({'product_id': product_id, 'quantity': quantity})
        return normalized
