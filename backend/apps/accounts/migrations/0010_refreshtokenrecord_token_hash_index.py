from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0009_alter_credentialvaultrecord_role'),
    ]

    operations = [
        migrations.AlterField(
            model_name='refreshtokenrecord',
            name='token_hash',
            field=models.CharField(db_index=True, max_length=128),
        ),
    ]
