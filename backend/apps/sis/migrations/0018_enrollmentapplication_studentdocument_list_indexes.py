from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('sis', '0017_student_sis_stu_sch_roll_id_idx_and_more'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='enrollmentapplication',
            index=models.Index(fields=['school', '-submitted_at', '-id'], name='sis_app_sch_sub_id_idx'),
        ),
        migrations.AddIndex(
            model_name='studentdocument',
            index=models.Index(fields=['-created_at', '-id'], include=['student'], name='sis_doc_created_id_idx'),
        ),
    ]
