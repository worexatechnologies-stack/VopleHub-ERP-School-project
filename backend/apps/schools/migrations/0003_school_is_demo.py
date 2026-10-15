from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('schools', '0002_school_subdomain')]
    operations = [migrations.AddField(model_name='school', name='is_demo', field=models.BooleanField(default=False, help_text='Marks sales/staging data that can be safely removed.'))]
