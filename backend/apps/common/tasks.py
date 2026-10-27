import os
import csv
import logging
from django.utils import timezone
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory, force_authenticate
from config.celery import app
from .import_queue import decrypt_import_payload, set_import_status
from .models import ExportJob

logger = logging.getLogger(__name__)


@app.task(bind=True)
def export_resource_task(self, job_id):
    """
    Asynchronously streams up to 1,000,000 records from PostgreSQL to a local CSV file
    using QuerySet.iterator(chunk_size=2000) to keep memory footprint below 50MB.
    """
    try:
        job = ExportJob.objects.select_related('school').get(pk=job_id)
    except ExportJob.DoesNotExist:
        logger.error("ExportJob %s does not exist", job_id)
        return

    job.status = ExportJob.Status.PROCESSING
    job.save(update_fields=['status'])

    school = job.school
    filters = job.filters or {}
    export_dir = os.path.join(settings.MEDIA_ROOT, 'exports', str(school.id))
    os.makedirs(export_dir, exist_ok=True)
    filename = f"{job.resource_type}_{job.id}.csv"
    filepath = os.path.join(export_dir, filename)

    try:
        qs = None
        headers = []
        row_extractor = None

        if job.resource_type == ExportJob.ResourceType.STUDENTS:
            from apps.sis.models import Student
            qs = Student.objects.filter(school=school).order_by('id')
            if filters.get('class_name'):
                qs = qs.filter(class_name=filters['class_name'])
            if filters.get('section'):
                qs = qs.filter(section=filters['section'])
            if filters.get('academic_year'):
                qs = qs.filter(academic_year=filters['academic_year'])
            headers = [
                'ID', 'Admission No', 'Name', 'Class', 'Section', 'Roll No',
                'Parent Name', 'Parent Phone', 'Parent Email', 'DOB', 'Gender',
                'Status', 'Academic Year', 'Fee Total', 'Fee Paid',
            ]
            def extract_student(s):
                return [
                    s.id, s.admission_no, s.name, s.class_name, s.section, s.roll_no,
                    s.parent_name, s.parent_phone, s.parent_email, s.dob, s.gender,
                    s.status, s.academic_year, s.fee_total or 0, s.fee_paid or 0,
                ]
            row_extractor = extract_student

        elif job.resource_type == ExportJob.ResourceType.ATTENDANCE:
            from apps.attendance.models import AttendanceRecord
            qs = AttendanceRecord.objects.filter(school=school).select_related('student', 'subject', 'marked_by').order_by('-date', 'id')
            if filters.get('date'):
                qs = qs.filter(date=filters['date'])
            if filters.get('start_date') and filters.get('end_date'):
                qs = qs.filter(date__range=[filters['start_date'], filters['end_date']])
            headers = ['ID', 'Student Name', 'Admission No', 'Date', 'Day', 'Period', 'Subject', 'Status', 'Marked By']
            def extract_attendance(a):
                return [
                    a.id,
                    getattr(a.student, 'name', '') if a.student else '',
                    getattr(a.student, 'admission_no', '') if a.student else '',
                    a.date,
                    a.day_of_week or '',
                    a.period,
                    getattr(a.subject, 'name', '') if a.subject else '',
                    a.status,
                    a.marked_by.get_full_name() if a.marked_by else '',
                ]
            row_extractor = extract_attendance

        elif job.resource_type == ExportJob.ResourceType.FEE_RECORDS:
            from apps.finance.models import StudentFeeRecord
            qs = StudentFeeRecord.objects.filter(school=school).order_by('id')
            if filters.get('class_name'):
                qs = qs.filter(class_name=filters['class_name'])
            headers = ['ID', 'Student Name', 'Admission No', 'Class', 'Section', 'Academic Year', 'Scholarship', 'Discount', 'Fine', 'Transport', 'Hostel']
            def extract_fee(f):
                return [
                    f.id, f.student_name, f.admission_no, f.class_name, f.section_name,
                    f.academic_year, f.scholarship or 0, f.discount or 0, f.fine_amount or 0,
                    f.transport_charges or 0, f.hostel_charges or 0,
                ]
            row_extractor = extract_fee

        elif job.resource_type == ExportJob.ResourceType.FEE_PAYMENTS:
            from apps.finance.models import FeePayment
            qs = FeePayment.objects.filter(school=school).select_related('student').order_by('-payment_date', '-id')
            headers = ['ID', 'Receipt No', 'Transaction ID', 'Student Name', 'Admission No', 'Amount Paid', 'Payment Date', 'Payment Method', 'Category']
            def extract_payment(p):
                return [
                    p.id, p.receipt_no, p.transaction_id,
                    getattr(p.student, 'name', '') if p.student else '',
                    getattr(p.student, 'admission_no', '') if p.student else '',
                    p.amount_paid, p.payment_date, p.payment_method, p.category,
                ]
            row_extractor = extract_payment

        elif job.resource_type == ExportJob.ResourceType.EXAM_RESULTS:
            from apps.exams.models import ExamResult
            qs = ExamResult.objects.filter(school=school).select_related('exam', 'student').order_by('id')
            headers = ['ID', 'Exam Name', 'Subject', 'Student Name', 'Admission No', 'Marks Obtained', 'Status']
            def extract_exam(r):
                return [
                    r.id,
                    getattr(r.exam, 'name', '') if r.exam else '',
                    getattr(r.exam, 'subject', '') if r.exam else '',
                    getattr(r.student, 'name', '') if r.student else '',
                    getattr(r.student, 'admission_no', '') if r.student else '',
                    r.marks_obtained if r.marks_obtained is not None else '',
                    r.status,
                ]
            row_extractor = extract_exam

        else:
            raise ValueError(f"Unknown resource_type: {job.resource_type}")

        total_count = qs.count()
        job.total_records = total_count
        job.save(update_fields=['total_records'])

        # Stream directly to CSV using iterator (chunk_size=2000)
        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(headers)

            processed = 0
            for item in qs.iterator(chunk_size=2000):
                writer.writerow(row_extractor(item))
                processed += 1
                if processed % 10000 == 0:
                    job.processed_records = processed
                    job.save(update_fields=['processed_records'])

        job.status = ExportJob.Status.COMPLETED
        job.processed_records = processed
        job.file_path = filepath
        job.file_size = os.path.getsize(filepath)
        job.completed_at = timezone.now()
        job.save(update_fields=['status', 'processed_records', 'file_path', 'file_size', 'completed_at'])

    except Exception:
        logger.exception("ExportJob %s failed", job_id)
        job.status = ExportJob.Status.FAILED
        job.error_message = 'Export failed. Please try again or contact support.'
        job.save(update_fields=['status', 'error_message'])


@app.task(
    ignore_result=True,
    acks_late=True,
    reject_on_worker_lost=True,
    name='apps.common.tasks.process_import_batch',
)
def process_import_batch(*, entity, school_id, user_id, job_id, batch_number, encrypted_payload):
    """Run a validated student or teacher bulk-import batch in a worker."""
    key_args = {
        'entity': entity,
        'school_id': school_id,
        'user_id': user_id,
        'job_id': job_id,
        'batch_number': batch_number,
    }
    set_import_status(**key_args, status='processing')

    try:
        User = get_user_model()
        user = User.objects.get(pk=user_id, school_id=school_id)
        payload = decrypt_import_payload(encrypted_payload)

        # Re-enter the existing DRF action to keep validation, transactions,
        # idempotency, and cache invalidation in one implementation.
        from apps.sis.views import StudentViewSet
        from apps.staff.views import TeacherViewSet

        if entity not in {'students', 'teachers'}:
            raise ValueError('Unknown import entity')
        viewset = StudentViewSet if entity == 'students' else TeacherViewSet
        request = APIRequestFactory().post(
            f'/api/v1/{entity}/bulk-import/', payload, format='json'
        )
        force_authenticate(request, user=user)
        response = viewset.as_view({'post': 'bulk_import'})(request)
        result = getattr(response, 'data', {})
        final_status = 'failed' if response.status_code >= 400 else 'completed'
        set_import_status(**key_args, status=final_status, result=result)
    except Exception:
        logger.exception('Asynchronous %s import batch failed (job %s, batch %s)', entity, job_id, batch_number)
        set_import_status(
            **key_args,
            status='failed',
            result={
                'success': False,
                'errorCategory': 'IMPORT_PROCESSING_ERROR',
                'detail': 'The import batch could not be completed. Retry the batch or contact support.',
            },
        )
