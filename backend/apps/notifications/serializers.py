from rest_framework import serializers

from .models import DeviceToken, Notification


class NotificationComposerSerializer(serializers.Serializer):
    recipientMode = serializers.ChoiceField(choices=['all', 'class', 'section', 'subject', 'individual'], required=False, default='all')
    targetClass = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    targetClassId = serializers.IntegerField(required=False, allow_null=True, default=None)
    targetSection = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    targetSectionId = serializers.IntegerField(required=False, allow_null=True, default=None)
    recipients = serializers.ListField(child=serializers.CharField(), required=False, allow_empty=True, default=list)
    category = serializers.CharField(max_length=80)
    title = serializers.CharField(max_length=160)
    body = serializers.CharField()

    def validate(self, attrs):
        mode = attrs.get('recipientMode', 'all')
        recipients = attrs.get('recipients', [])
        target_class = attrs.get('targetClass')
        target_class_id = attrs.get('targetClassId')
        target_section = attrs.get('targetSection')
        target_section_id = attrs.get('targetSectionId')

        if mode == 'individual' and not recipients:
            raise serializers.ValidationError({
                'recipients': 'Select at least one recipient for a targeted message.',
            })
        if mode in ['class', 'section'] and not (target_class or target_class_id or target_section or target_section_id or recipients):
            raise serializers.ValidationError({
                'recipients': 'Select a class or section for a targeted broadcast.',
            })
        return attrs


class NotificationSerializer(serializers.ModelSerializer):
    senderId = serializers.IntegerField(source='sender_id', read_only=True)
    senderName = serializers.SerializerMethodField()
    recipientId = serializers.IntegerField(source='recipient_id', read_only=True)
    recipientName = serializers.SerializerMethodField()
    requestStatus = serializers.CharField(source='status', read_only=True)
    readAt = serializers.DateTimeField(source='read_at', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = Notification
        fields = ['id', 'senderId', 'senderName', 'recipientId', 'recipientName', 'category', 'title', 'body', 'channel', 'status', 'requestStatus', 'related_object', 'readAt', 'createdAt']

    def get_senderName(self, obj) -> str:
        if not obj.sender:
            return 'School office'
        return obj.sender.get_full_name() or obj.sender.email

    def get_recipientName(self, obj) -> str:
        if not obj.recipient:
            return ''
        return obj.recipient.get_full_name() or obj.recipient.email


class DeviceTokenRegistrationSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=4096, trim_whitespace=True)
    deviceName = serializers.CharField(max_length=160, required=False, allow_blank=True)

    def validate_token(self, value):
        # FCM tokens are opaque and may contain punctuation. Reject only
        # clearly malformed values without logging the secret token itself.
        if len(value) < 20 or any(character.isspace() for character in value):
            raise serializers.ValidationError('Invalid FCM token.')
        return value


class DeviceTokenSerializer(serializers.ModelSerializer):
    deviceName = serializers.CharField(source='device_name')
    platform = serializers.CharField(read_only=True)
    lastSeenAt = serializers.DateTimeField(source='last_seen_at')
    lastSuccessAt = serializers.DateTimeField(source='last_success_at')

    class Meta:
        model = DeviceToken
        # Do not expose the token back to the browser or to other sessions.
        fields = ['id', 'deviceName', 'platform', 'is_active', 'lastSeenAt', 'lastSuccessAt', 'created_at']
