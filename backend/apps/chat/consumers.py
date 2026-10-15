"""WebSocket consumer for real-time school messaging events.

Protocol events:
- connection.ready: Delivered on successful connection with authorized user info.
- connection.error: Delivered on unauthorized actions or bad requests.
- message.created: Incoming new message in an active conversation.
- message.updated: Edited message notification.
- message.deleted: Soft-deleted message notification.
- conversation.read: Participant read receipt update.
- unread_count.updated: Total unread counter change.
"""
import logging
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from apps.accounts.models import User
from .models import Conversation, ConversationParticipant, DirectMessage

logger = logging.getLogger(__name__)


class ChatConsumer(AsyncJsonWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = None
        self.user_group = None
        self.joined_conversations = set()

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or not self.user.is_authenticated:
            logger.warning('Rejecting unauthenticated WebSocket connection')
            await self.close(code=4001)
            return

        if self.user.role == User.Role.STUDENT:
            logger.warning('Direct messaging rejected for student account %s', self.user.id)
            await self.close(code=4003)
            return

        await self.accept()

        # Join personal user group for direct notifications & messages
        self.user_group = f"user_{self.user.id}"
        await self.channel_layer.group_add(self.user_group, self.channel_name)

        # Automatically join all active conversations the user is a participant of
        conv_ids = await self.get_user_conversation_ids()
        for cid in conv_ids:
            group_name = f"conversation_{cid}"
            await self.channel_layer.group_add(group_name, self.channel_name)
            self.joined_conversations.add(group_name)

        # Announce ready
        await self.send_json({
            'type': 'connection.ready',
            'userId': self.user.id,
            'role': getattr(self.user, 'role', ''),
            'schoolId': getattr(self.user, 'school_id', None),
            'timestamp': timezone.now().isoformat(),
            'joinedConversations': list(conv_ids),
        })

    async def disconnect(self, close_code):
        if self.user_group:
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

        for group in self.joined_conversations:
            await self.channel_layer.group_discard(group, self.channel_name)
        self.joined_conversations.clear()

    async def receive_json(self, content, **kwargs):
        action = content.get('action') or content.get('type')

        if action == 'ping':
            await self.send_json({'type': 'pong', 'timestamp': timezone.now().isoformat()})
            return

        if action in ['join_conversation', 'subscribe']:
            cid = content.get('conversationId') or content.get('conversation_id')
            if not cid:
                await self.send_json({'type': 'connection.error', 'message': 'Missing conversationId'})
                return

            is_allowed = await self.check_conversation_access(cid)
            if not is_allowed:
                await self.send_json({'type': 'connection.error', 'message': 'Unauthorized conversation subscription'})
                return

            group_name = f"conversation_{cid}"
            if group_name not in self.joined_conversations:
                await self.channel_layer.group_add(group_name, self.channel_name)
                self.joined_conversations.add(group_name)

            await self.send_json({'type': 'conversation.subscribed', 'conversationId': cid})
            return

        if action in ['mark_read', 'read']:
            cid = content.get('conversationId') or content.get('conversation_id')
            if cid:
                is_allowed = await self.check_conversation_access(cid)
                if is_allowed:
                    await self.mark_conversation_read_db(cid)
                    group_name = f"conversation_{cid}"
                    await self.channel_layer.group_send(
                        group_name,
                        {
                            'type': 'chat_event',
                            'event': {
                                'type': 'conversation.read',
                                'data': {
                                    'conversationId': cid,
                                    'userId': self.user.id,
                                    'readAt': timezone.now().isoformat(),
                                },
                            },
                        },
                    )

    async def chat_event(self, event):
        """Handler for events broadcasted through channel layer."""
        await self.send_json(event.get('event', {}))

    @database_sync_to_async
    def get_user_conversation_ids(self) -> list[int]:
        if not self.user or not self.user.is_authenticated:
            return []
        from .models import Conversation
        from django.db.models import Q
        return list(
            Conversation.objects.filter(
                Q(participant1=self.user) | Q(participant2=self.user),
                school=self.user.school,
            ).values_list('id', flat=True)
        )

    @database_sync_to_async
    def check_conversation_access(self, conversation_id: int) -> bool:
        if not self.user or not self.user.is_authenticated:
            return False
        from .models import Conversation
        from .permissions import is_user_in_conversation
        conv = Conversation.objects.filter(id=conversation_id, school=self.user.school).first()
        if not conv:
            return False
        return is_user_in_conversation(self.user, conv)

    @database_sync_to_async
    def mark_conversation_read_db(self, conversation_id: int):
        from .models import ConversationParticipant, DirectMessage
        now = timezone.now()
        DirectMessage.objects.filter(
            conversation_id=conversation_id,
            recipient_id=self.user.id,
            read_at__isnull=True,
        ).update(read_at=now)
        ConversationParticipant.objects.filter(
            conversation_id=conversation_id,
            user_id=self.user.id,
        ).update(last_read_at=now)
