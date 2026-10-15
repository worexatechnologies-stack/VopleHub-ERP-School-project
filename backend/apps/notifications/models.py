from django.conf import settings
from django.db import models


class Notification(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE, related_name='notifications')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='sent_notifications')
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    category = models.CharField(max_length=80)
    title = models.CharField(max_length=160)
    body = models.TextField()
    channel = models.CharField(max_length=40)
    broadcast_id = models.UUIDField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=20, default='Pending')
    related_object = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'read_at', '-created_at']),
            models.Index(fields=['school', '-created_at']),
            models.Index(fields=['broadcast_id']),
            models.Index(fields=['status']),
        ]


class NotificationPreference(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notification_preferences')
    category = models.CharField(max_length=80)
    push_enabled = models.BooleanField(default=True)

    class Meta:
        unique_together = ('user', 'category')


class DeviceToken(models.Model):
    class Platform(models.TextChoices):
        WEB = 'web', 'Web browser'
        ANDROID = 'android', 'Android'
        IOS = 'ios', 'iOS'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='device_tokens')
    # FCM registration tokens are credentials. They are never returned by the
    # API or written to logs.
    token = models.CharField(max_length=4096, unique=True)
    platform = models.CharField(max_length=16, choices=Platform.choices, default=Platform.WEB)
    device_name = models.CharField(max_length=160, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    failure_count = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=160, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', 'is_active']),
            models.Index(fields=['is_active', 'last_seen_at']),
        ]
