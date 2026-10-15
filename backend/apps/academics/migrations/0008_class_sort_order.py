from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0007_unique_active_academic_year'),
    ]

    operations = [
        migrations.AddField(
            model_name='class',
            name='sort_order',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterModelOptions(
            name='class',
            options={'ordering': ['sort_order', 'name']},
        ),
    ]
