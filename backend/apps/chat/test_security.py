from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from django.db import connection
from django.test import TestCase

from apps.accounts.models import User
from apps.schools.models import School

from .consumers import ChatConsumer
from .crypto import (
    EVENT_PREFIX,
    decrypt_binary,
    decrypt_json,
    decrypt_text,
    encrypt_binary,
    encrypt_json,
    encrypt_text,
)
from .models import Conversation, DirectMessage, MessageAttachment, OutboxEvent


class ChatEncryptionTests(TestCase):
    def setUp(self):
        self.school = School.objects.create(name='Encrypted Chat School', code='encrypted-chat')
        self.parent = User.objects.create_user(
            username='encrypted-parent', email='encrypted-parent@example.com',
            password='StrongPass123!', role=User.Role.PARENT, school=self.school,
        )
        self.teacher = User.objects.create_user(
            username='encrypted-teacher', email='encrypted-teacher@example.com',
            password='StrongPass123!', role=User.Role.TEACHER, school=self.school,
        )
        self.conversation, _ = Conversation.get_or_create_between(
            self.school, self.parent, self.teacher,
        )

    def test_text_binary_and_json_crypto_are_authenticated_and_legacy_readable(self):
        plaintext = 'A private message for the mobile client'
        encrypted_text = encrypt_text(plaintext)
        self.assertTrue(encrypted_text.startswith('vhchat:v1:'))
        self.assertNotIn(plaintext, encrypted_text)
        self.assertEqual(decrypt_text(encrypted_text), plaintext)
        self.assertEqual(decrypt_text('legacy plaintext'), 'legacy plaintext')

        binary = b'private attachment bytes'
        encrypted_binary = encrypt_binary(binary)
        self.assertNotIn(binary, encrypted_binary)
        self.assertEqual(decrypt_binary(encrypted_binary), binary)

        payload = {'body': plaintext, 'kind': 'message'}
        encrypted_json = encrypt_json(payload)
        self.assertEqual(decrypt_json(encrypted_json), payload)

    def test_message_and_attachment_are_ciphertext_in_database_and_plaintext_in_orm(self):
        body = 'This message must not be stored as plaintext'
        message = DirectMessage.objects.create(
            conversation=self.conversation,
            sender=self.parent,
            recipient=self.teacher,
            body=body,
        )
        with connection.cursor() as cursor:
            cursor.execute('SELECT body FROM chat_directmessage WHERE id = %s', [message.id])
            stored_body = cursor.fetchone()[0]
        self.assertTrue(stored_body.startswith('vhchat:v1:'))
        self.assertNotIn(body, stored_body)
        self.assertEqual(DirectMessage.objects.get(pk=message.pk).body, body)

        attachment_bytes = b'private image payload'
        attachment = MessageAttachment.objects.create(
            message=message,
            file_data=attachment_bytes,
            original_name='private.png',
            content_type='image/png',
            file_size=len(attachment_bytes),
        )
        with connection.cursor() as cursor:
            cursor.execute('SELECT file_data FROM chat_messageattachment WHERE id = %s', [str(attachment.id)])
            stored_attachment = cursor.fetchone()[0]
        if isinstance(stored_attachment, memoryview):
            stored_attachment = stored_attachment.tobytes()
        self.assertTrue(stored_attachment.startswith(b'vhchat:v1:'))
        self.assertEqual(MessageAttachment.objects.get(pk=attachment.pk).file_data, attachment_bytes)

    def test_outbox_payload_is_encrypted_at_rest_and_keeps_payload_shape(self):
        payload = {'message': {'id': 5, 'body': 'mobile-compatible message'}}
        event = OutboxEvent.objects.create(
            event_type='message_created', channel_name='chat_test', payload=payload,
        )
        with connection.cursor() as cursor:
            cursor.execute('SELECT payload FROM chat_outboxevent WHERE id = %s', [event.id])
            stored_payload = cursor.fetchone()[0]
        self.assertIn('vhchat-json:v1:', str(stored_payload))
        self.assertNotIn('mobile-compatible message', str(stored_payload))
        self.assertEqual(OutboxEvent.objects.get(pk=event.pk).payload, payload)

class ChatWebsocketCompatibilityTests(IsolatedAsyncioTestCase):
    async def test_chat_event_sends_decrypted_data_using_existing_shape(self):
        data = {'body': 'mobile app receives the ordinary JSON body'}
        consumer = type('ConsumerStub', (), {'send_json': AsyncMock()})()
        await ChatConsumer.chat_event(
            consumer,
            {'event': {'type': 'message_created', 'data': encrypt_json(
                data, context=b'chat-realtime-v1', prefix=EVENT_PREFIX,
            )}},
        )
        consumer.send_json.assert_awaited_once_with({'type': 'message_created', 'data': data})
