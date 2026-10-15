from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination


class StudentFeeRecordPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 500
import re
import datetime
from django.db.models import Q, Sum, Count
from django.core.cache import cache
from apps.accounts.models import User
from apps.common.tenancy import TenantScopedViewSet
from apps.finance.models import FeeStructure, FeeQuarter, StudentFeeRecord, FeePayment
from apps.finance.serializers import FeeStructureSerializer, FeeQuarterSerializer, StudentFeeRecordSerializer, FeePaymentSerializer
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
            if q_due and today_str > str(q_due):
                q_status = 'OVERDUE'
            else:
                q_status = 'PAYMENT_DUE'

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
        'hasStructure': True,
        'feeStructureId': fee_structure.id,
        'feeStructureName': fee_structure.name,
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
    permission_classes = [permissions.AllowAny]
    filterset_fields = ['level', 'academic_year', 'target_class', 'target_class_ref', 'target_section_ref']
    search_fields = ['name', 'target_class']
    ordering_fields = ['id', 'created_at', 'name']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
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
        self._sync_fee_structure_to_students(instance)
        if school:
            cache.delete(f"school_revenue_{school.id}_{getattr(instance, 'academic_year', '') or 'all'}")
            cache.delete(f"school_revenue_{school.id}_all")

    def perform_update(self, serializer):
        instance = serializer.save()
        self._sync_fee_structure_to_students(instance)
        school_id = getattr(instance, 'school_id', None)
        if school_id:
            cache.delete(f"school_revenue_{school_id}_{getattr(instance, 'academic_year', '') or 'all'}")
            cache.delete(f"school_revenue_{school_id}_all")

    def _sync_fee_structure_to_students(self, instance):
        """Syncs newly created or updated FeeStructure to all matching students in the school."""
        try:
            school_id = instance.school_id
            if not school_id:
                return
            students_qs = Student.objects.filter(school_id=school_id)
            if instance.level == 'class' and instance.target_class:
                clean_cls = re.sub(r'(class|cls)', '', instance.target_class, flags=re.IGNORECASE).strip(' -_')
                students_qs = students_qs.filter(
                    Q(class_name__iexact=instance.target_class) |
                    Q(class_name__iexact=f"Class {clean_cls}") |
                    Q(class_name__iexact=clean_cls) |
                    Q(class_name__icontains=clean_cls)
                )
            elif instance.level == 'section' and instance.target_section:
                clean_cls = re.sub(r'(class|cls)', '', instance.target_class or '', flags=re.IGNORECASE).strip(' -_')
                students_qs = students_qs.filter(
                    Q(section__iexact=instance.target_section),
                    (Q(class_name__iexact=clean_cls) if clean_cls else Q(pk__isnull=False))
                )
            elif instance.level == 'student' and instance.target_student_id:
                students_qs = students_qs.filter(Q(pk=instance.target_student_id) if str(instance.target_student_id).isdigit() else Q(admission_no=instance.target_student_id))

            for st in students_qs:
                rec, _ = StudentFeeRecord.objects.get_or_create(
                    school_id=school_id,
                    student=st,
                    defaults={
                        'student_id_str': str(st.id),
                        'student_name': st.name,
                        'admission_no': st.admission_no,
                        'class_name': st.class_name,
                        'section_name': st.section,
                        'academic_year': instance.academic_year or st.academic_year or '2026-2027',
                    }
                )
                summary = get_student_fee_summary(st)
                if summary:
                    Student.objects.filter(pk=st.pk).update(
                        fee_total=summary.get('totalFees', 0),
                        fee_paid=summary.get('totalPaid', 0)
                    )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Failed to auto-sync fee structure to students: %s", e)

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
        school_id = getattr(user, 'school_id', None)
        student_id = request.query_params.get('student_id')
        class_id = request.query_params.get('class_id')
        section_id = request.query_params.get('section_id')
        academic_year = request.query_params.get('academic_year')
        academic_year_id = request.query_params.get('academic_year_id')

        student = None
        if student_id:
            st_qs = Student.objects.all().select_related('section_record__class_room', 'school')
            if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
                st_qs = st_qs.filter(school_id=school_id)
            if str(student_id).isdigit():
                student = st_qs.filter(pk=student_id).first()
            if not student:
                student = st_qs.filter(admission_no=student_id).first()

        fs = resolve_fee_structure_for_student(student, academic_year=academic_year, academic_year_id=academic_year_id, school_id=school_id)
        if not fs and class_id:
            qs = FeeStructure.objects.all().prefetch_related('quarter_records')
            if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
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
        school_id = getattr(user, 'school_id', None)
        student_id = request.query_params.get('student_id')
        if not student_id and request.user.is_authenticated and hasattr(request.user, 'student_profile'):
            student_id = request.user.student_profile.student_id

        if not student_id:
            return Response({'error': 'student_id query parameter is required'}, status=status.HTTP_400_BAD_REQUEST)

        st_qs = Student.objects.all().select_related('section_record__class_room', 'school')
        if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
            st_qs = st_qs.filter(school_id=school_id)

        student = None
        if str(student_id).isdigit():
            student = st_qs.filter(pk=student_id).first()
        if not student:
            student = st_qs.filter(admission_no=student_id).first()

        if not student:
            return Response({'error': f'Student {student_id} not found'}, status=status.HTTP_404_NOT_FOUND)

        summary = get_student_fee_summary(student)
        return Response(summary, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='student-summaries')
    def student_summaries(self, request):
        """Returns fee summaries for students matching class/section filters, strictly isolated by school."""
        user = request.user
        school_id = getattr(user, 'school_id', None)
        class_id = request.query_params.get('class_id')
        section_id = request.query_params.get('section_id')
        academic_year = request.query_params.get('academic_year')

        qs = Student.objects.all().select_related('section_record__class_room', 'school')
        if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
            qs = qs.filter(school_id=school_id)

        if section_id:
            qs = qs.filter(section_record_id=section_id)
        if class_id:
            qs = qs.filter(section_record__class_room_id=class_id)
        if academic_year:
            qs = qs.filter(academic_year=academic_year)

        cached_structures = list(FeeStructure.objects.all().prefetch_related('quarter_records'))
        if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
            cached_structures = [fs for fs in cached_structures if fs.school_id == school_id or not fs.school_id]

        summaries = [get_student_fee_summary(st, cached_structures=cached_structures) for st in qs[:200]]
        return Response(summaries, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='school-revenue')
    def school_revenue(self, request):
        """Returns authoritative, aggregated school revenue, receivables, and monthly receipts from PostgreSQL."""
        user = request.user
        school_id = getattr(user, 'school_id', None)
        academic_year = request.query_params.get('academic_year')

        cache_key = f"school_revenue_{school_id}_{academic_year or 'all'}"
        cached_data = cache.get(cache_key)
        if cached_data:
            return Response(cached_data, status=status.HTTP_200_OK)

        students_qs = Student.objects.all()
        payments_qs = FeePayment.objects.all()

        if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
            students_qs = students_qs.filter(school_id=school_id)
            payments_qs = payments_qs.filter(school_id=school_id)

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
            'lastUpdated': datetime.datetime.now().isoformat(),
        }

        cache.set(cache_key, response_data, 60)
        return Response(response_data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='record-student-payment')
    def record_student_payment(self, request):
        """Records an actual payment transaction in the database for a student."""
        user = request.user
        school_id = getattr(user, 'school_id', None)
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
        if school_id and (not user.is_authenticated or user.role != User.Role.SUPER_ADMIN):
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
            quarter_obj = FeeQuarter.objects.filter(pk=quarter_id).first()

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
        from apps.staff.models import Teacher
        teacher = None
        if user.is_authenticated and hasattr(user, 'teacher_profile'):
            teacher = user.teacher_profile
        elif request.query_params.get('teacher_id'):
            teacher = Teacher.objects.filter(pk=request.query_params.get('teacher_id')).first()

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


class FeeQuarterViewSet(TenantScopedViewSet):
    school_field = 'fee_structure__school'
    queryset = FeeQuarter.objects.select_related('fee_structure').all().order_by('quarter_number')
    serializer_class = FeeQuarterSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
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
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StudentFeeRecordPagination

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return StudentFeeRecord.objects.none()
        school_id = getattr(user, 'school_id', None)

        qs = StudentFeeRecord.objects.select_related('student', 'school')
        if user.role != User.Role.SUPER_ADMIN and school_id:
            qs = qs.filter(school_id=school_id)

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
            quarter_obj = FeeQuarter.objects.filter(pk=quarter_id).first()

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
        student_id = request.data.get('student_id') or request.data.get('studentId')
        record_id = request.data.get('record_id') or request.data.get('recordId')
        user = request.user
        school_id = getattr(user, 'school_id', None)

        record = None
        if record_id and str(record_id).isdigit():
            record = StudentFeeRecord.objects.filter(pk=record_id).first()
        if not record and student_id:
            record = StudentFeeRecord.objects.filter(
                Q(student_id_str=str(student_id)) | Q(student__id=student_id if str(student_id).isdigit() else None) | Q(admission_no=str(student_id))
            ).first()

        if not record and student_id:
            st = Student.objects.filter(pk=student_id).first() if str(student_id).isdigit() else Student.objects.filter(admission_no=student_id).first()
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
    queryset = FeePayment.objects.select_related('student', 'quarter', 'fee_structure').all().order_by('-payment_date', '-created_at')
    serializer_class = FeePaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['student', 'academic_year', 'payment_method', 'category']
    search_fields = ['receipt_no', 'transaction_id', 'student__name', 'student__admission_no']
    ordering_fields = ['payment_date', 'created_at', 'amount_paid']

    def perform_create(self, serializer):
        instance = serializer.save(school=self.request.user.school)
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
