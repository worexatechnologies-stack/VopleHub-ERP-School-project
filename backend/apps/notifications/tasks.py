import logging
import uuid

from celery import shared_task
from apps.common.tenancy import tenant_rls_context

from .fcm import FCMNotificationService

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=5, default_retry_delay=30)
def retry_fcm_devices(self, device_ids, *, title, body, data=None):
    """Retry only devices that had a transient FCM failure, never successes."""
    result = FCMNotificationService().send_to_device_ids(device_ids, title=title, body=body, data=data)
    if result.retry_device_ids:
        countdown = min(15 * (2 ** self.request.retries), 15 * 60)
        raise self.retry(
            args=[result.retry_device_ids],
            kwargs={'title': title, 'body': body, 'data': data or {}},
            countdown=countdown,
        )
    return result.__dict__


@shared_task
def queue_fcm_notification(user_ids, *, title, body, category='General', data=None):
    result = FCMNotificationService().send_to_user_ids(
        user_ids,
        title=title,
        body=body,
        category=category,
        data=data,
    )
    if result.retry_device_ids:
        retry_fcm_devices.delay(result.retry_device_ids, title=title, body=body, data=data or {})
    return result.__dict__


def enqueue_fcm_notification(user_ids, *, title, body, category='General', data=None) -> None:
    """Best-effort broker enqueue that falls back to synchronous delivery if Celery is unavailable."""
    try:
        queue_fcm_notification.delay(user_ids, title=title, body=body, category=category, data=data or {})
    except Exception as exc:
        logger.info('Celery broker unavailable (%s); dispatching FCM notification synchronously.', exc)
        try:
            FCMNotificationService().send_to_user_ids(
                user_ids,
                title=title,
                body=body,
                category=category,
                data=data or {},
            )
        except Exception as sync_err:
            logger.warning('Synchronous FCM delivery failed: %s', sync_err)


@shared_task(bind=True, max_retries=5, default_retry_delay=15, ignore_result=True)
def fanout_notification_task(
    self,
    *,
    school_id,
    sender_id,
    title,
    body,
    category='General',
    channel='system',
    related=None,
    recipient_ids=None,
    broadcast_id=None,
):
    """Create and deliver a school notification in bounded database batches.

    The request only queues this task. Recipient resolution, database inserts,
    WebSocket events, and FCM enqueueing all happen in the worker.
    """
    try:
        from apps.accounts.models import User
        from .services import create_bulk_notifications

        recipients = User.objects.filter(school_id=school_id, is_active=True)
        if recipient_ids is not None:
            recipients = recipients.filter(id__in=set(recipient_ids))
        if sender_id:
            recipients = recipients.exclude(pk=sender_id)

        broadcast_id = broadcast_id or str(uuid.uuid4())
        total = 0
        batch_ids = []

        def flush_batch(ids):
            nonlocal total
            if not ids:
                return
            with tenant_rls_context(school_id):
                batch_users = list(User.objects.filter(
                    school_id=school_id,
                    is_active=True,
                    id__in=ids,
                ))
                total += create_bulk_notifications(
                    school=school_id,
                    recipients=batch_users,
                    title=title,
                    body=body,
                    category=category,
                    channel=channel,
                    sender_id=sender_id,
                    related=related or {},
                    broadcast_id=broadcast_id,
                )

        for user_id in recipients.values_list('id', flat=True).iterator(chunk_size=1000):
            batch_ids.append(user_id)
            if len(batch_ids) >= 1000:
                flush_batch(batch_ids)
                batch_ids = []
        flush_batch(batch_ids)
        return total
    except Exception as exc:
        logger.exception('Notification fan-out failed for school %s', school_id)
        raise self.retry(exc=exc, countdown=min(15 * (2 ** self.request.retries), 300))


def enqueue_notification_fanout(*, school_id, sender_id, title, body, category='General',
                                channel='system', related=None, recipient_ids=None,
                                broadcast_id=None):
    """Queue a notification fan-out after the enclosing transaction commits."""
    from django.db import transaction

    def dispatch():
        payload = {
            'school_id': school_id,
            'sender_id': sender_id,
            'title': title,
            'body': body,
            'category': category,
            'channel': channel,
            'related': related or {},
            'recipient_ids': list(recipient_ids) if recipient_ids is not None else None,
            'broadcast_id': str(broadcast_id) if broadcast_id else None,
        }
        try:
            fanout_notification_task.delay(**payload)
        except Exception as exc:
            logger.exception('Could not enqueue notification fan-out for school %s', school_id)
            # Preserve delivery during a broker outage. This is intentionally
            # a last-resort path; normal production traffic stays asynchronous.
            try:
                fanout_notification_task.apply(kwargs=payload)
            except Exception:
                logger.exception('Synchronous notification fan-out fallback failed for school %s: %s', school_id, exc)

    transaction.on_commit(dispatch)
