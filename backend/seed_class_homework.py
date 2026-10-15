import os
import django
from datetime import date, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.academics.models import Homework, Class, Section, Subject
from apps.staff.models import Teacher
from apps.schools.models import School

school = School.objects.filter(id=2).first() or School.objects.first()
today = date.today()

sample_homeworks = [
    # Class 1
    {
        'class_name': '1',
        'section_name': 'A',
        'subject_name': 'English',
        'title': 'Alphabet Phonics & Sight Words Exercise',
        'description': 'Read Chapter 3 sight words on page 24. Write words starting with letters A to H in your practice notebook.',
        'due_date': today + timedelta(days=2),
        'max_marks': 20,
        'teacher_name': 'Anita Desai',
    },
    {
        'class_name': '1',
        'section_name': 'B',
        'subject_name': 'Mathematics',
        'title': 'Basic Number Counting (1 to 50) Worksheet',
        'description': 'Complete worksheet exercises 1 to 5 on missing numbers and count-and-write items.',
        'due_date': today + timedelta(days=3),
        'max_marks': 25,
        'teacher_name': 'Priya Sharma',
    },
    # Class 2
    {
        'class_name': '2',
        'section_name': 'A',
        'subject_name': 'Mathematics',
        'title': '2-Digit Addition with Regrouping Practice',
        'description': 'Solve problems 1 through 15 on page 42 of the textbook. Show your work clearly for carry-over addition.',
        'due_date': today + timedelta(days=2),
        'max_marks': 20,
        'teacher_name': 'Priya Sharma',
    },
    {
        'class_name': '2',
        'section_name': 'B',
        'subject_name': 'English',
        'title': 'Story Reading: The Clever Crow & Vocabulary',
        'description': 'Read the short story on page 31. Underline 5 new action verbs and write their definitions in sentences.',
        'due_date': today + timedelta(days=2),
        'max_marks': 20,
        'teacher_name': 'Anita Desai',
    },
    {
        'class_name': '2',
        'section_name': 'B',
        'subject_name': 'Science',
        'title': 'Parts of a Plant & Leaf Collection Project',
        'description': 'Collect 3 different fallen leaves from your garden. Paste them in your scrap-book and label stem, veins, and petiole.',
        'due_date': today + timedelta(days=4),
        'max_marks': 25,
        'teacher_name': 'Ramesh Kumar',
    },
    {
        'class_name': '2',
        'section_name': '',  # All sections
        'subject_name': 'Social Science',
        'title': 'Our Neighborhood Helpers & Community Care',
        'description': 'List 4 essential community helpers (doctor, firefighter, police, teacher) and write 2 lines about how they help us.',
        'due_date': today + timedelta(days=3),
        'max_marks': 20,
        'teacher_name': 'Suresh Patil',
    },
    # Class 3
    {
        'class_name': '3',
        'section_name': 'A',
        'subject_name': 'Science',
        'title': 'Water Cycle & States of Matter Summary',
        'description': 'Draw and label the water cycle diagram showing evaporation, condensation, and precipitation. Write 1 paragraph explaining the cycle.',
        'due_date': today + timedelta(days=2),
        'max_marks': 30,
        'teacher_name': 'Ramesh Kumar',
    },
    {
        'class_name': '3',
        'section_name': 'B',
        'subject_name': 'Mathematics',
        'title': 'Multiplication Tables (6 to 9) & Word Problems',
        'description': 'Complete worksheet exercises on multiplication word problems 1-10 on page 58.',
        'due_date': today + timedelta(days=3),
        'max_marks': 25,
        'teacher_name': 'Priya Sharma',
    },
    {
        'class_name': '3',
        'section_name': '',  # All sections
        'subject_name': 'English',
        'title': 'Descriptive Paragraph: My Favorite Season',
        'description': 'Write a 100-word descriptive paragraph about your favorite season using descriptive adjectives.',
        'due_date': today + timedelta(days=2),
        'max_marks': 20,
        'teacher_name': 'Anita Desai',
    },
    # Class 4
    {
        'class_name': '4',
        'section_name': 'A',
        'subject_name': 'Science',
        'title': 'Human Digestive System Diagram & Functions',
        'description': 'Draw the digestive system organs and write brief notes on stomach, small intestine, and liver roles.',
        'due_date': today + timedelta(days=3),
        'max_marks': 25,
        'teacher_name': 'Vijay Shekhar',
    },
    {
        'class_name': '4',
        'section_name': 'B',
        'subject_name': 'Computer Science',
        'title': 'Scratch Programming: Looping & Animation Basics',
        'description': 'Create an animated sprite sequence in Scratch using "repeat 10" block and submit the project link or description.',
        'due_date': today + timedelta(days=4),
        'max_marks': 20,
        'teacher_name': 'Arun Joshi',
    },
    # Class 5
    {
        'class_name': '5',
        'section_name': 'A',
        'subject_name': 'Maths',
        'title': 'Fractions: Addition & Subtraction with Unlike Denominators',
        'description': 'Solve exercises 5.2 on finding LCM and adding fractions on page 76.',
        'due_date': today + timedelta(days=2),
        'max_marks': 25,
        'teacher_name': 'Deepa Nair',
    },
    {
        'class_name': '5',
        'section_name': 'B',
        'subject_name': 'Science',
        'title': 'Renewable & Non-renewable Energy Sources',
        'description': 'Prepare a comparative chart distinguishing solar/wind energy from coal/petroleum fuels.',
        'due_date': today + timedelta(days=3),
        'max_marks': 20,
        'teacher_name': 'Vijay Shekhar',
    },
    # Class 6-10
    {
        'class_name': '6',
        'section_name': '',
        'subject_name': 'Science',
        'title': 'Components of Food & Balanced Diet Chart',
        'description': 'Complete nutrient deficiency diseases table on page 18.',
        'due_date': today + timedelta(days=3),
        'max_marks': 20,
        'teacher_name': 'Vijay Shekhar',
    },
    {
        'class_name': '10',
        'section_name': '',
        'subject_name': 'English',
        'title': 'Formal Letter Writing: Editorial Submission',
        'description': 'Draft a formal letter (150 words) to the editor on traffic congestion and public transport improvements.',
        'due_date': today + timedelta(days=3),
        'max_marks': 20,
        'teacher_name': 'Sunita Rao',
    },
]

created_count = 0
for hw_data in sample_homeworks:
    # Find matching teacher profile if exists
    fname = hw_data['teacher_name'].split()[0]
    t = Teacher.objects.filter(user__first_name__icontains=fname).first()

    # Find classroom
    cls_obj = Class.objects.filter(school=school, name__in=[hw_data['class_name'], f"Class {hw_data['class_name']}"]).first()
    sec_obj = None
    if cls_obj and hw_data['section_name']:
        sec_obj = Section.objects.filter(class_room=cls_obj, name__iexact=hw_data['section_name']).first()
    
    # Check if existing
    exists = Homework.objects.filter(
        school=school,
        class_name=hw_data['class_name'],
        section_name=hw_data['section_name'],
        title=hw_data['title'],
    ).exists()

    if not exists:
        Homework.objects.create(
            school=school,
            title=hw_data['title'],
            description=hw_data['description'],
            status='Active',
            class_name=hw_data['class_name'],
            section_name=hw_data['section_name'],
            subject_name=hw_data['subject_name'],
            class_room=cls_obj,
            section=sec_obj,
            due_date=hw_data['due_date'],
            max_marks=hw_data['max_marks'],
            teacher=t,
            teacher_name=hw_data['teacher_name'],
        )
        created_count += 1
        print(f"Created: Class {hw_data['class_name']} ({hw_data['section_name'] or 'All'}) - {hw_data['title']}")

print(f"\nDone! Created {created_count} new homework assignments.")
