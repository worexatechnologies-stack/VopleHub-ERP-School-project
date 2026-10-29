"""Validation and persistence helpers for homework files stored as DB bytes."""
from pathlib import Path

from django.core.exceptions import ValidationError

from .models import HomeworkFileAttachment

MAX_HOMEWORK_FILE_BYTES = 15 * 1024 * 1024
MAX_HOMEWORK_FILE_COUNT = 10
MAX_HOMEWORK_TOTAL_BYTES = 30 * 1024 * 1024

_EXTENSION_TYPES = {
    '.pdf': ('application/pdf',),
    '.jpg': ('image/jpeg',),
    '.jpeg': ('image/jpeg',),
    '.png': ('image/png',),
    '.webp': ('image/webp',),
    '.gif': ('image/gif',),
    '.bmp': ('image/bmp',),
    '.doc': ('application/msword',),
    '.docx': ('application/vnd.openxmlformats-officedocument.wordprocessingml.document',),
    '.xls': ('application/vnd.ms-excel',),
    '.xlsx': ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',),
    '.txt': ('text/plain',),
}


def _detect_content_type(extension, data):
    if extension == '.pdf' and data.startswith(b'%PDF-'):
        return 'application/pdf'
    if extension in {'.jpg', '.jpeg'} and data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if extension == '.png' and data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if extension == '.webp' and data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        return 'image/webp'
    if extension == '.gif' and data.startswith((b'GIF87a', b'GIF89a')):
        return 'image/gif'
    if extension == '.bmp' and data.startswith(b'BM'):
        return 'image/bmp'
    if extension in {'.doc', '.xls'} and data.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'):
        return _EXTENSION_TYPES[extension][0]
    if extension in {'.docx', '.xlsx'} and data.startswith(b'PK\x03\x04'):
        return _EXTENSION_TYPES[extension][0]
    if extension == '.txt':
        try:
            data.decode('utf-8')
            return 'text/plain'
        except UnicodeDecodeError:
            pass
    raise ValidationError('File content does not match a supported homework file type.')


def validate_homework_uploads(uploads):
    if len(uploads) > MAX_HOMEWORK_FILE_COUNT:
        raise ValidationError(f'Attach no more than {MAX_HOMEWORK_FILE_COUNT} files at once.')
    total = sum(upload.size for upload in uploads)
    if total > MAX_HOMEWORK_TOTAL_BYTES:
        raise ValidationError('Homework attachments exceed the 30 MB total limit.')

    validated = []
    for upload in uploads:
        if upload.size > MAX_HOMEWORK_FILE_BYTES:
            raise ValidationError(f'File "{upload.name}" exceeds the 15 MB limit.')
        extension = Path(upload.name).suffix.lower()
        if extension not in _EXTENSION_TYPES:
            raise ValidationError(f'File "{upload.name}" has an unsupported file extension.')
        upload.seek(0)
        data = upload.read(MAX_HOMEWORK_FILE_BYTES + 1)
        upload.seek(0)
        if len(data) != upload.size:
            raise ValidationError(f'File "{upload.name}" could not be read completely.')
        content_type = _detect_content_type(extension, data)
        validated.append((upload, data, content_type))
    return validated


def save_homework_uploads(homework, uploads, *, student=None):
    validated = validate_homework_uploads(list(uploads))
    return [HomeworkFileAttachment.objects.create(
        homework=homework,
        school_id=homework.school_id,
        submission_student_id=str(student.pk) if student is not None else '',
        file_name=Path(upload.name).name[:255],
        content_type=content_type,
        file_size=len(data),
        file_data=data,
    ) for upload, data, content_type in validated]
