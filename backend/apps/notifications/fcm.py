"""Server-only Firebase Cloud Messaging delivery service.

The client only registers opaque FCM registration tokens. Firebase Admin
credentials are read exclusively from Django settings and are never sent to or
used by the browser.
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from django.conf import settings
from django.db import models
from django.db.models import QuerySet
from django.utils import timezone
from .models import DeviceToken, NotificationPreference

logger = logging.getLogger(__name__)

FCM_BATCH_SIZE = 500
MAX_DEVICE_FAILURES = 5

try:
    import firebase_admin
    from firebase_admin import credentials, exceptions, messaging
    INVALID_TOKEN_ERRORS = (messaging.UnregisteredError, messaging.SenderIdMismatchError)
    RETRYABLE_ERRORS = (
        messaging.QuotaExceededError,
        exceptions.AbortedError,
        exceptions.DeadlineExceededError,
        exceptions.InternalError,
        exceptions.ResourceExhaustedError,
        exceptions.UnavailableError,
    )
except ImportError:
    firebase_admin = None
    credentials = None
    exceptions = None
    messaging = None
    INVALID_TOKEN_ERRORS = ()
    RETRYABLE_ERRORS = ()


class PushRetryableError(Exception):
    """A transient Firebase failure that a Celery task should retry."""


@dataclass
class DeliveryResult:
    attempted: int = 0
    delivered: int = 0
    invalid: int = 0
    failed: int = 0
    retry_device_ids: list[int] = field(default_factory=list)
    skipped: bool = False


def _firebase_app():
    """Return the singleton Admin SDK app, or None when FCM is intentionally off."""
    if not getattr(settings, 'FIREBASE_ENABLED', False) or firebase_admin is None:
        return None
    try:
        return firebase_admin.get_app()
    except ValueError:
        pass

    raw_credentials = settings.FIREBASE_SERVICE_ACCOUNT_JSON.strip()
    credential_file = settings.FIREBASE_SERVICE_ACCOUNT_FILE.strip()
    try:
        if raw_credentials:
            credential = credentials.Certificate(json.loads(raw_credentials))
        elif credential_file and Path(credential_file).is_file():
            credential = credentials.Certificate(credential_file)
        else:
            logger.error('FCM is enabled but no valid Firebase service account is configured.')
            return None
        return firebase_admin.initialize_app(credential)
    except (ValueError, OSError, json.JSONDecodeError):
        logger.exception('Unable to initialize Firebase Admin SDK. FCM delivery is unavailable.')
        return None


def _payload_data(data: dict | None) -> dict[str, str]:
    """FCM data values must be strings; limit values to avoid oversized payloads."""
    result: dict[str, str] = {}
    for key, value in (data or {}).items():
        safe_key = str(key)[:128]
        if not safe_key:
            continue
        encoded = value if isinstance(value, str) else json.dumps(value, separators=(',', ':'), default=str)
        result[safe_key] = encoded[:1024]
    return result


class FCMNotificationService:
    """Reusable, batched notification sender for users, roles, and topics."""

    def send_to_user(self, user, *, title: str, body: str, category: str = 'General', data: dict | None = None) -> DeliveryResult:
        return self.send_to_user_ids([user.pk], title=title, body=body, category=category, data=data)

    def send_to_users(self, users: Iterable, *, title: str, body: str, category: str = 'General', data: dict | None = None) -> DeliveryResult:
        return self.send_to_user_ids([user.pk for user in users], title=title, body=body, category=category, data=data)

    def send_to_user_ids(self, user_ids: Iterable[int], *, title: str, body: str, category: str = 'General', data: dict | None = None) -> DeliveryResult:
        user_ids = sorted({int(user_id) for user_id in user_ids})
        if not user_ids:
            return DeliveryResult()
        opted_out_ids = set(NotificationPreference.objects.filter(
            user_id__in=user_ids,
            category=category,
            push_enabled=False,
        ).values_list('user_id', flat=True))
        devices = DeviceToken.objects.filter(
            user_id__in=set(user_ids) - opted_out_ids,
            user__is_active=True,
            is_active=True,
        ).only('id', 'token', 'is_active')
        return self.send_to_devices(devices, title=title, body=body, data=data)

    def send_to_role(self, role: str, *, title: str, body: str, category: str = 'General', data: dict | None = None, school_id: int | None = None) -> DeliveryResult:
        from apps.accounts.models import User

        users: QuerySet = User.objects.filter(role=role, is_active=True)
        if school_id is not None:
            users = users.filter(school_id=school_id)
        return self.send_to_user_ids(users.values_list('id', flat=True), title=title, body=body, category=category, data=data)

    def send_to_topic(self, topic: str, *, title: str, body: str, data: dict | None = None) -> str | None:
        app = _firebase_app()
        if app is None:
            return None
        # Topics are server-defined names, never arbitrary user input.
        if not topic or len(topic) > 900:
            raise ValueError('Invalid FCM topic.')
        return messaging.send(messaging.Message(
            topic=topic,
            notification=messaging.Notification(title=title[:160], body=body[:4000]),
            data=_payload_data(data),
        ), app=app)

    def send_to_device_ids(self, device_ids: Iterable[int], *, title: str, body: str, data: dict | None = None) -> DeliveryResult:
        devices = DeviceToken.objects.filter(pk__in=set(device_ids), is_active=True).only('id', 'token', 'is_active')
        return self.send_to_devices(devices, title=title, body=body, data=data)

    def send_to_devices(self, devices: Iterable[DeviceToken], *, title: str, body: str, data: dict | None = None) -> DeliveryResult:
        device_list = list(devices)
        if not device_list:
            return DeliveryResult()
        app = _firebase_app()
        if app is None:
            return DeliveryResult(skipped=True)

        result = DeliveryResult(attempted=len(device_list))
        payload = _payload_data(data)
        for offset in range(0, len(device_list), FCM_BATCH_SIZE):
            batch = device_list[offset:offset + FCM_BATCH_SIZE]
            message = messaging.MulticastMessage(
                tokens=[device.token for device in batch],
                notification=messaging.Notification(title=title[:160], body=body[:4000]),
                data=payload,
                webpush=messaging.WebpushConfig(headers={'Urgency': 'high'}),
            )
            try:
                response = messaging.send_each_for_multicast(message, app=app)
            except RETRYABLE_ERRORS as error:
                self._record_transient_failure([device.id for device in batch], error)
                result.failed += len(batch)
                result.retry_device_ids.extend(device.id for device in batch)
                continue
            except exceptions.FirebaseError as error:
                logger.warning('FCM batch failed permanently: %s', error.code)
                self._record_permanent_failure([device.id for device in batch], error)
                result.failed += len(batch)
                continue

            successful_ids: list[int] = []
            invalid_ids: list[int] = []
            transient_ids: list[int] = []
            permanent_ids: list[int] = []
            for device, response_item in zip(batch, response.responses):
                if response_item.success:
                    successful_ids.append(device.id)
                    continue
                error = response_item.exception
                if isinstance(error, INVALID_TOKEN_ERRORS):
                    invalid_ids.append(device.id)
                elif isinstance(error, RETRYABLE_ERRORS):
                    transient_ids.append(device.id)
                else:
                    permanent_ids.append(device.id)
            self._record_success(successful_ids)
            self._remove_invalid(invalid_ids)
            self._record_transient_failure(transient_ids, None)
            self._record_permanent_failure(permanent_ids, None)
            result.delivered += len(successful_ids)
            result.invalid += len(invalid_ids)
            result.failed += len(transient_ids) + len(permanent_ids)
            result.retry_device_ids.extend(transient_ids)
        return result

    @staticmethod
    def _record_success(device_ids: list[int]) -> None:
        if device_ids:
            DeviceToken.objects.filter(pk__in=device_ids).update(
                last_success_at=timezone.now(), failure_count=0, last_error='', last_failure_at=None,
            )

    @staticmethod
    def _remove_invalid(device_ids: list[int]) -> None:
        if device_ids:
            # Firebase reports these tokens as unregistered or from another
            # sender. Deleting them prevents repeated failed delivery.
            DeviceToken.objects.filter(pk__in=device_ids).delete()

    @staticmethod
    def _record_transient_failure(device_ids: list[int], error: Exception | None) -> None:
        if device_ids:
            DeviceToken.objects.filter(pk__in=device_ids).update(
                last_failure_at=timezone.now(), last_error=(error.__class__.__name__ if error else 'Transient FCM error'),
            )

    @staticmethod
    def _record_permanent_failure(device_ids: list[int], error: Exception | None) -> None:
        if not device_ids:
            return
        DeviceToken.objects.filter(pk__in=device_ids).update(
            failure_count=models.F('failure_count') + 1,
            last_failure_at=timezone.now(),
            last_error=(error.__class__.__name__ if error else 'FCM delivery error'),
        )
        DeviceToken.objects.filter(pk__in=device_ids, failure_count__gte=MAX_DEVICE_FAILURES).update(is_active=False)
