import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('exams', '0008_examschedule_marks_published_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='examschedule',
            name='marks_entry_days',
            field=models.PositiveIntegerField(
                default=3,
                help_text='Allowed number of days for teachers to enter marks after exam completion',
            ),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='marks_entry_deadline',
            field=models.DateTimeField(
                blank=True,
                help_text='Custom or extended deadline for marks entry set by admin',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='marks_entry_extended',
            field=models.BooleanField(
                default=False,
                help_text='Indicates whether the marks entry period has been extended by an administrator',
            ),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='marks_entry_extension_reason',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='marks_entry_extended_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='examschedule',
            name='marks_entry_extended_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='extended_exam_schedules',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='exam',
            name='marks_entry_deadline',
            field=models.DateTimeField(
                blank=True,
                help_text='Custom or extended deadline for marks entry for this exam',
                null=True,
            ),
        ),
    ]
