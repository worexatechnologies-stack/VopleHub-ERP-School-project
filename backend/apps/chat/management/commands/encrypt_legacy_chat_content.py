from django.core.management.base import BaseCommand
from django.db import transaction

from apps.chat.models import ChatbotInteraction, Conversation, DirectMessage, MessageAttachment, OutboxEvent
from apps.notifications.models import Notification


class Command(BaseCommand):
    help = 'Encrypt legacy chat data and remove plaintext message previews after the new API is serving.'

    def handle(self, *args, **options):
        encrypted_models = (
            (DirectMessage, ('body',)),
            (MessageAttachment, ('file_data',)),
            (ChatbotInteraction, ('question', 'response')),
            (OutboxEvent, ('payload',)),
        )
        total = 0
        for model, fields in encrypted_models:
            count = 0
            maximum_pk = model.objects.order_by('-pk').values_list('pk', flat=True).first()
            last_pk = None
            while maximum_pk is not None:
                batch_query = model.objects.filter(pk__lte=maximum_pk)
                if last_pk is not None:
                    batch_query = batch_query.filter(pk__gt=last_pk)
                batch_ids = list(batch_query.order_by('pk').values_list('pk', flat=True)[:50])
                if not batch_ids:
                    break
                with transaction.atomic():
                    records = model.objects.filter(pk__in=batch_ids).select_for_update().only('pk', *fields)
                    for record in records.iterator(chunk_size=50):
                        record.save(update_fields=fields)
                        count += 1
                last_pk = batch_ids[-1]
            total += count
            self.stdout.write(f'Encrypted {count} {model.__name__} records.')

        notifications_updated = Notification.objects.filter(channel='chat').exclude(
            body='You have a new message.'
        ).update(body='You have a new message.')
        previews_updated = Conversation.objects.exclude(last_message_preview__in=['', 'New message']).update(
            last_message_preview='New message'
        )
        self.stdout.write(
            self.style.SUCCESS(
                f'Chat storage protection complete: {total} records processed, '
                f'{notifications_updated} notifications sanitized, '
                f'{previews_updated} conversation previews sanitized.'
            )
        )
