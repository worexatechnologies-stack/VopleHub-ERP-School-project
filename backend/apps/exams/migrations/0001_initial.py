from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    initial = True
    dependencies = [('accounts', '0003_parentprofile'), ('sis', '0001_initial'), ('schools', '0001_initial')]
    operations = [
        migrations.CreateModel(name='Exam', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('name', models.CharField(max_length=160)), ('class_name', models.CharField(max_length=40)), ('section', models.CharField(max_length=10)), ('subject', models.CharField(max_length=100)), ('date', models.DateField()), ('time', models.TimeField()), ('max_marks', models.PositiveIntegerField()), ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='exams', to='schools.school'))]),
        migrations.CreateModel(name='ExamResult', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('marks_obtained', models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)), ('remarks', models.TextField(blank=True)), ('status', models.CharField(choices=[('draft', 'Draft'), ('submitted', 'Submitted')], default='draft', max_length=12)), ('entered_at', models.DateTimeField(auto_now=True)), ('submitted_at', models.DateTimeField(blank=True, null=True)), ('entered_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='entered_exam_results', to=settings.AUTH_USER_MODEL)), ('exam', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='results', to='exams.exam')), ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='exam_results', to='sis.student'))]),
        migrations.AddConstraint(model_name='examresult', constraint=models.UniqueConstraint(fields=('exam', 'student'), name='unique_exam_result_per_student')),
    ]
