import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class ChatbotInteraction(models.Model):
    """Access-controlled audit record; deliberately not written to application logs."""
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='chatbot_interactions')
    parent = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chatbot_interactions')
    student = models.ForeignKey('sis.Student', on_delete=models.CASCADE, related_name='chatbot_interactions')
    question = models.TextField()
    response = models.TextField()
    token_usage = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', '-created_at']),
            models.Index(fields=['parent', '-created_at']),
        ]


class Conversation(models.Model):
    class Type(models.TextChoices):
        DIRECT = 'direct', 'Direct'
        PARENT_TEACHER = 'parent_teacher', 'Parent-Teacher'
        ADMIN_STAFF = 'admin_staff', 'Admin-Staff'

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        ARCHIVED = 'archived', 'Archived'

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, db_index=True)
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='conversations')
    participant1 = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='conversations_as_p1')
    participant2 = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='conversations_as_p2')
    conversation_type = models.CharField(max_length=32, choices=Type.choices, default=Type.DIRECT)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.ACTIVE)
    student = models.ForeignKey('sis.Student', on_delete=models.SET_NULL, null=True, blank=True, related_name='conversations')
    last_message_preview = models.CharField(max_length=255, blank=True, default='')
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('participant1', 'participant2')
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['uuid']),
            models.Index(fields=['school', '-updated_at']),
            models.Index(fields=['participant1', '-updated_at']),
            models.Index(fields=['participant2', '-updated_at']),
            models.Index(fields=['student', '-updated_at']),
        ]

    @classmethod
    def get_or_create_between(cls, school, user_a, user_b, student=None, conv_type=None):
        p1, p2 = (user_a, user_b) if user_a.id < user_b.id else (user_b, user_a)
        if not conv_type:
            roles = {user_a.role, user_b.role}
            if 'parent' in roles and 'teacher' in roles:
                conv_type = cls.Type.PARENT_TEACHER
            elif 'school_admin' in roles and 'teacher' in roles:
                conv_type = cls.Type.ADMIN_STAFF
            else:
                conv_type = cls.Type.DIRECT

        conv, created = cls.objects.get_or_create(
            participant1=p1,
            participant2=p2,
            defaults={
                'school': school,
                'conversation_type': conv_type,
                'student': student,
            },
        )
        if not created and student and not conv.student:
            conv.student = student
            conv.save(update_fields=['student'])

        # Ensure participant records exist
        ConversationParticipant.objects.get_or_create(
            conversation=conv,
            user=p1,
            defaults={'role': getattr(p1, 'role', '')},
        )
        ConversationParticipant.objects.get_or_create(
            conversation=conv,
            user=p2,
            defaults={'role': getattr(p2, 'role', '')},
        )
        return conv, created

    def get_other_participant(self, user):
        return self.participant2 if self.participant1_id == user.id else self.participant1


class ConversationParticipant(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chat_memberships')
    role = models.CharField(max_length=32, blank=True, default='')
    joined_at = models.DateTimeField(auto_now_add=True)
    is_muted = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    last_read_at = models.DateTimeField(null=True, blank=True)
    last_read_message = models.ForeignKey(
        'DirectMessage', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )

    class Meta:
        unique_together = ('conversation', 'user')
        indexes = [
            models.Index(fields=['user', 'conversation']),
            models.Index(fields=['conversation', 'user']),
        ]


class DirectMessage(models.Model):
    class MessageType(models.TextChoices):
        TEXT = 'text', 'Text'
        ATTACHMENT = 'attachment', 'Attachment'
        SYSTEM = 'system', 'System'

    uuid = models.UUIDField(default=uuid.uuid4, editable=False, db_index=True)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_direct_messages')
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='received_direct_messages')
    body = models.TextField(blank=True, default='')
    message_type = models.CharField(max_length=24, choices=MessageType.choices, default=MessageType.TEXT)
    client_idempotency_key = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['uuid']),
            models.Index(fields=['conversation', 'created_at']),
            models.Index(fields=['recipient', 'read_at']),
            models.Index(fields=['conversation', 'client_idempotency_key']),
        ]


class MessageAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(DirectMessage, on_delete=models.CASCADE, related_name='attachments')
    file_key = models.CharField(max_length=512, blank=True, default='')
    file_data = models.BinaryField(blank=True, null=True, editable=False)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=128)
    file_size = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['message', 'created_at']),
        ]


class OutboxEvent(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PUBLISHED = 'published', 'Published'
        FAILED = 'failed', 'Failed'

    id = models.BigAutoField(primary_key=True)
    event_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    event_type = models.CharField(max_length=64, db_index=True)
    channel_name = models.CharField(max_length=128, db_index=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    retry_count = models.PositiveSmallIntegerField(default=0)
    error = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['event_type', 'status']),
        ]


class ChatAuditLog(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='chat_audit_logs')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='chat_audit_logs')
    action = models.CharField(max_length=64)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', '-created_at']),
        ]
