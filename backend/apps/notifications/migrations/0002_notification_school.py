from django.db import migrations, models
import django.db.models.deletion


def backfill_school(apps, schema_editor):
    Notification = apps.get_model('notifications', 'Notification')
    for notification in Notification.objects.select_related('recipient').all():
        notification.school_id = notification.recipient.school_id
        notification.save(update_fields=['school'])


class Migration(migrations.Migration):
    dependencies = [('notifications', '0001_initial')]
    operations = [
        migrations.AddField(model_name='notification', name='school', field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='schools.school')),
        migrations.RunPython(backfill_school, migrations.RunPython.noop),
        migrations.AlterField(model_name='notification', name='school', field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='schools.school')),
        migrations.AddIndex(model_name='notification', index=models.Index(fields=['school', '-created_at'], name='notificatio_school__0dc97f_idx')),
    ]
