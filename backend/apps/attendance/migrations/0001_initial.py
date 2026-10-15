from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [('schools', '0001_initial'), ('sis', '0001_initial'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [migrations.CreateModel(name='AttendanceRecord', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('date', models.DateField()), ('status', models.CharField(choices=[('Present', 'Present'), ('Absent', 'Absent'), ('Late', 'Late')], max_length=10)), ('updated_at', models.DateTimeField(auto_now=True)), ('marked_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='marked_attendance', to=settings.AUTH_USER_MODEL)), ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attendance_records', to='schools.school')), ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attendance_records', to='sis.student'))]), migrations.AddConstraint(model_name='attendancerecord', constraint=models.UniqueConstraint(fields=('student', 'date'), name='unique_student_attendance_date'))]
