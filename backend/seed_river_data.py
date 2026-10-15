import os
import sys
import django
import random
import uuid
from datetime import date, time, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.schools.models import School
from apps.academics.models import Class, Section, Subject, AcademicYear
from apps.accounts.models import User
from apps.staff.models import Teacher, TeacherTeachingAssignment
from apps.sis.models import Student
from apps.exams.models import ExamSchedule, ExamScheduleItem, Exam
from django.contrib.auth.hashers import make_password
from django.db import transaction

print("Starting River High School complete seeding (40 students per section)...")

school = School.objects.filter(code='river').first()
if not school:
    print("Error: River school not found!")
    sys.exit(1)

print(f"Target School: {school.name} (id={school.id}, code={school.code})")

academic_year_obj = AcademicYear.objects.filter(school=school, is_active=True).first()
academic_year_str = academic_year_obj.name if academic_year_obj else '2026-29'
print(f"Academic Year: {academic_year_str}")

with transaction.atomic():
    # -------------------------------------------------------------
    # 1. Ensure Standard Subjects exist
    # -------------------------------------------------------------
    subject_names = ['English', 'Maths', 'Science', 'Social Science', 'Kannada', 'Hindi', 'Computer Science']
    subjects_dict = {}
    for sub_name in subject_names:
        sub_obj, created = Subject.objects.get_or_create(school=school, name=sub_name)
        subjects_dict[sub_name] = sub_obj
        if created:
            print(f"Created subject: {sub_name}")

    # -------------------------------------------------------------
    # 2. Ensure Classes 1 to 10 exist with normalized names
    # -------------------------------------------------------------
    classes_dict = {}
    for i in range(1, 11):
        c_name = f"Class {i}"
        c_code = f"class-{i}"

        c_obj = Class.objects.filter(school=school, name__iexact=c_name).first()
        if not c_obj:
            c_obj = Class.objects.filter(school=school, code=c_code).first()

        if c_obj:
            c_obj.name = c_name
            c_obj.code = c_code
            c_obj.sort_order = i
            c_obj.save()
        else:
            c_obj = Class.objects.create(
                school=school,
                name=c_name,
                code=c_code,
                sort_order=i
            )
            print(f"Created class: {c_name}")

        c_obj.subjects.set(list(subjects_dict.values()))
        classes_dict[i] = c_obj

    # -------------------------------------------------------------
    # 3. Ensure Sections A, B, and C exist for EVERY class (1 to 10)
    # -------------------------------------------------------------
    sections_dict = {}  # (class_num, sec_name) -> Section

    # Normalize Class 2 bad section names if any remaining
    c2 = classes_dict[2]
    for bad_sec in Section.objects.filter(school=school, class_room=c2):
        clean_name = bad_sec.name.replace('\\', '').strip().upper()
        if clean_name in ['A', 'B', 'C']:
            existing_clean = Section.objects.filter(school=school, class_room=c2, name=clean_name).exclude(id=bad_sec.id).first()
            if existing_clean:
                Student.objects.filter(section_record=bad_sec).update(section_record=existing_clean, section=clean_name)
                bad_sec.delete()
            else:
                bad_sec.name = clean_name
                bad_sec.save()

    for i in range(1, 11):
        c_obj = classes_dict[i]
        for s_name in ['A', 'B', 'C']:
            s_obj, created = Section.objects.get_or_create(
                school=school,
                class_room=c_obj,
                name=s_name,
            )
            sections_dict[(i, s_name)] = s_obj
            if created:
                print(f"Created Section: {c_obj.name} - {s_name}")

    # -------------------------------------------------------------
    # 4. Teachers for River High School — Full Coverage for ALL
    #    classes (1-10) and ALL sections (A, B, C) for ALL subjects
    # -------------------------------------------------------------
    # Each teacher assignment: (class_num, section_name, subject_name)
    # Strategy: Every class-section-subject combo must have exactly one teacher

    teacher_configs = [
        # --- PRIMARY CLASSES 1-3 (all subjects, all sections) ---
        {
            'email': 'priya.sharma@riverschool.edu',
            'first_name': 'Priya',
            'last_name': 'Sharma',
            'phone': '9845112233',
            'qualification': 'M.Sc, B.Ed (Mathematics)',
            'subjects': ['Maths'],
            'assignments': [
                (1, 'A', 'Maths'), (1, 'B', 'Maths'), (1, 'C', 'Maths'),
                (2, 'A', 'Maths'), (2, 'B', 'Maths'), (2, 'C', 'Maths'),
                (3, 'A', 'Maths'), (3, 'B', 'Maths'), (3, 'C', 'Maths'),
            ]
        },
        {
            'email': 'anita.desai@riverschool.edu',
            'first_name': 'Anita',
            'last_name': 'Desai',
            'phone': '9845334455',
            'qualification': 'M.A, B.Ed (English Literature)',
            'subjects': ['English'],
            'assignments': [
                (1, 'A', 'English'), (1, 'B', 'English'), (1, 'C', 'English'),
                (2, 'A', 'English'), (2, 'B', 'English'), (2, 'C', 'English'),
                (3, 'A', 'English'), (3, 'B', 'English'), (3, 'C', 'English'),
            ]
        },
        {
            'email': 'kavitha.reddy@riverschool.edu',
            'first_name': 'Kavitha',
            'last_name': 'Reddy',
            'phone': '9845556677',
            'qualification': 'M.A (Kannada), B.Ed',
            'subjects': ['Kannada'],
            'assignments': [
                (1, 'A', 'Kannada'), (1, 'B', 'Kannada'), (1, 'C', 'Kannada'),
                (2, 'A', 'Kannada'), (2, 'B', 'Kannada'), (2, 'C', 'Kannada'),
                (3, 'A', 'Kannada'), (3, 'B', 'Kannada'), (3, 'C', 'Kannada'),
            ]
        },
        {
            'email': 'lata.menon@riverschool.edu',
            'first_name': 'Lata',
            'last_name': 'Menon',
            'phone': '9845667122',
            'qualification': 'M.A (Hindi), B.Ed',
            'subjects': ['Hindi'],
            'assignments': [
                (1, 'A', 'Hindi'), (1, 'B', 'Hindi'), (1, 'C', 'Hindi'),
                (2, 'A', 'Hindi'), (2, 'B', 'Hindi'), (2, 'C', 'Hindi'),
                (3, 'A', 'Hindi'), (3, 'B', 'Hindi'), (3, 'C', 'Hindi'),
            ]
        },
        {
            'email': 'ramesh.kumar@riverschool.edu',
            'first_name': 'Ramesh',
            'last_name': 'Kumar',
            'phone': '9845223344',
            'qualification': 'M.Sc, B.Ed (Physics)',
            'subjects': ['Science'],
            'assignments': [
                (1, 'A', 'Science'), (1, 'B', 'Science'), (1, 'C', 'Science'),
                (2, 'A', 'Science'), (2, 'B', 'Science'), (2, 'C', 'Science'),
                (3, 'A', 'Science'), (3, 'B', 'Science'), (3, 'C', 'Science'),
            ]
        },
        {
            'email': 'suresh.patil@riverschool.edu',
            'first_name': 'Suresh',
            'last_name': 'Patil',
            'phone': '9845445566',
            'qualification': 'M.A, B.Ed (History)',
            'subjects': ['Social Science'],
            'assignments': [
                (1, 'A', 'Social Science'), (1, 'B', 'Social Science'), (1, 'C', 'Social Science'),
                (2, 'A', 'Social Science'), (2, 'B', 'Social Science'), (2, 'C', 'Social Science'),
                (3, 'A', 'Social Science'), (3, 'B', 'Social Science'), (3, 'C', 'Social Science'),
            ]
        },
        {
            'email': 'pavan.cs1@riverschool.edu',
            'first_name': 'Pavan',
            'last_name': 'Raju',
            'phone': '9845550011',
            'qualification': 'MCA, B.Ed',
            'subjects': ['Computer Science'],
            'assignments': [
                (1, 'A', 'Computer Science'), (1, 'B', 'Computer Science'), (1, 'C', 'Computer Science'),
                (2, 'A', 'Computer Science'), (2, 'B', 'Computer Science'), (2, 'C', 'Computer Science'),
                (3, 'A', 'Computer Science'), (3, 'B', 'Computer Science'), (3, 'C', 'Computer Science'),
            ]
        },

        # --- MIDDLE CLASSES 4-6 ---
        {
            'email': 'deepa.nair@riverschool.edu',
            'first_name': 'Deepa',
            'last_name': 'Nair',
            'phone': '9845778899',
            'qualification': 'M.Sc (Mathematics), B.Ed',
            'subjects': ['Maths'],
            'assignments': [
                (4, 'A', 'Maths'), (4, 'B', 'Maths'), (4, 'C', 'Maths'),
                (5, 'A', 'Maths'), (5, 'B', 'Maths'), (5, 'C', 'Maths'),
                (6, 'A', 'Maths'), (6, 'B', 'Maths'), (6, 'C', 'Maths'),
            ]
        },
        {
            'email': 'meena.shetty@riverschool.edu',
            'first_name': 'Meena',
            'last_name': 'Shetty',
            'phone': '9845998822',
            'qualification': 'M.A, B.Ed (English)',
            'subjects': ['English'],
            'assignments': [
                (4, 'A', 'English'), (4, 'B', 'English'), (4, 'C', 'English'),
                (5, 'A', 'English'), (5, 'B', 'English'), (5, 'C', 'English'),
                (6, 'A', 'English'), (6, 'B', 'English'), (6, 'C', 'English'),
            ]
        },
        {
            'email': 'nandini.bhat@riverschool.edu',
            'first_name': 'Nandini',
            'last_name': 'Bhat',
            'phone': '9845112244',
            'qualification': 'M.A (Kannada), B.Ed',
            'subjects': ['Kannada'],
            'assignments': [
                (4, 'A', 'Kannada'), (4, 'B', 'Kannada'), (4, 'C', 'Kannada'),
                (5, 'A', 'Kannada'), (5, 'B', 'Kannada'), (5, 'C', 'Kannada'),
                (6, 'A', 'Kannada'), (6, 'B', 'Kannada'), (6, 'C', 'Kannada'),
            ]
        },
        {
            'email': 'manoj.singh@riverschool.edu',
            'first_name': 'Manoj',
            'last_name': 'Singh',
            'phone': '9845667788',
            'qualification': 'M.A (Hindi), B.Ed',
            'subjects': ['Hindi'],
            'assignments': [
                (4, 'A', 'Hindi'), (4, 'B', 'Hindi'), (4, 'C', 'Hindi'),
                (5, 'A', 'Hindi'), (5, 'B', 'Hindi'), (5, 'C', 'Hindi'),
                (6, 'A', 'Hindi'), (6, 'B', 'Hindi'), (6, 'C', 'Hindi'),
            ]
        },
        {
            'email': 'vijay.shekhar@riverschool.edu',
            'first_name': 'Vijay',
            'last_name': 'Shekhar',
            'phone': '9845889900',
            'qualification': 'M.Sc (Chemistry), B.Ed',
            'subjects': ['Science'],
            'assignments': [
                (4, 'A', 'Science'), (4, 'B', 'Science'), (4, 'C', 'Science'),
                (5, 'A', 'Science'), (5, 'B', 'Science'), (5, 'C', 'Science'),
                (6, 'A', 'Science'), (6, 'B', 'Science'), (6, 'C', 'Science'),
            ]
        },
        {
            'email': 'girish.soc456@riverschool.edu',
            'first_name': 'Girish',
            'last_name': 'Acharya',
            'phone': '9845332211',
            'qualification': 'M.A (Social Science), B.Ed',
            'subjects': ['Social Science'],
            'assignments': [
                (4, 'A', 'Social Science'), (4, 'B', 'Social Science'), (4, 'C', 'Social Science'),
                (5, 'A', 'Social Science'), (5, 'B', 'Social Science'), (5, 'C', 'Social Science'),
                (6, 'A', 'Social Science'), (6, 'B', 'Social Science'), (6, 'C', 'Social Science'),
            ]
        },
        {
            'email': 'arun.joshi@riverschool.edu',
            'first_name': 'Arun',
            'last_name': 'Joshi',
            'phone': '9845001122',
            'qualification': 'MCA, B.Ed',
            'subjects': ['Computer Science'],
            'assignments': [
                (4, 'A', 'Computer Science'), (4, 'B', 'Computer Science'), (4, 'C', 'Computer Science'),
                (5, 'A', 'Computer Science'), (5, 'B', 'Computer Science'), (5, 'C', 'Computer Science'),
                (6, 'A', 'Computer Science'), (6, 'B', 'Computer Science'), (6, 'C', 'Computer Science'),
            ]
        },

        # --- UPPER CLASSES 7-10 ---
        {
            'email': 'rajesh.bhat@riverschool.edu',
            'first_name': 'Rajesh',
            'last_name': 'Bhat',
            'phone': '9845224466',
            'qualification': 'M.Sc (Mathematics)',
            'subjects': ['Maths'],
            'assignments': [
                (7, 'A', 'Maths'), (7, 'B', 'Maths'), (7, 'C', 'Maths'),
                (8, 'A', 'Maths'), (8, 'B', 'Maths'), (8, 'C', 'Maths'),
                (9, 'A', 'Maths'), (9, 'B', 'Maths'), (9, 'C', 'Maths'),
                (10, 'A', 'Maths'), (10, 'B', 'Maths'), (10, 'C', 'Maths'),
            ]
        },
        {
            'email': 'sunita.rao@riverschool.edu',
            'first_name': 'Sunita',
            'last_name': 'Rao',
            'phone': '9845990011',
            'qualification': 'M.A, M.Phil (English)',
            'subjects': ['English'],
            'assignments': [
                (7, 'A', 'English'), (7, 'B', 'English'), (7, 'C', 'English'),
                (8, 'A', 'English'), (8, 'B', 'English'), (8, 'C', 'English'),
                (9, 'A', 'English'), (9, 'B', 'English'), (9, 'C', 'English'),
                (10, 'A', 'English'), (10, 'B', 'English'), (10, 'C', 'English'),
            ]
        },
        {
            'email': 'prakash.nayak@riverschool.edu',
            'first_name': 'Prakash',
            'last_name': 'Nayak',
            'phone': '9845446688',
            'qualification': 'M.A (Kannada Literature)',
            'subjects': ['Kannada'],
            'assignments': [
                (7, 'A', 'Kannada'), (7, 'B', 'Kannada'), (7, 'C', 'Kannada'),
                (8, 'A', 'Kannada'), (8, 'B', 'Kannada'), (8, 'C', 'Kannada'),
                (9, 'A', 'Kannada'), (9, 'B', 'Kannada'), (9, 'C', 'Kannada'),
                (10, 'A', 'Kannada'), (10, 'B', 'Kannada'), (10, 'C', 'Kannada'),
            ]
        },
        {
            'email': 'pooja.hindi789@riverschool.edu',
            'first_name': 'Pooja',
            'last_name': 'Verma',
            'phone': '9845778011',
            'qualification': 'M.A (Hindi), B.Ed',
            'subjects': ['Hindi'],
            'assignments': [
                (7, 'A', 'Hindi'), (7, 'B', 'Hindi'), (7, 'C', 'Hindi'),
                (8, 'A', 'Hindi'), (8, 'B', 'Hindi'), (8, 'C', 'Hindi'),
                (9, 'A', 'Hindi'), (9, 'B', 'Hindi'), (9, 'C', 'Hindi'),
                (10, 'A', 'Hindi'), (10, 'B', 'Hindi'), (10, 'C', 'Hindi'),
            ]
        },
        {
            'email': 'shilpa.hegde@riverschool.edu',
            'first_name': 'Shilpa',
            'last_name': 'Hegde',
            'phone': '9845335577',
            'qualification': 'M.Sc (Biology), B.Ed',
            'subjects': ['Science'],
            'assignments': [
                (7, 'A', 'Science'), (7, 'B', 'Science'), (7, 'C', 'Science'),
                (8, 'A', 'Science'), (8, 'B', 'Science'), (8, 'C', 'Science'),
                (9, 'A', 'Science'), (9, 'B', 'Science'), (9, 'C', 'Science'),
                (10, 'A', 'Science'), (10, 'B', 'Science'), (10, 'C', 'Science'),
            ]
        },
        {
            'email': 'meera.kulkarni@riverschool.edu',
            'first_name': 'Meera',
            'last_name': 'Kulkarni',
            'phone': '9845113355',
            'qualification': 'M.A (Economics), B.Ed',
            'subjects': ['Social Science'],
            'assignments': [
                (7, 'A', 'Social Science'), (7, 'B', 'Social Science'), (7, 'C', 'Social Science'),
                (8, 'A', 'Social Science'), (8, 'B', 'Social Science'), (8, 'C', 'Social Science'),
                (9, 'A', 'Social Science'), (9, 'B', 'Social Science'), (9, 'C', 'Social Science'),
                (10, 'A', 'Social Science'), (10, 'B', 'Social Science'), (10, 'C', 'Social Science'),
            ]
        },
        {
            'email': 'kiran.cs710@riverschool.edu',
            'first_name': 'Kiran',
            'last_name': 'Prasad',
            'phone': '9845667200',
            'qualification': 'M.Tech (CS), B.Ed',
            'subjects': ['Computer Science'],
            'assignments': [
                (7, 'A', 'Computer Science'), (7, 'B', 'Computer Science'), (7, 'C', 'Computer Science'),
                (8, 'A', 'Computer Science'), (8, 'B', 'Computer Science'), (8, 'C', 'Computer Science'),
                (9, 'A', 'Computer Science'), (9, 'B', 'Computer Science'), (9, 'C', 'Computer Science'),
                (10, 'A', 'Computer Science'), (10, 'B', 'Computer Science'), (10, 'C', 'Computer Science'),
            ]
        },
    ]

    for t_conf in teacher_configs:
        email = t_conf['email']
        u = User.objects.filter(email=email).first()
        if not u:
            u = User.objects.create(
                email=email,
                username=email.split('@')[0],
                first_name=t_conf['first_name'],
                last_name=t_conf['last_name'],
                role=User.Role.TEACHER,
                school=school,
                is_active=True,
                password=make_password('Admin@123')
            )
            print(f"Created teacher user: {t_conf['first_name']} {t_conf['last_name']}")
        else:
            u.role = User.Role.TEACHER
            u.school = school
            u.is_active = True
            u.first_name = t_conf['first_name']
            u.last_name = t_conf['last_name']
            u.set_password('Admin@123')
            u.save()

        assigned_sec_strings = []
        target_sections = []
        for c_num, s_name, sub in t_conf['assignments']:
            sec_str = f"Class {c_num}-{s_name}"
            if sec_str not in assigned_sec_strings:
                assigned_sec_strings.append(sec_str)
            sec_obj = sections_dict.get((c_num, s_name))
            if sec_obj and sec_obj not in target_sections:
                target_sections.append(sec_obj)

        teacher_profile, created = Teacher.objects.get_or_create(
            user=u,
            defaults={
                'school': school,
                'qualification': t_conf['qualification'],
                'joining_date': date(2024, 6, 1),
                'phone': t_conf['phone'],
                'salary': 45000.00,
                'status': Teacher.Status.ACTIVE,
                'assigned_sections': assigned_sec_strings,
                'subjects': t_conf['subjects'],
            }
        )
        if not created:
            teacher_profile.school = school
            teacher_profile.status = Teacher.Status.ACTIVE
            teacher_profile.assigned_sections = assigned_sec_strings
            teacher_profile.subjects = t_conf['subjects']
            teacher_profile.qualification = t_conf['qualification']
            teacher_profile.save()

        teacher_profile.sections.set(target_sections)
        teacher_profile.subject_records.set([subjects_dict[s] for s in t_conf['subjects'] if s in subjects_dict])

        for c_num, s_name, sub in t_conf['assignments']:
            sec_obj = sections_dict.get((c_num, s_name))
            sub_obj = subjects_dict.get(sub)
            if sec_obj and sub_obj:
                try:
                    TeacherTeachingAssignment.objects.get_or_create(
                        school=school,
                        teacher=teacher_profile,
                        section=sec_obj,
                        subject=sub_obj,
                    )
                except Exception as e:
                    print(f"  Warning creating assignment {c_num}-{s_name} {sub}: {e}")

    print("All teacher assignments created.")

    # Verify coverage
    total_combos = 0
    missing_combos = []
    for i in range(1, 11):
        for s_name in ['A', 'B', 'C']:
            sec_obj = sections_dict.get((i, s_name))
            if not sec_obj:
                continue
            for sub_name in subject_names:
                total_combos += 1
                sub_obj = subjects_dict.get(sub_name)
                if not sub_obj:
                    continue
                has_assignment = TeacherTeachingAssignment.objects.filter(
                    school=school,
                    section=sec_obj,
                    subject=sub_obj,
                ).exists()
                if not has_assignment:
                    missing_combos.append(f"Class {i}-{s_name}: {sub_name}")

    if missing_combos:
        print(f"\nWARNING: {len(missing_combos)} missing teacher-subject assignments:")
        for mc in missing_combos[:20]:
            print(f"  - {mc}")
    else:
        print(f"\nAll {total_combos} class-section-subject combos have a teacher assigned!")

    # -------------------------------------------------------------
    # 5. Populate EXACTLY 40 Students in EVERY Section of EVERY Class
    # -------------------------------------------------------------
    first_names_m = [
        'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan',
        'Krishna', 'Ishan', 'Shaurya', 'Atharv', 'Dhruv', 'Kabir', 'Ritvik', 'Anish',
        'Rohan', 'Nikhil', 'Varun', 'Karthik', 'Tejas', 'Pranav', 'Siddharth', 'Yash',
        'Harsh', 'Dev', 'Aryan', 'Madhav', 'Chetan', 'Darshan', 'Manjunath', 'Naveen',
        'Praveen', 'Sagar', 'Puneeth', 'Bharat', 'Rakesh', 'Vinay', 'Santhosh', 'Manoj',
        'Girish', 'Abhishek', 'Chandan', 'Deepak', 'Eshwar', 'Harish', 'Jagadish', 'Kiran'
    ]
    first_names_f = [
        'Aadhya', 'Saanvi', 'Ananya', 'Diya', 'Fatima', 'Ishani', 'Myra', 'Samaira',
        'Navya', 'Kiara', 'Anika', 'Avani', 'Pari', 'Riya', 'Tara', 'Kavya',
        'Sneha', 'Pooja', 'Divya', 'Meera', 'Shreya', 'Tanvi', 'Aditi', 'Nandini',
        'Priya', 'Swathi', 'Bhavana', 'Deepika', 'Rekha', 'Sahana', 'Spandana', 'Meghana',
        'Rakshitha', 'Harshitha', 'Chaithra', 'Lavanya', 'Sushma', 'Keerthi', 'Bhoomika', 'Varsha',
        'Anusha', 'Bindu', 'Chandana', 'Dhanya', 'Geetha', 'Hema', 'Inchara', 'Jyothi'
    ]
    last_names = [
        'Sharma', 'Rao', 'Gowda', 'Patil', 'Kumar', 'Verma', 'Reddy', 'Nair',
        'Hegde', 'Iyer', 'Joshi', 'Singh', 'Bhat', 'Shettigar', 'Kulkarni', 'Desai',
        'Acharya', 'Kamat', 'Nayak', 'Shenoy', 'Shetty', 'Poojary', 'Shinde',
        'Choudhary', 'Patel', 'Agarwal', 'Pillai', 'Das', 'Roy', 'Menon', 'Prasad'
    ]

    EXACT_TARGET = 40
    total_added = 0

    for (c_num, s_name), sec_obj in sorted(sections_dict.items()):
        c_obj = classes_dict[c_num]

        # Existing students in this class and section
        existing_students = list(Student.objects.filter(
            school=school,
            class_name__iexact=c_obj.name,
            section__iexact=s_name,
        ).order_by('roll_no', 'id'))

        existing_count = len(existing_students)
        needed = EXACT_TARGET - existing_count

        if needed > 0:
            print(f"{c_obj.name} Sec {s_name}: Currently {existing_count} students -> Adding {needed} to reach {EXACT_TARGET}...")
            existing_rolls = {st.roll_no for st in existing_students}
            birth_year = 2026 - (5 + c_num)

            new_students = []
            curr_roll = 1
            added_for_sec = 0

            while added_for_sec < needed:
                while curr_roll in existing_rolls:
                    curr_roll += 1

                is_female = random.random() < 0.5
                fname = random.choice(first_names_f) if is_female else random.choice(first_names_m)
                lname = random.choice(last_names)
                full_name = f"{fname} {lname}"
                gender = 'Female' if is_female else 'Male'

                birth_month = random.randint(1, 12)
                birth_day = random.randint(1, 28)
                dob_val = date(birth_year, birth_month, birth_day)

                parent_fname = random.choice(first_names_m)
                parent_name = f"{parent_fname} {lname}"
                parent_phone = f"98{random.randint(10000000, 99999999)}"
                parent_email = f"{fname.lower()}.{lname.lower()}{random.randint(100, 999)}@gmail.com"

                adm_no = f"ADM-202629-{uuid.uuid4().hex[:8].upper()}"

                st = Student(
                    school=school,
                    admission_no=adm_no,
                    name=full_name,
                    class_name=c_obj.name,
                    section=s_name,
                    section_record=sec_obj,
                    roll_no=curr_roll,
                    parent_name=parent_name,
                    parent_phone=parent_phone,
                    parent_email=parent_email,
                    dob=dob_val,
                    gender=gender,
                    address=f"#{random.randint(1, 500)}, {random.choice(['MG Road', 'Gandhi Nagar', 'Indiranagar', 'Jayanagar', 'Rajajinagar', 'Koramangala'])}, Bengaluru",
                    medical_conditions="",
                    status=Student.Status.ACTIVE,
                    academic_year=academic_year_str,
                    attendance_percentage=round(random.uniform(85.0, 99.0), 2),
                    fee_total=45000.00,
                    fee_paid=random.choice([30000.00, 35000.00, 40000.00, 45000.00]),
                )
                new_students.append(st)
                existing_rolls.add(curr_roll)
                curr_roll += 1
                added_for_sec += 1

            Student.objects.bulk_create(new_students)
            total_added += len(new_students)
        elif needed < 0:
            # If ever more than 40, trim to exactly 40
            to_remove = existing_students[EXACT_TARGET:]
            Student.objects.filter(id__in=[s.id for s in to_remove]).delete()
            print(f"{c_obj.name} Sec {s_name}: Trimmed from {existing_count} to {EXACT_TARGET}")
        else:
            print(f"{c_obj.name} Sec {s_name}: Already has exactly {EXACT_TARGET} students.")

        # Ensure all students in this section have sequential roll_no from 1 to 40
        sec_students = list(Student.objects.filter(
            school=school,
            class_name__iexact=c_obj.name,
            section__iexact=s_name,
        ).order_by('roll_no', 'name', 'id'))

        for idx, student in enumerate(sec_students, start=1):
            if student.roll_no != idx or student.section_record_id != sec_obj.id or student.class_name != c_obj.name or student.section != s_name:
                student.roll_no = idx
                student.section_record = sec_obj
                student.class_name = c_obj.name
                student.section = s_name
                student.save(update_fields=['roll_no', 'section_record', 'class_name', 'section'])

    print(f"\nAdded {total_added} students. All sections verified.")

    # -------------------------------------------------------------
    # 6. Ensure Mid Term Exam schedules exist for all Classes (1 to 10)
    #    Force status=published and marks_entry_days=10 on ALL schedules
    # -------------------------------------------------------------
    exam_schedule_items_data = [
        ('English', 100, 1),
        ('Kannada', 100, 2),
        ('Hindi', 100, 3),
        ('Maths', 100, 4),
        ('Science', 100, 5),
        ('Social Science', 100, 6),
        ('Computer Science', 50, 7),
    ]

    base_date = date.today() - timedelta(days=5)  # exams already happened, so window is open

    for i in range(1, 11):
        c_obj = classes_dict[i]
        sched, created = ExamSchedule.objects.get_or_create(
            school=school,
            classroom=c_obj,
            name='Mid Term Exam',
            defaults={
                'class_name': c_obj.name,
                'academic_year': academic_year_str,
                'status': 'published',
                'marks_entry_days': 10,
            }
        )
        # Always force published status and correct class name
        update_fields = []
        if sched.status != 'published':
            sched.status = 'published'
            update_fields.append('status')
        if sched.class_name != c_obj.name:
            sched.class_name = c_obj.name
            update_fields.append('class_name')
        if sched.marks_entry_days != 10:
            sched.marks_entry_days = 10
            update_fields.append('marks_entry_days')
        if update_fields:
            sched.save(update_fields=update_fields)
            print(f"Updated {c_obj.name} exam schedule: {update_fields}")

        for idx, (sub_name, max_m, ord_num) in enumerate(exam_schedule_items_data):
            sub_record = subjects_dict.get(sub_name)
            item, it_created = ExamScheduleItem.objects.get_or_create(
                schedule=sched,
                subject_name=sub_name,
                defaults={
                    'subject': sub_record,
                    'max_marks': max_m,
                    'order': ord_num,
                    'exam_date': base_date + timedelta(days=idx),
                    'start_time': time(9, 30),
                    'end_time': time(12, 30),
                }
            )
            # Update dates so the exam is in the past (window is open)
            if not it_created:
                exam_day = base_date + timedelta(days=idx)
                if item.exam_date != exam_day:
                    item.exam_date = exam_day
                    item.save(update_fields=['exam_date'])

    print("Exam schedules verified and published for all classes.")

final_student_count = Student.objects.filter(school=school).count()
print(f"\nSUCCESS! Total students in River High School: {final_student_count}")
print(f"Teachers created/updated with FULL coverage for all 10 classes x 3 sections x 7 subjects.")
print("\nTeacher login credentials:")
print("  Email format: <name>@riverschool.edu")
print("  Password: Admin@123")
