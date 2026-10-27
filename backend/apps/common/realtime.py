import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

logger = logging.getLogger(__name__)


def broadcast_sync_event(school_id: int, entity: str, action: str, entity_id=None, data: dict = None):
    """Broadcast real-time entity synchronization updates across Redis to all connected school clients."""
    if not school_id:
        return

    try:
        channel_layer = get_channel_layer()
        if not channel_layer:
            return

        payload = {
            'entity': entity,
            'action': action,
            'id': entity_id,
            'schoolId': school_id,
            'timestamp': timezone.now().isoformat(),
            'data': data or {},
        }

        group_name = f"school_{school_id}"
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                'type': 'chat_event',
                'event': {
                    'type': f"{entity}.sync",
                    'data': payload,
                },
            },
        )
        logger.debug('Broadcasted %s.%s event to group %s', entity, action, group_name)
    except Exception as exc:
        logger.warning('Failed to broadcast real-time sync event for %s %s: %s', entity, action, exc)
