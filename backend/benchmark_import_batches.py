import os
import sys
import time
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.test.utils import CaptureQueriesContext
from django.db import connection
from apps.schools.models import School
from apps.accounts.models import User
from apps.academics.models import AcademicYear, Class, Section
from apps.sis.models import Student
from rest_framework.test import APIClient

def run_benchmark():
    print("=" * 70)
    print("BULK IMPORT BENCHMARK: BATCH SIZES 500 vs 1,000 vs 2,000")
    print("=" * 70)

    # Setup isolated test tenant
    school_code = f"bench-{int(time.time())}"
    school = School.objects.create(name=f"Bench School {school_code}", code=school_code, subdomain=school_code)
    admin = User.objects.create_user(
        username=f"admin-{school_code}",
        email=f"admin@{school_code}.edu",
        password="Password123!",
        role=User.Role.SCHOOL_ADMIN,
        school=school,
    )
    ay = AcademicYear.objects.create(
        school=school,
        name='2026-2027',
        starts_on='2026-04-01',
        ends_on='2027-03-31',
        is_active=True,
    )
    c1 = Class.objects.create(school=school, name='Class 1', code='class-1')
    s1 = Section.objects.create(school=school, class_room=c1, name='A')

    client = APIClient()
    client.force_authenticate(admin)

    batch_sizes = [500, 1000, 2000]
    total_test_rows = 2000

    results = []

    for bs in batch_sizes:
        # Generate rows
        rows = []
        for i in range(1, total_test_rows + 1):
            rows.append({
                'name': f'Benchmark Student {bs}_{i}',
                'admission_no': f'B{bs}-{i:06d}',
                'class_name': 'Class 1',
                'section': 'A',
                'roll_no': i,
                'parent_name': f'Parent {bs}_{i}',
                'parent_phone': f'99{i:08d}'[-10:],
                'parent_email': f'p_{bs}_{i}@gmail.com',
                'dob': '2015-01-01',
                'gender': 'Male' if i % 2 == 0 else 'Female',
            })

        payload = {
            'students': rows,
            'academicYear': '2026-2027',
            'jobId': f'bench-job-{bs}',
            'batchNumber': 1,
            'totalBatches': 1,
            'batchSize': bs,
        }

        # Measure queries & time
        t0 = time.time()
        with CaptureQueriesContext(connection) as query_context:
            res = client.post('/api/v1/students/bulk-import/', data=payload, format='json')
        t1 = time.time()

        duration = t1 - t0
        rows_per_sec = total_test_rows / duration if duration > 0 else 0
        query_count = len(query_context.captured_queries)

        success = res.status_code == 201 and res.data.get('createdCount') == total_test_rows

        results.append({
            'batch_size': bs,
            'total_rows': total_test_rows,
            'duration_s': round(duration, 3),
            'rows_per_sec': round(rows_per_sec, 1),
            'query_count': query_count,
            'status_code': res.status_code,
            'success': success,
        })

        print(f"Batch Size {bs:4d}: {total_test_rows} rows in {duration:.3f}s ({rows_per_sec:.1f} rows/s) | {query_count} DB Queries | Success: {success}")

    print("\n" + "=" * 70)
    print("BENCHMARK SUMMARY TABLE")
    print("=" * 70)
    print(f"{'Batch Size':<12} | {'Rows':<8} | {'Duration (s)':<14} | {'Throughput (rows/s)':<20} | {'DB Queries':<10}")
    print("-" * 70)
    for r in results:
        print(f"{r['batch_size']:<12} | {r['total_rows']:<8} | {r['duration_s']:<14} | {r['rows_per_sec']:<20} | {r['query_count']:<10}")
    print("=" * 70)

    # 10,000 Rows Simulation in 10 batches of 1,000 rows (User's Exact Workload)
    print("\n" + "=" * 70)
    print("USER PRODUCTION SIMULATION: 10,000 ROWS IN 10 BATCHES OF 1,000 ROWS")
    print("=" * 70)
    total_10k_time = 0
    total_10k_queries = 0
    total_created_10k = 0
    job_id_10k = f"sim-10k-{int(time.time())}"

    for b in range(1, 11):
        chunk_rows = []
        for i in range(1, 1001):
            idx = (b - 1) * 1000 + i
            chunk_rows.append({
                'name': f'Student 10K {idx}',
                'admission_no': f'10K-{idx:06d}',
                'class_name': 'Class 1',
                'section': 'A',
                'parent_name': f'Parent {idx}',
                'parent_phone': f'91{idx:08d}'[-10:],
                'parent_email': f'p_10k_{idx}@volpe.edu',
                'dob': '2016-05-10',
                'gender': 'Female' if idx % 2 == 0 else 'Male',
            })
        payload_10k = {
            'students': chunk_rows,
            'academicYear': '2026-2027',
            'jobId': job_id_10k,
            'batchNumber': b,
            'totalBatches': 10,
            'batchSize': 1000,
        }
        tb0 = time.time()
        with CaptureQueriesContext(connection) as query_context_10k:
            res_b = client.post('/api/v1/students/bulk-import/', data=payload_10k, format='json')
        tb1 = time.time()
        b_dur = tb1 - tb0
        b_queries = len(query_context_10k.captured_queries)
        b_created = res_b.data.get('createdCount', 0) if res_b.status_code == 201 else 0

        total_10k_time += b_dur
        total_10k_queries += b_queries
        total_created_10k += b_created

        print(f"Batch {b:2d}/10: 1,000 rows imported in {b_dur:.3f}s | {b_queries} queries | Status: {res_b.status_code}")

    print("-" * 70)
    overall_speed = total_created_10k / total_10k_time if total_10k_time > 0 else 0
    print(f"10,000 ROWS TOTAL TIME : {total_10k_time:.2f} seconds")
    print(f"OVERALL THROUGHPUT      : {overall_speed:.1f} rows/second")
    print(f"TOTAL DATABASE QUERIES  : {total_10k_queries} (avg {total_10k_queries/10:.1f} per batch)")
    print(f"TOTAL INSERTED ROWS     : {total_created_10k} / 10,000")
    print("=" * 70)

if __name__ == '__main__':
    run_benchmark()
