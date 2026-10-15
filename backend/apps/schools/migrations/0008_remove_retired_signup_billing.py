from django.db import migrations


def remove_retired_billing_tables(apps, schema_editor):
    """Remove tables from the withdrawn self-service signup/billing feature."""
    with schema_editor.connection.cursor() as cursor:
        if schema_editor.connection.vendor == 'postgresql':
            cursor.execute('DROP TABLE IF EXISTS billing_billingwebhookevent CASCADE')
            cursor.execute('DROP TABLE IF EXISTS billing_subscription CASCADE')
        else:
            cursor.execute('DROP TABLE IF EXISTS billing_billingwebhookevent')
            cursor.execute('DROP TABLE IF EXISTS billing_subscription')


class Migration(migrations.Migration):
    dependencies = [('schools', '0007_school_signup_admin_email')]

    operations = [
        migrations.RemoveField(model_name='school', name='signup_admin_email'),
        migrations.RunPython(remove_retired_billing_tables, migrations.RunPython.noop),
    ]
