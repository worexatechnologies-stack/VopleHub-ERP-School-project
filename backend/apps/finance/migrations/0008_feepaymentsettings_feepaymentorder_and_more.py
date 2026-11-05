from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0007_feepayment_fee_pmt_sch_dt_cr_idx_and_more'),
        ('schools', '0011_remove_legacy_logo_file'),
        ('sis', '0016_enrollmentapplication_document_key_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='FeePaymentSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key_id', models.CharField(blank=True, max_length=128)),
                ('encrypted_key_secret', models.TextField(blank=True)),
                ('encrypted_webhook_secret', models.TextField(blank=True)),
                ('test_mode', models.BooleanField(default=True)),
                ('enabled', models.BooleanField(default=False)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('school', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='fee_payment_settings', to='schools.school')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='fee_payment_settings_updates', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddField(
            model_name='feepayment',
            name='gateway_order_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='feepayment',
            name='gateway_payment_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='feepayment',
            name='gateway_signature',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='feepayment',
            name='status',
            field=models.CharField(default='Success', max_length=20),
        ),
        migrations.AddField(
            model_name='feepayment',
            name='payer_name',
            field=models.CharField(blank=True, default='', max_length=160),
        ),
        migrations.AddField(
            model_name='feepayment',
            name='payer_email',
            field=models.CharField(blank=True, default='', max_length=160),
        ),
        migrations.AddField(
            model_name='feepayment',
            name='payer_phone',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
        migrations.AddField(
            model_name='feepayment',
            name='notes',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.CreateModel(
            name='FeePaymentOrder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('gateway_order_id', models.CharField(db_index=True, max_length=100, unique=True)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('currency', models.CharField(default='INR', max_length=10)),
                ('category', models.CharField(default='School Fee Payment', max_length=100)),
                ('installment_type', models.CharField(default='Custom', max_length=100)),
                ('academic_year', models.CharField(default='2026-2027', max_length=50)),
                ('status', models.CharField(choices=[('Pending', 'Pending payment'), ('Paid', 'Paid'), ('Failed', 'Payment failed'), ('Cancelled', 'Cancelled')], default='Pending', max_length=20)),
                ('receipt_no', models.CharField(blank=True, default='', max_length=100)),
                ('notes', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('fee_record', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='payment_orders', to='finance.studentfeerecord')),
                ('payer', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='fee_payment_orders', to=settings.AUTH_USER_MODEL)),
                ('payment', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gateway_order', to='finance.feepayment')),
                ('quarter', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='payment_orders', to='finance.feequarter')),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='fee_payment_orders', to='schools.school')),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='fee_payment_orders', to='sis.student')),
            ],
        ),
        migrations.CreateModel(
            name='FeePaymentWebhookEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_id', models.CharField(db_index=True, max_length=128, unique=True)),
                ('event_type', models.CharField(max_length=100)),
                ('payload', models.JSONField(default=dict)),
                ('processed', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('school', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='fee_webhook_events', to='schools.school')),
            ],
        ),
        migrations.AddIndex(
            model_name='feepayment',
            index=models.Index(fields=['gateway_payment_id'], name='fee_pmt_gw_pmt_idx'),
        ),
        migrations.AddIndex(
            model_name='feepayment',
            index=models.Index(fields=['gateway_order_id'], name='fee_pmt_gw_ord_idx'),
        ),
        migrations.AddIndex(
            model_name='feepayment',
            index=models.Index(fields=['school', 'status'], name='fee_pmt_sch_st_idx'),
        ),
        migrations.AddIndex(
            model_name='feepaymentorder',
            index=models.Index(fields=['school', 'status'], name='fee_ord_sch_st_idx'),
        ),
        migrations.AddIndex(
            model_name='feepaymentorder',
            index=models.Index(fields=['student', 'status'], name='fee_ord_stu_st_idx'),
        ),
        migrations.AddIndex(
            model_name='feepaymentorder',
            index=models.Index(fields=['gateway_order_id'], name='fee_ord_gw_ord_idx'),
        ),
        migrations.AddIndex(
            model_name='feepaymentorder',
            index=models.Index(fields=['school', '-created_at'], name='fee_ord_sch_cr_idx'),
        ),
        migrations.AddIndex(
            model_name='feepaymentwebhookevent',
            index=models.Index(fields=['event_id'], name='fee_wh_evt_id_idx'),
        ),
        migrations.AddIndex(
            model_name='feepaymentwebhookevent',
            index=models.Index(fields=['school', 'event_type'], name='fee_wh_sch_typ_idx'),
        ),
    ]

