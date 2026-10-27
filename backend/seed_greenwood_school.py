import os
import sys
import django
import random
from datetime import date
from decimal import Decimal

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.db import transaction
from django.contrib.auth.hashers import make_password
from apps.schools.models import School
from apps.academics.models import Class, Section, Subject, AcademicYear
from apps.accounts.models import User, StudentProfile, ParentProfile
from apps.staff.models import Teacher, TeacherTeachingAssignment
from apps.sis.models import Student

print("=== Starting Greenwood International Academy Seeding ===")

school, _ = School.objects.get_or_create(code='greenwood', defaults={'name': 'Greenwood International Academy', 'is_active': True})
print(f"Target School: {school.name} (id={school.id}, code={school.code})")

academic_year = AcademicYear.objects.filter(school=school, is_active=True).first()
if not academic_year:
    academic_year, _ = AcademicYear.objects.get_or_create(
        school=school,
        name='2026-2027',
        defaults={'starts_on': date(2026, 4, 1), 'ends_on': date(2027, 3, 31), 'is_active': True}
    )
print(f"Academic Year: {academic_year.name}")

with transaction.atomic():
    # -------------------------------------------------------------------------
    # 1. Ensure Standard Subjects Exist
    # -------------------------------------------------------------------------
    subject_names = [
        'English',
        'Mathematics',
        'Science',
        'Social Studies',
        'Computer Science',
        'Hindi',
        'Kannada'
    ]
    subjects_dict = {}
    for name in subject_names:
        sub_obj, created = Subject.objects.get_or_create(school=school, name=name)
        subjects_dict[name] = sub_obj
        if created:
            print(f" Created subject: {name}")

    # -------------------------------------------------------------------------
    # 2. Ensure Classes 1 to 10 Exist
    # -------------------------------------------------------------------------
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
            print(f" Created class: {c_name}")

        c_obj.subjects.set(list(subjects_dict.values()))
        classes_dict[i] = c_obj

    # -------------------------------------------------------------------------
    # 3. Ensure Sections A and B Exist for EVERY Class (1 to 10)
    # -------------------------------------------------------------------------
    sections_dict = {}  # (class_num, sec_name) -> Section
    for i in range(1, 11):
        c_obj = classes_dict[i]
        for s_name in ['A', 'B']:
            s_obj, created = Section.objects.get_or_create(
                school=school,
                class_room=c_obj,
                name=s_name,
            )
            sections_dict[(i, s_name)] = s_obj
            if created:
                print(f" Created Section: {c_obj.name} - Section {s_name}")

    print(f"Total sections ready: {len(sections_dict)} (Classes 1-10, Sections A & B)")

    # -------------------------------------------------------------------------
    # 4. Teachers for Greenwood International Academy
    #    Full coverage for ALL classes (1-10) and ALL sections (A, B) for ALL subjects
    # -------------------------------------------------------------------------
    teacher_configs = [
        # --- Primary Classes 1-5 ---
        {
            'email': 'priya.sharma@greenwood.edu',
            'first_name': 'Priya',
            'last_name': 'Sharma',
            'phone': '9845112233',
            'qualification': 'M.Sc, B.Ed (Mathematics)',
            'subjects': ['Mathematics'],
            'classes': [1, 2, 3, 4, 5],
        },
        {
            'email': 'anita.desai@greenwood.edu',
            'first_name': 'Anita',
            'last_name': 'Desai',
            'phone': '9845334455',
            'qualification': 'M.A, B.Ed (English Literature)',
            'subjects': ['English'],
            'classes': [1, 2, 3, 4, 5],
        },
        {
            'email': 'deepak.verma@greenwood.edu',
            'first_name': 'Deepak',
            'last_name': 'Verma',
            'phone': '9845556677',
            'qualification': 'M.Sc (Physics), B.Ed',
            'subjects': ['Science'],
            'classes': [1, 2, 3, 4, 5],
        },
        {
            'email': 'suresh.patil@greenwood.edu',
            'first_name': 'Suresh',
            'last_name': 'Patil',
            'phone': '9845778899',
            'qualification': 'M.A (History), B.Ed',
            'subjects': ['Social Studies'],
            'classes': [1, 2, 3, 4, 5],
        },
        {
            'email': 'mega@gmail.com',  # Existing teacher
            'first_name': 'Mega',
            'last_name': 'Veram',
            'phone': '9845991122',
            'qualification': 'MCA, B.Ed (Computer Science)',
            'subjects': ['Computer Science'],
            'classes': [1, 2, 3, 4, 5],
        },

        # --- Secondary Classes 6-10 ---
        {
            'email': 'rajesh.bhat@greenwood.edu',
            'first_name': 'Rajesh',
            'last_name': 'Bhat',
            'phone': '9845224466',
            'qualification': 'M.Sc (Mathematics), M.Ed',
            'subjects': ['Mathematics'],
            'classes': [6, 7, 8, 9, 10],
        },
        {
            'email': 'sunita.rao@greenwood.edu',
            'first_name': 'Sunita',
            'last_name': 'Rao',
            'phone': '9845446688',
            'qualification': 'M.A, M.Phil (English)',
            'subjects': ['English'],
            'classes': [6, 7, 8, 9, 10],
        },
        {
            'email': 'shilpa.hegde@greenwood.edu',
            'first_name': 'Shilpa',
            'last_name': 'Hegde',
            'phone': '9845668800',
            'qualification': 'M.Sc (Chemistry), B.Ed',
            'subjects': ['Science'],
            'classes': [6, 7, 8, 9, 10],
        },
        {
            'email': 'meera.kulkarni@greenwood.edu',
            'first_name': 'Meera',
            'last_name': 'Kulkarni',
            'phone': '9845880022',
            'qualification': 'M.A (Political Science), B.Ed',
            'subjects': ['Social Studies'],
            'classes': [6, 7, 8, 9, 10],
        },
        {
            'email': 'kiran.cs@greenwood.edu',
            'first_name': 'Kiran',
            'last_name': 'Prasad',
            'phone': '9845002244',
            'qualification': 'M.Tech (CS), B.Ed',
            'subjects': ['Computer Science'],
            'classes': [6, 7, 8, 9, 10],
        },

        # --- Language Faculty for All Classes 1-10 ---
        {
            'email': 'kavitha.reddy@greenwood.edu',
            'first_name': 'Kavitha',
            'last_name': 'Reddy',
            'phone': '9845113355',
            'qualification': 'M.A (Kannada), B.Ed',
            'subjects': ['Kannada'],
            'classes': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        },
        {
            'email': 'lata.menon@greenwood.edu',
            'first_name': 'Lata',
            'last_name': 'Menon',
            'phone': '9845335577',
            'qualification': 'M.A (Hindi), B.Ed',
            'subjects': ['Hindi'],
            'classes': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        },
    ]

    shared_pw = make_password('Admin@123')

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
                password=shared_pw
            )
            print(f" Created teacher account: {t_conf['first_name']} {t_conf['last_name']} ({email})")
        else:
            u.role = User.Role.TEACHER
            u.school = school
            u.is_active = True
            u.first_name = t_conf['first_name']
            u.last_name = t_conf['last_name']
            u.password = shared_pw
            u.save()

        assigned_sec_strings = []
        target_sections = []

        for c_num in t_conf['classes']:
            for s_name in ['A', 'B']:
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
                'salary': Decimal('52000.00'),
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

        # Create Teaching Assignments
        for c_num in t_conf['classes']:
            for s_name in ['A', 'B']:
                sec_obj = sections_dict.get((c_num, s_name))
                for sub_name in t_conf['subjects']:
                    sub_obj = subjects_dict.get(sub_name)
                    if sec_obj and sub_obj:
                        TeacherTeachingAssignment.objects.get_or_create(
                            school=school,
                            teacher=teacher_profile,
                            section=sec_obj,
                            subject=sub_obj,
                        )

    print("All teachers created and assigned across all classes, sections, and subjects.")

    # -------------------------------------------------------------------------
    # 5. Populate EXACTLY 20 Students in EVERY Section of EVERY Class
    # -------------------------------------------------------------------------
    first_names_m = [
        'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan',
        'Krishna', 'Ishan', 'Shaurya', 'Atharv', 'Dhruv', 'Kabir', 'Ritvik', 'Anish',
        'Rohan', 'Nikhil', 'Varun', 'Karthik', 'Tejas', 'Pranav', 'Siddharth', 'Yash',
        'Harsh', 'Dev', 'Aryan', 'Madhav', 'Chetan', 'Darshan', 'Manjunath', 'Naveen',
        'Praveen', 'Sagar', 'Puneeth', 'Bharat', 'Rakesh', 'Vinay', 'Santhosh', 'Manoj'
    ]
    first_names_f = [
        'Aadhya', 'Saanvi', 'Ananya', 'Diya', 'Fatima', 'Ishani', 'Myra', 'Samaira',
        'Navya', 'Kiara', 'Anika', 'Avani', 'Pari', 'Riya', 'Tara', 'Kavya',
        'Sneha', 'Pooja', 'Divya', 'Meera', 'Shreya', 'Tanvi', 'Aditi', 'Nandini',
        'Priya', 'Swathi', 'Bhavana', 'Deepika', 'Rekha', 'Sahana', 'Spandana', 'Meghana',
        'Rakshitha', 'Harshitha', 'Chaithra', 'Lavanya', 'Sushma', 'Keerthi', 'Bhoomika', 'Varsha'
    ]
    last_names = [
        'Sharma', 'Rao', 'Gowda', 'Patil', 'Kumar', 'Verma', 'Reddy', 'Nair',
        'Hegde', 'Iyer', 'Joshi', 'Singh', 'Bhat', 'Shettigar', 'Kulkarni', 'Desai',
        'Acharya', 'Kamat', 'Nayak', 'Shenoy', 'Shetty', 'Poojary', 'Shinde',
        'Choudhary', 'Patel', 'Agarwal', 'Pillai', 'Das', 'Roy', 'Menon', 'Prasad'
    ]

    TARGET_PER_SECTION = 20
    total_students_created = 0

    for (c_num, s_name), sec_obj in sorted(sections_dict.items()):
        c_obj = classes_dict[c_num]

        existing_students = list(Student.objects.filter(
            school=school,
            class_name__iexact=c_obj.name,
            section__iexact=s_name,
        ).order_by('roll_no', 'id'))

        # Also link section_record if missing on existing
        for st in existing_students:
            if not st.section_record:
                st.section_record = sec_obj
                st.save(update_fields=['section_record'])

        existing_count = len(existing_students)
        needed = TARGET_PER_SECTION - existing_count

        if needed > 0:
            existing_rolls = {st.roll_no for st in existing_students}
            birth_year = 2026 - (5 + c_num)

            curr_roll = 1
            for _ in range(needed):
                while curr_roll in existing_rolls:
                    curr_roll += 1
                existing_rolls.add(curr_roll)

                is_female = random.random() < 0.5
                fname = random.choice(first_names_f) if is_female else random.choice(first_names_m)
                lname = random.choice(last_names)
                full_name = f"{fname} {lname}"
                gender = 'Female' if is_female else 'Male'

                parent_fname = random.choice(first_names_m)
                parent_name = f"{parent_fname} {lname}"
                parent_phone = f"98{random.randint(10000000, 99999999)}"

                adm_no = f"GIA-2026-C{c_num:02d}{s_name}-{curr_roll:02d}"
                st_email = f"student.c{c_num}{s_name.lower()}{curr_roll:02d}@greenwood.edu"
                p_email = f"parent.c{c_num}{s_name.lower()}{curr_roll:02d}@greenwood.edu"

                birth_month = random.randint(1, 12)
                birth_day = random.randint(1, 28)
                dob = date(birth_year, birth_month, birth_day)

                student = Student.objects.create(
                    school=school,
                    name=full_name,
                    admission_no=adm_no,
                    roll_no=curr_roll,
                    class_name=c_obj.name,
                    section=s_name,
                    section_record=sec_obj,
                    gender=gender,
                    dob=dob,
                    parent_name=parent_name,
                    parent_phone=parent_phone,
                    parent_email=p_email,
                    address='Bengaluru, Karnataka, India',
                    academic_year=academic_year.name,
                    attendance_percentage=Decimal(f"{random.uniform(86.0, 98.5):.1f}"),
                    fee_total=Decimal('45000.00'),
                    fee_paid=Decimal('45000.00'),
                    status='Active'
                )

                # Student User Account
                st_user, _ = User.objects.get_or_create(
                    email=st_email,
                    defaults={
                        'username': st_email.split('@')[0],
                        'first_name': fname,
                        'last_name': lname,
                        'role': User.Role.STUDENT,
                        'school': school,
                        'is_active': True,
                        'password': shared_pw
                    }
                )
                StudentProfile.objects.get_or_create(user=st_user, defaults={'student': student})

                # Parent User Account
                p_user, _ = User.objects.get_or_create(
                    email=p_email,
                    defaults={
                        'username': p_email.split('@')[0],
                        'first_name': parent_fname,
                        'last_name': lname,
                        'role': User.Role.PARENT,
                        'school': school,
                        'is_active': True,
                        'password': shared_pw
                    }
                )
                p_prof, _ = ParentProfile.objects.get_or_create(user=p_user, defaults={'phone': parent_phone})
                p_prof.students.add(student)

                total_students_created += 1

    print(f"\nSuccessfully seeded {total_students_created} new students across all 20 sections!")
    print(f"Now EVERY section (Classes 1-10, Sections A & B) has exactly {TARGET_PER_SECTION} students!")

    # Verify Summary
    print("\n=== FINAL ACADEMIC STRUCTURE SUMMARY ===")
    total_students = Student.objects.filter(school=school).count()
    total_teachers = Teacher.objects.filter(school=school).count()
    total_assignments = TeacherTeachingAssignment.objects.filter(school=school).count()
    print(f"School: {school.name}")
    print(f"Classes: 1 to 10 (10 Classes)")
    print(f"Sections: 20 Sections (A and B for each class)")
    print(f"Students: {total_students} total ({TARGET_PER_SECTION} per section)")
    print(f"Teachers: {total_teachers} total")
    print(f"Teaching Assignments: {total_assignments} active assignments")

