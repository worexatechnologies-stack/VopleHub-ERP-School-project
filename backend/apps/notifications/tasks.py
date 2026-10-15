import logging

from celery import shared_task

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
    """Best-effort broker enqueue that never makes an API write fail."""
    try:
        queue_fcm_notification.delay(user_ids, title=title, body=body, category=category, data=data or {})
    except Exception as exc:
        logger.warning('Could not enqueue FCM delivery task: %s', exc)
