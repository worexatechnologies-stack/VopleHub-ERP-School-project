import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.academics.models import Homework
from apps.accounts.models import User
from apps.sis.models import Student

# Check if any homework exists
hw_count = Homework.objects.count()
print(f'Total homework records: {hw_count}')

# Show all homework
for hw in Homework.objects.all()[:10]:
    print(f'  HW #{hw.id}: Class={hw.class_name!r} Section={hw.section_name!r} Subject={hw.subject_name!r} Title={hw.title!r}')

# Check students
student_count = Student.objects.count()
print(f'\nTotal students: {student_count}')
for s in Student.objects.all()[:5]:
    login = getattr(s, 'login_profile', None)
    print(f'  Student: {s.name!r} class={s.class_name!r} section={s.section!r} has_login={login is not None}')

# Check student users
student_users = User.objects.filter(role='student')
print(f'\nStudent user accounts: {student_users.count()}')
for u in student_users[:5]:
    print(f'  User: {u.email!r} role={u.role!r}')
    profile = getattr(u, 'student_profile', None)
    if profile:
        st = getattr(profile, 'student', None)
        if st:
            print(f'    -> Student: {st.name!r} class={st.class_name!r} section={st.section!r}')
        else:
            print(f'    -> profile exists but no student linked')
    else:
        # Try alternate lookup
        from apps.accounts.models import StudentProfile
        sp = StudentProfile.objects.filter(user=u).first()
        if sp:
            st = getattr(sp, 'student', None)
            print(f'    -> StudentProfile found via filter, student={st}')
        else:
            print(f'    -> No student_profile at all')

# Now simulate the get_queryset logic for a student user
print('\n--- Simulating homework query for each student user ---')
from django.db.models import Q
from apps.academics.views import _normalize_class_q

for u in student_users[:3]:
    from apps.accounts.models import StudentProfile
    student_profile = getattr(u, 'student_profile', None)
    student = getattr(student_profile, 'student', None) if student_profile else None
    if not student:
        student = Student.objects.filter(login_profile__user=u).first()
    
    print(f'\nUser: {u.email!r}')
    print(f'  student_profile={student_profile}')
    print(f'  student={student}')
    if student:
        print(f'  class_name={student.class_name!r} section={student.section!r}')
        q = _normalize_class_q(student.class_name)
        if student.section:
            q &= (Q(section_name__iexact=student.section) | Q(section_name='') | Q(section_name__isnull=True))
        matching_hw = Homework.objects.filter(school_id=u.school_id).filter(q)
        print(f'  Matching homework count: {matching_hw.count()}')
        for hw in matching_hw[:5]:
            print(f'    -> HW: {hw.title!r} class={hw.class_name!r} section={hw.section_name!r}')
    else:
        print(f'  Cannot find student record -> would return empty')
