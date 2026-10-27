import hashlib
import hmac
import logging
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.http import HttpRequest, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser

from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet

from .models import StoreOrder, StoreOrderItem, StorePaymentSettings, StoreProduct
from .serializers import (
    StoreOrderCreateSerializer,
    StoreOrderSerializer,
    StorePaymentSettingsSerializer,
    StoreProductSerializer,
)

logger = logging.getLogger(__name__)


def _is_school_admin(user):
    return bool(user and user.is_authenticated and user.role == User.Role.SCHOOL_ADMIN and user.school_id)


class StoreProductPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        # Stock is owned by a school tenant.  A platform super-admin has no
        # tenant context here, so only that school's admin may mutate it.
        return request.user.role == User.Role.SCHOOL_ADMIN and bool(request.user.school_id)

    def has_object_permission(self, request, view, obj):
        if obj.school_id != request.user.school_id:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role == User.Role.SCHOOL_ADMIN


class StoreProductViewSet(TenantScopedViewSet):
    queryset = StoreProduct.objects.select_related('school', 'created_by')
    serializer_class = StoreProductSerializer
    permission_classes = [StoreProductPermission]
    search_fields = ['name', 'sku', 'description']
    filterset_fields = ['is_active']
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            qs = qs.filter(is_active=True)
        elif self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        if not user.school_id:
            raise ValidationError({'detail': 'A school tenant is required.'})
        serializer.save(school_id=user.school_id, created_by=user)

    @action(detail=True, methods=['get'], url_path='image')
    def image(self, request, pk=None):
        product = self.get_object()
        if not product.image_data:
            return Response({'detail': 'Product image not found.'}, status=status.HTTP_404_NOT_FOUND)
        return HttpResponse(product.image_data, content_type=product.image_content_type or 'image/webp')


class StoreOrderPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.school_id)

    def has_object_permission(self, request, view, obj):
        if obj.school_id != request.user.school_id:
            return False
        return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN] or obj.buyer_id == request.user.id


def _expire_pending_orders(school_id):
    now = timezone.now()
    expired = StoreOrder.objects.filter(school_id=school_id, status=StoreOrder.Status.PENDING, expires_at__lt=now).prefetch_related('items')
    for order in expired:
        for item in order.items.all():
            StoreProduct.objects.filter(pk=item.product_id, reserved_quantity__gte=item.quantity).update(
                reserved_quantity=models.F('reserved_quantity') - item.quantity
            )
        order.status = StoreOrder.Status.EXPIRED
        order.save(update_fields=['status', 'updated_at'])


def _release_order_reservations(order):
    for item in order.items.all():
        StoreProduct.objects.filter(pk=item.product_id, reserved_quantity__gte=item.quantity).update(
            reserved_quantity=models.F('reserved_quantity') - item.quantity
        )


def _gateway_config(school_id):
    configured = StorePaymentSettings.objects.filter(school_id=school_id).first()
    dummy_mode = bool(getattr(settings, 'RAZORPAY_DUMMY_MODE', False))
    if configured and configured.enabled and configured.key_id and configured.get_key_secret():
        expected_prefix = 'rzp_test_' if configured.test_mode else 'rzp_live_'
        if not configured.key_id.startswith(expected_prefix):
            logger.error('Razorpay key mode mismatch for school=%s', school_id)
            return None
        # Explicit school credentials always use the real Razorpay gateway,
        # including test keys. The global dummy flag is only a fallback when
        # no school credentials have been configured.
        return configured.key_id, configured.get_key_secret(), False
    if dummy_mode:
        key_id = getattr(settings, 'RAZORPAY_KEY_ID', '') or f'rzp_test_dummy_{school_id}'
        key_secret = getattr(settings, 'RAZORPAY_KEY_SECRET', '') or 'dummy-secret'
        return key_id, key_secret, True
    return None


def _create_gateway_order(*, school_id, order_id, amount, currency):
    config = _gateway_config(school_id)
    if not config:
        raise ValidationError({'detail': 'Razorpay is not configured for this school. Ask the School Admin to add the payment credentials.'})
    key_id, key_secret, dummy_mode = config
    if dummy_mode:
        return {'id': f'dummy_order_{uuid.uuid4().hex}', 'amount': int(amount * 100), 'currency': currency, 'key_id': key_id, 'demo_mode': True}
    try:
        import razorpay
        client = razorpay.Client(auth=(key_id, key_secret))
        result = client.order.create({'amount': int(amount * 100), 'currency': currency, 'receipt': f'store-{order_id}'})
        return {'id': result['id'], 'amount': result['amount'], 'currency': result['currency'], 'key_id': key_id, 'demo_mode': False}
    except ImportError as exc:
        raise APIException('Razorpay integration is not installed on the server.') from exc
    except Exception as exc:
        logger.exception('Razorpay order creation failed for school=%s', school_id)
        raise APIException('Unable to start Razorpay checkout. Please try again.') from exc


def _mark_order_paid(order, *, payment_id, signature=''):
    if order.status == StoreOrder.Status.PAID:
        return order
    if order.status != StoreOrder.Status.PENDING or order.expires_at < timezone.now():
        raise ValidationError({'detail': 'This order is no longer payable.'})
    for item in order.items.select_related('product').select_for_update():
        product = StoreProduct.objects.select_for_update().get(pk=item.product_id)
        if product.reserved_quantity < item.quantity or product.stock_quantity < item.quantity:
            raise ValidationError({'detail': f'Stock is no longer available for {item.product_name}.'})
        product.reserved_quantity -= item.quantity
        product.stock_quantity -= item.quantity
        product.save(update_fields=['reserved_quantity', 'stock_quantity', 'updated_at'])
    order.status = StoreOrder.Status.PAID
    order.gateway_payment_id = payment_id
    order.gateway_signature = signature
    order.paid_at = timezone.now()
    order.save(update_fields=['status', 'gateway_payment_id', 'gateway_signature', 'paid_at', 'updated_at'])
    return order


class StoreOrderViewSet(TenantScopedViewSet):
    queryset = StoreOrder.objects.select_related('school', 'buyer').prefetch_related('items__product')
    serializer_class = StoreOrderSerializer
    permission_classes = [StoreOrderPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            qs = qs.filter(buyer=user)
        return qs

    def create(self, request, *args, **kwargs):
        input_serializer = StoreOrderCreateSerializer(data=request.data, context={'request': request})
        input_serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.school_id:
            return Response({'detail': 'A school tenant is required.'}, status=status.HTTP_400_BAD_REQUEST)
        school_id = user.school_id
        with transaction.atomic():
            _expire_pending_orders(school_id)
            requested = input_serializer.validated_data['items']
            product_ids = [item['product_id'] for item in requested]
            products = {
                p.id: p for p in StoreProduct.objects.select_for_update().filter(
                    school_id=school_id, id__in=product_ids, is_active=True
                )
            }
            if len(products) != len(product_ids):
                raise ValidationError({'detail': 'One or more selected products are unavailable.'})
            subtotal = Decimal('0.00')
            for item in requested:
                product = products[item['product_id']]
                if product.available_stock < item['quantity']:
                    raise ValidationError({'detail': f'Only {product.available_stock} units of {product.name} are available.'})
                subtotal += product.price * item['quantity']
            order = StoreOrder.objects.create(
                school_id=school_id,
                buyer=user,
                subtotal=subtotal,
                buyer_name=input_serializer.validated_data.get('buyerName') or user.get_full_name() or user.username,
                buyer_email=user.email,
                buyer_phone=input_serializer.validated_data.get('buyerPhone', ''),
                delivery_address=input_serializer.validated_data.get('deliveryAddress', ''),
                expires_at=timezone.now() + timedelta(minutes=15),
            )
            for item in requested:
                product = products[item['product_id']]
                qty = item['quantity']
                item_name = f'{product.name} · Size {product.size_label}' if product.size_label else product.name
                StoreOrderItem.objects.create(order=order, product=product, product_name=item_name, unit_price=product.price, quantity=qty)
                product.reserved_quantity += qty
                product.save(update_fields=['reserved_quantity', 'updated_at'])
            gateway = _create_gateway_order(school_id=school_id, order_id=order.id, amount=subtotal, currency=order.currency)
            order.gateway_order_id = gateway['id']
            order.save(update_fields=['gateway_order_id', 'updated_at'])
        payload = StoreOrderSerializer(order, context={'request': request}).data
        payload['checkout'] = {
            'keyId': gateway['key_id'],
            'orderId': gateway['id'],
            'amount': gateway['amount'],
            'currency': gateway['currency'],
            'demoMode': gateway['demo_mode'],
        }
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='verify-payment')
    def verify_payment(self, request, pk=None):
        order = self.get_object()
        payment_id = str(request.data.get('paymentId', '')).strip()
        signature = str(request.data.get('signature', '')).strip()
        config = _gateway_config(order.school_id)
        if not config or not payment_id or not signature:
            return Response({'detail': 'Payment verification data is incomplete.'}, status=status.HTTP_400_BAD_REQUEST)
        _, secret, dummy_mode = config
        expected = hmac.new(secret.encode(), f'{order.gateway_order_id}|{payment_id}'.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            with transaction.atomic():
                order = StoreOrder.objects.select_for_update().get(pk=order.pk)
                if order.status == StoreOrder.Status.PENDING:
                    _release_order_reservations(order)
                    order.status = StoreOrder.Status.FAILED
                    order.save(update_fields=['status', 'updated_at'])
            return Response({'detail': 'Payment signature verification failed.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            order = StoreOrder.objects.select_for_update().get(pk=order.pk)
            _mark_order_paid(order, payment_id=payment_id, signature=signature)
        return Response(StoreOrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='demo-complete')
    def demo_complete(self, request, pk=None):
        if not getattr(settings, 'RAZORPAY_DUMMY_MODE', False):
            return Response({'detail': 'Demo payments are disabled.'}, status=status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            order = StoreOrder.objects.select_for_update().get(pk=self.get_object().pk)
            _mark_order_paid(order, payment_id=f'dummy_payment_{uuid.uuid4().hex}')
        return Response(StoreOrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        with transaction.atomic():
            order = StoreOrder.objects.select_for_update().get(pk=self.get_object().pk)
            if order.status == StoreOrder.Status.PENDING:
                _release_order_reservations(order)
                order.status = StoreOrder.Status.CANCELLED
                order.save(update_fields=['status', 'updated_at'])
        return Response(StoreOrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def fulfill(self, request, pk=None):
        if not _is_school_admin(request.user):
            return Response({'detail': 'Only school admins can fulfill orders.'}, status=status.HTTP_403_FORBIDDEN)
        order = self.get_object()
        if order.status not in (StoreOrder.Status.PAID, StoreOrder.Status.FULFILLED):
            return Response(
                {'detail': f'Cannot fulfill order with status "{order.status}". Only paid orders can be fulfilled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        order.status = StoreOrder.Status.FULFILLED
        order.save(update_fields=['status', 'updated_at'])
        return Response(StoreOrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='unfulfill')
    def unfulfill(self, request, pk=None):
        if not _is_school_admin(request.user):
            return Response({'detail': 'Only school admins can update order status.'}, status=status.HTTP_403_FORBIDDEN)
        order = self.get_object()
        if order.status != StoreOrder.Status.FULFILLED:
            return Response({'detail': 'Only fulfilled orders can be returned to paid status.'}, status=status.HTTP_400_BAD_REQUEST)
        order.status = StoreOrder.Status.PAID
        order.save(update_fields=['status', 'updated_at'])
        return Response(StoreOrderSerializer(order, context={'request': request}).data)


class StorePaymentSettingsPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return _is_school_admin(request.user)


@api_view(['GET', 'PUT', 'PATCH'])
@permission_classes([StorePaymentSettingsPermission])
def store_payment_settings(request):
    settings_obj, _ = StorePaymentSettings.objects.get_or_create(school_id=request.user.school_id)
    if request.method == 'GET':
        return Response(StorePaymentSettingsSerializer(settings_obj).data)
    serializer = StorePaymentSettingsSerializer(settings_obj, data=request.data, partial=True, context={'request': request})
    serializer.is_valid(raise_exception=True)
    obj = serializer.save(updated_by=request.user)
    return Response(StorePaymentSettingsSerializer(obj).data)


@csrf_exempt
@api_view(['POST'])
@permission_classes([])
def razorpay_webhook(request: HttpRequest):
    """Accept signed Razorpay events so a closed browser cannot lose a payment."""
    event = request.data.get('event', '')
    entity = (((request.data.get('payload') or {}).get('payment') or {}).get('entity') or {})
    gateway_order_id = str(entity.get('order_id') or '').strip()
    if not gateway_order_id:
        return Response({'detail': 'Webhook order id is missing.'}, status=status.HTTP_400_BAD_REQUEST)
    order = StoreOrder.objects.filter(gateway_order_id=gateway_order_id).first()
    if not order:
        return Response({'detail': 'Unknown order.'}, status=status.HTTP_404_NOT_FOUND)
    payment_settings = StorePaymentSettings.objects.filter(school_id=order.school_id).first()
    webhook_secret = payment_settings.get_webhook_secret() if payment_settings else ''
    signature = request.headers.get('X-Razorpay-Signature', '')
    expected = hmac.new(webhook_secret.encode(), request.body, hashlib.sha256).hexdigest() if webhook_secret else ''
    if not webhook_secret or not signature or not hmac.compare_digest(expected, signature):
        return Response({'detail': 'Invalid webhook signature.'}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        locked_order = StoreOrder.objects.select_for_update().get(pk=order.pk)
        if event in ('payment.captured', 'payment.authorized'):
            _mark_order_paid(locked_order, payment_id=str(entity.get('id') or ''), signature=signature)
        elif event == 'payment.failed' and locked_order.status == StoreOrder.Status.PENDING:
            _release_order_reservations(locked_order)
            locked_order.status = StoreOrder.Status.FAILED
            locked_order.save(update_fields=['status', 'updated_at'])
    return Response({'received': True})
