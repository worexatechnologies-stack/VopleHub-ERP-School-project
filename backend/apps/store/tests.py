import hashlib
import hmac
import json
from io import BytesIO

from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.schools.models import School
from .models import StoreOrder, StorePaymentSettings, StoreProduct


@override_settings(
    RAZORPAY_DUMMY_MODE=True,
    RAZORPAY_KEY_ID='rzp_test_dummy',
    RAZORPAY_KEY_SECRET='dummy-secret',
)
class StoreTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Store Academy', code='store-academy')
        self.other_school = School.objects.create(name='Other Academy', code='other-academy')
        self.admin = User.objects.create_user(username='store-admin', email='admin@store.test', password='StrongPass123!', role=User.Role.SCHOOL_ADMIN, school=self.school)
        self.parent = User.objects.create_user(username='store-parent', email='parent@store.test', password='StrongPass123!', role=User.Role.PARENT, school=self.school)
        self.foreign_parent = User.objects.create_user(username='foreign-parent', email='parent@other.test', password='StrongPass123!', role=User.Role.PARENT, school=self.other_school)
        self.client = APIClient()

    def test_only_school_admin_can_manage_stock_and_users_can_order(self):
        self.client.force_authenticate(self.admin)
        created = self.client.post('/api/v1/store/products/', {
            'name': 'School Hoodie', 'sku': 'hoodie-001', 'price': '1200.00', 'stockQuantity': 2,
        }, format='json')
        self.assertEqual(created.status_code, 201)
        product_id = created.data['id']

        self.client.force_authenticate(self.parent)
        self.assertEqual(self.client.get('/api/v1/store/products/').status_code, 200)
        self.assertEqual(self.client.post('/api/v1/store/products/', {'name': 'Nope', 'sku': 'nope', 'price': '1.00', 'stockQuantity': 1}, format='json').status_code, 403)

        order = self.client.post('/api/v1/store/orders/', {
            'items': [{'productId': product_id, 'quantity': 1}],
            'buyerName': 'Parent User', 'buyerPhone': '9000000000', 'deliveryAddress': 'School office',
        }, format='json')
        self.assertEqual(order.status_code, 201)
        self.assertTrue(order.data['checkout']['demoMode'])
        self.assertEqual(order.data['subtotal'], '1200.00')
        order_id = order.data['id']

        completed = self.client.post(f'/api/v1/store/orders/{order_id}/demo-complete/')
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.data['status'], 'Paid')
        product = StoreProduct.objects.get(pk=product_id)
        self.assertEqual(product.stock_quantity, 1)
        self.assertEqual(product.reserved_quantity, 0)

    def test_school_tenant_isolation_and_payment_settings_are_masked(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put('/api/v1/store/payment-settings/', {
            'keyId': 'rzp_test_school', 'keySecret': 'server-only-secret',
            'webhookSecret': 'server-only-webhook-secret', 'testMode': True, 'enabled': True,
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('server-only-secret', response.data)
        self.assertTrue(response.data['keySecretConfigured'])
        self.assertTrue(response.data['webhookSecretConfigured'])

        self.client.force_authenticate(self.foreign_parent)
        self.assertEqual(self.client.get('/api/v1/store/products/').data['results'], [])
        self.assertEqual(self.client.get('/api/v1/store/orders/').data['results'], [])

    def test_payment_settings_require_key_mode_to_match_selected_mode(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put('/api/v1/store/payment-settings/', {
            'keyId': 'rzp_live_wrong_mode',
            'keySecret': 'server-only-secret',
            'webhookSecret': 'server-only-webhook-secret',
            'testMode': True,
            'enabled': True,
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('keyId', response.data)

    def test_stock_is_not_oversold(self):
        self.client.force_authenticate(self.admin)
        product = StoreProduct.objects.create(school=self.school, name='Badge', sku='badge-001', price='100.00', stock_quantity=1, created_by=self.admin)
        self.client.force_authenticate(self.parent)
        first = self.client.post('/api/v1/store/orders/', {
            'items': [{'productId': product.id, 'quantity': 1}],
            'buyerName': 'Parent User',
            'buyerPhone': '9000000000',
        }, format='json')
        self.assertEqual(first.status_code, 201)
        second = self.client.post('/api/v1/store/orders/', {
            'items': [{'productId': product.id, 'quantity': 1}],
            'buyerName': 'Parent User',
            'buyerPhone': '9000000000',
        }, format='json')
        self.assertEqual(second.status_code, 400)
        self.assertEqual(StoreOrder.objects.count(), 1)

    def test_signed_webhook_completes_order_after_browser_callback_is_lost(self):
        self.client.force_authenticate(self.admin)
        StorePaymentSettings.objects.create(
            school=self.school,
            key_id='rzp_test_school',
            encrypted_key_secret='',
            enabled=True,
        )
        payment_settings = StorePaymentSettings.objects.get(school=self.school)
        payment_settings.set_key_secret('key-secret')
        payment_settings.set_webhook_secret('webhook-secret')
        payment_settings.save()
        product = StoreProduct.objects.create(school=self.school, name='Notebook', sku='note-001', price='50.00', stock_quantity=1, created_by=self.admin)
        self.client.force_authenticate(self.parent)
        created = self.client.post('/api/v1/store/orders/', {
            'items': [{'productId': product.id, 'quantity': 1}],
            'buyerName': 'Parent User',
            'buyerPhone': '9000000000',
        }, format='json')
        self.assertEqual(created.status_code, 201)
        order = StoreOrder.objects.get(pk=created.data['id'])
        payload = {'event': 'payment.captured', 'payload': {'payment': {'entity': {'id': 'pay_webhook_1', 'order_id': order.gateway_order_id}}}}
        raw = json.dumps(payload, separators=(',', ':')).encode()
        signature = hmac.new(b'webhook-secret', raw, hashlib.sha256).hexdigest()
        response = self.client.post('/api/v1/store/razorpay/webhook/', data=raw, content_type='application/json', HTTP_X_RAZORPAY_SIGNATURE=signature)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(StoreOrder.objects.get(pk=order.pk).status, StoreOrder.Status.PAID)

    def test_admin_can_upload_a_valid_product_photo_and_other_users_can_view_it(self):
        image = BytesIO()
        Image.new('RGB', (24, 24), (82, 67, 240)).save(image, format='PNG')
        image.seek(0)
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/v1/store/products/', {
            'name': 'School Cap', 'sku': 'cap-001', 'price': '350.00', 'stockQuantity': '2',
            'category': 'Uniforms', 'targetClasses': json.dumps(['1', '3']),
            'uniformType': 'Daily uniform', 'sizeLabel': '28',
            'imageFile': SimpleUploadedFile('cap.png', image.read(), content_type='image/png'),
        }, format='multipart')
        self.assertEqual(response.status_code, 201)
        self.assertIn('/image/', response.data['imageUrl'])
        self.assertEqual(response.data['targetClasses'], ['1', '3'])
        self.assertEqual(response.data['uniformType'], 'Daily uniform')
        self.assertTrue(StoreProduct.objects.get(pk=response.data['id']).is_active)
        self.client.force_authenticate(self.parent)
        self.assertTrue(StoreProduct.objects.filter(pk=response.data['id'], school=self.school).exists())
        self.assertEqual(self.client.get('/api/v1/store/products/').data['results'][0]['id'], response.data['id'])
        image_response = self.client.get(response.data['imageUrl'])
        self.assertEqual(image_response.status_code, 200, image_response.content)
        self.assertEqual(image_response['Content-Type'], 'image/webp')

    def test_product_without_photo_saves_class_and_uniform_details(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/v1/store/products/', {
            'name': 'Sports socks',
            'sku': 'SOCK-SPORT-02',
            'category': 'Uniforms',
            'targetClasses': ['2', '4'],
            'uniformType': 'Sports uniform',
            'sizeLabel': '32',
            'price': '1200.00',
            'stockQuantity': 12,
            'description': 'Sports uniform socks',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        product = StoreProduct.objects.get(pk=response.data['id'])
        self.assertEqual(product.category, 'Uniforms')
        self.assertEqual(product.target_classes, ['2', '4'])
        self.assertEqual(product.uniform_type, 'Sports uniform')
        self.assertEqual(product.size_label, '32')

    def test_uniform_size_variants_get_generated_skus_and_order_quantity_reduces_that_size(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/v1/store/products/', {
            'name': 'Daily uniform',
            'category': 'Uniforms',
            'targetClasses': json.dumps(['1', '2']),
            'uniformType': 'Daily uniform',
            'sizeVariants': json.dumps([
                {'sizeLabel': '28', 'stockQuantity': 10},
                {'sizeLabel': '30', 'stockQuantity': 8},
            ]),
            'price': '500.00',
        }, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        variants = list(StoreProduct.objects.filter(variant_group=response.data['variantGroup']).order_by('size_label'))
        self.assertEqual([variant.size_label for variant in variants], ['28', '30'])
        self.assertEqual([variant.stock_quantity for variant in variants], [10, 8])
        self.assertEqual(len({variant.sku for variant in variants}), 2)
        self.assertTrue(all(variant.sku.startswith('ST-') for variant in variants))

        self.client.force_authenticate(self.parent)
        order = self.client.post('/api/v1/store/orders/', {
            'items': [{'productId': variants[0].id, 'quantity': 3}],
            'buyerName': 'Parent User',
            'buyerPhone': '9000000000',
        }, format='json')
        self.assertEqual(order.status_code, 201, order.data)
        self.assertEqual(order.data['items'][0]['productName'], 'Daily uniform · Size 28')
        variants[0].refresh_from_db()
        variants[1].refresh_from_db()
        self.assertEqual(variants[0].available_stock, 7)
        self.assertEqual(variants[1].available_stock, 8)

        oversize = self.client.post('/api/v1/store/orders/', {
            'items': [{'productId': variants[0].id, 'quantity': 8}],
            'buyerName': 'Parent User',
            'buyerPhone': '9000000000',
        }, format='json')
        self.assertEqual(oversize.status_code, 400)

        self.client.post(f"/api/v1/store/orders/{order.data['id']}/demo-complete/")
        variants[0].refresh_from_db()
        self.assertEqual(variants[0].stock_quantity, 7)
        self.assertEqual(variants[0].reserved_quantity, 0)
