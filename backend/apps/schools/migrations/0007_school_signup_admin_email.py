from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('schools', '0006_mark_seeded_demo_schools')]
    operations = [migrations.AddField(model_name='school', name='signup_admin_email', field=models.EmailField(blank=True, help_text='Contact email used for public self-service signup.', max_length=254, null=True, unique=True))]
