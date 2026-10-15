import os
import sys
import time
import json
import django

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from django.db import connection, reset_queries
from rest_framework.test import APIClient
from apps.accounts.models import User
from apps.schools.models import School

def benchmark_all():
    client = APIClient()
    # Find an admin user or create one
    admin = User.objects.filter(role=User.Role.SCHOOL_ADMIN).first()
    if not admin:
        school = School.objects.first()
        admin = User.objects.create(
            username='audit_admin',
            email='audit_admin@example.com',
            role=User.Role.SCHOOL_ADMIN,
            school=school
        )
    client.force_authenticate(user=admin)

    # Also find a teacher user for teacher-specific endpoints
    teacher_user = User.objects.filter(role=User.Role.TEACHER).first()

    endpoints = [
        ("Exam Schedules (Admin)", "/api/v1/exam-schedules/", client),
        ("Attendance Records (Admin)", "/api/v1/attendance/?date=2026-10-09", client),
        ("Student Fee Records", "/api/v1/fee-records/", client),
        ("Fee Payments", "/api/v1/fee-payments/", client),
        ("Fee Structures", "/api/v1/fee-structures/", client),
        ("Chat Conversations", "/api/v1/chat/conversations/", client),
        ("Notifications List", "/api/v1/notifications/", client),
        ("Homework List", "/api/v1/homework/", client),
        ("Students List (P1)", "/api/v1/students/?page=1", client),
        ("Teachers List (P1)", "/api/v1/teachers/?page=1", client),
        ("School Revenue", "/api/v1/fee-structures/school-revenue/", client),
    ]

    if teacher_user:
        teacher_client = APIClient()
        teacher_client.force_authenticate(user=teacher_user)
        endpoints.append(("Exam Schedules (Teacher)", "/api/v1/exam-schedules/", teacher_client))
        endpoints.append(("Attendance Records (Teacher)", "/api/v1/attendance/?date=2026-10-09", teacher_client))

    print("\n" + "=" * 90)
    print(f"{'ENDPOINT':<32} | {'STATUS':<6} | {'QUERIES':<8} | {'DB TIME (ms)':<12} | {'API TIME (ms)':<14} | {'RESP SIZE':<10}")
    print("=" * 90)

    results = []

    for name, url, cl in endpoints:
        # Warmup
        cl.get(url)

        # Measure 3 runs
        latencies = []
        db_times = []
        query_counts = []
        resp_size = 0
        last_status = 200

        for _ in range(3):
            reset_queries()
            queries = 0
            query_time = 0.0

            def counter(execute, sql, params, many, context):
                nonlocal queries, query_time
                q_start = time.perf_counter()
                res = execute(sql, params, many, context)
                query_time += (time.perf_counter() - q_start) * 1000.0
                queries += 1
                return res

            start = time.perf_counter()
            with connection.execute_wrapper(counter):
                resp = cl.get(url)
            total_duration = (time.perf_counter() - start) * 1000.0

            last_status = resp.status_code
            latencies.append(total_duration)
            db_times.append(query_time)
            query_counts.append(queries)
            resp_size = len(resp.content) if hasattr(resp, 'content') else 0

        avg_lat = sum(latencies) / len(latencies)
        avg_db = sum(db_times) / len(db_times)
        avg_q = sum(query_counts) / len(query_counts)

        size_kb = f"{resp_size / 1024:.1f} KB" if resp_size > 1024 else f"{resp_size} B"

        print(f"{name:<32} | {last_status:<6} | {avg_q:<8.0f} | {avg_db:<12.2f} | {avg_lat:<14.2f} | {size_kb:<10}")
        results.append({
            'name': name,
            'url': url,
            'status': last_status,
            'queries': round(avg_q),
            'db_time': round(avg_db, 2),
            'api_time': round(avg_lat, 2),
            'resp_size': size_kb,
        })

    print("=" * 90)

if __name__ == '__main__':
    benchmark_all()
