from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('sis', '0009_student_section_relationship'),
    ]

    operations = [
        migrations.AlterField(
            model_name='student',
            name='section',
            field=models.CharField(max_length=40),
        ),
        migrations.AlterField(
            model_name='student',
            name='academic_year',
            field=models.CharField(max_length=40),
        ),
        migrations.AlterField(
            model_name='academichistory',
            name='section',
            field=models.CharField(max_length=40),
        ),
        migrations.AlterField(
            model_name='academichistory',
            name='academic_year',
            field=models.CharField(max_length=40),
        ),
    ]
