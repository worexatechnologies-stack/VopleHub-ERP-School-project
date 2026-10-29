import logging

from celery import shared_task
from django.db.models import Q

from apps.common.tenancy import tenant_rls_context
from apps.sis.models import Student

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=5, default_retry_delay=30, ignore_result=True)
def sync_fee_structure_to_students(self, fee_structure_id, school_id):
    """Populate student fee records after a structure save, outside the web request."""
    try:
        from apps.finance.models import FeeStructure, StudentFeeRecord
        from apps.finance.views import get_student_fee_summary

        with tenant_rls_context(school_id):
            try:
                structure = FeeStructure.objects.select_related('target_class_ref').get(
                    pk=fee_structure_id,
                    school_id=school_id,
                )
            except FeeStructure.DoesNotExist:
                logger.info('Fee structure %s was deleted before assignment sync.', fee_structure_id)
                return

            students = Student.objects.filter(school_id=school_id)
            if structure.level == 'class':
                if structure.target_class_ref_id:
                    students = students.filter(
                        Q(section_record__class_room_id=structure.target_class_ref_id)
                        | Q(class_name__iexact=structure.target_class_ref.name)
                    )
                elif structure.target_class:
                    clean_class = structure.target_class
                    import re
                    clean_class = re.sub(r'(class|cls)', '', clean_class, flags=re.IGNORECASE).strip(' -_')
                    students = students.filter(
                        Q(class_name__iexact=structure.target_class)
                        | Q(class_name__iexact=f'Class {clean_class}')
                        | Q(class_name__iexact=clean_class)
                        | Q(class_name__icontains=clean_class)
                    )
            elif structure.level == 'section':
                if structure.target_section_ref_id:
                    students = students.filter(section_record_id=structure.target_section_ref_id)
                elif structure.target_section:
                    import re
                    clean_class = re.sub(r'(class|cls)', '', structure.target_class or '', flags=re.IGNORECASE).strip(' -_')
                    students = students.filter(section__iexact=structure.target_section)
                    if clean_class:
                        students = students.filter(class_name__iexact=clean_class)
            elif structure.level == 'student':
                if structure.target_student_ref_id:
                    students = students.filter(pk=structure.target_student_ref_id)
                elif structure.target_student_id:
                    students = students.filter(
                        Q(pk=structure.target_student_id)
                        if str(structure.target_student_id).isdigit()
                        else Q(admission_no=structure.target_student_id)
                    )

            students = students.select_related('section_record', 'section_record__class_room').order_by('pk')
            for student in students.iterator(chunk_size=500):
                fee_record, _ = StudentFeeRecord.objects.get_or_create(
                    school_id=school_id,
                    student=student,
                    defaults={
                        'student_id_str': str(student.id),
                        'student_name': student.name,
                        'admission_no': student.admission_no,
                        'class_name': student.class_name,
                        'section_name': student.section,
                        'academic_year': structure.academic_year or student.academic_year or '2026-2027',
                    },
                )
                summary = get_student_fee_summary(student)
                if summary:
                    Student.objects.filter(pk=student.pk).update(
                        fee_total=summary.get('totalFees', 0),
                        fee_paid=summary.get('totalPaid', 0),
                    )
        logger.info('Synced fee structure %s for school %s.', fee_structure_id, school_id)
    except Exception as exc:
        logger.exception('Fee structure assignment sync failed for structure %s.', fee_structure_id)
        raise self.retry(exc=exc, countdown=min(30 * (2 ** self.request.retries), 300))


def enqueue_fee_structure_sync(fee_structure_id, school_id):
    """Queue post-save student assignment after the fee structure commits."""
    from django.db import transaction

    def dispatch():
        try:
            sync_fee_structure_to_students.delay(fee_structure_id, school_id)
        except Exception:
            # Saving the structure is the critical operation. The structure is
            # still authoritative for fee summaries if the worker is offline.
            logger.exception(
                'Could not queue student assignment for fee structure %s; '
                'the structure is saved and student records can be resynced.',
                fee_structure_id,
            )

    transaction.on_commit(dispatch)
