"""Pre-scoped chatbot context and provider boundary.

No function in this module exposes ORM/query tools to a provider. Providers receive only
the snapshot constructed below and are intentionally mocked until a provider is approved.
"""
from apps.attendance.models import AttendanceRecord
from apps.exams.models import ExamResult

SYSTEM_PROMPT = '''You are a parent academic assistant. Discuss only the one student in the
provided snapshot. State marks, grades, attendance, and other factual numbers only when they
appear in the snapshot. If data is absent, say it is not recorded. General study advice is
allowed only when clearly described as general advice, never as a fact about the student.
Never discuss another student, disciplinary, medical, mental-health, or family matters.'''


def student_snapshot(student):
    records = AttendanceRecord.objects.filter(student=student)
    total = records.count()
    present = records.filter(status=AttendanceRecord.Status.PRESENT).count()
    attendance = str(student.attendance_percentage) if student.attendance_percentage is not None else (round((present / total) * 100, 2) if total else None)
    results = ExamResult.objects.filter(student=student, status=ExamResult.Status.SUBMITTED).select_related('exam').order_by('-submitted_at')[:20]
    return {
        'student': {'id': student.id, 'name': student.name, 'class': student.class_name, 'section': student.section},
        'attendance_percentage': attendance,
        'exam_results': [
            {'exam': item.exam.name, 'subject': item.exam.subject, 'marks_obtained': str(item.marks_obtained) if item.marks_obtained is not None else None,
             'max_marks': item.exam.max_marks, 'remarks': item.remarks, 'submitted_at': item.submitted_at.isoformat() if item.submitted_at else None}
            for item in results
        ],
    }


def answer_question(*, snapshot, message):
    """Approved provider seam. This safe local fallback is used until provider approval."""
    return ('AI provider integration is not enabled yet. Your school can provide the verified '
            'academic records shown in this portal. General advice: encourage a regular study routine and discuss questions with the subject teacher.'), 0
