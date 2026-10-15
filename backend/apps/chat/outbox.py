"""Transactional outbox dispatcher for reliable real-time messaging events.

Guarantees at-least-once delivery of real-time events over Redis and Channels
without losing committed database records if Redis or Channels encounters transient errors.
"""
import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone
from .models import OutboxEvent

logger = logging.getLogger(__name__)


def record_outbox_event(event_type: str, channel_name: str, payload: dict) -> OutboxEvent:
    """Create an outbox event inside the active database transaction.

    On transaction commit, synchronously attempts best-effort dispatch.
    """
    event = OutboxEvent.objects.create(
        event_type=event_type,
        channel_name=channel_name,
        payload=payload,
    )

    def _dispatch_after_commit():
        try:
            publish_outbox_event(event.id)
        except Exception as exc:
            logger.warning('Immediate outbox event dispatch failed for %s: %s', event.id, exc)

    transaction.on_commit(_dispatch_after_commit)
    return event


def publish_outbox_event(event_id: int) -> bool:
    """Dispatch a single outbox event to Django Channels channel layer."""
    try:
        with transaction.atomic():
            event = OutboxEvent.objects.select_for_update(skip_locked=True).filter(id=event_id).first()
            if not event or event.status == OutboxEvent.Status.PUBLISHED:
                return True

            channel_layer = get_channel_layer()
            if channel_layer:
                async_to_sync(channel_layer.group_send)(
                    event.channel_name,
                    {
                        'type': 'chat_event',
                        'event': {
                            'type': event.event_type,
                            'eventId': str(event.event_id),
                            'createdAt': event.created_at.isoformat(),
                            'data': event.payload,
                        },
                    },
                )

            event.status = OutboxEvent.Status.PUBLISHED
            event.published_at = timezone.now()
            event.error = ''
            event.save(update_fields=['status', 'published_at', 'error'])
            return True

    except Exception as exc:
        logger.exception('Error publishing outbox event %s: %s', event_id, exc)
        try:
            OutboxEvent.objects.filter(id=event_id).update(
                status=OutboxEvent.Status.FAILED,
                error=str(exc)[:500],
            )
        except Exception:
            pass
        return False


def process_pending_outbox_events(limit: int = 50) -> int:
    """Batch sweeper for pending or failed outbox events (run via Celery or cron)."""
    pending_ids = list(
        OutboxEvent.objects.filter(
            status__in=[OutboxEvent.Status.PENDING, OutboxEvent.Status.FAILED],
            retry_count__lt=10,
        )
        .order_by('created_at')[:limit]
        .values_list('id', flat=True)
    )

    published_count = 0
    for eid in pending_ids:
        success = publish_outbox_event(eid)
        if success:
            published_count += 1
        else:
            OutboxEvent.objects.filter(id=eid).update(retry_count=transaction.F('retry_count') + 1)

    return published_count
