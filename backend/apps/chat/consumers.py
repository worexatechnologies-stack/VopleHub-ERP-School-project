"""WebSocket consumer for real-time school messaging events.

Protocol events:
- connection.ready: Delivered on successful connection with authorized user info.
- connection.error: Delivered on unauthorized actions or bad requests.
- message.created: Incoming new message in an active conversation.
- message.updated: Edited message notification.
- message.deleted: Soft-deleted message notification.
- conversation.read: Participant read receipt update.
- unread_count.updated: Total unread counter change.
- typing.updated: Typing indicator status for a conversation.
- user.presence: Online / last seen status update.
"""
import logging
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.cache import cache
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

        # Multi-tab connection tracking & online presence
        is_first_conn = self._increment_user_conns() == 1
        if is_first_conn:
            await self.update_user_online_status(is_online=True)
            await self.broadcast_presence(is_online=True)

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
        if self.user and self.user.is_authenticated:
            is_last_conn = self._decrement_user_conns() <= 0
            if is_last_conn:
                await self.update_user_online_status(is_online=False)
                await self.broadcast_presence(is_online=False)

        if self.user_group:
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

        for group in self.joined_conversations:
            await self.channel_layer.group_discard(group, self.channel_name)
        self.joined_conversations.clear()

    async def receive_json(self, content, **kwargs):
        action = content.get('action') or content.get('type')

        if action == 'ping':
            await self.touch_user_last_seen()
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

        if action in ['typing', 'typing.start', 'typing.stop']:
            raw_cid = content.get('conversationId') or content.get('conversation_id')
            if not raw_cid:
                return

            try:
                cid = int(raw_cid)
            except (ValueError, TypeError):
                cid = raw_cid

            is_allowed = await self.check_conversation_access(cid)
            if not is_allowed:
                return

            is_typing = action != 'typing.stop' and bool(content.get('isTyping', True))
            typing_data = {
                'conversationId': cid,
                'userId': self.user.id,
                'userName': self.user.get_full_name() or self.user.username,
                'isTyping': is_typing,
            }

            # 1. Broadcast to conversation room participants
            group_name = f"conversation_{cid}"
            await self.channel_layer.group_send(
                group_name,
                {
                    'type': 'chat_event',
                    'event': {
                        'type': 'typing.updated',
                        'data': typing_data,
                    },
                },
            )

            # 2. Also broadcast directly to recipient's personal user group
            other_user_id = await self.get_conversation_other_user_id(cid)
            if other_user_id:
                await self.channel_layer.group_send(
                    f"user_{other_user_id}",
                    {
                        'type': 'chat_event',
                        'event': {
                            'type': 'typing.updated',
                            'data': typing_data,
                        },
                    },
                )
            return

        if action in ['mark_read', 'read']:
            cid = content.get('conversationId') or content.get('conversation_id')
            if cid:
                is_allowed = await self.check_conversation_access(cid)
                if is_allowed:
                    await self.mark_conversation_read_db(cid)
                    group_name = f"conversation_{cid}"
                    now_str = timezone.now().isoformat()

                    # 1. Notify conversation participants that messages are read
                    await self.channel_layer.group_send(
                        group_name,
                        {
                            'type': 'chat_event',
                            'event': {
                                'type': 'conversation.read',
                                'data': {
                                    'conversationId': cid,
                                    'userId': self.user.id,
                                    'readAt': now_str,
                                },
                            },
                        },
                    )

                    # 2. Notify authenticated user's tabs of new unread counts
                    total_unread, conv_unread = await self.get_user_unread_counts(cid)
                    await self.channel_layer.group_send(
                        self.user_group,
                        {
                            'type': 'chat_event',
                            'event': {
                                'type': 'unread_count.updated',
                                'data': {
                                    'totalUnread': total_unread,
                                    'conversationId': cid,
                                    'conversationUnread': conv_unread,
                                },
                            },
                        },
                    )

    async def chat_event(self, event):
        """Handler for events broadcasted through channel layer."""
        await self.send_json(event.get('event', {}))

    def _get_conn_key(self) -> str:
        return f"ws_user_conns_{self.user.id}"

    def _increment_user_conns(self) -> int:
        key = self._get_conn_key()
        try:
            val = cache.incr(key)
        except (ValueError, Exception):
            cache.set(key, 1, timeout=86400)
            val = 1
        return val

    def _decrement_user_conns(self) -> int:
        key = self._get_conn_key()
        try:
            val = cache.decr(key)
        except (ValueError, Exception):
            val = 0
        if val <= 0:
            cache.delete(key)
            val = 0
        return val

    async def broadcast_presence(self, is_online: bool):
        """Notify all active conversations of user online / offline transition."""
        if not self.joined_conversations:
            conv_ids = await self.get_user_conversation_ids()
            groups = [f"conversation_{cid}" for cid in conv_ids]
        else:
            groups = list(self.joined_conversations)

        now_str = timezone.now().isoformat()
        for group in groups:
            await self.channel_layer.group_send(
                group,
                {
                    'type': 'chat_event',
                    'event': {
                        'type': 'user.presence',
                        'data': {
                            'userId': self.user.id,
                            'isOnline': is_online,
                            'lastSeenAt': now_str,
                        },
                    },
                },
            )

    @database_sync_to_async
    def update_user_online_status(self, is_online: bool):
        if not self.user or not self.user.is_authenticated:
            return
        now = timezone.now()
        User.objects.filter(id=self.user.id).update(
            is_online=is_online,
            last_seen_at=now,
        )

    @database_sync_to_async
    def touch_user_last_seen(self):
        if not self.user or not self.user.is_authenticated:
            return
        User.objects.filter(id=self.user.id).update(last_seen_at=timezone.now())

    @database_sync_to_async
    def get_user_unread_counts(self, conversation_id: int | None = None) -> tuple[int, int]:
        if not self.user or not self.user.is_authenticated:
            return 0, 0
        total = DirectMessage.objects.filter(
            recipient_id=self.user.id,
            read_at__isnull=True,
            is_deleted=False,
        ).count()
        conv_unread = 0
        if conversation_id:
            conv_unread = DirectMessage.objects.filter(
                conversation_id=conversation_id,
                recipient_id=self.user.id,
                read_at__isnull=True,
                is_deleted=False,
            ).count()
        return total, conv_unread

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
    def get_conversation_other_user_id(self, conversation_id: int) -> int | None:
        if not self.user or not self.user.is_authenticated:
            return None
        from .models import Conversation
        conv = Conversation.objects.filter(id=conversation_id, school=self.user.school).first()
        if not conv:
            return None
        return conv.participant2_id if conv.participant1_id == self.user.id else conv.participant1_id

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
