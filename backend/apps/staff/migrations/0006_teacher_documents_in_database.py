from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('staff', '0005_remove_legacy_teacher_photo_file')]

    operations = [
        migrations.RenameField(
            model_name='teacher',
            old_name='documents',
            new_name='legacy_document_notes',
        ),
        migrations.CreateModel(
            name='TeacherDocument',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=160)),
                ('file_data', models.BinaryField(editable=False)),
                ('file_content_type', models.CharField(max_length=100)),
                ('file_name', models.CharField(max_length=255)),
                ('file_type', models.CharField(max_length=16)),
                ('status', models.CharField(default='Uploaded', max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('teacher', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='documents', to='staff.teacher')),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddIndex(
            model_name='teacherdocument',
            index=models.Index(fields=['teacher', 'created_at'], name='staff_teach_teacher_48693d_idx'),
        ),
    ]
