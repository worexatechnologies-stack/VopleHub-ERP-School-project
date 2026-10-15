from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('academics', '0004_subject'),
    ]

    operations = [
        migrations.AddField(
            model_name='class',
            name='subjects',
            field=models.ManyToManyField(blank=True, related_name='classes', to='academics.subject'),
        ),
    ]
