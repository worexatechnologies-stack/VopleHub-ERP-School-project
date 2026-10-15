from rest_framework import serializers
from django.utils import timezone
from .models import SchoolEvent, EventRegistration, CommunityPost
from apps.accounts.models import User


class EventRegistrationSerializer(serializers.ModelSerializer):
    event_title = serializers.CharField(source='event.title', read_only=True)
    event_date = serializers.DateTimeField(source='event.date', read_only=True)
    event_venue = serializers.CharField(source='event.venue', read_only=True)
    ticket_required = serializers.BooleanField(source='event.ticket_required', read_only=True)
    admission_no = serializers.SerializerMethodField()

    class Meta:
        model = EventRegistration
        fields = [
            'id',
            'event',
            'event_title',
            'event_date',
            'event_venue',
            'ticket_required',
            'user',
            'student',
            'attendee_name',
            'attendee_email',
            'attendee_phone',
            'class_name',
            'section',
            'roll_no',
            'admission_no',
            'notes',
            'ticket_code',
            'status',
            'registered_at',
        ]
        read_only_fields = ['ticket_code', 'registered_at', 'status']

    def get_admission_no(self, obj) -> str:
        if obj.student:
            return obj.student.admission_no
        return ''


class EventRegisterInputSerializer(serializers.Serializer):
    attendee_name = serializers.CharField(max_length=160, required=False, allow_blank=True)
    attendee_email = serializers.EmailField(required=False, allow_blank=True)
    attendee_phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    class_name = serializers.CharField(max_length=40, required=False, allow_blank=True)
    section = serializers.CharField(max_length=40, required=False, allow_blank=True)
    roll_no = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class SchoolEventSerializer(serializers.ModelSerializer):
    registered_count = serializers.SerializerMethodField()
    is_deadline_passed = serializers.SerializerMethodField()
    is_registration_open = serializers.SerializerMethodField()
    is_registered = serializers.SerializerMethodField()
    my_ticket_code = serializers.SerializerMethodField()
    my_registration_id = serializers.SerializerMethodField()

    class Meta:
        model = SchoolEvent
        fields = [
            'id',
            'title',
            'kind',
            'description',
            'date',
            'end_date',
            'registration_deadline',
            'venue',
            'capacity',
            'ticket_required',
            'status',
            'audience',
            'created_by',
            'created_at',
            'updated_at',
            'registered_count',
            'is_deadline_passed',
            'is_registration_open',
            'is_registered',
            'my_ticket_code',
            'my_registration_id',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def validate(self, attrs):
        date = attrs.get('date', getattr(self.instance, 'date', None))
        registration_deadline = attrs.get(
            'registration_deadline',
            getattr(self.instance, 'registration_deadline', None),
        )
        if date and registration_deadline and registration_deadline > date:
            raise serializers.ValidationError({
                'registration_deadline': 'Registration deadline cannot be after the event start date.'
            })
        return attrs

    def get_registered_count(self, obj) -> int:
        return obj.registered_count

    def get_is_deadline_passed(self, obj) -> bool:
        return obj.is_deadline_passed

    def get_is_registration_open(self, obj) -> bool:
        return obj.is_registration_open

    def _get_user_registration(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        if not hasattr(self, '_user_registrations_cache'):
            user = request.user
            registrations = EventRegistration.objects.filter(
                school_id=user.school_id,
                status=EventRegistration.RegistrationStatus.CONFIRMED,
            )
            student_profile = getattr(user, 'student_profile', None)
            if student_profile:
                registrations = registrations.filter(
                    models_q(user=user) | models_q(student=student_profile.student)
                )
            else:
                registrations = registrations.filter(user=user)
            self._user_registrations_cache = {reg.event_id: reg for reg in registrations}
        return self._user_registrations_cache.get(obj.id)

    def get_is_registered(self, obj) -> bool:
        reg = self._get_user_registration(obj)
        return reg is not None

    def get_my_ticket_code(self, obj) -> str:
        reg = self._get_user_registration(obj)
        return reg.ticket_code if reg else ''

    def get_my_registration_id(self, obj) -> int | None:
        reg = self._get_user_registration(obj)
        return reg.id if reg else None


def models_q(**kwargs):
    from django.db.models import Q
    return Q(**kwargs)


class CommunityPostSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommunityPost
        fields = [
            'id',
            'kind',
            'title',
            'body',
            'audience',
            'channels',
            'author',
            'author_name',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['author', 'created_at', 'updated_at']
