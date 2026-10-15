from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('staff', '0004_optimize_database_teacher_photos')]

    operations = [migrations.RemoveField(model_name='teacher', name='photo')]
