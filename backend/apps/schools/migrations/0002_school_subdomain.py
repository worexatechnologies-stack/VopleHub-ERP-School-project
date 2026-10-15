from django.db import migrations, models


def copy_code_to_subdomain(apps, schema_editor):
    School = apps.get_model('schools', 'School')
    for school in School.objects.all():
        school.subdomain = school.code
        school.save(update_fields=['subdomain'])


class Migration(migrations.Migration):
    dependencies = [('schools', '0001_initial')]
    operations = [
        migrations.AddField(model_name='school', name='subdomain', field=models.SlugField(blank=True, null=True, unique=True)),
        migrations.RunPython(copy_code_to_subdomain, migrations.RunPython.noop),
    ]
