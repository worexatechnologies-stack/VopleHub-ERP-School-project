from django.db import migrations


def sync_temporary_passwords(apps, schema_editor):
    CredentialVaultRecord = apps.get_model('accounts', 'CredentialVaultRecord')
    User = apps.get_model('accounts', 'User')

    # 1. Sync any vault record that has a temporary password or must_change_password=True
    records = CredentialVaultRecord.objects.filter(must_change_password=True)
    for record in records:
        target_user = record.user
        if not target_user:
            target_user = (
                User.objects.filter(school=record.school, email__iexact=record.login_id).first()
                or User.objects.filter(school=record.school, username__iexact=record.login_id).first()
            )
            if target_user:
                record.user = target_user
                record.save(update_fields=['user'])

        if target_user and not target_user.must_change_password:
            target_user.must_change_password = True
            target_user.save(update_fields=['must_change_password'])


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0011_user_case_insensitive_login_indexes'),
    ]

    operations = [
        migrations.RunPython(sync_temporary_passwords, reverse_code=migrations.RunPython.noop),
    ]
