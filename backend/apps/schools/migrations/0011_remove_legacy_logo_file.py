from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('schools', '0010_optimize_database_logos')]

    operations = [migrations.RemoveField(model_name='school', name='logo')]
