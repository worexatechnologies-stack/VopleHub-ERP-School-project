from django.test import TestCase
from rest_framework.test import APIClient
from apps.schools.models import School
from apps.academics.models import Class, Section, AcademicYear
from apps.sis.models import Student
from apps.finance.models import FeeStructure, FeeQuarter, StudentFeeRecord

class FeeStructureTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.school = School.objects.create(name='Test School', code='test-school')
        self.academic_year = AcademicYear.objects.create(
            school=self.school, name='2026-2027', starts_on='2026-04-01', ends_on='2027-03-31', is_active=True
        )
        self.class_1 = Class.objects.create(school=self.school, name='Class 1', code='class-1', sort_order=1)
        self.class_2 = Class.objects.create(school=self.school, name='Class 2', code='class-2', sort_order=2)
        self.section_1a = Section.objects.create(school=self.school, class_room=self.class_1, name='A')
        self.section_1b = Section.objects.create(school=self.school, class_room=self.class_1, name='B')

        self.student_1 = Student.objects.create(
            school=self.school,
            admission_no='ADM-101',
            name='Alice Smith',
            class_name='Class 1',
            section='A',
            section_record=self.section_1a,
            roll_no=1,
            parent_name='Bob Smith',
            parent_phone='9876543210',
            parent_email='bob@example.com',
            dob='2018-05-10',
            gender='Female',
            academic_year='2026-2027',
        )

    def test_fee_structure_creation_and_auto_quarters(self):
        items = [
            {'category': 'Tuition Fee', 'amount': 20000},
            {'category': 'Examination Fee', 'amount': 3000},
            {'category': 'Library Fee', 'amount': 2000},
            {'category': 'Activity Fee', 'amount': 5000},
            {'category': 'Lab Fee', 'amount': 3000},
            {'category': 'Sports Fee', 'amount': 2000},
        ]
        fs = FeeStructure.objects.create(
            school=self.school,
            name='Class 1 Standard Fee Structure',
            academic_year='2026-2027',
            academic_year_ref=self.academic_year,
            level='class',
            target_class_ref=self.class_1,
            items=items
        )

        self.assertEqual(fs.name, 'Class 1 Standard Fee Structure')
        self.assertEqual(fs.target_class, 'Class 1')
        self.assertEqual(fs.target_class_ref_id, self.class_1.id)

        quarters = FeeQuarter.objects.filter(fee_structure=fs).order_by('quarter_number')
        self.assertEqual(quarters.count(), 4)
        total_assigned = sum(q.assigned_amount for q in quarters)
        self.assertEqual(total_assigned, 35000)

    def test_resolution_priority_hierarchy(self):
        # 1. School-level structure
        school_fs = FeeStructure.objects.create(
            school=self.school,
            name='School Wide Default',
            academic_year='2026-2027',
            academic_year_ref=self.academic_year,
            level='school',
            items=[{'category': 'Base Tuition', 'amount': 10000}]
        )

        # 2. Class-level structure for Class 1
        class_fs = FeeStructure.objects.create(
            school=self.school,
            name='Class 1 Fee Structure',
            academic_year='2026-2027',
            academic_year_ref=self.academic_year,
            level='class',
            target_class_ref=self.class_1,
            items=[{'category': 'Class 1 Tuition', 'amount': 20000}]
        )

        # Resolve for Student 1 (in Class 1, Section A) -> should resolve to Class-level structure
        resp = self.client.get(f'/api/v1/fee-structures/resolve/?student_id={self.student_1.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['id'], class_fs.id)
        self.assertEqual(resp.data['name'], 'Class 1 Fee Structure')

        # 3. Create Section-level structure for Section 1A
        section_fs = FeeStructure.objects.create(
            school=self.school,
            name='Section 1-A Specialized Fee',
            academic_year='2026-2027',
            academic_year_ref=self.academic_year,
            level='section',
            target_class_ref=self.class_1,
            target_section_ref=self.section_1a,
            items=[{'category': 'Section 1A Tuition', 'amount': 25000}]
        )

        # Now resolving for Student 1 should give Section-level structure (Priority 2 > Priority 3)
        resp = self.client.get(f'/api/v1/fee-structures/resolve/?student_id={self.student_1.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['id'], section_fs.id)
        self.assertEqual(resp.data['name'], 'Section 1-A Specialized Fee')

        # 4. Create Student-level custom override for Student 1
        student_fs = FeeStructure.objects.create(
            school=self.school,
            name='Alice Custom Scholarship Fee',
            academic_year='2026-2027',
            academic_year_ref=self.academic_year,
            level='student',
            target_student_id=str(self.student_1.id),
            target_student_ref=self.student_1,
            items=[{'category': 'Special Tuition', 'amount': 5000}]
        )

        # Resolving for Student 1 should now give Student-level structure (Priority 1)
        resp = self.client.get(f'/api/v1/fee-structures/resolve/?student_id={self.student_1.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['id'], student_fs.id)
        self.assertEqual(resp.data['name'], 'Alice Custom Scholarship Fee')

        # Resolving for a student in Class 2 (no class or section structure) -> should fall back to School-level
        resp2 = self.client.get(f'/api/v1/fee-structures/resolve/?class_id={self.class_2.id}&academic_year=2026-2027')
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.data['id'], school_fs.id)

    def test_no_fee_structure_returns_null(self):
        # When no structures exist in DB
        resp = self.client.get(f'/api/v1/fee-structures/resolve/?class_id={self.class_2.id}&academic_year=2026-2027')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data.get('id'))
        self.assertEqual(resp.data.get('fee_structure'), None)

    def test_cascade_delete_quarters_when_fee_structure_deleted(self):
        items = [{'category': 'Tuition Fee', 'amount': 20000}]
        fs = FeeStructure.objects.create(
            name='Temporary Fee Structure',
            academic_year='2026-2027',
            level='class',
            target_class_ref=self.class_1,
            items=items
        )
        fs_id = fs.id
        self.assertEqual(FeeQuarter.objects.filter(fee_structure_id=fs_id).count(), 4)

        fs.delete()
        self.assertEqual(FeeQuarter.objects.filter(fee_structure_id=fs_id).count(), 0)

    def test_student_fee_summary_unconfigured(self):
        # When no structure is assigned to student
        resp = self.client.get(f'/api/v1/fee-structures/student-summary/?student_id={self.student_1.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['hasStructure'])
        self.assertEqual(resp.data['totalFees'], 0.0)
        self.assertEqual(resp.data['totalPaid'], 0.0)
        self.assertEqual(resp.data['balanceDue'], 0.0)
        self.assertEqual(resp.data['quartersPaid'], 0)
        self.assertEqual(resp.data['totalQuarters'], 0)

    def test_student_fee_summary_and_payment_recording(self):
        # 1. Create Class 1 Fee Structure with 35,000 total (4 quarters of 8,750 each)
        items = [
            {'category': 'Tuition Fee', 'amount': 25000},
            {'category': 'Lab Fee', 'amount': 5000},
            {'category': 'Sports Fee', 'amount': 5000},
        ]
        fs = FeeStructure.objects.create(
            school=self.school,
            name='Class 1 Annual Structure',
            academic_year='2026-2027',
            academic_year_ref=self.academic_year,
            level='class',
            target_class_ref=self.class_1,
            items=items
        )

        # 2. Check initial summary before any payments: Total=35,000, Paid=0, Balance=35,000, 0 of 4 Paid
        resp = self.client.get(f'/api/v1/fee-structures/student-summary/?student_id={self.student_1.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['hasStructure'])
        self.assertEqual(resp.data['totalFees'], 35000.0)
        self.assertEqual(resp.data['totalPaid'], 0.0)
        self.assertEqual(resp.data['balanceDue'], 35000.0)
        self.assertEqual(resp.data['quartersPaid'], 0)
        self.assertEqual(resp.data['totalQuarters'], 4)
        self.assertEqual(resp.data['paymentStatus'], 'UNPAID')

        # 3. Student makes a payment of 13,750 (8,750 covers Q1, 5,000 covers part of Q2)
        pay_resp = self.client.post('/api/v1/fee-structures/record-student-payment/', {
            'student_id': self.student_1.id,
            'amount_paid': 13750,
            'payment_method': 'UPI',
            'category': 'Tuition Payment',
            'installment_type': 'Q1 & Q2 partial',
        }, format='json')
        self.assertEqual(pay_resp.status_code, 201)

        summary = pay_resp.data['summary']
        self.assertEqual(summary['totalFees'], 35000.0)
        self.assertEqual(summary['totalPaid'], 13750.0)
        self.assertEqual(summary['balanceDue'], 21250.0)
        self.assertEqual(summary['quartersPaid'], 1)
        self.assertEqual(summary['totalQuarters'], 4)
        self.assertEqual(summary['paymentStatus'], 'PARTIALLY_PAID')

        quarters = summary['quarters']
        self.assertEqual(len(quarters), 4)
        # Q1: 8,750 paid -> status PAID
        self.assertEqual(quarters[0]['requiredAmount'], 8750.0)
        self.assertEqual(quarters[0]['amountPaid'], 8750.0)
        self.assertEqual(quarters[0]['remainingAmount'], 0.0)
        self.assertEqual(quarters[0]['status'], 'PAID')

        # Q2: 5,000 paid -> status PARTIALLY_PAID, remaining 3,750
        self.assertEqual(quarters[1]['requiredAmount'], 8750.0)
        self.assertEqual(quarters[1]['amountPaid'], 5000.0)
        self.assertEqual(quarters[1]['remainingAmount'], 3750.0)
        self.assertEqual(quarters[1]['status'], 'PARTIALLY_PAID')

        # Q3: 0 paid -> status PAYMENT_DUE, remaining 8,750
        self.assertEqual(quarters[2]['requiredAmount'], 8750.0)
        self.assertEqual(quarters[2]['amountPaid'], 0.0)
        self.assertEqual(quarters[2]['remainingAmount'], 8750.0)
        self.assertEqual(quarters[2]['status'], 'PAYMENT_DUE')

        # 4. Student pays the remaining 21,250 in full
        pay_resp2 = self.client.post('/api/v1/fee-structures/record-student-payment/', {
            'student_id': self.student_1.id,
            'amount_paid': 21250,
            'payment_method': 'Net Banking',
        }, format='json')
        self.assertEqual(pay_resp2.status_code, 201)

        summary2 = pay_resp2.data['summary']
        self.assertEqual(summary2['totalFees'], 35000.0)
        self.assertEqual(summary2['totalPaid'], 35000.0)
        self.assertEqual(summary2['balanceDue'], 0.0)
        self.assertEqual(summary2['quartersPaid'], 4)
        self.assertEqual(summary2['paymentStatus'], 'PAID')

    def test_demon_2_exact_acceptance_scenario(self):
        # 1. Demon-2 has Total Fee = 25,000 (4 quarters of 6,250 each)
        fs_25k = FeeStructure.objects.create(
            school=self.school,
            name='Class 1 25K Fee Structure',
            academic_year='2026-2027',
            academic_year_ref=self.academic_year,
            level='class',
            target_class_ref=self.class_1,
            items=[{'category': 'Tuition Fee', 'amount': 25000}]
        )
        demon_2 = Student.objects.create(
            school=self.school,
            admission_no='ADM-DEMON-2',
            name='Demon-2',
            class_name='Class 1',
            section='B',
            section_record=self.section_1b,
            roll_no=2,
            parent_name='Demon Parent',
            parent_phone='9999988888',
            dob='2018-01-01',
            gender='Male',
            academic_year='2026-2027',
            fee_total=25000,
            fee_paid=0
        )

        # 2. Before payment: All panels fetch student summary -> Paid: 0, Pending: 25,000, 0/4 Quarters Paid, UNPAID
        resp = self.client.get(f'/api/v1/fee-structures/student-summary/?student_id={demon_2.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['totalFees'], 25000.0)
        self.assertEqual(resp.data['totalPaid'], 0.0)
        self.assertEqual(resp.data['balanceDue'], 25000.0)
        self.assertEqual(resp.data['quartersPaid'], 0)
        self.assertEqual(resp.data['totalQuarters'], 4)
        self.assertEqual(resp.data['paymentStatus'], 'UNPAID')
        self.assertEqual(resp.data['quarters'][0]['amountPaid'], 0.0)
        self.assertEqual(resp.data['quarters'][0]['remainingAmount'], 6250.0)
        self.assertIn(resp.data['quarters'][0]['status'], ['PAYMENT_DUE', 'OVERDUE'])

        # 3. Parent pays Q1 (6,250)
        q1_obj = fs_25k.quarter_records.filter(quarter_number=1).first()
        pay_resp = self.client.post('/api/v1/fee-structures/record-student-payment/', {
            'student_id': demon_2.id,
            'amount_paid': 6250,
            'payment_method': 'UPI',
            'quarter_id': q1_obj.id if q1_obj else None,
            'installment_type': 'Q1 Payment',
        }, format='json')
        self.assertEqual(pay_resp.status_code, 201)

        summary = pay_resp.data['summary']
        self.assertEqual(summary['totalFees'], 25000.0)
        self.assertEqual(summary['totalPaid'], 6250.0)
        self.assertEqual(summary['balanceDue'], 18750.0)
        self.assertEqual(summary['quartersPaid'], 1)
        self.assertEqual(summary['quarters'][0]['status'], 'PAID')
        self.assertEqual(summary['quarters'][0]['amountPaid'], 6250.0)
        self.assertEqual(summary['quarters'][0]['remainingAmount'], 0.0)

        # 4. Partial payment for Q2: Parent pays 2,500 towards Q2
        pay_resp2 = self.client.post('/api/v1/fee-structures/record-student-payment/', {
            'student_id': demon_2.id,
            'amount_paid': 2500,
            'payment_method': 'Card',
            'installment_type': 'Q2 Partial',
        }, format='json')
        self.assertEqual(pay_resp2.status_code, 201)

        summary2 = pay_resp2.data['summary']
        self.assertEqual(summary2['totalFees'], 25000.0)
        self.assertEqual(summary2['totalPaid'], 8750.0)
        self.assertEqual(summary2['balanceDue'], 16250.0)
        self.assertEqual(summary2['quartersPaid'], 1)
        self.assertEqual(summary2['quarters'][0]['status'], 'PAID')
        self.assertEqual(summary2['quarters'][1]['status'], 'PARTIALLY_PAID')
        self.assertEqual(summary2['quarters'][1]['amountPaid'], 2500.0)
        self.assertEqual(summary2['quarters'][1]['remainingAmount'], 3750.0)

    def test_school_tenant_data_isolation(self):
        """Verify strict multi-tenant school isolation:
        - Admin 1 only sees School 1's 5 students and fee structures
        - Admin 2 only sees School 2's 7 students and fee structures
        - Cross-school contamination is strictly prevented across all queries
        """
        from apps.accounts.models import User
        school_1 = School.objects.create(name='School 1', code='SCH-1')
        school_2 = School.objects.create(name='School 2', code='SCH-2')

        admin_1 = User.objects.create_user(
            username='admin1', email='admin1@sch1.edu', password='password123', role=User.Role.SCHOOL_ADMIN, school=school_1
        )
        admin_2 = User.objects.create_user(
            username='admin2', email='admin2@sch2.edu', password='password123', role=User.Role.SCHOOL_ADMIN, school=school_2
        )

        ay_1 = AcademicYear.objects.create(school=school_1, name='2026-2027', starts_on='2026-04-01', ends_on='2027-03-31', is_active=True)
        ay_2 = AcademicYear.objects.create(school=school_2, name='2026-2027', starts_on='2026-04-01', ends_on='2027-03-31', is_active=True)

        class_1_s1 = Class.objects.create(school=school_1, name='Class 1', code='c1-s1')
        class_1_s2 = Class.objects.create(school=school_2, name='Class 1', code='c1-s2')

        sec_1a_s1 = Section.objects.create(school=school_1, class_room=class_1_s1, name='A')
        sec_1a_s2 = Section.objects.create(school=school_2, class_room=class_1_s2, name='A')

        # School 1: Create exactly 5 students in Class 1
        for i in range(1, 6):
            student = Student.objects.create(
                school=school_1,
                admission_no=f'S1-ADM-{i}',
                name=f'S1 Student {i}',
                class_name='Class 1',
                section='A',
                section_record=sec_1a_s1,
                roll_no=i,
                dob='2018-05-10',
                gender='Female',
                academic_year='2026-2027'
            )
            StudentFeeRecord.objects.create(
                school=school_1, student=student, student_id_str=str(student.pk),
                student_name=student.name, admission_no=student.admission_no,
                class_name=student.class_name, section_name=student.section,
                academic_year=student.academic_year,
            )

        # School 2: Create exactly 7 students in Class 1
        for i in range(1, 8):
            student = Student.objects.create(
                school=school_2,
                admission_no=f'S2-ADM-{i}',
                name=f'S2 Student {i}',
                class_name='Class 1',
                section='A',
                section_record=sec_1a_s2,
                roll_no=i,
                dob='2018-05-10',
                gender='Female',
                academic_year='2026-2027'
            )
            StudentFeeRecord.objects.create(
                school=school_2, student=student, student_id_str=str(student.pk),
                student_name=student.name, admission_no=student.admission_no,
                class_name=student.class_name, section_name=student.section,
                academic_year=student.academic_year,
            )

        # Fee Structure for School 1
        fs_1 = FeeStructure.objects.create(
            school=school_1,
            name='School 1 Class 1 Fee',
            level='class',
            target_class_ref=class_1_s1,
            target_class='Class 1',
            items=[{'category': 'Tuition', 'amount': 15000}]
        )

        # Fee Structure for School 2
        fs_2 = FeeStructure.objects.create(
            school=school_2,
            name='School 2 Class 1 Fee',
            level='class',
            target_class_ref=class_1_s2,
            target_class='Class 1',
            items=[{'category': 'Tuition', 'amount': 30000}]
        )

        # 1. Test Admin 1 querying fee structures -> Only returns fs_1
        self.client.force_authenticate(user=admin_1)
        resp_fs1 = self.client.get('/api/v1/fee-structures/')
        self.assertEqual(resp_fs1.status_code, 200)
        fs1_rows = resp_fs1.data.get('results', resp_fs1.data)
        fs1_ids = [item['id'] for item in fs1_rows]
        self.assertIn(fs_1.id, fs1_ids)
        self.assertNotIn(fs_2.id, fs1_ids)

        # 2. Test Admin 1 querying fee records -> Returns ONLY 5 students from School 1
        resp_rec1 = self.client.get('/api/v1/fee-records/')
        self.assertEqual(resp_rec1.status_code, 200)
        rec1_rows = resp_rec1.data.get('results', resp_rec1.data)
        self.assertEqual(len(rec1_rows), 5)
        for rec in rec1_rows:
            self.assertTrue(rec['admission_no'].startswith('S1-ADM-'))

        # 3. Test Admin 1 querying student-summaries -> Returns ONLY 5 students from School 1
        resp_sum1 = self.client.get('/api/v1/fee-structures/student-summaries/')
        self.assertEqual(resp_sum1.status_code, 200)
        self.assertEqual(len(resp_sum1.data), 5)
        for s in resp_sum1.data:
            self.assertTrue(s['admissionNo'].startswith('S1-ADM-'))
            self.assertEqual(s['totalFees'], 15000.0)

        # 4. Test Admin 2 querying fee structures -> Only returns fs_2
        self.client.force_authenticate(user=admin_2)
        resp_fs2 = self.client.get('/api/v1/fee-structures/')
        self.assertEqual(resp_fs2.status_code, 200)
        fs2_rows = resp_fs2.data.get('results', resp_fs2.data)
        fs2_ids = [item['id'] for item in fs2_rows]
        self.assertIn(fs_2.id, fs2_ids)
        self.assertNotIn(fs_1.id, fs2_ids)

        # 5. Test Admin 2 querying fee records -> Returns ONLY 7 students from School 2
        resp_rec2 = self.client.get('/api/v1/fee-records/')
        self.assertEqual(resp_rec2.status_code, 200)
        rec2_rows = resp_rec2.data.get('results', resp_rec2.data)
        self.assertEqual(len(rec2_rows), 7)
        for rec in rec2_rows:
            self.assertTrue(rec['admission_no'].startswith('S2-ADM-'))

        # 6. Test Admin 2 querying student-summaries -> Returns ONLY 7 students from School 2
        resp_sum2 = self.client.get('/api/v1/fee-structures/student-summaries/')
        self.assertEqual(resp_sum2.status_code, 200)
        self.assertEqual(len(resp_sum2.data), 7)
        for s in resp_sum2.data:
            self.assertTrue(s['admissionNo'].startswith('S2-ADM-'))
            self.assertEqual(s['totalFees'], 30000.0)

        # 7. Test Admin 1 querying school-revenue with students having fee_total=0 (fallback calculation)
        self.client.force_authenticate(user=admin_1)
        resp_rev1 = self.client.get('/api/v1/fee-structures/school-revenue/')
        self.assertEqual(resp_rev1.status_code, 200)
        self.assertIn('totalRevenue', resp_rev1.data)
        self.assertIn('totalInvoiced', resp_rev1.data)
        self.assertEqual(resp_rev1.data['totalInvoiced'], 5 * 15000.0)
        self.assertEqual(resp_rev1.data['studentsCount'], 5)
        self.assertEqual(resp_rev1.data['paidCount'], 0)
        self.assertEqual(resp_rev1.data['unpaidCount'], 5)

    def test_fee_structure_total_amount_property(self):
        from apps.accounts.models import User
        admin_user = User.objects.create_user(
            username='admin_ta', email='admin_ta@test.edu', password='password123',
            role=User.Role.SCHOOL_ADMIN, school=self.school
        )
        self.client.force_authenticate(user=admin_user)

        # 1. Total amount from items
        fs_items = FeeStructure.objects.create(
            school=self.school,
            name='Items Fee Structure',
            academic_year='2026-2027',
            items=[
                {'category': 'Tuition', 'amount': 25000},
                {'category': 'Lab', 'amount': 5000},
            ]
        )
        self.assertEqual(fs_items.total_amount, 30000.0)

        # 2. Total amount serialized in API
        resp = self.client.get(f'/api/v1/fee-structures/{fs_items.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['total_amount'], 30000.0)

        # 3. Empty fee structure returns 0.0 without errors
        fs_empty = FeeStructure.objects.create(
            school=self.school,
            name='Empty Fee Structure',
            academic_year='2026-2027',
            items=[]
        )
        self.assertEqual(fs_empty.total_amount, 0.0)


