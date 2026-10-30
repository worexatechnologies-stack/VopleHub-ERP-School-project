import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0014_remove_credential_vault_plaintext_password'),
    ]

    operations = [
        migrations.CreateModel(
            name='PublicLearnerSubscription',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('plan', models.CharField(choices=[('Monthly', 'Monthly'), ('Quarterly', 'Quarterly'), ('Annual', 'Annual')], max_length=16)),
                ('status', models.CharField(choices=[('Pending', 'Pending'), ('Active', 'Active'), ('Expired', 'Expired'), ('Suspended', 'Suspended')], default='Pending', max_length=16)),
                ('phone', models.CharField(blank=True, default='', max_length=30)),
                ('payment_date', models.DateField(blank=True, null=True)),
                ('expiry_date', models.DateField(blank=True, null=True)),
                ('notes', models.CharField(blank=True, default='', max_length=500)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='public_subscription', to='accounts.user')),
            ],
            options={'ordering': ['-created_at', '-id']},
        ),
    ]
