import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('common', '0001_initial'),
        ('schools', '0011_remove_legacy_logo_file'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AdminAuditEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(max_length=80)),
                ('object_type', models.CharField(blank=True, max_length=80)),
                ('object_id', models.CharField(blank=True, max_length=120)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('remote_addr', models.GenericIPAddressField(blank=True, null=True)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='admin_audit_events', to=settings.AUTH_USER_MODEL)),
                ('school', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='admin_audit_events', to='schools.school')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
    ]
