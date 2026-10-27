"""Helpers for safely tracking asynchronous, tenant-scoped import batches."""

import json
import re
import base64
import hashlib

from django.conf import settings
from django.core.cache import cache
from rest_framework import permissions, status
from rest_framework.response import Response


IMPORT_STATUS_TTL = 60 * 60


def encrypt_import_payload(payload: dict) -> str:
    """Keep student/teacher personal data encrypted in the Celery broker."""
    from cryptography.fernet import Fernet

    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest())
    return Fernet(key).encrypt(json.dumps(payload, ensure_ascii=False).encode('utf-8')).decode('ascii')


def decrypt_import_payload(ciphertext: str) -> dict:
    """Decrypt a queued payload using the server-only Django secret."""
    from cryptography.fernet import Fernet

    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest())
    return json.loads(Fernet(key).decrypt(ciphertext.encode('ascii')).decode('utf-8'))


def import_status_key(*, entity: str, school_id, user_id, job_id: str, batch_number: int) -> str:
    return f"bulk_import_status:{entity}:{school_id}:{user_id}:{job_id}:{batch_number}"


def set_import_status(*, entity: str, school_id, user_id, job_id: str, batch_number: int, status: str, result=None):
    cache.set(
        import_status_key(
            entity=entity,
            school_id=school_id,
            user_id=user_id,
            job_id=job_id,
            batch_number=batch_number,
        ),
        {'status': status, 'result': result},
        timeout=IMPORT_STATUS_TTL,
    )


class CanManageSchoolImports(permissions.BasePermission):
    """Import status and enqueue APIs are restricted to school administrators."""

    def has_permission(self, request, view):
        from apps.accounts.models import User

        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == User.Role.SCHOOL_ADMIN
            and request.user.school_id
        )


def queue_import_batch(request, *, entity: str, user, school):
    """Queue a JSON batch when requested; return None for the legacy sync path."""
    from .tasks import process_import_batch

    async_value = request.data.get('async_import', False)
    if str(async_value).lower() not in {'1', 'true', 'yes'}:
        return None

    if request.FILES:
        return Response(
            {'success': False, 'detail': 'Queued imports accept parsed JSON batches; upload a file through the import screen.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    payload = request.data.dict() if hasattr(request.data, 'dict') else dict(request.data)
    payload.pop('async_import', None)
    job_id = str(payload.get('jobId') or payload.get('job_id') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', job_id):
        return Response({'success': False, 'detail': 'A valid jobId is required for queued imports.'}, status=400)
    try:
        batch_number = int(payload.get('batchNumber') or payload.get('batch_number') or 1)
    except (TypeError, ValueError):
        batch_number = 0
    if not 1 <= batch_number <= 10000:
        return Response({'success': False, 'detail': 'batchNumber must be between 1 and 10000.'}, status=400)

    rows = payload.get('students' if entity == 'students' else 'teachers')
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
            payload['students' if entity == 'students' else 'teachers'] = rows
        except (TypeError, ValueError):
            rows = None
    if (
        not isinstance(rows, list)
        or not rows
        or len(rows) > 500
        or any(not isinstance(row, dict) for row in rows)
    ):
        return Response(
            {'success': False, 'detail': 'A queued batch must contain 1 to 500 valid record objects.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        payload_size = len(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
    except (TypeError, ValueError):
        return Response({'success': False, 'detail': 'Import batch must contain valid JSON data.'}, status=400)
    if payload_size > 2 * 1024 * 1024:
        return Response({'success': False, 'detail': 'A queued batch cannot exceed 2 MB.'}, status=413)

    key_args = {
        'entity': entity,
        'school_id': school.pk,
        'user_id': user.pk,
        'job_id': job_id,
        'batch_number': batch_number,
    }
    status_key = import_status_key(**key_args)
    existing = cache.get(status_key)
    if existing and existing.get('status') in {'pending', 'processing', 'completed'}:
        return Response(
            {'success': True, 'queued': True, 'jobId': job_id, 'batchNumber': batch_number,
             'status': existing['status']},
            status=status.HTTP_202_ACCEPTED,
        )

    if existing is None:
        # Redis SET NX ensures concurrent retries for the same user/job/batch
        # cannot enqueue duplicate database writes.
        reserved = cache.add(
            status_key,
            {'status': 'pending', 'result': None},
            timeout=IMPORT_STATUS_TTL,
        )
        if not reserved:
            existing = cache.get(status_key)
            if existing and existing.get('status') in {'pending', 'processing', 'completed'}:
                return Response(
                    {'success': True, 'queued': True, 'jobId': job_id, 'batchNumber': batch_number,
                     'status': existing['status']},
                    status=status.HTTP_202_ACCEPTED,
                )
            return Response(
                {'success': False, 'detail': 'Could not reserve this import batch. Please retry.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
    else:
        set_import_status(**key_args, status='pending')
    try:
        process_import_batch.delay(
            entity=entity,
            school_id=school.pk,
            user_id=user.pk,
            job_id=job_id,
            batch_number=batch_number,
            encrypted_payload=encrypt_import_payload(payload),
        )
    except Exception:
        set_import_status(
            **key_args,
            status='failed',
            result={
                'success': False,
                'errorCategory': 'QUEUE_UNAVAILABLE',
                'detail': 'The import queue is temporarily unavailable. Please retry this batch.',
            },
        )
        return Response(
            {'success': False, 'errorCategory': 'QUEUE_UNAVAILABLE',
             'detail': 'The import queue is temporarily unavailable. Please retry this batch.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response(
        {'success': True, 'queued': True, 'jobId': job_id, 'batchNumber': batch_number, 'status': 'pending'},
        status=status.HTTP_202_ACCEPTED,
    )
