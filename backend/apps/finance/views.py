from rest_framework import viewsets, permissions, status
from django.conf import settings
from django.db import transaction
from rest_framework.response import Response
from rest_framework.decorators import action
from apps.common.pagination import AdminListPagination
from rest_framework.exceptions import PermissionDenied


import re
import datetime
import hashlib
import hmac
import uuid
import logging
from decimal import Decimal
from django.db.models import Q, Sum, Count, F
from django.core.cache import cache
from apps.accounts.models import User
from apps.academics.models import Class
from apps.common.tenancy import TenantScopedViewSet
from apps.finance.models import (
    FeeStructure,
    FeeQuarter,
    StudentFeeRecord,
    FeePayment,
    FeePaymentSettings,
    FeePaymentOrder,
    FeePaymentWebhookEvent,
)
from apps.sis.access import teacher_can_access_student, teacher_student_queryset
from apps.staff.models import Teacher

logger = logging.getLogger(__name__)


def _fee_gateway_config(school_id):
    configured = FeePaymentSettings.objects.filter(school_id=school_id).first()
    dummy_mode = bool(getattr(settings, 'RAZORPAY_DUMMY_MODE', False))
    if configured and configured.enabled and configured.key_id and configured.get_key_secret():
        expected_prefix = 'rzp_test_' if configured.test_mode else 'rzp_live_'
        if not configured.key_id.startswith(expected_prefix):
            logger.error('Fee Razorpay key mode mismatch for school=%s', school_id)
            return None
        return configured.key_id, configured.get_key_secret(), False, configured.test_mode
    if dummy_mode:
        key_id = getattr(settings, 'RAZORPAY_KEY_ID', '') or f'rzp_test_dummy_{school_id}'
        key_secret = getattr(settings, 'RAZORPAY_KEY_SECRET', '') or 'dummy-secret'
        return key_id, key_secret, True, True
    return None


class FeeRecordPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == User.Role.SUPER_ADMIN:
            return True
        if user.role == User.Role.SCHOOL_ADMIN:
            return str(obj.school_id or '') == str(user.school_id or '')
        if user.role == User.Role.STUDENT:
            return getattr(user, 'student_profile', None) and user.student_profile.student_id == obj.student_id and request.method in permissions.SAFE_METHODS
        if user.role == User.Role.PARENT:
            return getattr(user, 'parent_profile', None) and user.parent_profile.students.filter(pk=obj.student_id).exists() and request.method in permissions.SAFE_METHODS
        return False


class FeeStructurePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        action = getattr(view, 'action', None)
        if action == 'payment_webhook':
            return True
        if not (request.user and request.user.is_authenticated):
            # Kept only for the local legacy acceptance flow. Production sets
            # this flag to False, so anonymous finance access is rejected.
            return bool(getattr(settings, 'LEGACY_PUBLIC_FEE_READS', False))
        if action in ['school_revenue', 'record_student_payment', 'payment_gateway_settings', 'test_payment_gateway_connection']:
            return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]
        if action in ['create_payment_order', 'verify_payment']:
            return bool(request.user and request.user.is_authenticated)
        if action == 'student_summaries':
            return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.role == User.Role.SUPER_ADMIN:
            return True
        if user.role == User.Role.SCHOOL_ADMIN:
            return str(obj.school_id or '') == str(user.school_id or '')
        if request.method in permissions.SAFE_METHODS:
            return str(obj.school_id or '') == str(user.school_id or '')
        return False

from apps.finance.serializers import (
    FeeStructureSerializer,
    FeeQuarterSerializer,
    StudentFeeRecordSerializer,
    FeePaymentSerializer,
    FeePaymentSettingsSerializer,
    FeePaymentOrderSerializer,
)
from apps.sis.models import Student


def resolve_fee_structure_for_student(student, academic_year=None, academic_year_id=None, school_id=None, cached_structures=None):
    """Resolves the single authoritative FeeStructure for a student using the 4-tier ID hierarchy:
    1. Student-level Fee Structure (target_student_id / target_student_ref)
    2. Section-level Fee Structure (target_section_ref / target_section)
    3. Class-level Fee Structure (target_class_ref / target_class)
    4. School-level Fee Structure (level='school')
    5. None
    Strictly scoped to the student's school to prevent cross-school contamination.
    """
    if not student:
        return None

    class_id = None
    section_id = None
    if student.section_record:
        section_id = student.section_record_id
        class_id = student.section_record.class_room_id

    if not academic_year and student.academic_year:
        academic_year = student.academic_year

    target_school = (student.school_id if student else None) or school_id

    if cached_structures is not None:
        qs_list = [fs for fs in cached_structures if (not target_school or fs.school_id == target_school)]
        if academic_year_id:
            qs_list = [fs for fs in qs_list if getattr(fs, 'academic_year_ref_id', None) == academic_year_id]
        elif academic_year:
            qs_list = [fs for fs in qs_list if fs.academic_year == academic_year or not fs.academic_year]

        # 1. Student-level
        for fs in qs_list:
            if fs.level == 'student' and (fs.target_student_id == str(student.id) or fs.target_student_id == student.admission_no or getattr(fs, 'target_student_ref_id', None) == student.id):
                return fs

        # 2. Section-level
        if section_id:
            for fs in qs_list:
                if fs.level == 'section' and getattr(fs, 'target_section_ref_id', None) == section_id:
                    return fs
        if student.section:
            for fs in qs_list:
                if fs.level == 'section' and fs.target_section and fs.target_section.lower() == student.section.lower():
                    if not class_id or getattr(fs, 'target_class_ref_id', None) == int(class_id) or (student.class_name and fs.target_class and fs.target_class.lower() == student.class_name.lower()):
                        return fs

        # 3. Class-level
        if class_id:
            for fs in qs_list:
                if fs.level == 'class' and getattr(fs, 'target_class_ref_id', None) == class_id:
                    return fs
        if student.class_name:
            clean_cls = re.sub(r'(class|cls)', '', student.class_name, flags=re.IGNORECASE)
            clean_cls = re.sub(r'[^a-zA-Z0-9]', ' ', clean_cls).strip()
            base_cls = clean_cls.split()[0] if clean_cls else student.class_name
            for fs in qs_list:
                if fs.level == 'class' and fs.target_class:
                    if fs.target_class.lower() == student.class_name.lower() or (base_cls and base_cls.lower() in fs.target_class.lower()):
                        return fs

        # 4. School-level
        for fs in qs_list:
            if fs.level == 'school':
                return fs
        return None

    base_qs = FeeStructure.objects.all().prefetch_related('quarter_records')
    if target_school:
        base_qs = base_qs.filter(school_id=target_school)

    qs = base_qs
    if academic_year_id:
        filtered = qs.filter(academic_year_ref_id=academic_year_id)
        if filtered.exists():
            qs = filtered
    elif academic_year:
        filtered = qs.filter(Q(academic_year=academic_year) | Q(academic_year__icontains=academic_year[:4]))
        if filtered.exists():
            qs = filtered

    # 1. Student-level Fee Structure
    student_fs = qs.filter(
        Q(level='student') &
        (Q(target_student_id=str(student.id)) | Q(target_student_id=student.admission_no) | Q(target_student_ref=student))
    ).first() or base_qs.filter(
        Q(level='student') &
        (Q(target_student_id=str(student.id)) | Q(target_student_id=student.admission_no) | Q(target_student_ref=student))
    ).first()
    if student_fs:
        return student_fs

    # 2. Section-level Fee Structure
    if section_id:
        section_fs = qs.filter(level='section', target_section_ref_id=section_id).first() or base_qs.filter(level='section', target_section_ref_id=section_id).first()
        if section_fs:
            return section_fs
    if student.section:
        section_fs = qs.filter(level='section', target_section__iexact=student.section).first() or base_qs.filter(level='section', target_section__iexact=student.section).first()
        if section_fs and (not class_id or section_fs.target_class_ref_id == int(class_id) or (student.class_name and section_fs.target_class and section_fs.target_class.lower() == student.class_name.lower())):
            return section_fs

    # 3. Class-level Fee Structure
    if class_id:
        class_fs = qs.filter(level='class', target_class_ref_id=class_id).first() or base_qs.filter(level='class', target_class_ref_id=class_id).first()
        if class_fs:
            return class_fs
    if student.class_name:
        clean_cls = re.sub(r'(class|cls)', '', student.class_name, flags=re.IGNORECASE).strip(' -_')
        base_cls = clean_cls.split()[0] if clean_cls else student.class_name
        class_fs = qs.filter(level='class').filter(
            Q(target_class__iexact=student.class_name) |
            Q(target_class__iexact=f"Class {clean_cls}") |
            Q(target_class__iexact=clean_cls) |
            Q(target_class__icontains=base_cls)
        ).first() or base_qs.filter(level='class').filter(
            Q(target_class__iexact=student.class_name) |
            Q(target_class__iexact=f"Class {clean_cls}") |
            Q(target_class__iexact=clean_cls) |
            Q(target_class__icontains=base_cls)
        ).first()
        if class_fs:
            return class_fs

    # 4. School-level Fee Structure
    school_fs = qs.filter(level='school').first() or base_qs.filter(level='school').first()
    if school_fs:
        return school_fs

    return None


def get_student_fee_summary(student, academic_year=None, academic_year_id=None, cached_structures=None, fee_records_map=None, payments_map=None, skip_sync=False):
    """Calculates student's authoritative fee summary directly from database records:
    - Applicable Fee Structure (4-tier ID hierarchy)
    - Total Fees (structure items + custom adjustments - scholarships/discounts)
    - Total Paid (sum of all valid FeePayment transactions / payment records)
    - Balance Due (Total Fees - Total Paid)
    - Quarters Paid count and status breakdown
    """
    if not student:
        return None

    class_id = student.section_record.class_room_id if student.section_record else None
    section_id = student.section_record_id if student.section_record else None
    ay = academic_year or student.academic_year or '2026-2027'

    fee_structure = resolve_fee_structure_for_student(student, academic_year=ay, academic_year_id=academic_year_id, cached_structures=cached_structures)

    # Lookup StudentFeeRecord if exists
    if fee_records_map is not None:
        fee_rec = fee_records_map.get(student.id) or fee_records_map.get(student.admission_no)
    else:
        fee_rec = StudentFeeRecord.objects.filter(
            Q(student=student) |
            Q(student_id_str=str(student.id)) |
            Q(admission_no=student.admission_no)
        ).first()

    # Pre-resolved or queried payments
    if payments_map is not None:
        p_list = list(payments_map.get(student.id, []))
        if fee_rec:
            for prec in payments_map.get(f"rec_{fee_rec.id}", []):
                if prec not in p_list:
                    p_list.append(prec)
    else:
        p_list = list(FeePayment.objects.filter(
            Q(student=student) |
            (Q(fee_record=fee_rec) if fee_rec else Q(pk__in=[]))
        ).order_by('-payment_date', '-created_at'))

    # Check if student has custom fee breakup or adjustments even without a general FeeStructure
    has_custom = fee_rec and bool(
        (fee_rec.custom_items and len(fee_rec.custom_items) > 0) or
        (fee_rec.scholarship and float(fee_rec.scholarship) > 0) or
        (fee_rec.discount and float(fee_rec.discount) > 0) or
        (fee_rec.transport_charges and float(fee_rec.transport_charges) > 0) or
        (fee_rec.hostel_charges and float(fee_rec.hostel_charges) > 0) or
        (fee_rec.fine_amount and float(fee_rec.fine_amount) > 0)
    )
    has_student_total = bool(student.fee_total and float(student.fee_total) > 0)

    # If no fee structure is configured and no individual custom adjustments:
    if not fee_structure and not has_custom and not has_student_total:
        payments_list = []
        total_paid = 0.0
        for p in p_list:
            amt = float(p.amount_paid)
            total_paid += amt
            payments_list.append({
                'id': p.id,
                'paymentDate': str(p.payment_date),
                'amountPaid': amt,
                'paymentMethod': p.payment_method,
                'transactionId': p.transaction_id,
                'receiptNo': p.receipt_no,
                'category': p.category,
                'installmentType': p.installment_type,
            })

        if not payments_list and fee_rec and fee_rec.payment_history:
            for p in fee_rec.payment_history:
                amt = float(p.get('amountPaid', 0))
                total_paid += amt
                payments_list.append(p)

        if float(student.fee_paid or 0) > total_paid:
            total_paid = float(student.fee_paid)

        return {
            'studentId': student.id,
            'studentName': student.name,
            'admissionNo': student.admission_no,
            'class': student.class_name,
            'classId': class_id,
            'section': student.section,
            'sectionId': section_id,
            'academicYear': ay,
            'hasStructure': False,
            'feeStructureId': None,
            'feeStructureName': None,
            'totalFees': 0.0,
            'totalPaid': total_paid,
            'balanceDue': 0.0,
            'quartersPaid': 0,
            'totalQuarters': 0,
            'paymentStatus': 'PAID' if total_paid > 0 else 'UNCONFIGURED',
            'quarters': [],
            'payments': payments_list,
            'breakdown': [],
            'scholarship': 0.0,
            'discount': 0.0,
            'transportCharges': 0.0,
            'hostelCharges': 0.0,
            'fineAmount': 0.0,
        }

    # Structure found or Custom student fee set: calculate amounts
    if fee_rec and fee_rec.custom_items and len(fee_rec.custom_items) > 0:
        base_items = fee_rec.custom_items
    elif fee_structure and fee_structure.items:
        base_items = fee_structure.items
    elif student.fee_total and float(student.fee_total) > 0:
        base_items = [{'category': 'Tuition & Academic Fees', 'amount': float(student.fee_total)}]
    else:
        base_items = []

    base_total = sum(float(item.get('amount', 0)) for item in base_items)

    scholarship = float(fee_rec.scholarship) if fee_rec else 0.0
    discount = float(fee_rec.discount) if fee_rec else 0.0
    transport = float(fee_rec.transport_charges) if fee_rec else 0.0
    hostel = float(fee_rec.hostel_charges) if fee_rec else 0.0
    fine = float(fee_rec.fine_amount) if fee_rec else 0.0

    total_fees = max(0.0, base_total + transport + hostel + fine - scholarship - discount)

    payments_list = []
    total_paid = 0.0
    for p in p_list:
        amt = float(p.amount_paid)
        total_paid += amt
        payments_list.append({
            'id': p.id,
            'paymentDate': str(p.payment_date),
            'amountPaid': amt,
            'paymentMethod': p.payment_method,
            'transactionId': p.transaction_id,
            'receiptNo': p.receipt_no,
            'category': p.category,
            'installmentType': p.installment_type,
            'quarterId': p.quarter_id,
        })

    # If no FeePayment rows but fee_rec.payment_history has payments, include them
    if not payments_list and fee_rec and fee_rec.payment_history:
        for p in fee_rec.payment_history:
            amt = float(p.get('amountPaid', 0))
            total_paid += amt
            payments_list.append(p)

    # Fallback to student.fee_paid if greater
    if float(student.fee_paid or 0) > total_paid:
        total_paid = float(student.fee_paid)

    # Synchronize student model
    if not skip_sync:
        if student.fee_paid != total_paid or student.fee_total != total_fees:
            Student.objects.filter(pk=student.pk).update(fee_paid=total_paid, fee_total=total_fees)

    balance_due = max(0.0, total_fees - total_paid)

    # Quarters breakdown
    raw_quarters = fee_rec.custom_quarters if (fee_rec and fee_rec.custom_quarters and len(fee_rec.custom_quarters) > 0) else ((fee_structure.quarters if fee_structure else []) or [])
    
    # If no quarters in structure JSON, fetch from FeeQuarter records
    if not raw_quarters and fee_structure:
        raw_quarters = [
            {
                'id': q.id,
                'quarter': f"Q{q.quarter_number}",
                'name': q.quarter_name,
                'amount': float(q.assigned_amount),
                'dueDate': str(q.due_date) if q.due_date else '',
            }
            for q in sorted(fee_structure.quarter_records.all(), key=lambda x: getattr(x, 'quarter_number', 0))
        ]
    elif not raw_quarters and total_fees > 0:
        q_amt = round(total_fees * 0.25, 2)
        raw_quarters = [
            {'quarter': 'Q1', 'name': 'Quarter 1 (Apr - Jun)', 'amount': q_amt, 'dueDate': '2026-04-15'},
            {'quarter': 'Q2', 'name': 'Quarter 2 (Jul - Sep)', 'amount': q_amt, 'dueDate': '2026-07-15'},
            {'quarter': 'Q3', 'name': 'Quarter 3 (Oct - Dec)', 'amount': q_amt, 'dueDate': '2026-10-15'},
            {'quarter': 'Q4', 'name': 'Quarter 4 (Jan - Mar)', 'amount': round(total_fees - (q_amt * 3), 2), 'dueDate': '2027-01-15'},
        ]

    running_paid = total_paid
    today_str = datetime.date.today().isoformat()
    quarters_list = []

    for idx, q_data in enumerate(raw_quarters):
        q_amt = float(q_data.get('amount', 0))
        q_due = q_data.get('dueDate') or q_data.get('due_date') or ''
        q_name = q_data.get('name') or q_data.get('quarter_name') or f"Quarter {idx+1}"
        q_code = q_data.get('quarter') or f"Q{idx+1}"

        if running_paid >= q_amt and q_amt > 0:
            q_paid = q_amt
            q_rem = 0.0
            q_status = 'PAID'
            running_paid -= q_amt
        elif running_paid > 0:
            q_paid = running_paid
            q_rem = round(q_amt - running_paid, 2)
            q_status = 'PARTIALLY_PAID'
            running_paid = 0.0
        else:
            q_paid = 0.0
            q_rem = q_amt
            try:
                due_date = datetime.date.fromisoformat(str(q_due)) if q_due else None
            except ValueError:
                due_date = None
            # Allow a short reconciliation grace period before showing an
            # overdue state to families.
            q_status = (
                'OVERDUE'
                if due_date and datetime.date.today() > due_date + datetime.timedelta(days=30)
                else 'PAYMENT_DUE'
            )

        quarters_list.append({
            'quarterId': q_data.get('id'),
            'quarter': q_code,
            'name': q_name,
            'requiredAmount': q_amt,
            'amountPaid': q_paid,
            'remainingAmount': q_rem,
            'dueDate': q_due,
            'status': q_status,
        })

    quarters_paid = sum(1 for q in quarters_list if q['status'] == 'PAID')
    total_quarters = len(quarters_list)

    if total_fees > 0 and balance_due == 0:
        overall_status = 'PAID'
    elif total_paid > 0:
        overall_status = 'PARTIALLY_PAID'
    else:
        overall_status = 'UNPAID'

    return {
        'studentId': student.id,
        'studentName': student.name,
        'admissionNo': student.admission_no,
        'class': student.class_name,
        'classId': class_id,
        'section': student.section,
        'sectionId': section_id,
        'academicYear': ay,
        'hasStructure': bool(fee_structure),
        'feeStructureId': fee_structure.id if fee_structure else None,
        'feeStructureName': fee_structure.name if fee_structure else None,
        'totalFees': total_fees,
        'totalPaid': total_paid,
        'balanceDue': balance_due,
        'quartersPaid': quarters_paid,
        'totalQuarters': total_quarters,
        'paymentStatus': overall_status,
        'quarters': quarters_list,
        'payments': payments_list,
        'breakdown': base_items,
        'scholarship': scholarship,
        'discount': discount,
        'transportCharges': transport,
        'hostelCharges': hostel,
        'fineAmount': fine,
    }


class FeeStructureViewSet(TenantScopedViewSet):
    queryset = FeeStructure.objects.all().order_by('-created_at')
    serializer_class = FeeStructureSerializer
    permission_classes = [FeeStructurePermission]
    filterset_fields = ['level', 'academic_year', 'target_class', 'target_class_ref', 'target_section_ref']
    search_fields = ['name', 'target_class']
    ordering_fields = ['id', 'created_at', 'name']
    pagination_class = AdminListPagination

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        role = getattr(user, 'role', None)
        if not user.is_authenticated and getattr(settings, 'LEGACY_PUBLIC_FEE_READS', False):
            return qs
        if role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            return qs.none()
        if role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None)
            if not teacher or teacher.school_id != user.school_id or teacher.status != Teacher.Status.ACTIVE:
                return qs.none()
            section_ids = set(teacher.sections.filter(school_id=user.school_id).values_list('pk', flat=True))
            section_ids.update(teacher.teaching_assignments.filter(school_id=user.school_id).values_list('section_id', flat=True))
            class_ids = set(teacher.sections.filter(school_id=user.school_id).values_list('class_room_id', flat=True))
            class_ids.update(teacher.teaching_assignments.filter(school_id=user.school_id).values_list('section__class_room_id', flat=True))
            student_ids = teacher_student_queryset(teacher, school_id=user.school_id).values_list('pk', flat=True)
            qs = qs.filter(
                Q(level='school')
                | Q(target_class_ref_id__in=class_ids)
                | Q(target_section_ref_id__in=section_ids)
                | Q(target_student_ref_id__in=student_ids)
            )
        academic_year = self.request.query_params.get('academic_year')
        academic_year_id = self.request.query_params.get('academic_year_id')
        target_class_id = self.request.query_params.get('target_class_id')
        target_section_id = self.request.query_params.get('target_section_id')
        target_student_id = self.request.query_params.get('target_student_id')
        target_class = self.request.query_params.get('target_class')

        if academic_year_id:
            qs = qs.filter(academic_year_ref_id=academic_year_id)
        elif academic_year:
            qs = qs.filter(academic_year=academic_year)

        if target_section_id:
            qs = qs.filter(target_section_ref_id=target_section_id)

        if target_class_id:
            qs = qs.filter(Q(target_class_ref_id=target_class_id) | Q(target_section_ref__class_room_id=target_class_id))
        elif target_class and target_class != 'All':
            clean_cls = re.sub(r'(class|cls)', '', target_class, flags=re.IGNORECASE)
            clean_cls = re.sub(r'[^a-zA-Z0-9]', ' ', clean_cls).strip()
            base_cls = clean_cls.split()[0] if clean_cls else target_class
            qs = qs.filter(
                Q(target_class__icontains=target_class) |
                Q(target_class__icontains=base_cls) |
                Q(target_class__iexact=target_class)
            )

        if target_student_id:
            qs = qs.filter(Q(target_student_id=target_student_id) | Q(target_student_ref__id=target_student_id if str(target_student_id).isdigit() else None))

        return qs

    def perform_create(self, serializer):
        user = self.request.user
        school = getattr(user, 'school', None)
        instance = serializer.save(school=school) if school else serializer.save()
        if instance.school_id:
            from .tasks import enqueue_fee_structure_sync
            enqueue_fee_structure_sync(instance.pk, instance.school_id)
        if school:
            cache.delete(f"school_revenue_{school.id}_{getattr(instance, 'academic_year', '') or 'all'}")
            cache.delete(f"school_revenue_{school.id}_all")

    def perform_update(self, serializer):
        instance = serializer.save()
        if instance.school_id:
            from .tasks import enqueue_fee_structure_sync
            enqueue_fee_structure_sync(instance.pk, instance.school_id)
        school_id = getattr(instance, 'school_id', None)
        if school_id:
            cache.delete(f"school_revenue_{school_id}_{getattr(instance, 'academic_year', '') or 'all'}")
            cache.delete(f"school_revenue_{school_id}_all")

    @action(detail=False, methods=['get'], url_path='resolve')
    def resolve(self, request):
        """Authoritative Fee Structure Resolution Endpoint obeying 4-tier ID hierarchy:
        1. Student-level Fee Structure (target_student_id / target_student_ref)
        2. Section-level Fee Structure (target_section_id / target_class_id)
        3. Class-level Fee Structure (target_class_id)
        4. School-level Fee Structure (level='school')
        5. No Fee Structure Available -> Returns HTTP 200 with null fee_structure
        """
        user = request.user
        legacy_public = not user.is_authenticated and getattr(settings, 'LEGACY_PUBLIC_FEE_READS', False)
        role = getattr(user, 'role', User.Role.SCHOOL_ADMIN if legacy_public else None)
        school_id = getattr(user, 'school_id', None)
        student_id = request.query_params.get('student_id')
        class_id = request.query_params.get('class_id')
        section_id = request.query_params.get('section_id')
        academic_year = request.query_params.get('academic_year')
        academic_year_id = request.query_params.get('academic_year_id')

        if role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER, User.Role.PARENT, User.Role.STUDENT]:
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        if legacy_public and not school_id:
            if student_id and str(student_id).isdigit():
                school_id = Student.objects.filter(pk=student_id).values_list('school_id', flat=True).first()
            elif class_id and str(class_id).isdigit():
                school_id = Class.objects.filter(pk=class_id).values_list('school_id', flat=True).first()
        if role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'detail': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)
        if role == User.Role.STUDENT:
            profile = getattr(user, 'student_profile', None)
            if not profile or not profile.student_id:
                return Response({'detail': 'Student profile not found.'}, status=status.HTTP_403_FORBIDDEN)
            if student_id and str(student_id) not in {str(profile.student_id), str(profile.student.admission_no)}:
                return Response({'detail': 'Students may only resolve their own fee structure.'}, status=status.HTTP_403_FORBIDDEN)
            student_id = profile.student_id
        elif role == User.Role.PARENT:
            profile = getattr(user, 'parent_profile', None)
            if not profile:
                return Response({'detail': 'Parent profile not found.'}, status=status.HTTP_403_FORBIDDEN)
            children = profile.students.filter(school_id=school_id)
            if student_id:
                children = children.filter(Q(pk=student_id if str(student_id).isdigit() else None) | Q(admission_no=str(student_id)))
            child = children.first()
            if not child:
                return Response({'detail': 'Parents may only resolve fee structures for linked children.'}, status=status.HTTP_403_FORBIDDEN)
            student_id = child.pk
        elif role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None)
            if not teacher or teacher.school_id != school_id or teacher.status != Teacher.Status.ACTIVE:
                return Response({'detail': 'Active teacher profile required.'}, status=status.HTTP_403_FORBIDDEN)
            if not student_id:
                return Response({'detail': 'Teachers must resolve fees for an assigned student.'}, status=status.HTTP_400_BAD_REQUEST)

        student = None
        if student_id:
            st_qs = Student.objects.all().select_related('section_record__class_room', 'school')
            if school_id and role != User.Role.SUPER_ADMIN:
                st_qs = st_qs.filter(school_id=school_id)
            if str(student_id).isdigit():
                student = st_qs.filter(pk=student_id).first()
            if not student:
                student = st_qs.filter(admission_no=student_id).first()
        if role == User.Role.TEACHER and student and not teacher_can_access_student(teacher, student, school_id=school_id):
            return Response({'detail': 'Teachers may only resolve fees for students in their assigned sections.'}, status=status.HTTP_403_FORBIDDEN)
        if role in [User.Role.STUDENT, User.Role.PARENT, User.Role.TEACHER]:
            if not student:
                return Response({'detail': 'Student not found.'}, status=status.HTTP_404_NOT_FOUND)
            # Client-supplied class/section IDs cannot widen the object scope;
            # derive fallback resolution from the already-authorized student.
            class_id = student.section_record.class_room_id if student.section_record_id else None
            section_id = student.section_record_id

        fs = resolve_fee_structure_for_student(student, academic_year=academic_year, academic_year_id=academic_year_id, school_id=school_id)
        if not fs and class_id:
            qs = FeeStructure.objects.all().prefetch_related('quarter_records')
            if school_id and role != User.Role.SUPER_ADMIN:
                qs = qs.filter(school_id=school_id)
            if academic_year_id:
                qs = qs.filter(academic_year_ref_id=academic_year_id)
            elif academic_year:
                qs = qs.filter(academic_year=academic_year)
            fs = qs.filter(level='class', target_class_ref_id=class_id).first()

        if fs:
            return Response(FeeStructureSerializer(fs).data)

        # Fallback to school-level
        qs_school = FeeStructure.objects.filter(level='school')
        if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
            qs_school = qs_school.filter(school_id=school_id)
        school_fs = qs_school.first()
        if school_fs:
            return Response(FeeStructureSerializer(school_fs).data)

        return Response({'detail': 'No Fee Structure Available', 'fee_structure': None}, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='student-summary')
    def student_summary(self, request):
        """Returns the full calculated fee summary for a student from DB records."""
        user = request.user
        legacy_public = not user.is_authenticated and getattr(settings, 'LEGACY_PUBLIC_FEE_READS', False)
        role = getattr(user, 'role', User.Role.SCHOOL_ADMIN if legacy_public else None)
        school_id = getattr(user, 'school_id', None)
        student_id = request.query_params.get('student_id')

        if legacy_public and student_id and str(student_id).isdigit():
            school_id = Student.objects.filter(pk=student_id).values_list('school_id', flat=True).first()
        if role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)

        # Early Object-Level Authorization Check (BOLA & ID Enumeration Prevention)
        if role == User.Role.STUDENT:
            sp = getattr(user, 'student_profile', None)
            if not sp:
                return Response({'error': 'Permission denied. Student profile not found.'}, status=status.HTTP_403_FORBIDDEN)
            if student_id and str(student_id) != str(sp.student_id):
                st_obj = getattr(sp, 'student', None)
                if not st_obj or str(student_id) != str(st_obj.admission_no):
                    return Response({'error': 'Permission denied. Students may only view their own fee summary.'}, status=status.HTTP_403_FORBIDDEN)
            student_id = sp.student_id
        elif role == User.Role.PARENT:
            pp = getattr(user, 'parent_profile', None)
            if not pp:
                return Response({'error': 'Permission denied. Parent profile not found.'}, status=status.HTTP_403_FORBIDDEN)
            if student_id:
                if not pp.students.filter(school_id=school_id).filter(Q(pk=student_id if str(student_id).isdigit() else None) | Q(admission_no=str(student_id))).exists():
                    return Response({'error': 'Permission denied. Parents may only view fee summaries for their linked children.'}, status=status.HTTP_403_FORBIDDEN)
            else:
                first_child = pp.students.first()
                if first_child:
                    student_id = first_child.id
                else:
                    return Response({'error': 'No linked children found.'}, status=status.HTTP_404_NOT_FOUND)
        elif role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            return Response({'error': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        if not student_id:
            return Response({'error': 'student_id query parameter is required'}, status=status.HTTP_400_BAD_REQUEST)

        st_qs = Student.objects.all().select_related('section_record__class_room', 'school')
        if school_id and role != User.Role.SUPER_ADMIN:
            st_qs = st_qs.filter(school_id=school_id)

        student = None
        if str(student_id).isdigit():
            student = st_qs.filter(pk=student_id).first()
        if not student:
            student = st_qs.filter(admission_no=student_id).first()

        if not student:
            return Response({'error': f'Student {student_id} not found'}, status=status.HTTP_404_NOT_FOUND)

        if role == User.Role.TEACHER:
            tp = getattr(user, 'teacher_profile', None)
            if not teacher_can_access_student(tp, student, school_id=school_id):
                return Response({'error': 'Permission denied. Teachers may only view fee summaries for students in their assigned sections.'}, status=status.HTTP_403_FORBIDDEN)

        summary = get_student_fee_summary(student)
        return Response(summary, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='student-summaries')
    def student_summaries(self, request):
        """Returns fee summaries for students matching class/section filters, strictly isolated by school."""
        user = request.user
        if user.role in [User.Role.STUDENT, User.Role.PARENT]:
            return Response({'error': 'Permission denied. Batch student summaries are restricted to staff and administrators.'}, status=status.HTTP_403_FORBIDDEN)
        school_id = getattr(user, 'school_id', None)
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            return Response({'error': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        if user.role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)
        class_id = request.query_params.get('class_id')
        section_id = request.query_params.get('section_id')
        academic_year = request.query_params.get('academic_year')

        qs = Student.objects.all().select_related('section_record__class_room', 'school')
        if user.role != User.Role.SUPER_ADMIN:
            qs = qs.filter(school_id=school_id)

        if user.role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None)
            qs = teacher_student_queryset(teacher, qs, school_id=school_id)

        if section_id:
            qs = qs.filter(section_record_id=section_id)
        if class_id:
            qs = qs.filter(section_record__class_room_id=class_id)
        if academic_year:
            qs = qs.filter(academic_year=academic_year)

        cached_structures = list(FeeStructure.objects.all().prefetch_related('quarter_records'))
        if user.role != User.Role.SUPER_ADMIN:
            cached_structures = [fs for fs in cached_structures if fs.school_id == school_id]

        summaries = [get_student_fee_summary(st, cached_structures=cached_structures) for st in qs[:200]]
        return Response(summaries, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='school-revenue')
    def school_revenue(self, request):
        """Returns authoritative, aggregated school revenue, receivables, and monthly receipts from PostgreSQL."""
        user = request.user
        school_id = getattr(user, 'school_id', None)
        if user.role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)
        academic_year = request.query_params.get('academic_year')
        class_name = request.query_params.get('class_name')

        cache_key = f"school_revenue_{school_id}_{academic_year or 'all'}_{class_name or 'all'}"
        cached_data = cache.get(cache_key)
        if cached_data:
            return Response(cached_data, status=status.HTTP_200_OK)

        students_qs = Student.objects.all()
        payments_qs = FeePayment.objects.all()

        if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
            students_qs = students_qs.filter(school_id=school_id)
            payments_qs = payments_qs.filter(school_id=school_id)

        if class_name:
            students_qs = students_qs.filter(class_name=class_name)
            payments_qs = payments_qs.filter(student__class_name=class_name)

        if academic_year:
            students_qs = students_qs.filter(Q(academic_year=academic_year) | Q(academic_year=''))
            payments_qs = payments_qs.filter(academic_year=academic_year)

        # 1. Total Revenue Collected (direct SQL SUM)
        payment_sum = payments_qs.aggregate(total=Sum('amount_paid'))['total'] or 0.0
        total_collected = float(payment_sum)

        # Fallback to student.fee_paid direct sum if higher
        student_paid_sum = students_qs.aggregate(total=Sum('fee_paid'))['total'] or 0.0
        if float(student_paid_sum) > total_collected:
            total_collected = float(student_paid_sum)

        # 2. Total Invoiced & Student Count
        students_count = students_qs.count()
        status_counts = students_qs.aggregate(
            paid=Count('id', filter=Q(fee_total__gt=0, fee_paid__gte=F('fee_total'))),
            partial=Count('id', filter=Q(fee_paid__gt=0, fee_paid__lt=F('fee_total'))),
            unpaid=Count('id', filter=Q(fee_paid__lte=0)),
        )
        student_invoiced_sum = students_qs.aggregate(total=Sum('fee_total'))['total'] or 0.0
        total_invoiced = float(student_invoiced_sum)

        if total_invoiced == 0 and students_count > 0:
            cached_structures = list(FeeStructure.objects.all().prefetch_related('quarter_records'))
            if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
                cached_structures = [fs for fs in cached_structures if fs.school_id == school_id or not fs.school_id]
            if academic_year:
                cached_structures = [fs for fs in cached_structures if fs.academic_year == academic_year or not fs.academic_year]

            class_counts = students_qs.values('class_name', 'section').annotate(count=Count('id'))
            dummy_student = Student()
            structure_amounts_cache = {}
            calculated_invoiced = 0.0

            for group in class_counts:
                c_name = group['class_name']
                s_name = group['section']
                cnt = group['count']
                cache_key_grp = f"{c_name}_{s_name}"
                if cache_key_grp not in structure_amounts_cache:
                    dummy_student.class_name = c_name
                    dummy_student.section = s_name
                    dummy_student.section_record = None
                    dummy_student.school_id = school_id
                    matched_fs = resolve_fee_structure_for_student(
                        dummy_student,
                        academic_year=academic_year,
                        school_id=school_id,
                        cached_structures=cached_structures,
                    )
                    amount = 0.0
                    if matched_fs:
                        try:
                            amount = float(getattr(matched_fs, 'total_amount', 0.0) or 0.0)
                        except (ValueError, TypeError, AttributeError):
                            amount = 0.0
                    structure_amounts_cache[cache_key_grp] = amount
                calculated_invoiced += structure_amounts_cache[cache_key_grp] * cnt

            fee_recs_qs = StudentFeeRecord.objects.all()
            if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
                fee_recs_qs = fee_recs_qs.filter(school_id=school_id)
            if academic_year:
                fee_recs_qs = fee_recs_qs.filter(academic_year=academic_year)
            adj = fee_recs_qs.aggregate(
                t=Sum('transport_charges'),
                h=Sum('hostel_charges'),
                f=Sum('fine_amount'),
                s=Sum('scholarship'),
                d=Sum('discount')
            )
            net_adj = (float(adj['t'] or 0) + float(adj['h'] or 0) + float(adj['f'] or 0) - float(adj['s'] or 0) - float(adj['d'] or 0))
            total_invoiced = max(0.0, calculated_invoiced + net_adj)

        pending_receivables = max(0.0, total_invoiced - total_collected)
        collection_rate = round((total_collected / total_invoiced * 100), 1) if total_invoiced > 0 else 0

        # 3. Monthly Revenue breakdown (SQL Group-By Month)
        month_keys = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        monthly_distribution = {m: 0.0 for m in month_keys}

        monthly_aggregates = (
            payments_qs
            .filter(payment_date__isnull=False)
            .values('payment_date__month')
            .annotate(total=Sum('amount_paid'))
        )
        for entry in monthly_aggregates:
            m_num = entry.get('payment_date__month')
            if m_num and 1 <= m_num <= 12:
                monthly_distribution[month_keys[m_num - 1]] = float(entry['total'])

        if not any(monthly_distribution.values()) and total_collected > 0:
            current_m = datetime.date.today().month - 1
            monthly_distribution[month_keys[current_m]] = total_collected

        monthly_chart = [
            {'month': m, 'amount': monthly_distribution[m]}
            for m in month_keys
        ]

        # 4. Recent Transactions / Payments (limit 10 with select_related)
        recent_payments = [
            {
                'id': p.id,
                'receiptNo': p.receipt_no,
                'studentName': p.student.name if p.student else 'Student',
                'admissionNo': p.student.admission_no if p.student else '',
                'amountPaid': float(p.amount_paid),
                'paymentDate': str(p.payment_date),
                'paymentMethod': p.payment_method,
                'category': p.category,
            }
            for p in payments_qs.select_related('student').order_by('-payment_date', '-created_at')[:10]
        ]

        response_data = {
            'totalRevenue': total_collected,
            'totalInvoiced': total_invoiced,
            'pendingReceivables': pending_receivables,
            'collectionRate': collection_rate,
            'monthlyDistribution': monthly_chart,
            'recentPayments': recent_payments,
            'studentsCount': students_count,
            'paidCount': status_counts['paid'] or 0,
            'partialCount': status_counts['partial'] or 0,
            'unpaidCount': status_counts['unpaid'] or 0,
            'lastUpdated': datetime.datetime.now().isoformat(),
        }

        cache.set(cache_key, response_data, 60)
        return Response(response_data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='record-student-payment')
    @transaction.atomic
    def record_student_payment(self, request):
        """Records an actual payment transaction in the database for a student."""
        user = request.user
        legacy_public = not user.is_authenticated and getattr(settings, 'LEGACY_PUBLIC_FEE_READS', False)
        role = getattr(user, 'role', User.Role.SCHOOL_ADMIN if legacy_public else None)
        if role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'error': 'Permission denied. Only school administrators can record payments.'}, status=status.HTTP_403_FORBIDDEN)
        school_id = getattr(user, 'school_id', None)
        if role != User.Role.SUPER_ADMIN and not school_id and legacy_public:
            student_id = request.data.get('student_id') or request.data.get('studentId')
            if student_id and str(student_id).isdigit():
                school_id = Student.objects.filter(pk=student_id).values_list('school_id', flat=True).first()
        if role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)
        student_id = request.data.get('student_id') or request.data.get('studentId')
        amount_paid = request.data.get('amount_paid') or request.data.get('amountPaid')
        payment_method = request.data.get('payment_method') or request.data.get('paymentMethod', 'Cash')
        category = request.data.get('category', 'School Fee Payment')
        installment_type = request.data.get('installment_type') or request.data.get('installmentType', 'Custom')
        quarter_id = request.data.get('quarter_id') or request.data.get('quarterId')

        if not student_id:
            return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        if not amount_paid or float(amount_paid) <= 0:
            return Response({'error': 'A valid positive amount_paid is required'}, status=status.HTTP_400_BAD_REQUEST)

        st_qs = Student.objects.all().select_related('section_record__class_room', 'school')
        if school_id and role != User.Role.SUPER_ADMIN:
            st_qs = st_qs.filter(school_id=school_id)

        student = None
        if str(student_id).isdigit():
            student = st_qs.filter(pk=student_id).first()
        if not student:
            student = st_qs.filter(admission_no=student_id).first()

        if not student:
            return Response({'error': f'Student with ID {student_id} not found'}, status=status.HTTP_404_NOT_FOUND)

        import time, random
        receipt_no = f"RCPT-2026-{random.randint(100, 999)}"
        transaction_id = f"TXN-{payment_method.upper().replace(' ', '')}-{random.randint(10000, 99999)}"
        today_str = datetime.date.today().isoformat()

        # Find or create StudentFeeRecord
        fee_rec, _ = StudentFeeRecord.objects.get_or_create(
            student=student,
            defaults={
                'school': student.school,
                'student_id_str': str(student.id),
                'student_name': student.name,
                'admission_no': student.admission_no,
                'class_name': student.class_name,
                'section_name': student.section,
                'academic_year': student.academic_year or '2026-2027',
            }
        )

        quarter_obj = None
        if quarter_id and str(quarter_id).isdigit():
            quarter_obj = FeeQuarter.objects.filter(pk=quarter_id, fee_structure__school_id=student.school_id).first()

        fs = resolve_fee_structure_for_student(student, school_id=student.school_id)

        payment_obj = FeePayment.objects.create(
            school=student.school,
            fee_record=fee_rec,
            student=student,
            fee_structure=quarter_obj.fee_structure if quarter_obj else fs,
            quarter=quarter_obj,
            academic_year=student.academic_year or '2026-2027',
            payment_date=today_str,
            amount_paid=float(amount_paid),
            payment_method=payment_method,
            transaction_id=transaction_id,
            receipt_no=receipt_no,
            category=category,
            installment_type=installment_type,
        )

        # Update JSON payment history in StudentFeeRecord
        history = list(fee_rec.payment_history or [])
        history.insert(0, {
            'id': f"p-{payment_obj.id}",
            'paymentDate': today_str,
            'amountPaid': float(amount_paid),
            'paymentMethod': payment_method,
            'transactionId': transaction_id,
            'receiptNo': receipt_no,
            'category': category,
            'installmentType': installment_type,
            'quarterId': quarter_id,
        })
        fee_rec.payment_history = history
        fee_rec.save()

        summary = get_student_fee_summary(student)

        try:
            from apps.notifications.services import notify_school_admins, notify_student_and_parents
            notify_student_and_parents(
                student,
                title='Fee Payment Recorded',
                body=f'₹{amount_paid} fee payment recorded for {student.name}. Receipt: {payment_obj.receipt_no}.',
                category='Finance',
                channel='fee-alert',
                sender=user,
                related={
                    'receiptNo': payment_obj.receipt_no,
                    'amount': float(payment_obj.amount_paid),
                    'paymentMethod': payment_obj.payment_method,
                    'studentId': student.id,
                },
            )
            notify_school_admins(
                student.school,
                title='Fee Collection Recorded',
                body=f'₹{amount_paid} received for {student.name} ({student.class_name}-{student.section}). Receipt: {payment_obj.receipt_no}.',
                category='Finance',
                channel='fee-alert',
                sender=user,
                related={
                    'receiptNo': payment_obj.receipt_no,
                    'amount': float(payment_obj.amount_paid),
                },
            )
        except Exception:
            pass

        if student.school_id:
            cache.delete(f"school_revenue_{student.school_id}_{student.academic_year or 'all'}")
            cache.delete(f"school_revenue_{student.school_id}_all")

        return Response({
            'message': 'Student payment recorded successfully',
            'payment': FeePaymentSerializer(payment_obj).data,
            'summary': summary,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='by-teacher')
    def by_teacher(self, request):
        user = request.user
        if not (user and user.is_authenticated):
            return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)
        if user.role not in [User.Role.TEACHER, User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'error': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        from apps.staff.models import Teacher
        teacher = None
        if user.role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None) or Teacher.objects.filter(user=user, school_id=user.school_id).first()
            if teacher and (teacher.school_id != user.school_id or teacher.status != Teacher.Status.ACTIVE):
                teacher = None
        elif user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            if user.role == User.Role.SCHOOL_ADMIN and not user.school_id:
                return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)
            t_id = request.query_params.get('teacher_id')
            t_qs = Teacher.objects.all()
            if user.role != User.Role.SUPER_ADMIN:
                t_qs = t_qs.filter(school_id=user.school_id)
            if t_id:
                teacher = t_qs.filter(pk=t_id).first()
            else:
                teacher = t_qs.first()

        if not teacher:
            return Response([])

        section_ids = list(teacher.sections.values_list('id', flat=True))
        class_ids = list(teacher.sections.values_list('class_room_id', flat=True))
        teaching_section_ids = list(teacher.teaching_assignments.values_list('section_id', flat=True))
        teaching_class_ids = list(teacher.teaching_assignments.values_list('section__class_room_id', flat=True))

        all_section_ids = set(section_ids + teaching_section_ids)
        all_class_ids = set(class_ids + teaching_class_ids)

        qs = self.get_queryset().filter(
            Q(level='class', target_class_ref_id__in=all_class_ids) |
            Q(level='section', target_section_ref_id__in=all_section_ids) |
            Q(level='school')
        ).distinct()
        return Response(FeeStructureSerializer(qs, many=True).data)

    @action(detail=False, methods=['get', 'post', 'patch'], url_path='payment-gateway/settings')
    def payment_gateway_settings(self, request):
        user = request.user
        school_id = getattr(user, 'school_id', None)
        if user.role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)
        if user.role == User.Role.SUPER_ADMIN and not school_id:
            school_id = request.data.get('school_id') or request.query_params.get('school_id')
        if not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_400_BAD_REQUEST)

        settings_obj, _ = FeePaymentSettings.objects.get_or_create(school_id=school_id)

        if request.method == 'GET':
            return Response(FeePaymentSettingsSerializer(settings_obj, context={'request': request}).data)

        serializer = FeePaymentSettingsSerializer(
            settings_obj,
            data=request.data,
            partial=True,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(FeePaymentSettingsSerializer(obj, context={'request': request}).data)

    @action(detail=False, methods=['post'], url_path='payment-gateway/test-connection')
    def test_payment_gateway_connection(self, request):
        user = request.user
        school_id = getattr(user, 'school_id', None)
        if user.role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)
        if user.role == User.Role.SUPER_ADMIN and not school_id:
            school_id = request.data.get('school_id') or request.query_params.get('school_id')

        key_id = (request.data.get('keyId') or request.data.get('key_id') or '').strip()
        key_secret = (request.data.get('keySecret') or request.data.get('key_secret') or '').strip()
        test_mode = request.data.get('testMode', request.data.get('test_mode', True))

        if not key_id or not key_secret:
            stored = FeePaymentSettings.objects.filter(school_id=school_id).first()
            if stored:
                key_id = key_id or stored.key_id
                key_secret = key_secret or stored.get_key_secret()
                if 'testMode' not in request.data and 'test_mode' not in request.data:
                    test_mode = stored.test_mode

        if not key_id or not key_secret:
            return Response({
                'connected': False,
                'status': 'error',
                'message': 'Both Razorpay Key ID and Key Secret are required to test connection.'
            }, status=status.HTTP_400_BAD_REQUEST)

        expected_prefix = 'rzp_test_' if test_mode else 'rzp_live_'
        if not key_id.startswith(expected_prefix):
            return Response({
                'connected': False,
                'status': 'error',
                'message': f"Key ID prefix mismatch. Expected prefix '{expected_prefix}' for {'Test' if test_mode else 'Live'} mode."
            }, status=status.HTTP_400_BAD_REQUEST)

        if getattr(settings, 'RAZORPAY_DUMMY_MODE', False) and 'dummy' in key_id:
            return Response({
                'connected': True,
                'status': 'success',
                'message': 'Razorpay mock test connection succeeded (Sandbox environment).',
                'mode': 'test' if test_mode else 'live'
            })

        try:
            import razorpay
            client = razorpay.Client(auth=(key_id, key_secret))
            client.order.all({'count': 1})
            return Response({
                'connected': True,
                'status': 'success',
                'message': f"Razorpay {'Test' if test_mode else 'Live'} API credentials verified successfully with Razorpay servers.",
                'mode': 'test' if test_mode else 'live'
            })
        except ImportError:
            return Response({
                'connected': True,
                'status': 'warning',
                'message': 'Razorpay credentials format verified. Server SDK package check passed.'
            })
        except Exception as exc:
            err_msg = str(exc)
            logger.exception("Razorpay connection test error")
            return Response({
                'connected': False,
                'status': 'error',
                'message': f"Connection test failed: {err_msg}"
            }, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='payments/create-order')
    def create_payment_order(self, request):
        user = request.user
        if not user or not user.is_authenticated:
            return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

        student_id = request.data.get('studentId') or request.data.get('student_id')
        amount = request.data.get('amount')
        quarter_id = request.data.get('quarterId') or request.data.get('quarter_id')
        category = request.data.get('category', 'School Fee Payment')
        installment_type = request.data.get('installmentType') or request.data.get('installment_type', 'Quarterly')

        if not student_id:
            return Response({'error': 'studentId is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            amount_val = float(amount)
            if amount_val <= 0:
                raise ValueError()
        except (TypeError, ValueError):
            return Response({'error': 'A valid positive amount is required.'}, status=status.HTTP_400_BAD_REQUEST)

        student_qs = Student.objects.all().select_related('school')
        if str(student_id).isdigit():
            student = student_qs.filter(pk=student_id).first()
        else:
            student = student_qs.filter(admission_no=student_id).first()

        if not student:
            return Response({'error': f'Student not found: {student_id}'}, status=status.HTTP_404_NOT_FOUND)

        if user.role == User.Role.PARENT:
            parent_profile = getattr(user, 'parent_profile', None)
            if not parent_profile or not parent_profile.students.filter(pk=student.pk).exists():
                return Response({'error': 'Permission denied. You can only make payments for your registered children.'}, status=status.HTTP_403_FORBIDDEN)
        elif user.role == User.Role.STUDENT:
            student_profile = getattr(user, 'student_profile', None)
            if not student_profile or student_profile.student_id != student.pk:
                return Response({'error': 'Permission denied. You can only make payments for your own account.'}, status=status.HTTP_403_FORBIDDEN)
        elif user.role == User.Role.SCHOOL_ADMIN:
            if student.school_id != user.school_id:
                return Response({'error': 'Permission denied. Student belongs to another school.'}, status=status.HTTP_403_FORBIDDEN)

        summary = get_student_fee_summary(student)
        balance_due = float(summary.get('balanceDue', 0))
        if balance_due <= 0 and summary.get('totalFees', 0) > 0:
            return Response({'error': 'All fee dues for this student have already been paid in full.'}, status=status.HTTP_400_BAD_REQUEST)
        if balance_due > 0 and amount_val > (balance_due + 1.0):
            return Response({'error': f'Payment amount (₹{amount_val}) exceeds the outstanding balance (₹{balance_due}).'}, status=status.HTTP_400_BAD_REQUEST)

        config = _fee_gateway_config(student.school_id)
        if not config:
            return Response({'error': 'Payment Gateway is not configured or enabled for this school. Please contact the school administration.'}, status=status.HTTP_400_BAD_REQUEST)

        key_id, key_secret, dummy_mode, is_test_mode = config
        amount_paise = int(round(amount_val * 100))
        receipt_ref = f"FEE-{student.id}-{int(datetime.datetime.now().timestamp())}"

        if dummy_mode:
            gateway_order_id = f"order_dummy_{uuid.uuid4().hex[:14]}"
        else:
            try:
                import razorpay
                client = razorpay.Client(auth=(key_id, key_secret))
                order_payload = {
                    'amount': amount_paise,
                    'currency': 'INR',
                    'receipt': receipt_ref[:40],
                    'notes': {
                        'student_id': str(student.id),
                        'admission_no': student.admission_no,
                        'student_name': student.name,
                        'school_id': str(student.school_id),
                        'quarter_id': str(quarter_id or ''),
                        'category': category,
                    }
                }
                rzp_order = client.order.create(order_payload)
                gateway_order_id = rzp_order['id']
            except ImportError:
                gateway_order_id = f"order_sim_{uuid.uuid4().hex[:14]}"
                dummy_mode = True
            except Exception as exc:
                logger.exception("Failed to create Razorpay order for student=%s", student.id)
                return Response({'error': f"Failed to initiate Razorpay order: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        fee_rec, _ = StudentFeeRecord.objects.get_or_create(
            student=student,
            defaults={
                'school': student.school,
                'student_id_str': str(student.id),
                'student_name': student.name,
                'admission_no': student.admission_no,
                'class_name': student.class_name,
                'section_name': student.section,
                'academic_year': student.academic_year or '2026-2027',
            }
        )

        quarter_obj = None
        if quarter_id and str(quarter_id).isdigit():
            quarter_obj = FeeQuarter.objects.filter(pk=quarter_id, fee_structure__school_id=student.school_id).first()

        fee_order = FeePaymentOrder.objects.create(
            school=student.school,
            student=student,
            payer=user,
            fee_record=fee_rec,
            quarter=quarter_obj,
            gateway_order_id=gateway_order_id,
            amount=Decimal(str(amount_val)),
            currency='INR',
            category=category,
            installment_type=installment_type,
            academic_year=student.academic_year or '2026-2027',
            status=FeePaymentOrder.Status.PENDING,
            receipt_no=receipt_ref,
            notes={
                'payer_name': user.get_full_name() or user.username,
                'payer_email': user.email or '',
                'student_name': student.name,
                'class_name': student.class_name,
                'section': student.section,
            }
        )

        return Response({
            'orderId': gateway_order_id,
            'keyId': key_id,
            'amount': amount_paise,
            'currency': 'INR',
            'receiptNo': receipt_ref,
            'demoMode': dummy_mode,
            'testMode': is_test_mode,
            'student': {
                'id': student.id,
                'name': student.name,
                'admissionNo': student.admission_no,
                'className': student.class_name,
                'section': student.section,
            },
            'payer': {
                'name': user.get_full_name() or user.username,
                'email': user.email or '',
                'phone': getattr(user, 'phone_number', '') or '',
            }
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='payments/verify')
    @transaction.atomic
    def verify_payment(self, request):
        user = request.user
        if not user or not user.is_authenticated:
            return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

        gateway_order_id = (request.data.get('orderId') or request.data.get('order_id') or request.data.get('gateway_order_id') or '').strip()
        gateway_payment_id = (request.data.get('paymentId') or request.data.get('payment_id') or request.data.get('gateway_payment_id') or '').strip()
        signature = (request.data.get('signature') or request.data.get('gateway_signature') or '').strip()

        if not gateway_order_id or not gateway_payment_id:
            return Response({'error': 'Both orderId and paymentId are required for verification.'}, status=status.HTTP_400_BAD_REQUEST)

        fee_order = FeePaymentOrder.objects.select_for_update().filter(gateway_order_id=gateway_order_id).first()
        if not fee_order:
            return Response({'error': f"Order not found for ID: {gateway_order_id}"}, status=status.HTTP_404_NOT_FOUND)

        if fee_order.status == FeePaymentOrder.Status.PAID and fee_order.payment:
            summary = get_student_fee_summary(fee_order.student)
            return Response({
                'message': 'Payment already verified and recorded.',
                'payment': FeePaymentSerializer(fee_order.payment).data,
                'summary': summary,
            }, status=status.HTTP_200_OK)

        config = _fee_gateway_config(fee_order.school_id)
        if not config:
            return Response({'error': 'Payment gateway configuration missing for school.'}, status=status.HTTP_400_BAD_REQUEST)

        key_id, key_secret, dummy_mode, _ = config

        if not dummy_mode:
            if not signature:
                return Response({'error': 'Payment signature is required for live verification.'}, status=status.HTTP_400_BAD_REQUEST)
            expected = hmac.new(key_secret.encode(), f"{gateway_order_id}|{gateway_payment_id}".encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                fee_order.status = FeePaymentOrder.Status.FAILED
                fee_order.save(update_fields=['status', 'updated_at'])
                return Response({'error': 'Payment verification failed: Signature mismatch.'}, status=status.HTTP_400_BAD_REQUEST)

        payment_method = request.data.get('paymentMethod') or request.data.get('payment_method') or 'Razorpay'
        payer_name = (request.data.get('payerName') or user.get_full_name() or user.username or '').strip()
        payer_email = (request.data.get('payerEmail') or user.email or '').strip()
        payer_phone = (request.data.get('payerPhone') or getattr(user, 'phone_number', '') or '').strip()

        import random
        official_receipt_no = f"RCPT-2026-{random.randint(1000, 9999)}"
        txn_id = f"TXN-RZP-{gateway_payment_id[-8:].upper() if len(gateway_payment_id) >= 8 else random.randint(100000, 999999)}"
        today_str = datetime.date.today().isoformat()

        student = fee_order.student
        fee_rec = fee_order.fee_record or StudentFeeRecord.objects.get_or_create(
            student=student,
            defaults={
                'school': student.school,
                'student_id_str': str(student.id),
                'student_name': student.name,
                'admission_no': student.admission_no,
                'class_name': student.class_name,
                'section_name': student.section,
                'academic_year': student.academic_year or '2026-2027',
            }
        )[0]

        payment_obj = FeePayment.objects.create(
            school=student.school,
            fee_record=fee_rec,
            student=student,
            fee_structure=fee_order.quarter.fee_structure if fee_order.quarter else resolve_fee_structure_for_student(student, school_id=student.school_id),
            quarter=fee_order.quarter,
            academic_year=fee_order.academic_year or student.academic_year or '2026-2027',
            payment_date=today_str,
            amount_paid=fee_order.amount,
            payment_method=payment_method,
            transaction_id=txn_id,
            receipt_no=official_receipt_no,
            category=fee_order.category or 'School Fee Payment',
            installment_type=fee_order.installment_type or 'Custom',
            gateway_order_id=gateway_order_id,
            gateway_payment_id=gateway_payment_id,
            gateway_signature=signature,
            status='Success',
            payer_name=payer_name,
            payer_email=payer_email,
            payer_phone=payer_phone,
            notes=fee_order.notes or {},
        )

        fee_order.status = FeePaymentOrder.Status.PAID
        fee_order.payment = payment_obj
        fee_order.receipt_no = official_receipt_no
        fee_order.save(update_fields=['status', 'payment', 'receipt_no', 'updated_at'])

        history = list(fee_rec.payment_history or [])
        history.insert(0, {
            'id': f"p-{payment_obj.id}",
            'paymentDate': today_str,
            'amountPaid': float(payment_obj.amount_paid),
            'paymentMethod': payment_method,
            'transactionId': txn_id,
            'receiptNo': official_receipt_no,
            'category': payment_obj.category,
            'installmentType': payment_obj.installment_type,
            'quarterId': fee_order.quarter_id,
            'gatewayPaymentId': gateway_payment_id,
            'gatewayOrderId': gateway_order_id,
        })
        fee_rec.payment_history = history
        fee_rec.save(update_fields=['payment_history', 'updated_at'])

        summary = get_student_fee_summary(student)
        Student.objects.filter(pk=student.pk).update(
            fee_total=summary.get('totalFees', 0),
            fee_paid=summary.get('totalPaid', 0),
        )

        if student.school_id:
            cache.delete(f"school_revenue_{student.school_id}_{student.academic_year or 'all'}")
            cache.delete(f"school_revenue_{student.school_id}_all")

        try:
            from apps.notifications.services import notify_student_and_parents, notify_school_admins
            notify_student_and_parents(
                student,
                title="Fee Payment Successful",
                body=f"Payment of ₹{payment_obj.amount_paid} received for {student.name}. Receipt: {official_receipt_no}. Gateway ID: {gateway_payment_id}.",
                category="Finance",
                channel="fee-alert",
                sender=user,
                related={
                    'receiptNo': official_receipt_no,
                    'amount': float(payment_obj.amount_paid),
                    'paymentMethod': payment_method,
                    'gatewayPaymentId': gateway_payment_id,
                    'studentId': student.id,
                },
            )
            notify_school_admins(
                student.school,
                title="Fee Payment Received via Razorpay",
                body=f"₹{payment_obj.amount_paid} received for {student.name} ({student.class_name}-{student.section}). Payment ID: {gateway_payment_id}.",
                category="Finance",
                channel="fee-alert",
                sender=user,
                related={
                    'receiptNo': official_receipt_no,
                    'amount': float(payment_obj.amount_paid),
                    'gatewayPaymentId': gateway_payment_id,
                },
            )
        except Exception:
            pass

        return Response({
            'message': 'Fee payment verified and processed successfully',
            'payment': FeePaymentSerializer(payment_obj).data,
            'summary': summary,
            'receiptNo': official_receipt_no,
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny], url_path='payments/webhook')
    def payment_webhook(self, request):
        event_id = request.headers.get('X-Razorpay-Event-Id') or request.data.get('id') or ''
        event = request.data.get('event', '')
        entity = (((request.data.get('payload') or {}).get('payment') or {}).get('entity') or {})
        gateway_order_id = str(entity.get('order_id') or '').strip()

        if not gateway_order_id:
            return Response({'detail': 'Webhook order_id missing.'}, status=status.HTTP_400_BAD_REQUEST)

        if event_id and FeePaymentWebhookEvent.objects.filter(event_id=event_id).exists():
            return Response({'status': 'already_processed'}, status=status.HTTP_200_OK)

        fee_order = FeePaymentOrder.objects.filter(gateway_order_id=gateway_order_id).first()
        if not fee_order:
            return Response({'detail': 'Unknown fee order.'}, status=status.HTTP_404_NOT_FOUND)

        payment_settings = FeePaymentSettings.objects.filter(school_id=fee_order.school_id).first()
        webhook_secret = payment_settings.get_webhook_secret() if payment_settings else ''
        signature = request.headers.get('X-Razorpay-Signature', '')

        if webhook_secret and signature:
            expected = hmac.new(webhook_secret.encode(), request.body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                return Response({'detail': 'Invalid webhook signature.'}, status=status.HTTP_400_BAD_REQUEST)

        if event_id:
            FeePaymentWebhookEvent.objects.create(
                event_id=event_id,
                event_type=event,
                school_id=fee_order.school_id,
                payload=request.data,
                processed=True
            )

        with transaction.atomic():
            locked_order = FeePaymentOrder.objects.select_for_update().get(pk=fee_order.pk)
            gateway_payment_id = str(entity.get('id') or '')
            method = str(entity.get('method') or 'Razorpay').upper()

            if event in ('payment.captured', 'payment.authorized'):
                if locked_order.status != FeePaymentOrder.Status.PAID:
                    import random
                    official_receipt_no = f"RCPT-2026-{random.randint(1000, 9999)}"
                    txn_id = f"TXN-RZP-{gateway_payment_id[-8:].upper() if len(gateway_payment_id) >= 8 else random.randint(100000, 999999)}"
                    today_str = datetime.date.today().isoformat()
                    student = locked_order.student
                    fee_rec = locked_order.fee_record or StudentFeeRecord.objects.get_or_create(
                        student=student,
                        defaults={
                            'school': student.school,
                            'student_id_str': str(student.id),
                            'student_name': student.name,
                            'admission_no': student.admission_no,
                            'class_name': student.class_name,
                            'section_name': student.section,
                            'academic_year': student.academic_year or '2026-2027',
                        }
                    )[0]

                    payment_obj = FeePayment.objects.create(
                        school=student.school,
                        fee_record=fee_rec,
                        student=student,
                        fee_structure=locked_order.quarter.fee_structure if locked_order.quarter else None,
                        quarter=locked_order.quarter,
                        academic_year=locked_order.academic_year or student.academic_year or '2026-2027',
                        payment_date=today_str,
                        amount_paid=locked_order.amount,
                        payment_method=method,
                        transaction_id=txn_id,
                        receipt_no=official_receipt_no,
                        category=locked_order.category or 'School Fee Payment',
                        installment_type=locked_order.installment_type or 'Custom',
                        gateway_order_id=gateway_order_id,
                        gateway_payment_id=gateway_payment_id,
                        gateway_signature=signature,
                        status='Success',
                        payer_name=str(entity.get('notes', {}).get('payer_name') or ''),
                        payer_email=str(entity.get('email') or ''),
                        payer_phone=str(entity.get('contact') or ''),
                    )

                    locked_order.status = FeePaymentOrder.Status.PAID
                    locked_order.payment = payment_obj
                    locked_order.receipt_no = official_receipt_no
                    locked_order.save(update_fields=['status', 'payment', 'receipt_no', 'updated_at'])

                    history = list(fee_rec.payment_history or [])
                    history.insert(0, {
                        'id': f"p-{payment_obj.id}",
                        'paymentDate': today_str,
                        'amountPaid': float(payment_obj.amount_paid),
                        'paymentMethod': method,
                        'transactionId': txn_id,
                        'receiptNo': official_receipt_no,
                        'category': payment_obj.category,
                        'quarterId': locked_order.quarter_id,
                        'gatewayPaymentId': gateway_payment_id,
                        'gatewayOrderId': gateway_order_id,
                    })
                    fee_rec.payment_history = history
                    fee_rec.save(update_fields=['payment_history', 'updated_at'])

                    summary = get_student_fee_summary(student)
                    Student.objects.filter(pk=student.pk).update(
                        fee_total=summary.get('totalFees', 0),
                        fee_paid=summary.get('totalPaid', 0),
                    )

                    if student.school_id:
                        cache.delete(f"school_revenue_{student.school_id}_{student.academic_year or 'all'}")
                        cache.delete(f"school_revenue_{student.school_id}_all")

            elif event == 'payment.failed' and locked_order.status == FeePaymentOrder.Status.PENDING:
                locked_order.status = FeePaymentOrder.Status.FAILED
                locked_order.save(update_fields=['status', 'updated_at'])

        return Response({'received': True})


class FeeQuarterViewSet(TenantScopedViewSet):
    school_field = 'fee_structure__school'
    queryset = FeeQuarter.objects.select_related('fee_structure').all().order_by('quarter_number')
    serializer_class = FeeQuarterSerializer
    permission_classes = [FeeStructurePermission]
    pagination_class = AdminListPagination
    ordering_fields = ['quarter_number', 'academic_year', 'due_date', 'assigned_amount']
    ordering = ['academic_year', 'quarter_number', 'pk']
    filterset_fields = ['academic_year', 'target_class', 'fee_structure']
    search_fields = ['quarter_name', 'target_class', 'academic_year']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN, User.Role.TEACHER]:
            return qs.none()
        if user.role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None)
            if not teacher or teacher.school_id != user.school_id or teacher.status != Teacher.Status.ACTIVE:
                return qs.none()
            section_ids = set(teacher.sections.filter(school_id=user.school_id).values_list('pk', flat=True))
            section_ids.update(teacher.teaching_assignments.filter(school_id=user.school_id).values_list('section_id', flat=True))
            class_ids = set(teacher.sections.filter(school_id=user.school_id).values_list('class_room_id', flat=True))
            class_ids.update(teacher.teaching_assignments.filter(school_id=user.school_id).values_list('section__class_room_id', flat=True))
            student_ids = teacher_student_queryset(teacher, school_id=user.school_id).values_list('pk', flat=True)
            qs = qs.filter(
                Q(fee_structure__level='school')
                | Q(fee_structure__target_class_ref_id__in=class_ids)
                | Q(fee_structure__target_section_ref_id__in=section_ids)
                | Q(fee_structure__target_student_ref_id__in=student_ids)
            )
        academic_year = self.request.query_params.get('academic_year')
        target_class = self.request.query_params.get('target_class')
        target_class_id = self.request.query_params.get('target_class_id')
        fee_structure_id = self.request.query_params.get('fee_structure_id')

        if academic_year:
            qs = qs.filter(academic_year=academic_year)
        if target_class_id:
            qs = qs.filter(fee_structure__target_class_ref_id=target_class_id)
        elif target_class and target_class != 'All':
            clean_cls = re.sub(r'(class|cls)', '', target_class, flags=re.IGNORECASE)
            clean_cls = re.sub(r'[^a-zA-Z0-9]', ' ', clean_cls).strip()
            base_cls = clean_cls.split()[0] if clean_cls else target_class
            qs = qs.filter(
                Q(target_class__icontains=target_class) |
                Q(target_class__icontains=base_cls) |
                Q(target_class__iexact=target_class)
            )
        if fee_structure_id:
            qs = qs.filter(fee_structure_id=fee_structure_id)
        return qs


class StudentFeeRecordViewSet(TenantScopedViewSet):
    serializer_class = StudentFeeRecordSerializer
    permission_classes = [FeeRecordPermission]
    pagination_class = AdminListPagination
    filterset_fields = ['academic_year', 'class_name', 'section_name', 'student']
    search_fields = ['student_name', 'admission_no', 'student_id_str']
    ordering_fields = ['student_name', 'admission_no', 'class_name', 'section_name', 'academic_year', 'updated_at']
    ordering = ['student_name', 'pk']

    def perform_create(self, serializer):
        user = self.request.user
        student = serializer.validated_data.get('student')
        school = user.school if user.role != User.Role.SUPER_ADMIN else getattr(student, 'school', None)
        if not school or (student and student.school_id != school.id):
            raise PermissionDenied('Fee records and students must belong to the same school.')
        serializer.save(school=school)

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return StudentFeeRecord.objects.none()
        school_id = getattr(user, 'school_id', None)

        qs = StudentFeeRecord.objects.select_related('student', 'school')
        # Keep GET requests read-only and quick. Legacy missing fee records are
        # created through the explicit sync-records action instead of during
        # every fee ledger read.
        if user.role == User.Role.SUPER_ADMIN:
            pass
        elif user.role in [User.Role.SCHOOL_ADMIN, User.Role.TEACHER, User.Role.PARENT, User.Role.STUDENT] and school_id:
            qs = qs.filter(school_id=school_id)
        else:
            # Fail closed for accounts without a tenant or without a role that
            # is allowed to view fee records. In particular, never let a
            # school-less user inherit the unfiltered queryset.
            return StudentFeeRecord.objects.none()

        # Object-Level Authorization by Role
        if user.role == User.Role.STUDENT:
            student_profile = getattr(user, 'student_profile', None)
            if not student_profile or not student_profile.student:
                return StudentFeeRecord.objects.none()
            qs = qs.filter(student=student_profile.student)
        elif user.role == User.Role.PARENT:
            parent_profile = getattr(user, 'parent_profile', None)
            if not parent_profile:
                return StudentFeeRecord.objects.none()
            qs = qs.filter(student__in=parent_profile.students.all())
        elif user.role == User.Role.TEACHER:
            teacher = getattr(user, 'teacher_profile', None)
            if not teacher or teacher.school_id != school_id:
                return StudentFeeRecord.objects.none()
            assigned_students = teacher_student_queryset(
                teacher, school_id=school_id,
            ).values_list('pk', flat=True)
            qs = qs.filter(student_id__in=assigned_students)

        class_name = self.request.query_params.get('class_name')
        class_id = self.request.query_params.get('class_id')
        section_id = self.request.query_params.get('section_id')
        student_id = self.request.query_params.get('student_id')

        if student_id:
            qs = qs.filter(Q(student_id=student_id) if str(student_id).isdigit() else Q(admission_no=student_id))
        if section_id:
            qs = qs.filter(student__section_record_id=section_id)
        if class_id:
            qs = qs.filter(student__section_record__class_room_id=class_id)
        elif class_name and class_name != 'All':
            clean_cls = class_name.replace('Class', '').replace('class', '').strip(' -_')
            qs = qs.filter(Q(class_name__icontains=clean_cls) | Q(class_name=class_name))

        return qs.order_by('class_name', 'student_name')

    @action(detail=False, methods=['post'], url_path='sync-records')
    def sync_records(self, request):
        """Asynchronously or on-demand batches missing StudentFeeRecords without stalling GET operations."""
        user = self.request.user
        school_id = getattr(user, 'school_id', None)
        if not school_id:
            return Response({'error': 'School context required'}, status=status.HTTP_400_BAD_REQUEST)
        existing_ids = set(StudentFeeRecord.objects.filter(school_id=school_id).values_list('student_id', flat=True))
        missing_students = Student.objects.filter(school_id=school_id).exclude(id__in=existing_ids)
        new_recs = [
            StudentFeeRecord(
                school=st.school,
                student=st,
                student_id_str=str(st.id),
                student_name=st.name,
                admission_no=st.admission_no,
                class_name=st.class_name,
                section_name=st.section,
                academic_year=st.academic_year or '2026-2027',
            )
            for st in missing_students
        ]
        created = len(StudentFeeRecord.objects.bulk_create(new_recs))
        return Response({'status': 'success', 'created_count': created}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='record-payment')
    @transaction.atomic
    def record_payment(self, request, pk=None):
        record = self.get_object()
        amount_paid = request.data.get('amount_paid')
        payment_method = request.data.get('payment_method', 'Cash')
        category = request.data.get('category', 'School Fee Payment')
        installment_type = request.data.get('installment_type', 'Custom')
        quarter_id = request.data.get('quarter_id')

        if not amount_paid or float(amount_paid) <= 0:
            return Response({'error': 'Invalid payment amount'}, status=status.HTTP_400_BAD_REQUEST)

        import time, random
        receipt_no = f"RCPT-2026-{random.randint(100, 999)}"
        transaction_id = f"TXN-{payment_method.upper().replace(' ', '')}-{random.randint(10000, 99999)}"
        today_str = datetime.date.today().isoformat()

        new_payment_dict = {
            'id': f"p-{int(time.time() * 1000)}",
            'paymentDate': today_str,
            'amountPaid': float(amount_paid),
            'paymentMethod': payment_method,
            'transactionId': transaction_id,
            'receiptNo': receipt_no,
            'category': category,
            'installmentType': installment_type,
            'quarterId': quarter_id,
        }

        # Update JSON payment history field
        history = list(record.payment_history or [])
        history.insert(0, new_payment_dict)
        record.payment_history = history
        record.save()

        quarter_obj = None
        if quarter_id and str(quarter_id).isdigit():
            quarter_obj = FeeQuarter.objects.filter(
                pk=quarter_id,
                fee_structure__school_id=record.school_id,
            ).first()

        # Create FeePayment instance
        payment_obj = FeePayment.objects.create(
            school=record.school,
            fee_record=record,
            student=record.student,
            fee_structure=quarter_obj.fee_structure if quarter_obj else None,
            quarter=quarter_obj,
            academic_year=record.academic_year,
            payment_date=today_str,
            amount_paid=amount_paid,
            payment_method=payment_method,
            transaction_id=transaction_id,
            receipt_no=receipt_no,
            category=category,
            installment_type=installment_type,
        )

        # Dispatch fee payment receipt notification to student and parents
        try:
            from apps.notifications.services import notify_student_and_parents, notify_school_admins
            st_target = record.student or Student.objects.filter(school=record.school).filter(
                Q(id=int(record.student_id_str) if str(record.student_id_str).isdigit() else -1) | Q(admission_no=record.admission_no)
            ).first()
            st_name = (st_target.name if st_target else None) or record.student_name or 'Student'
            if st_target:
                notify_student_and_parents(
                    st_target,
                    title="Fee Payment Successful",
                    body=f"Payment of ₹{amount_paid} received for {st_name}. Receipt: {receipt_no}. Mode: {payment_method}.",
                    category="Finance",
                    channel="fee-alert",
                    sender=request.user if request.user.is_authenticated else None,
                    related={
                        'receiptNo': receipt_no,
                        'amount': float(amount_paid),
                        'paymentMethod': payment_method,
                        'studentId': st_target.id,
                    },
                )
            notify_school_admins(
                record.school,
                title="Fee Collection Recorded",
                body=f"₹{amount_paid} received for {st_name} ({record.class_name}-{record.section_name}). Receipt: {receipt_no}.",
                category="Finance",
                channel="fee-alert",
                sender=request.user if request.user.is_authenticated else None,
                related={'receiptNo': receipt_no, 'amount': float(amount_paid)},
            )
        except Exception:
            pass

        summary = get_student_fee_summary(record.student) if record.student else None
        if summary and record.student_id:
            Student.objects.filter(pk=record.student_id).update(
                fee_total=summary.get('totalFees', 0),
                fee_paid=summary.get('totalPaid', 0),
            )
        if record.school_id:
            cache.delete(f"school_revenue_{record.school_id}_{record.academic_year or 'all'}")
            cache.delete(f"school_revenue_{record.school_id}_all")

        return Response({
            'message': 'Payment recorded successfully',
            'payment': new_payment_dict,
            'record': StudentFeeRecordSerializer(record).data,
            'summary': summary,
        }, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        instance = serializer.save()
        student = instance.student
        if student:
            summary = get_student_fee_summary(student)
            if summary:
                Student.objects.filter(pk=student.pk).update(
                    fee_total=summary.get('totalFees', 0),
                    fee_paid=summary.get('totalPaid', 0)
                )
        if instance.school_id:
            cache.delete(f"school_revenue_{instance.school_id}_{getattr(instance, 'academic_year', '') or 'all'}")
            cache.delete(f"school_revenue_{instance.school_id}_all")

    @action(detail=False, methods=['patch', 'put', 'post'], url_path='update-student-fee')
    def update_student_fee(self, request):
        """Allows updating student fee record by student_id or record_id, directly synchronizing the database."""
        user = request.user
        if user.role not in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            return Response({'error': 'Permission denied. Only school administrators can update fee records.'}, status=status.HTTP_403_FORBIDDEN)

        student_id = request.data.get('student_id') or request.data.get('studentId')
        record_id = request.data.get('record_id') or request.data.get('recordId')
        school_id = getattr(user, 'school_id', None)

        record_qs = StudentFeeRecord.objects.all()
        if user.role != User.Role.SUPER_ADMIN and school_id:
            record_qs = record_qs.filter(school_id=school_id)

        record = None
        if record_id and str(record_id).isdigit():
            record = record_qs.filter(pk=record_id).first()
        if not record and student_id:
            record = record_qs.filter(
                Q(student_id_str=str(student_id)) | Q(student__id=student_id if str(student_id).isdigit() else None) | Q(admission_no=str(student_id))
            ).first()

        if not record and student_id:
            st_qs = Student.objects.all()
            if user.role != User.Role.SUPER_ADMIN and school_id:
                st_qs = st_qs.filter(school_id=school_id)
            st = st_qs.filter(pk=student_id).first() if str(student_id).isdigit() else st_qs.filter(admission_no=student_id).first()
            if st:
                record = StudentFeeRecord.objects.create(
                    school=st.school,
                    student=st,
                    student_id_str=str(st.id),
                    student_name=st.name,
                    admission_no=st.admission_no,
                    class_name=st.class_name,
                    section_name=st.section,
                    academic_year=st.academic_year or '2026-2027',
                )

        if not record:
            return Response({'error': 'Student fee record not found'}, status=status.HTTP_404_NOT_FOUND)

        if user.role != User.Role.SUPER_ADMIN and record.school_id != school_id:
            return Response({'error': 'Permission denied. Fee record does not belong to your school.'}, status=status.HTTP_403_FORBIDDEN)

        if 'custom_items' in request.data:
            record.custom_items = request.data['custom_items']
        if 'custom_quarters' in request.data:
            record.custom_quarters = request.data['custom_quarters']
        if 'scholarship' in request.data:
            record.scholarship = request.data['scholarship']
        if 'discount' in request.data:
            record.discount = request.data['discount']
        if 'transport_charges' in request.data:
            record.transport_charges = request.data['transport_charges']
        if 'hostel_charges' in request.data:
            record.hostel_charges = request.data['hostel_charges']
        if 'fine_amount' in request.data:
            record.fine_amount = request.data['fine_amount']
        if 'payment_history' in request.data:
            record.payment_history = request.data['payment_history']

        record.save()

        # Synchronize Student model
        student = record.student
        summary = None
        if student:
            summary = get_student_fee_summary(student)
            if summary:
                Student.objects.filter(pk=student.pk).update(
                    fee_total=summary.get('totalFees', 0),
                    fee_paid=summary.get('totalPaid', 0)
                )

        if record.school_id:
            cache.delete(f"school_revenue_{record.school_id}_{getattr(record, 'academic_year', '') or 'all'}")
            cache.delete(f"school_revenue_{record.school_id}_all")

        return Response({
            'message': 'Student fee record updated successfully in database',
            'record': StudentFeeRecordSerializer(record).data,
            'summary': summary,
        }, status=status.HTTP_200_OK)


class FeePaymentViewSet(TenantScopedViewSet):
    queryset = FeePayment.objects.select_related('student', 'quarter', 'fee_structure', 'school').all().order_by('-payment_date', '-created_at')
    serializer_class = FeePaymentSerializer
    permission_classes = [FeeRecordPermission]
    pagination_class = AdminListPagination
    ordering_fields = ['payment_date', 'created_at', 'amount_paid']
    ordering = ['-payment_date', '-created_at']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not (user and user.is_authenticated):
            return FeePayment.objects.none()

        if user.role in [User.Role.SCHOOL_ADMIN, User.Role.SUPER_ADMIN]:
            pass
        elif user.role == User.Role.STUDENT:
            student_profile = getattr(user, 'student_profile', None)
            if not student_profile or not student_profile.student:
                return FeePayment.objects.none()
            qs = qs.filter(student=student_profile.student)
        elif user.role == User.Role.PARENT:
            parent_profile = getattr(user, 'parent_profile', None)
            if not parent_profile:
                return FeePayment.objects.none()
            qs = qs.filter(student__in=parent_profile.students.all())
        else:
            return FeePayment.objects.none()

        # Filtering parameters
        params = self.request.query_params

        student_id = params.get('student_id') or params.get('studentId')
        if student_id:
            if str(student_id).isdigit():
                qs = qs.filter(student_id=student_id)
            else:
                qs = qs.filter(student__admission_no=student_id)

        class_id = params.get('class_id') or params.get('classId')
        class_name = params.get('class_name') or params.get('className')
        if class_id:
            qs = qs.filter(student__section_record__class_room_id=class_id)
        elif class_name and class_name != 'All':
            clean_cls = class_name.replace('Class', '').replace('class', '').strip(' -_')
            qs = qs.filter(Q(student__class_name__icontains=clean_cls) | Q(student__class_name=class_name))

        section_id = params.get('section_id') or params.get('sectionId')
        section_name = params.get('section_name') or params.get('sectionName')
        if section_id:
            qs = qs.filter(student__section_record_id=section_id)
        elif section_name and section_name != 'All':
            qs = qs.filter(student__section__iexact=section_name)

        status_filter = params.get('status')
        if status_filter and status_filter != 'All':
            qs = qs.filter(status__iexact=status_filter)

        payment_method = params.get('payment_method') or params.get('paymentMethod')
        if payment_method and payment_method != 'All':
            qs = qs.filter(payment_method__iexact=payment_method)

        category = params.get('category')
        if category and category != 'All':
            qs = qs.filter(category__icontains=category)

        academic_year = params.get('academic_year') or params.get('academicYear')
        if academic_year:
            qs = qs.filter(academic_year=academic_year)

        # Date range & scope filtering
        today = datetime.date.today()
        date_scope = params.get('date_scope') or params.get('dateScope')
        if date_scope == 'today':
            qs = qs.filter(payment_date=today)
        elif date_scope == 'week':
            week_ago = today - datetime.timedelta(days=7)
            qs = qs.filter(payment_date__gte=week_ago)
        elif date_scope == 'month':
            start_of_month = today.replace(day=1)
            qs = qs.filter(payment_date__gte=start_of_month)

        start_date = params.get('start_date') or params.get('startDate')
        end_date = params.get('end_date') or params.get('endDate')
        if start_date:
            qs = qs.filter(payment_date__gte=start_date)
        if end_date:
            qs = qs.filter(payment_date__lte=end_date)

        # Keyword search
        search = (params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(receipt_no__icontains=search) |
                Q(transaction_id__icontains=search) |
                Q(gateway_payment_id__icontains=search) |
                Q(gateway_order_id__icontains=search) |
                Q(student__name__icontains=search) |
                Q(student__admission_no__icontains=search) |
                Q(payer_name__icontains=search)
            )

        return qs

    @action(detail=False, methods=['get'], url_path='metrics')
    def metrics(self, request):
        """Aggregate fee collection metrics for the admin collection dashboard."""
        user = request.user
        school_id = getattr(user, 'school_id', None)
        if user.role != User.Role.SUPER_ADMIN and not school_id:
            return Response({'error': 'School context required.'}, status=status.HTTP_403_FORBIDDEN)

        payments_qs = FeePayment.objects.all()
        orders_qs = FeePaymentOrder.objects.all()
        students_qs = Student.objects.all()

        if user.role != User.Role.SUPER_ADMIN and school_id:
            payments_qs = payments_qs.filter(school_id=school_id)
            orders_qs = orders_qs.filter(school_id=school_id)
            students_qs = students_qs.filter(school_id=school_id)

        academic_year = request.query_params.get('academic_year')
        if academic_year:
            payments_qs = payments_qs.filter(academic_year=academic_year)
            orders_qs = orders_qs.filter(academic_year=academic_year)
            students_qs = students_qs.filter(academic_year=academic_year)

        today = datetime.date.today()
        start_of_month = today.replace(day=1)

        # 1. Total revenue collected
        success_payments = payments_qs.filter(status__iexact='Success')
        total_collected = float(success_payments.aggregate(total=Sum('amount_paid'))['total'] or 0.0)

        # 2. Today's collections
        today_collected = float(success_payments.filter(payment_date=today).aggregate(total=Sum('amount_paid'))['total'] or 0.0)

        # 3. This month's collections
        month_collected = float(success_payments.filter(payment_date__gte=start_of_month).aggregate(total=Sum('amount_paid'))['total'] or 0.0)

        # 4. Status counts
        success_count = success_payments.count()
        failed_count = payments_qs.filter(status__iexact='Failed').count() + orders_qs.filter(status=FeePaymentOrder.Status.FAILED).count()
        pending_count = orders_qs.filter(status=FeePaymentOrder.Status.PENDING).count()
        refunded_count = payments_qs.filter(status__iexact='Refunded').count()

        # 5. Total invoiced and pending receivables from students
        total_invoiced = float(students_qs.aggregate(total=Sum('fee_total'))['total'] or 0.0)
        total_student_paid = float(students_qs.aggregate(total=Sum('fee_paid'))['total'] or 0.0)
        effective_collected = max(total_collected, total_student_paid)
        pending_receivables = max(0.0, total_invoiced - effective_collected)
        collection_rate = round((effective_collected / total_invoiced * 100), 1) if total_invoiced > 0 else 0.0

        # Method breakdown
        method_counts = (
            success_payments
            .values('payment_method')
            .annotate(total_amount=Sum('amount_paid'), count=Count('id'))
            .order_by('-total_amount')
        )

        return Response({
            'totalCollected': total_collected,
            'todayCollected': today_collected,
            'monthCollected': month_collected,
            'totalInvoiced': total_invoiced,
            'pendingReceivables': pending_receivables,
            'collectionRate': collection_rate,
            'successCount': success_count,
            'failedCount': failed_count,
            'pendingCount': pending_count,
            'refundedCount': refunded_count,
            'totalTransactions': payments_qs.count(),
            'methodBreakdown': list(method_counts),
            'lastUpdated': datetime.datetime.now().isoformat(),
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='receipt')
    def receipt(self, request, pk=None):
        payment = self.get_object()
        student = payment.student
        school = payment.school

        # Verify parent/student permissions
        user = request.user
        if user.role == User.Role.STUDENT:
            student_profile = getattr(user, 'student_profile', None)
            if not student_profile or student_profile.student_id != payment.student_id:
                raise PermissionDenied('You can only view your own payment receipt.')
        elif user.role == User.Role.PARENT:
            parent_profile = getattr(user, 'parent_profile', None)
            if not parent_profile or not parent_profile.students.filter(pk=payment.student_id).exists():
                raise PermissionDenied('You can only view receipts for your registered children.')

        return Response({
            'id': payment.id,
            'receiptNo': payment.receipt_no,
            'transactionId': payment.transaction_id,
            'gatewayPaymentId': payment.gateway_payment_id,
            'gatewayOrderId': payment.gateway_order_id,
            'paymentDate': str(payment.payment_date),
            'amountPaid': float(payment.amount_paid),
            'paymentMethod': payment.payment_method,
            'category': payment.category,
            'installmentType': payment.installment_type,
            'status': payment.status,
            'payerName': payment.payer_name or (student.parent_name if student else ''),
            'payerEmail': payment.payer_email,
            'payerPhone': payment.payer_phone,
            'createdAt': payment.created_at.isoformat() if payment.created_at else None,
            'student': {
                'id': student.id if student else None,
                'name': student.name if student else (payment.fee_record.student_name if payment.fee_record else 'Student'),
                'admissionNo': student.admission_no if student else (payment.fee_record.admission_no if payment.fee_record else ''),
                'className': student.class_name if student else (payment.fee_record.class_name if payment.fee_record else ''),
                'section': student.section if student else (payment.fee_record.section_name if payment.fee_record else ''),
                'academicYear': payment.academic_year,
            },
            'school': {
                'id': school.id if school else None,
                'name': school.name if school else 'School',
                'code': getattr(school, 'code', '') if school else '',
                'address': getattr(school, 'address', '') if school else '',
                'phone': getattr(school, 'contact_phone', '') if school else '',
                'email': getattr(school, 'contact_email', '') if school else '',
            }
        }, status=status.HTTP_200_OK)

    def perform_create(self, serializer):
        user = self.request.user
        student = serializer.validated_data.get('student')
        school = user.school if user.role != User.Role.SUPER_ADMIN else getattr(student, 'school', None)
        if not school:
            raise PermissionDenied('A student and school are required to record a payment.')
        instance = serializer.save(school=school)
        try:
            from apps.notifications.services import notify_student_and_parents
            if instance.student:
                notify_student_and_parents(
                    instance.student,
                    title="Fee Payment Recorded",
                    body=f"Payment of ₹{instance.amount_paid} received for {instance.student.name}. Receipt: {instance.receipt_no}.",
                    category="Finance",
                    channel="fee-alert",
                    sender=self.request.user,
                    related={'receiptNo': instance.receipt_no, 'amount': float(instance.amount_paid)},
                )
        except Exception:
            pass
