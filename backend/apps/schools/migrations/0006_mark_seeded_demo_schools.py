from django.db import migrations


def mark_known_seeded_schools_as_demo(apps, schema_editor):
    School = apps.get_model('schools', 'School')
    School.objects.filter(code__in=['demo-north', 'demo-south']).update(is_demo=True)


class Migration(migrations.Migration):
    dependencies = [('schools', '0005_alter_school_logo')]

    operations = [migrations.RunPython(mark_known_seeded_schools_as_demo, migrations.RunPython.noop)]
