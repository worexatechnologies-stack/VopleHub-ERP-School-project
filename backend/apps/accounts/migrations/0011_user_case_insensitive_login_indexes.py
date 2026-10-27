from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations, models
from django.db.models.functions import Upper


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('accounts', '0010_refreshtokenrecord_token_hash_index'),
    ]

    operations = [
        AddIndexConcurrently(
            model_name='user',
            index=models.Index(Upper('email'), name='accounts_user_email_upper_idx'),
        ),
        AddIndexConcurrently(
            model_name='user',
            index=models.Index(Upper('username'), name='accounts_user_uname_upper_idx'),
        ),
    ]
