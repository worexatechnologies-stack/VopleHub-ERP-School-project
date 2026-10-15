# Generated manually for tenant-scoped parent identities.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_parentprofile'),
    ]

    operations = [
        migrations.AlterField(
            model_name='parentprofile',
            name='phone',
            field=models.CharField(max_length=30),
        ),
    ]
