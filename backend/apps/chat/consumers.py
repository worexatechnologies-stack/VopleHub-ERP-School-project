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
import time
import asyncio
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
        self.message_timestamps = []
        self.last_session_validation = 0.0
        self.session_watchdog_task = None

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or not self.user.is_authenticated:
            logger.warning('Rejecting unauthenticated WebSocket connection')
            await self.close(code=4001)
            return

        await self.accept()

        session_auth = self.scope.get('django_session_auth')
        if session_auth:
            self.session_watchdog_task = asyncio.create_task(self._watch_session_expiry())

        # Join personal user group for direct notifications & messages
        self.user_group = f"user_{self.user.id}"
        await self.channel_layer.group_add(self.user_group, self.channel_name)

        # Join school-wide broadcast group for real-time live sync (homework, attendance, notifications, etc.)
        self.school_group = None
        if getattr(self.user, 'school_id', None):
            self.school_group = f"school_{self.user.school_id}"
            await self.channel_layer.group_add(self.school_group, self.channel_name)

        # Automatically join all active conversations the user is a participant of
        conv_ids = await self.get_user_conversation_ids()
        for cid in conv_ids:
            group_name = f"conversation_{cid}"
            await self.channel_layer.group_add(group_name, self.channel_name)
            self.joined_conversations.add(group_name)

        # Multi-tab connection tracking & online presence (max 15 concurrent tabs/devices per user)
        conn_count = self._increment_user_conns()
        if conn_count > 15:
            self._decrement_user_conns()
            logger.warning('Rejecting connection: user %s exceeded max 15 concurrent WebSocket connections', self.user.id)
            await self.close(code=4029)
            return

        await self.update_user_online_status(is_online=True)
        await self.broadcast_presence(is_online=True)

        online_uids = await self.get_online_user_ids()
        # Announce ready with instant online users
        await self.send_json({
            'type': 'connection.ready',
            'userId': self.user.id,
            'role': getattr(self.user, 'role', ''),
            'schoolId': getattr(self.user, 'school_id', None),
            'timestamp': timezone.now().isoformat(),
            'joinedConversations': list(conv_ids),
            'onlineUserIds': online_uids,
        })

    async def disconnect(self, close_code):
        if self.session_watchdog_task:
            self.session_watchdog_task.cancel()
            self.session_watchdog_task = None
        if self.user and self.user.is_authenticated:
            is_last_conn = self._decrement_user_conns() <= 0
            if is_last_conn:
                await self.update_user_online_status(is_online=False)
                await self.broadcast_presence(is_online=False)

        if self.user_group:
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

        if getattr(self, 'school_group', None):
            await self.channel_layer.group_discard(self.school_group, self.channel_name)

        for group in self.joined_conversations:
            await self.channel_layer.group_discard(group, self.channel_name)
        self.joined_conversations.clear()

    async def _watch_session_expiry(self):
        """Close browser sockets when the backing session expires, even if idle."""
        from .middleware import django_session_is_active
        session_auth = self.scope.get('django_session_auth')
        try:
            while True:
                await asyncio.sleep(30)
                if not await django_session_is_active(session_auth['session_key'], str(self.user.id)):
                    await self.close(code=4001)
                    return
        except asyncio.CancelledError:
            pass

    async def receive_json(self, content, **kwargs):
        session_auth = self.scope.get('django_session_auth')
        now_monotonic = time.monotonic()
        if session_auth and now_monotonic - self.last_session_validation >= 60:
            from .middleware import touch_django_session
            if not await touch_django_session(session_auth['session_key'], str(self.user.id)):
                await self.close(code=4001)
                return
            self.last_session_validation = now_monotonic

        now = time.time()
        self.message_timestamps = [t for t in self.message_timestamps if now - t < 10.0]
        if len(self.message_timestamps) >= 40:
            await self.send_json({
                'type': 'connection.error',
                'message': 'WebSocket message rate limit exceeded (max 40 events / 10s). Please slow down.',
                'code': 'rate_limit_exceeded',
            })
            return
        self.message_timestamps.append(now)

        action = content.get('action') or content.get('type')

        if action == 'ping':
            self._refresh_user_conns()
            await self.touch_user_last_seen()
            await self.send_json({'type': 'pong', 'timestamp': timezone.now().isoformat()})
            return

        if action in ['presence.query', 'get_online_users']:
            online_uids = await self.get_online_user_ids()
            await self.send_json({'type': 'presence.snapshot', 'onlineUserIds': online_uids})
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
            raw_target_uid = content.get('targetUserId') or content.get('target_user_id')
            cid = None
            if raw_cid:
                try:
                    cid = int(raw_cid)
                except (ValueError, TypeError):
                    cid = raw_cid

            target_user_id = None
            if raw_target_uid:
                try:
                    target_user_id = int(raw_target_uid)
                except (ValueError, TypeError):
                    target_user_id = None

            # A typing event must be tied to a conversation the sender belongs to.
            # A client-supplied recipient ID alone is not authorization.
            if not cid:
                await self.send_json({'type': 'connection.error', 'message': 'conversationId is required'})
                return

            is_allowed = await self.check_conversation_access(cid)
            if not is_allowed:
                await self.send_json({'type': 'connection.error', 'message': 'Unauthorized conversation'})
                return

            other_user_id = await self.get_conversation_other_user_id(cid)
            if not other_user_id or (target_user_id and target_user_id != other_user_id):
                await self.send_json({'type': 'connection.error', 'message': 'Invalid conversation recipient'})
                return

            is_typing = action != 'typing.stop' and bool(content.get('isTyping', True))
            raw_text = content.get('text') or ''
            typing_data = {
                'conversationId': cid or 0,
                'userId': self.user.id,
                'userName': self.user.get_full_name() or self.user.username,
                'isTyping': is_typing,
                'text': str(raw_text)[:120] if is_typing else '',
            }

            event_id = f"typ_{self.user.id}_{cid or target_user_id}_{int(time.time()*4)}"
            typing_data['eventId'] = event_id

            # 1. Broadcast to conversation room participants
            if cid:
                await self.channel_layer.group_send(
                    f"conversation_{cid}",
                    {
                        'type': 'chat_event',
                        'event': {
                            'type': 'typing.updated',
                            'data': typing_data,
                        },
                    },
                )

            # 2. Also broadcast directly to recipient's personal user group for guaranteed receipt
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

    WS_CONN_TTL = 300  # 5 minutes sliding heartbeat TTL to prevent leaked counts on crash

    def _get_conn_key(self) -> str:
        return f"ws_user_conns_{self.user.id}"

    def _increment_user_conns(self) -> int:
        key = self._get_conn_key()
        try:
            val = cache.incr(key)
            try:
                cache.touch(key, self.WS_CONN_TTL)
            except Exception:
                pass
        except (ValueError, Exception):
            cache.set(key, 1, timeout=self.WS_CONN_TTL)
            val = 1
        return val

    def _refresh_user_conns(self):
        """Refresh sliding heartbeat TTL for active connection tracking."""
        if not self.user or not self.user.is_authenticated:
            return
        key = self._get_conn_key()
        try:
            cache.touch(key, self.WS_CONN_TTL)
        except Exception:
            pass

    def _decrement_user_conns(self) -> int:
        key = self._get_conn_key()
        try:
            val = cache.decr(key)
            if val <= 0:
                cache.delete(key)
                val = 0
            else:
                try:
                    cache.touch(key, self.WS_CONN_TTL)
                except Exception:
                    pass
        except (ValueError, Exception):
            val = 0
            cache.delete(key)
        return val

    async def broadcast_presence(self, is_online: bool):
        """Notify all active conversations and school members of user online / offline transition in real time."""
        groups = set()
        if not self.joined_conversations:
            conv_ids = await self.get_user_conversation_ids()
            for cid in conv_ids:
                groups.add(f"conversation_{cid}")
        else:
            groups.update(self.joined_conversations)

        if getattr(self.user, 'school_id', None):
            groups.add(f"school_{self.user.school_id}")

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
    def get_online_user_ids(self) -> list[int]:
        if not self.user or not getattr(self.user, 'school_id', None):
            return []
        from django.utils import timezone
        from datetime import timedelta
        cutoff = timezone.now() - timedelta(minutes=5)
        return list(
            User.objects.filter(
                school_id=self.user.school_id,
                is_online=True,
                last_seen_at__gte=cutoff,
            ).values_list('id', flat=True)
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
