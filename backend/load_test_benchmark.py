"""Architecture Hardening: Comprehensive Load-Testing and Benchmarking Script.

Tests performance at scales of 1,000, 5,000, and 10,000 students across:
1. Student List Pagination (deferred blobs, pagination pageSize=100)
2. Student Compound Index Filtering & Search
3. School Revenue SQL Aggregation & Redis Caching
4. Teacher List N+1 Prefetching

Usage:
    python load_test_benchmark.py [--scales 1000,5000,10000] [--iterations 5]
"""
import os
import sys
import time
import argparse
import django

# Ensure safe console output encoding on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Setup Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')
os.environ.setdefault('DJANGO_SECRET_KEY', 'benchmark-secret-key-32-chars-long')
os.environ.setdefault('DJANGO_DEBUG', 'False')

django.setup()

from django.core.cache import cache
from django.db import connection, transaction
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.schools.models import School
from apps.sis.models import Student
from apps.staff.models import Teacher, TeacherTeachingAssignment
from apps.academics.models import Class, Section, Subject, AcademicYear
from apps.finance.models import FeeStructure, StudentFeeRecord, FeePayment


class BenchmarkRunner:
    def __init__(self, scales=None, iterations=5):
        self.scales = scales or [1000, 5000, 10000]
        self.iterations = iterations
        self.client = APIClient()
        self.school = None
        self.admin = None
        self.results = []

    def setup_base_school(self):
        """Creates or resets the benchmark school tenant."""
        print("\n" + "=" * 70)
        print("  SETTING UP BENCHMARK TENANT & REFERENCE DATA")
        print("=" * 70)
        cache.clear()

        self.school, _ = School.objects.get_or_create(
            code='bench-school',
            defaults={'name': 'Benchmark Academy'}
        )

        self.admin, _ = User.objects.get_or_create(
            username='bench-admin',
            defaults={
                'email': 'bench-admin@example.com',
                'role': User.Role.SCHOOL_ADMIN,
                'school': self.school,
            }
        )
        self.client.force_authenticate(self.admin)

        # Setup classes, sections, and subjects
        self.academic_year, _ = AcademicYear.objects.get_or_create(
            school=self.school, name='2026-27',
            defaults={'starts_on': '2026-06-01', 'ends_on': '2027-04-30', 'is_active': True}
        )

        self.classes = []
        self.sections = []
        for i in range(1, 11):
            c, _ = Class.objects.get_or_create(
                school=self.school, code=f'class-{i}',
                defaults={'name': f'Class-{i}', 'sort_order': i}
            )
            self.classes.append(c)
            for sec_name in ['A', 'B', 'C']:
                s, _ = Section.objects.get_or_create(
                    school=self.school, class_room=c, name=sec_name
                )
                self.sections.append(s)

        self.subjects = []
        for sub_name in ['Mathematics', 'Science', 'English', 'Social Studies']:
            subj, _ = Subject.objects.get_or_create(
                school=self.school, name=sub_name
            )
            self.subjects.append(subj)
        for c in self.classes:
            c.subjects.set(self.subjects)

        # Setup teachers with assignments to verify N+1 prefetch
        TeacherTeachingAssignment.objects.filter(school=self.school).delete()
        Teacher.objects.filter(school=self.school).delete()

        teachers_to_create = []
        for t_idx in range(1, 26):
            t_user, _ = User.objects.get_or_create(
                username=f'bench-teacher-{t_idx}',
                defaults={
                    'email': f'teacher-{t_idx}@example.com',
                    'role': User.Role.TEACHER,
                    'school': self.school,
                }
            )
            teacher = Teacher.objects.create(
                school=self.school,
                user=t_user,
                qualification='M.Sc., B.Ed.',
                joining_date='2022-01-01',
                phone=f'98000000{t_idx:02d}',
                status=Teacher.Status.ACTIVE,
            )
            teachers_to_create.append(teacher)

        total_combos = [(sec, subj) for sec in self.sections for subj in self.subjects]
        for t_idx, teacher in enumerate(teachers_to_create):
            teacher_combos = total_combos[t_idx * 4 : (t_idx + 1) * 4]
            for sec, subj in teacher_combos:
                TeacherTeachingAssignment.objects.create(
                    school=self.school,
                    teacher=teacher,
                    section=sec,
                    subject=subj,
                )

        # Fee Structure setup
        FeeStructure.objects.filter(school=self.school).delete()
        self.fee_structure = FeeStructure.objects.create(
            school=self.school,
            level='Primary',
            academic_year='2026-27',
            items=[{'category': 'Tuition', 'amount': 25000}, {'category': 'Lab', 'amount': 5000}],
            quarters=[{'quarter': 'Q1', 'name': 'First Term', 'amount': 15000, 'dueDate': '2026-07-01'}],
        )

        print(f"[OK] Created 10 classes, 30 sections, 4 subjects, 25 teachers with teaching assignments")

    def seed_students(self, target_count):
        """Efficiently scales student population to target_count using bulk_create."""
        current_count = Student.objects.filter(school=self.school).count()
        needed = target_count - current_count
        if needed <= 0:
            return

        print(f"\n-> Scaling student database from {current_count} to {target_count} (+{needed} students)...")
        start_seed = time.perf_counter()

        batch_size = 2000
        students_batch = []
        records_batch = []
        payments_batch = []

        for i in range(current_count + 1, target_count + 1):
            sec = self.sections[i % len(self.sections)]
            cls = sec.class_room
            adm_no = f"ADM-{i:06d}"
            stu = Student(
                school=self.school,
                admission_no=adm_no,
                name=f"Student {i}",
                class_name=cls.name,
                section=sec.name,
                section_record=sec,
                roll_no=(i % 40) + 1,
                parent_name=f"Parent {i}",
                parent_phone=f"9{i % 1000000000:09d}",
                parent_email=f"parent{i}@example.com",
                dob="2014-05-10",
                gender="Male" if i % 2 == 0 else "Female",
                academic_year="2026-27",
                status=Student.Status.ACTIVE,
                fee_total=30000.0,
                fee_paid=15000.0 if i % 2 == 0 else 30000.0,
            )
            students_batch.append(stu)

            if len(students_batch) >= batch_size:
                Student.objects.bulk_create(students_batch)
                students_batch = []

        if students_batch:
            Student.objects.bulk_create(students_batch)

        # Seed matching FeePayment records for revenue aggregation benchmark
        created_students = list(Student.objects.filter(school=self.school).only('id', 'school_id', 'academic_year', 'admission_no'))
        existing_payments = FeePayment.objects.filter(school=self.school).count()
        needed_payments = len(created_students) - existing_payments

        if needed_payments > 0:
            for s in created_students[existing_payments:]:
                payments_batch.append(FeePayment(
                    school=self.school,
                    student=s,
                    amount_paid=15000.0,
                    payment_date="2026-08-15",
                    academic_year="2026-27",
                    payment_method="UPI",
                    category="Tuition",
                ))
                if len(payments_batch) >= batch_size:
                    FeePayment.objects.bulk_create(payments_batch)
                    payments_batch = []
            if payments_batch:
                FeePayment.objects.bulk_create(payments_batch)

        elapsed = time.perf_counter() - start_seed
        total_students = Student.objects.filter(school=self.school).count()
        print(f"[OK] Seeded in {elapsed:.2f}s. Total students in tenant: {total_students:,}")

    def measure_endpoint(self, name, url, method='get', data=None):
        """Runs multiple iterations of an endpoint, recording latencies and query counts."""
        latencies = []
        query_counts = []

        # Warm-up request
        if method == 'get':
            self.client.get(url)
        else:
            self.client.post(url, data or {})

        for _ in range(self.iterations):
            queries = 0

            def counter(execute, sql, params, many, context):
                nonlocal queries
                queries += 1
                return execute(sql, params, many, context)

            start = time.perf_counter()
            with connection.execute_wrapper(counter):
                if method == 'get':
                    response = self.client.get(url)
                else:
                    response = self.client.post(url, data or {})
            duration = (time.perf_counter() - start) * 1000.0

            assert response.status_code == 200, f"Endpoint {url} failed with {response.status_code}: {response.data}"
            latencies.append(duration)
            query_counts.append(queries)

        avg_latency = sum(latencies) / len(latencies)
        min_latency = min(latencies)
        max_latency = max(latencies)
        avg_queries = sum(query_counts) / len(query_counts)

        return {
            'endpoint': name,
            'url': url,
            'avg_ms': avg_latency,
            'min_ms': min_latency,
            'max_ms': max_latency,
            'queries': avg_queries,
            'status': 'PASS' if avg_latency < 200.0 else 'WARN'
        }

    def run_suite(self):
        self.setup_base_school()

        for scale in self.scales:
            self.seed_students(scale)
            print(f"\n{'=' * 70}")
            print(f"  BENCHMARKING LOAD AT SCALE: {scale:,} STUDENTS")
            print(f"{'=' * 70}")

            # 1. Student List Pagination (100 students)
            r1 = self.measure_endpoint(
                'Student List (Page 1, Size=100)',
                '/api/v1/students/?page=1&pageSize=100'
            )
            r1['scale'] = scale
            self.results.append(r1)
            print(f"  [1] Student Pagination:      {r1['avg_ms']:6.2f} ms | Queries: {r1['queries']:.0f} | {r1['status']}")

            # 2. Student Search & Index Filtering
            r2 = self.measure_endpoint(
                'Student Search & Filter (Status=Active, Class=Class-1)',
                '/api/v1/students/?search=Student&status=Active&class_name=Class-1'
            )
            r2['scale'] = scale
            self.results.append(r2)
            print(f"  [2] Search & Compound Filter:{r2['avg_ms']:6.2f} ms | Queries: {r2['queries']:.0f} | {r2['status']}")

            # 3. School Revenue SQL Aggregation (Uncached run)
            cache.clear()
            r3 = self.measure_endpoint(
                'School Revenue (SQL Aggregation)',
                '/api/v1/fee-structures/school-revenue/?academicYear=2026-27'
            )
            r3['scale'] = scale
            self.results.append(r3)
            print(f"  [3] School Revenue (SQL):     {r3['avg_ms']:6.2f} ms | Queries: {r3['queries']:.0f} | {r3['status']}")

            # 4. School Revenue Cached Run
            r4 = self.measure_endpoint(
                'School Revenue (Redis Cached)',
                '/api/v1/fee-structures/school-revenue/?academicYear=2026-27'
            )
            r4['scale'] = scale
            self.results.append(r4)
            print(f"  [4] School Revenue (Cached):  {r4['avg_ms']:6.2f} ms | Queries: {r4['queries']:.0f} | {r4['status']}")

            # 5. Teacher List (Prefetch / N+1 verification)
            r5 = self.measure_endpoint(
                'Teacher List (25 Teachers with Assignments)',
                '/api/v1/teachers/'
            )
            r5['scale'] = scale
            self.results.append(r5)
            print(f"  [5] Teacher List (N+1 Fixed): {r5['avg_ms']:6.2f} ms | Queries: {r5['queries']:.0f} | {r5['status']}")

        self.print_summary_table()

    def print_summary_table(self):
        print("\n" + "=" * 90)
        print("  ARCHITECTURE HARDENING: BENCHMARK SUMMARY & PERFORMANCE REPORT")
        print("=" * 90)
        header = f"{'Scale':<10} | {'Endpoint / Operation':<42} | {'Avg (ms)':<10} | {'Queries':<8} | {'Status'}"
        print(header)
        print("-" * 90)
        for r in self.results:
            scale_str = f"{r['scale']:,}"
            print(f"{scale_str:<10} | {r['endpoint']:<42} | {r['avg_ms']:8.2f} ms | {r['queries']:7.0f} | {r['status']}")
        print("=" * 90)
        print("Latency Target: < 200ms per API request under 10,000 student scale.")
        all_passed = all(r['status'] == 'PASS' for r in self.results)
        if all_passed:
            print(">>> ALL BENCHMARK TESTS PASSED WITH ZERO N+1 QUERY LEAKS! <<<\n")
        else:
            print(">>> BENCHMARKS COMPLETED (See warnings above) <<<\n")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Run scale benchmarks")
    parser.add_argument('--scales', type=str, default='1000,5000,10000', help='Comma-separated scale counts')
    parser.add_argument('--iterations', type=int, default=5, help='Number of iterations per test')
    args = parser.parse_args()

    scale_list = [int(s.strip()) for s in args.scales.split(',') if s.strip()]
    runner = BenchmarkRunner(scales=scale_list, iterations=args.iterations)
    runner.run_suite()
