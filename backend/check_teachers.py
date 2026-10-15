import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from apps.staff.models import Teacher
for t in Teacher.objects.all():
    user_email = t.user.email if t.user else 'No user'
    t_name = getattr(t, 'full_name', None) or (t.user.get_full_name() if t.user else str(t))
    print(f'Teacher: {t_name} ({user_email})')
    print(f'  assigned_sections: {t.assigned_sections}')
    print(f'  subjects: {t.subjects}')
    print(f'  canonical sections: {[f"{cs.class_room.name}-{cs.name}" for cs in t.sections.all()]}')
    print(f'  teaching_assignments: {[f"{ta.section.class_room.name}-{ta.section.name}: {ta.subject.name}" for ta in t.teaching_assignments.all()]}')
