from django.db import migrations, models
import apps.common.validators


class Migration(migrations.Migration):
    dependencies = [('schools', '0004_enable_tenant_rls')]
    operations = [migrations.AlterField(
        model_name='school', name='logo',
        field=models.ImageField(blank=True, upload_to='logos/', validators=[apps.common.validators.validate_school_logo]),
    )]
