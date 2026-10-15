"""Celery tasks for messaging platform outbox dispatch and push notifications."""
import logging
from config.celery import app
from .outbox import process_pending_outbox_events

logger = logging.getLogger(__name__)


@app.task(name='apps.chat.tasks.flush_outbox_events')
def flush_outbox_events(limit: int = 50):
    """Periodic task or triggered worker to dispatch pending outbox events."""
    published = process_pending_outbox_events(limit=limit)
    if published > 0:
        logger.info('Flushed %d outbox events to channel layer', published)
    return published
