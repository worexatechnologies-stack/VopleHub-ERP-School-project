from django.db import models
from apps.schools.models import School
from apps.sis.models import Student

class FeeStructure(models.Model):
    LEVEL_CHOICES = [
        ('school', 'School'),
        ('class', 'Class'),
        ('section', 'Section'),
        ('student', 'Student'),
    ]

    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name='fee_structures', null=True, blank=True)
    name = models.CharField(max_length=255)
    academic_year = models.CharField(max_length=50, default='2026-2027')
    academic_year_ref = models.ForeignKey('academics.AcademicYear', on_delete=models.SET_NULL, null=True, blank=True, related_name='fee_structures')
    level = models.CharField(max_length=50, choices=LEVEL_CHOICES, default='class')
    target_class = models.CharField(max_length=50, blank=True, null=True)
    target_class_ref = models.ForeignKey('academics.Class', on_delete=models.SET_NULL, null=True, blank=True, related_name='fee_structures')
    target_section = models.CharField(max_length=50, blank=True, null=True)
    target_section_ref = models.ForeignKey('academics.Section', on_delete=models.SET_NULL, null=True, blank=True, related_name='fee_structures')
    target_student_id = models.CharField(max_length=50, blank=True, null=True)
    target_student_ref = models.ForeignKey('sis.Student', on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_fee_structures')
    items = models.JSONField(default=list, help_text="List of component items: [{category, amount}]")
    quarters = models.JSONField(default=list, help_text="List of quarterly schedules: [{quarter, name, amount, dueDate}]")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if self.target_section_ref:
            if not self.target_class_ref:
                self.target_class_ref = self.target_section_ref.class_room
            if not self.target_section:
                self.target_section = self.target_section_ref.name
        if self.target_class_ref and not self.target_class:
            self.target_class = self.target_class_ref.name
        if self.academic_year_ref and not self.academic_year:
            self.academic_year = self.academic_year_ref.name
        super().save(*args, **kwargs)
        self.sync_quarters()

    def sync_quarters(self):
        total_fee = sum(float(item.get('amount', 0)) for item in (self.items or []))
        q1_amt = round(total_fee * 0.25, 2)
        q2_amt = round(total_fee * 0.25, 2)
        q3_amt = round(total_fee * 0.25, 2)
        q4_amt = round(total_fee - (q1_amt * 3), 2)

        q_specs = [
            {'number': 1, 'name': 'Quarter 1 (Apr - Jun)', 'amount': q1_amt, 'due_date': '2026-04-15'},
            {'number': 2, 'name': 'Quarter 2 (Jul - Sep)', 'amount': q2_amt, 'due_date': '2026-07-15'},
            {'number': 3, 'name': 'Quarter 3 (Oct - Dec)', 'amount': q3_amt, 'due_date': '2026-10-15'},
            {'number': 4, 'name': 'Quarter 4 (Jan - Mar)', 'amount': q4_amt, 'due_date': '2027-01-15'},
        ]

        if self.quarters and len(self.quarters) >= 4:
            for idx, q_data in enumerate(self.quarters[:4]):
                if isinstance(q_data, dict):
                    if q_data.get('name'):
                        q_specs[idx]['name'] = q_data['name']
                    if q_data.get('amount') is not None:
                        q_specs[idx]['amount'] = float(q_data['amount'])
                    if q_data.get('dueDate'):
                        q_specs[idx]['due_date'] = q_data['dueDate']

        quarters_json = []
        for spec in q_specs:
            due_d = spec['due_date'] if spec['due_date'] else None
            q_obj, created = FeeQuarter.objects.get_or_create(
                fee_structure=self,
                quarter_number=spec['number'],
                defaults={
                    'target_class': self.target_class,
                    'academic_year': self.academic_year,
                    'quarter_name': spec['name'],
                    'assigned_amount': spec['amount'],
                    'paid_amount': 0,
                    'remaining_amount': spec['amount'],
                    'payment_status': 'Unpaid',
                    'due_date': due_d
                }
            )
            if not created:
                q_obj.target_class = self.target_class
                q_obj.academic_year = self.academic_year
                q_obj.quarter_name = spec['name']
                q_obj.assigned_amount = spec['amount']
                q_obj.remaining_amount = max(0, float(q_obj.assigned_amount) - float(q_obj.paid_amount))
                if float(q_obj.remaining_amount) == 0 and float(q_obj.assigned_amount) > 0:
                    q_obj.payment_status = 'Paid'
                elif float(q_obj.paid_amount) > 0:
                    q_obj.payment_status = 'Partially Paid'
                else:
                    q_obj.payment_status = 'Unpaid'
                if due_d:
                    q_obj.due_date = due_d
                q_obj.save()

            quarters_json.append({
                'id': q_obj.id,
                'quarter': f"Q{q_obj.quarter_number}",
                'name': q_obj.quarter_name,
                'amount': float(q_obj.assigned_amount),
                'paidAmount': float(q_obj.paid_amount),
                'remainingAmount': float(q_obj.remaining_amount),
                'paymentStatus': q_obj.payment_status,
                'dueDate': str(q_obj.due_date) if q_obj.due_date else ''
            })

        # Update JSON field without triggering recursion
        FeeStructure.objects.filter(id=self.id).update(quarters=quarters_json)

    @property
    def total_amount(self):
        """Calculates total fee amount from items, quarters, or quarter records."""
        if self.items:
            try:
                item_sum = sum(float(item.get('amount', 0) or 0) for item in self.items if isinstance(item, dict))
                if item_sum > 0:
                    return float(item_sum)
            except (ValueError, TypeError):
                pass

        if self.quarters:
            try:
                quarter_sum = sum(float(q.get('amount', 0) or 0) for q in self.quarters if isinstance(q, dict))
                if quarter_sum > 0:
                    return float(quarter_sum)
            except (ValueError, TypeError):
                pass

        try:
            records = getattr(self, 'quarter_records', None)
            if records is not None:
                all_records = records.all()
                if all_records:
                    return float(sum(float(r.assigned_amount or 0) for r in all_records))
        except Exception:
            pass

        return 0.0

    class Meta:
        indexes = [
            models.Index(fields=['school', 'academic_year']),
            models.Index(fields=['school', 'level']),
        ]

    def __str__(self):
        return f"{self.name} ({self.academic_year})"

class FeeQuarter(models.Model):
    fee_structure = models.ForeignKey(FeeStructure, on_delete=models.CASCADE, related_name='quarter_records')
    target_class = models.CharField(max_length=50, blank=True, null=True)
    academic_year = models.CharField(max_length=50, default='2026-2027')
    quarter_number = models.IntegerField(default=1)
    quarter_name = models.CharField(max_length=100)
    assigned_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    remaining_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_status = models.CharField(max_length=50, default='Unpaid')
    due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.fee_structure.name} - Q{self.quarter_number} ({self.quarter_name})"


class StudentFeeRecord(models.Model):
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name='student_fee_records', null=True, blank=True)
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='fee_records', null=True, blank=True)
    student_id_str = models.CharField(max_length=100)
    student_name = models.CharField(max_length=255)
    admission_no = models.CharField(max_length=100)
    class_name = models.CharField(max_length=50)
    section_name = models.CharField(max_length=50)
    academic_year = models.CharField(max_length=50, default='2026-2027')
    scholarship = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    transport_charges = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    hostel_charges = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    fine_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    installments_paid = models.IntegerField(default=0)
    custom_items = models.JSONField(default=list, blank=True, null=True)
    custom_quarters = models.JSONField(default=list, blank=True, null=True)
    payment_history = models.JSONField(default=list, help_text="List of payments: [{id, paymentDate, amountPaid, paymentMethod, transactionId, receiptNo, category, installmentType}]")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['school', 'academic_year']),
            models.Index(fields=['student', 'academic_year']),
            models.Index(fields=['school', 'admission_no']),
            models.Index(fields=['school', 'class_name', 'section_name']),
            models.Index(fields=['school', 'class_name', 'student_name'], name='fee_rec_sch_cls_st_idx'),
        ]

    def __str__(self):
        return f"{self.student_name} ({self.admission_no}) - Fee Record"

class FeePayment(models.Model):
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name='fee_payments', null=True, blank=True)
    fee_record = models.ForeignKey(StudentFeeRecord, on_delete=models.CASCADE, related_name='payments', null=True, blank=True)
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='fee_payments', null=True, blank=True)
    fee_structure = models.ForeignKey(FeeStructure, on_delete=models.SET_NULL, related_name='payments', null=True, blank=True)
    quarter = models.ForeignKey(FeeQuarter, on_delete=models.SET_NULL, related_name='payments', null=True, blank=True)
    academic_year = models.CharField(max_length=50, default='2026-2027')
    payment_date = models.DateField()
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2)
    payment_method = models.CharField(max_length=50)
    transaction_id = models.CharField(max_length=100)
    receipt_no = models.CharField(max_length=100)
    category = models.CharField(max_length=100, blank=True, default='School Fee Payment')
    installment_type = models.CharField(max_length=100, blank=True, default='Custom')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['school', 'payment_date']),
            models.Index(fields=['school', 'academic_year']),
            models.Index(fields=['school', 'academic_year', 'payment_date'], name='fee_pmt_sch_yr_dt_idx'),
            models.Index(fields=['student', 'payment_date']),
            models.Index(fields=['fee_record']),
            models.Index(fields=['school', '-payment_date', '-created_at'], name='fee_pmt_sch_dt_cr_idx'),
        ]

    def __str__(self):
        return f"Payment {self.receipt_no} - ₹{self.amount_paid}"
