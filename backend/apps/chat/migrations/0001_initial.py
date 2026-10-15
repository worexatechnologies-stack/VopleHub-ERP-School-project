from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [('accounts', '0003_parentprofile'), ('schools', '0001_initial'), ('sis', '0001_initial')]
    operations = [migrations.CreateModel(name='ChatbotInteraction', fields=[
        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
        ('question', models.TextField()), ('response', models.TextField()), ('token_usage', models.PositiveIntegerField(default=0)), ('created_at', models.DateTimeField(auto_now_add=True)),
        ('parent', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chatbot_interactions', to=settings.AUTH_USER_MODEL)),
        ('school', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chatbot_interactions', to='schools.school')),
        ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chatbot_interactions', to='sis.student')),
    ], options={'ordering': ['-created_at']}),
    migrations.AddIndex(model_name='chatbotinteraction', index=models.Index(fields=['school', '-created_at'], name='chat_chatbo_school__145ea6_idx')),
    migrations.AddIndex(model_name='chatbotinteraction', index=models.Index(fields=['parent', '-created_at'], name='chat_chatbo_parent__ebe0a6_idx'))]
