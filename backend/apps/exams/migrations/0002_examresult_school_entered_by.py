from django.db import migrations, models
import django.db.models.deletion


def backfill_school(apps, schema_editor):
    ExamResult = apps.get_model('exams', 'ExamResult')
    for result in ExamResult.objects.select_related('exam').all():
        result.school_id = result.exam.school_id
        result.save(update_fields=['school'])


class Migration(migrations.Migration):
    dependencies = [('exams', '0001_initial')]
    operations = [
        migrations.AddField(model_name='examresult', name='school', field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='exam_results', to='schools.school')),
        migrations.RunPython(backfill_school, migrations.RunPython.noop),
        migrations.AlterField(model_name='examresult', name='school', field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='exam_results', to='schools.school')),
        migrations.AlterField(model_name='examresult', name='entered_by', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='entered_exam_results', to='accounts.user')),
        migrations.AddIndex(model_name='examresult', index=models.Index(fields=['school', 'student'], name='exams_examr_school__9fc488_idx')),
    ]
