from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('exams', '0003_exam_tenant_indexes'),
    ]

    operations = [
        migrations.AlterField(
            model_name='exam',
            name='section',
            field=models.CharField(max_length=40),
        ),
    ]
