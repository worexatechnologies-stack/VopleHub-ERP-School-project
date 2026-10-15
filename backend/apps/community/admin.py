from django.contrib import admin
from .models import SchoolEvent, EventRegistration, CommunityPost


@admin.register(SchoolEvent)
class SchoolEventAdmin(admin.ModelAdmin):
    list_display = ['title', 'school', 'kind', 'date', 'registration_deadline', 'capacity', 'status']
    list_filter = ['school', 'kind', 'status']
    search_fields = ['title', 'venue', 'description']


@admin.register(EventRegistration)
class EventRegistrationAdmin(admin.ModelAdmin):
    list_display = ['ticket_code', 'event', 'attendee_name', 'class_name', 'section', 'roll_no', 'status', 'registered_at']
    list_filter = ['school', 'status', 'event']
    search_fields = ['ticket_code', 'attendee_name', 'event__title']


@admin.register(CommunityPost)
class CommunityPostAdmin(admin.ModelAdmin):
    list_display = ['title', 'school', 'kind', 'audience', 'author_name', 'created_at']
    list_filter = ['school', 'kind']
    search_fields = ['title', 'body', 'author_name']
