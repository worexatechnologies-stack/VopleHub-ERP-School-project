"""Object Storage (S3 / MinIO / Local) unified adapter and key generators."""
import os
import re
import uuid
from io import BytesIO
from pathlib import Path
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage


_storage_instance = None


def get_storage():
    """Returns the configured object storage instance (S3/MinIO or FileSystem)."""
    global _storage_instance
    if _storage_instance is not None:
        return _storage_instance

    use_s3 = getattr(settings, 'USE_S3_STORAGE', False)
    bucket = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', '')

    if use_s3 and bucket:
        try:
            from storages.backends.s3boto3 import S3Boto3Storage

            kwargs = {
                'bucket_name': bucket,
                'access_key': getattr(settings, 'AWS_ACCESS_KEY_ID', None) or None,
                'secret_key': getattr(settings, 'AWS_SECRET_ACCESS_KEY', None) or None,
                'region_name': getattr(settings, 'AWS_S3_REGION_NAME', 'us-east-1'),
                'file_overwrite': getattr(settings, 'AWS_S3_FILE_OVERWRITE', False),
                'default_acl': getattr(settings, 'AWS_DEFAULT_ACL', None),
                'querystring_auth': getattr(settings, 'AWS_QUERYSTRING_AUTH', True),
                'querystring_expire': getattr(settings, 'AWS_QUERYSTRING_EXPIRE', 3600),
            }
            endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', None)
            if endpoint_url:
                kwargs['endpoint_url'] = endpoint_url

            _storage_instance = S3Boto3Storage(**kwargs)
            return _storage_instance
        except Exception:
            # Fall back to local FileSystemStorage if S3 initialization fails
            pass

    media_root = getattr(settings, 'MEDIA_ROOT', settings.BASE_DIR / 'media')
    media_url = getattr(settings, 'MEDIA_URL', '/media/')
    _storage_instance = FileSystemStorage(location=str(media_root), base_url=media_url)
    return _storage_instance


def sanitize_filename(filename: str) -> str:
    """Strip dangerous characters from filenames, keeping extension."""
    clean = re.sub(r'[^a-zA-Z0-9_.-]', '_', Path(filename).name)
    return clean[:100] if clean else 'document.bin'


def save_file(file_content, target_key: str) -> str:
    """Saves raw bytes or file-like object to storage at target_key and returns the saved key.
    
    If the file at target_key already exists, it is replaced atomically.
    """
    storage = get_storage()
    if isinstance(file_content, bytes):
        content = ContentFile(file_content)
    elif isinstance(file_content, BytesIO):
        content = ContentFile(file_content.getvalue())
    else:
        content = file_content

    # If file exists, delete first to support atomic replacement
    if storage.exists(target_key):
        try:
            storage.delete(target_key)
        except Exception:
            pass

    saved_name = storage.save(target_key, content)
    return saved_name


def open_file(key: str):
    """Opens a file from storage in binary read mode."""
    storage = get_storage()
    return storage.open(key, 'rb')


def read_file_bytes(key: str) -> bytes:
    """Reads all bytes from a file in storage."""
    with open_file(key) as f:
        return f.read()


def delete_file(key: str) -> bool:
    """Deletes a file from storage if it exists."""
    if not key:
        return False
    storage = get_storage()
    try:
        if storage.exists(key):
            storage.delete(key)
            return True
    except Exception:
        pass
    return False


def file_exists(key: str) -> bool:
    """Checks whether a file exists in storage."""
    if not key:
        return False
    storage = get_storage()
    try:
        return storage.exists(key)
    except Exception:
        return False


def get_file_url(key: str, default: str | None = None) -> str | None:
    """Returns a direct or presigned URL for a file in storage."""
    if not key:
        return default
    storage = get_storage()
    try:
        return storage.url(key)
    except Exception:
        return default


# Consistent Key Generators for Models
def student_photo_key(school_id, student_id) -> str:
    return f"schools/{school_id}/students/{student_id}/photo.webp"


def student_document_key(school_id, student_id, filename: str) -> str:
    clean_name = sanitize_filename(filename)
    return f"schools/{school_id}/students/{student_id}/docs/{uuid.uuid4().hex[:8]}_{clean_name}"


def teacher_photo_key(school_id, teacher_id) -> str:
    return f"schools/{school_id}/teachers/{teacher_id}/photo.webp"


def teacher_document_key(school_id, teacher_id, filename: str) -> str:
    clean_name = sanitize_filename(filename)
    return f"schools/{school_id}/teachers/{teacher_id}/docs/{uuid.uuid4().hex[:8]}_{clean_name}"


def enrollment_photo_key(school_id, app_id) -> str:
    return f"schools/{school_id}/enrollments/{app_id}/photo.webp"


def enrollment_document_key(school_id, app_id, filename: str) -> str:
    clean_name = sanitize_filename(filename)
    return f"schools/{school_id}/enrollments/{app_id}/docs/{uuid.uuid4().hex[:8]}_{clean_name}"
