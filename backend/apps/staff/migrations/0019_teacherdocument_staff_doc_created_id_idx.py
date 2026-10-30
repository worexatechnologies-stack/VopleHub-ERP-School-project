from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('staff', '0018_allow_multiple_teachers_per_section_subject'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='teacherdocument',
            index=models.Index(fields=['-created_at', '-id'], include=['teacher'], name='staff_doc_created_id_idx'),
        ),
    ]
