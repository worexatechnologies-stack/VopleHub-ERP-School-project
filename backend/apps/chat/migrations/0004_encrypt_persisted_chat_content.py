from django.db import migrations
import apps.chat.fields


class Migration(migrations.Migration):
    # These fields keep their existing database types. The legacy row
    # conversion runs after new API containers are serving, so old API workers
    # never encounter ciphertext during deployment.
    atomic = False

    dependencies = [
        ('chat', '0003_chatauditlog_conversationparticipant_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='directmessage',
            name='body',
            field=apps.chat.fields.EncryptedChatTextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='messageattachment',
            name='file_data',
            field=apps.chat.fields.EncryptedChatBinaryField(blank=True, editable=False, null=True),
        ),
        migrations.AlterField(
            model_name='chatbotinteraction',
            name='question',
            field=apps.chat.fields.EncryptedChatTextField(),
        ),
        migrations.AlterField(
            model_name='chatbotinteraction',
            name='response',
            field=apps.chat.fields.EncryptedChatTextField(),
        ),
        migrations.AlterField(
            model_name='outboxevent',
            name='payload',
            field=apps.chat.fields.EncryptedChatJSONField(),
        ),
    ]
