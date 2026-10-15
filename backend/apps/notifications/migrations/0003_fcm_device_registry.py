from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('notifications', '0002_notification_school')]

    operations = [
        migrations.AddField(model_name='devicetoken', name='device_name', field=models.CharField(blank=True, max_length=160)),
        migrations.AddField(model_name='devicetoken', name='failure_count', field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name='devicetoken', name='last_error', field=models.CharField(blank=True, max_length=160)),
        migrations.AddField(model_name='devicetoken', name='last_failure_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='devicetoken', name='last_seen_at', field=models.DateTimeField(auto_now=True)),
        migrations.AddField(model_name='devicetoken', name='last_success_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='devicetoken', name='platform', field=models.CharField(choices=[('web', 'Web browser'), ('android', 'Android'), ('ios', 'iOS')], default='web', max_length=16)),
        migrations.AddField(model_name='devicetoken', name='updated_at', field=models.DateTimeField(auto_now=True)),
        migrations.AddField(model_name='devicetoken', name='user_agent', field=models.CharField(blank=True, max_length=512)),
        migrations.AlterField(model_name='devicetoken', name='token', field=models.CharField(max_length=4096, unique=True)),
        migrations.AddIndex(model_name='devicetoken', index=models.Index(fields=['user', 'is_active'], name='notificatio_user_id_f0e72c_idx')),
        migrations.AddIndex(model_name='devicetoken', index=models.Index(fields=['is_active', 'last_seen_at'], name='notificatio_is_acti_7f82ef_idx')),
    ]
