import base64
import binascii
from pathlib import Path

import django.db.models.deletion
from django.db import migrations, models


def move_legacy_base64_attachments(apps, schema_editor):
    Homework = apps.get_model('academics', 'Homework')
    Attachment = apps.get_model('academics', 'HomeworkFileAttachment')
    db = schema_editor.connection.alias

    def move(items, homework, student_id=''):
        result = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            url = item.get('url')
            if not isinstance(url, str) or not url.startswith('data:'):
                result.append(item)
                continue
            header, separator, encoded = url.partition(',')
            if not separator or ';base64' not in header:
                continue
            try:
                file_data = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                continue
            content_type = header[5:].split(';', 1)[0][:128] or 'application/octet-stream'
            name = Path(str(item.get('name') or 'attachment.bin')).name[:255]
            Attachment.objects.using(db).create(
                homework_id=homework.pk,
                school_id=homework.school_id,
                submission_student_id=str(student_id or ''),
                file_name=name,
                content_type=content_type,
                file_size=len(file_data),
                file_data=file_data,
            )
        return result

    queryset = Homework.objects.using(db).all().iterator(chunk_size=100)
    for homework in queryset:
        homework.attachments = move(homework.attachments, homework)
        submissions = list(homework.submissions or [])
        for submission in submissions:
            if isinstance(submission, dict):
                submission['attachments'] = move(
                    submission.get('attachments'), homework,
                    submission.get('student_id', ''),
                )
        homework.submissions = submissions
        homework.save(using=db, update_fields=['attachments', 'submissions'])


def restore_legacy_base64_attachments(apps, schema_editor):
    Homework = apps.get_model('academics', 'Homework')
    Attachment = apps.get_model('academics', 'HomeworkFileAttachment')
    db = schema_editor.connection.alias
    for homework in Homework.objects.using(db).all().iterator(chunk_size=100):
        rows = list(Attachment.objects.using(db).filter(homework_id=homework.pk).only(
            'id', 'submission_student_id', 'file_name', 'content_type', 'file_data',
        ))
        if not rows:
            continue
        encoded_by_student = {}
        encoded_assignment = []
        for row in rows:
            encoded = base64.b64encode(bytes(row.file_data)).decode('ascii')
            item = {
                'name': row.file_name,
                'type': row.content_type,
                'size': len(row.file_data),
                'url': f'data:{row.content_type};base64,{encoded}',
            }
            if row.submission_student_id:
                encoded_by_student.setdefault(str(row.submission_student_id), []).append(item)
            else:
                encoded_assignment.append(item)
        homework.attachments = [*(homework.attachments or []), *encoded_assignment]
        submissions = list(homework.submissions or [])
        for submission in submissions:
            if isinstance(submission, dict):
                submission['attachments'] = [
                    *(submission.get('attachments') or []),
                    *encoded_by_student.get(str(submission.get('student_id') or ''), []),
                ]
        homework.submissions = submissions
        homework.save(using=db, update_fields=['attachments', 'submissions'])


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0011_class_class_teacher_section_class_teacher'),
        ('schools', '0013_tenant_rls_fail_closed'),
    ]

    operations = [
        migrations.CreateModel(
            name='HomeworkFileAttachment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file_name', models.CharField(max_length=255)),
                ('content_type', models.CharField(default='application/octet-stream', max_length=128)),
                ('file_size', models.PositiveIntegerField(default=0)),
                ('file_data', models.BinaryField(editable=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('homework', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='file_attachments', to='academics.homework')),
                ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='homework_attachments', to='schools.school')),
                ('submission_student_id', models.CharField(blank=True, default='', max_length=64)),
            ],
            options={
                'ordering': ['created_at', 'id'],
            },
        ),
        migrations.RunPython(move_legacy_base64_attachments, restore_legacy_base64_attachments),
    ]
