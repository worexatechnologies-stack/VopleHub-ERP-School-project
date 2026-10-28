from django.db import migrations


def force_temp_password_change(apps, schema_editor):
    CredentialVaultRecord = apps.get_model('accounts', 'CredentialVaultRecord')
    User = apps.get_model('accounts', 'User')

    # 1. Any vault record that has a plaintext password (not '[User Managed]') is on a temporary password!
    vault_records = CredentialVaultRecord.objects.exclude(plaintext_password='[User Managed]').exclude(source='user_password_change')
    for record in vault_records:
        record.must_change_password = True
        target_user = record.user
        if not target_user:
            target_user = (
                User.objects.filter(school=record.school, email__iexact=record.login_id).first()
                or User.objects.filter(school=record.school, username__iexact=record.login_id).first()
                or User.objects.filter(email__iexact=record.login_id).first()
            )
            if target_user:
                record.user = target_user

        if target_user:
            target_user.must_change_password = True
            target_user.save(update_fields=['must_change_password'])
        record.save(update_fields=['user', 'must_change_password'])

    # 2. For all Teachers, Students, and Parents who do not have a '[User Managed]' vault record:
    user_managed_user_ids = set(
        CredentialVaultRecord.objects.filter(
            plaintext_password='[User Managed]'
        ).values_list('user_id', flat=True)
    )
    unmanaged_users = User.objects.filter(
        role__in=['teacher', 'student', 'parent']
    ).exclude(id__in=user_managed_user_ids)

    unmanaged_users.update(must_change_password=True)


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0012_sync_temp_passwords'),
    ]

    operations = [
        migrations.RunPython(force_temp_password_change, reverse_code=migrations.RunPython.noop),
    ]
