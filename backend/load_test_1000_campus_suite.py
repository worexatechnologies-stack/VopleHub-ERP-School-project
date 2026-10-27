"""
Comprehensive 1,000-User Campus Load Test Suite.
Scenarios:
- Scenario A: Gradual Login Ramp (1,000 distinct students logging in over 60 seconds from shared IP)
- Scenario B: Sudden Login Burst (300 concurrent students hitting login in a 2-second window)
- Scenario C: Normal School Activity (1,000 students browsing API concurrently with Admin CRUD)
- Scenario D: Administrative Bulk Import under concurrent student traffic
- Scenario E: Sustained Concurrency (100 concurrent users with think-time)
"""
import os
import sys
import time
import json
import random
import argparse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from apps.accounts.models import User
from apps.schools.models import School
from apps.academics.models import Class, Section, AcademicYear
from apps.sis.models import Student
from rest_framework_simplejwt.tokens import RefreshToken

SHARED_CAMPUS_IP = "203.0.113.195"
BASE_URL = os.environ.get('LOAD_TEST_BASE_URL', 'http://web:80' if os.path.exists('/.dockerenv') else 'http://localhost:3001')


def send_http_request(url, method='GET', data=None, token=None, ip=SHARED_CAMPUS_IP, timeout=15):
    body_bytes = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(url, data=body_bytes, method=method)
    req.add_header('X-Forwarded-For', ip)
    req.add_header('User-Agent', 'VolpehubCampusBenchmark/2.0')
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')

    start = time.perf_counter()
    status_code = None
    response_body = None
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status_code = resp.status
            response_body = resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        status_code = e.code
        try:
            response_body = e.read().decode('utf-8')
        except Exception:
            pass
    except Exception as e:
        status_code = 599
        response_body = str(e)

    duration_ms = (time.perf_counter() - start) * 1000.0
    return {
        'status': status_code,
        'duration_ms': duration_ms,
        'body': response_body,
        'url': url,
    }


def compute_metrics(results, total_elapsed):
    status_counts = {}
    latencies = []
    for r in results:
        s = r['status']
        status_counts[s] = status_counts.get(s, 0) + 1
        latencies.append(r['duration_ms'])

    latencies.sort()
    count = len(latencies)
    p50 = latencies[int(count * 0.50)] if count else 0
    p95 = latencies[int(count * 0.95)] if count else 0
    p99 = latencies[int(count * 0.99)] if count else 0
    avg_ms = sum(latencies) / count if count else 0
    throughput = count / total_elapsed if total_elapsed > 0 else 0

    return {
        'total': count,
        'elapsed_sec': total_elapsed,
        'throughput': throughput,
        'status_counts': status_counts,
        'p50': p50,
        'p95': p95,
        'p99': p99,
        'avg': avg_ms,
    }


def print_metrics_table(title, metrics):
    print("=" * 80)
    print(f"  {title.upper()}")
    print("=" * 80)
    print(f"  Total Requests:       {metrics['total']}")
    print(f"  Duration:             {metrics['elapsed_sec']:.2f} seconds")
    print(f"  Throughput:           {metrics['throughput']:.1f} req/s")
    print(f"  Status Breakdown:     {metrics['status_counts']}")
    print(f"  Latency (P50 / Median): {metrics['p50']:.1f} ms")
    print(f"  Latency (P95):          {metrics['p95']:.1f} ms")
    print(f"  Latency (P99):          {metrics['p99']:.1f} ms")
    print(f"  Latency (Average):      {metrics['avg']:.1f} ms")
    print("=" * 80)


def run_scenario_a():
    """Scenario A: 1,000 distinct students logging in over 60 seconds."""
    print("\n" + ">>> STARTING SCENARIO A: 1,000 GRADUAL STUDENT LOGINS OVER 60 SECONDS <<<")
    school = School.objects.get(id=5)
    students = list(User.objects.filter(school=school, role=User.Role.STUDENT, is_active=True)[:1000])
    num_students = len(students)
    print(f"Loaded {num_students} distinct student accounts from School 5.")

    tasks = []
    # Stagger arrival times across 60 seconds (~16.6 req/s)
    for i, s in enumerate(students):
        scheduled_delay = (i / num_students) * 55.0  # Spaced over 55s
        tasks.append({
            'url': f"{BASE_URL}/api/v1/auth/login/",
            'data': {'email': s.email, 'password': 'Admin@123'},
            'scheduled_delay': scheduled_delay,
        })

    results = []
    t0 = time.perf_counter()

    def worker_login(task):
        target_time = t0 + task['scheduled_delay']
        now = time.perf_counter()
        if target_time > now:
            time.sleep(target_time - now)
        return send_http_request(task['url'], method='POST', data=task['data'])

    with ThreadPoolExecutor(max_workers=25) as executor:
        results = list(executor.map(worker_login, tasks))

    total_elapsed = time.perf_counter() - t0
    m = compute_metrics(results, total_elapsed)
    print_metrics_table("Scenario A: Gradual Login Ramp (1,000 Logins)", m)
    return m


def run_scenario_b():
    """Scenario B: Sudden Login Burst (300 students hitting login in a 2-second burst)."""
    print("\n" + ">>> STARTING SCENARIO B: SUDDEN LOGIN BURST (300 CONCURRENT LOGINS) <<<")
    school = School.objects.get(id=5)
    students = list(User.objects.filter(school=school, role=User.Role.STUDENT, is_active=True)[:300])

    tasks = [
        {'url': f"{BASE_URL}/api/v1/auth/login/", 'data': {'email': s.email, 'password': 'Admin@123'}}
        for s in students
    ]

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=50) as executor:
        results = list(executor.map(lambda t: send_http_request(t['url'], method='POST', data=t['data'], timeout=30), tasks))
    total_elapsed = time.perf_counter() - t0

    m = compute_metrics(results, total_elapsed)
    print_metrics_table("Scenario B: Sudden Login Burst (300 Logins)", m)
    print(f"Nginx Burst Defense: {m['status_counts'].get(200, 0)} accepted immediately, {m['status_counts'].get(429, 0)} throttled by Nginx login_flood_zone (burst=150).")
    return m


def run_scenario_c():
    """Scenario C: Normal School Activity (1,000 students browsing API concurrently with Admin CRUD)."""
    print("\n" + ">>> STARTING SCENARIO C: 1,000 USERS BROWSING WITH CONCURRENT ADMIN CRUD <<<")
    school = School.objects.get(id=5)
    users = list(User.objects.filter(school=school, is_active=True, must_change_password=False)[:1000])

    print("Generating JWT access tokens for 1,000 users...")
    user_tokens = [str(RefreshToken.for_user(u).access_token) for u in users]

    admin_user = User.objects.filter(school=school, role=User.Role.SCHOOL_ADMIN, is_active=True).first()
    admin_token = str(RefreshToken.for_user(admin_user).access_token) if admin_user else user_tokens[0]

    endpoints = ["/api/v1/auth/me/", "/api/v1/classes/", "/api/v1/subjects/"]
    tasks = []
    for token in user_tokens:
        for _ in range(2):
            ep = random.choice(endpoints)
            tasks.append({'url': f"{BASE_URL}{ep}", 'token': token, 'is_admin': False})

    # Admin concurrent tasks
    for i in range(10):
        tasks.append({
            'url': f"{BASE_URL}/api/v1/students/",
            'token': admin_token,
            'is_admin': True,
        })

    random.shuffle(tasks)
    print(f"Executing {len(tasks)} requests across 50 concurrent worker threads...")

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=50) as executor:
        results = list(executor.map(lambda t: send_http_request(t['url'], token=t['token']), tasks))
    total_elapsed = time.perf_counter() - t0

    m = compute_metrics(results, total_elapsed)
    print_metrics_table("Scenario C: Normal School Activity (2,010 Requests)", m)
    return m


def run_scenario_d():
    """Scenario D: Administrative Bulk Import under concurrent student traffic."""
    print("\n" + ">>> STARTING SCENARIO D: ADMINISTRATIVE BULK IMPORT UNDER TRAFFIC <<<")
    school = School.objects.get(id=5)
    admin_user = User.objects.filter(school=school, role=User.Role.SCHOOL_ADMIN, is_active=True).first()
    admin_token = str(RefreshToken.for_user(admin_user).access_token)

    students = list(User.objects.filter(school=school, role=User.Role.STUDENT, is_active=True, must_change_password=False)[:100])
    student_tokens = [str(RefreshToken.for_user(s).access_token) for s in students]

    # Prepare bulk import payload (50 students)
    import_payload = {
        'jobId': f"bulk_loadtest_{int(time.time())}",
        'students': [
            {
                'name': f"Batch Student {i}",
                'className': 'Class 10',
                'section': 'A',
                'dob': '2010-06-12',
                'gender': 'Male' if i % 2 == 0 else 'Female',
                'parentName': f"Parent {i}",
                'parentPhone': f"98765{i:05d}",
                'parentEmail': f"p{i}_{int(time.time())}@greenwood.edu",
            }
            for i in range(50)
        ]
    }

    import_result = []
    traffic_results = []

    def run_import():
        res = send_http_request(
            f"{BASE_URL}/api/v1/students/bulk-import/",
            method='POST',
            data=import_payload,
            token=admin_token,
            timeout=30,
        )
        import_result.append(res)

    def run_student_traffic():
        for st in student_tokens:
            traffic_results.append(send_http_request(f"{BASE_URL}/api/v1/classes/", token=st))

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=10) as executor:
        f_import = executor.submit(run_import)
        f_traffic = executor.submit(run_student_traffic)
        f_import.result()
        f_traffic.result()
    total_elapsed = time.perf_counter() - t0

    all_results = import_result + traffic_results
    m = compute_metrics(all_results, total_elapsed)
    print_metrics_table("Scenario D: Bulk Import + Concurrent Traffic", m)
    if import_result:
        print(f"Bulk Import Status: HTTP {import_result[0]['status']}, Duration: {import_result[0]['duration_ms']:.1f}ms")
    return m


def run_scenario_e():
    """Scenario E: Sustained Concurrency (100 concurrent users over 10 seconds with think-time)."""
    print("\n" + ">>> STARTING SCENARIO E: SUSTAINED CONCURRENCY (100 WORKERS WITH THINK-TIME) <<<")
    school = School.objects.get(id=5)
    users = list(User.objects.filter(school=school, is_active=True, must_change_password=False)[:100])
    tokens = [str(RefreshToken.for_user(u).access_token) for u in users]

    endpoints = ["/api/v1/auth/me/", "/api/v1/classes/", "/api/v1/subjects/"]
    results = []
    stop_time = time.perf_counter() + 10.0

    def user_session(token):
        while time.perf_counter() < stop_time:
            ep = random.choice(endpoints)
            res = send_http_request(f"{BASE_URL}{ep}", token=token)
            results.append(res)
            time.sleep(random.uniform(0.05, 0.15))  # 50ms - 150ms think-time

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=100) as executor:
        list(executor.map(user_session, tokens))
    total_elapsed = time.perf_counter() - t0

    m = compute_metrics(results, total_elapsed)
    print_metrics_table("Scenario E: Sustained Concurrency (100 Users, 10s)", m)
    return m


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Run 1000 campus users load test scenarios")
    parser.add_argument('--scenario', type=str, default='all', choices=['A', 'B', 'C', 'D', 'E', 'all'])
    args = parser.parse_args()

    print("=" * 80)
    print("  VOLPEHUB ERP - PRODUCTION 1,000-USER LOAD TEST SUITE")
    print(f"  Target: {BASE_URL} (Nginx Gateway -> Gunicorn ASGI -> PgBouncer -> PostgreSQL)")
    print(f"  Campus IP: {SHARED_CAMPUS_IP}")
    print("=" * 80)

    if args.scenario in ('A', 'all'):
        run_scenario_a()
    if args.scenario in ('B', 'all'):
        run_scenario_b()
    if args.scenario in ('C', 'all'):
        run_scenario_c()
    if args.scenario in ('D', 'all'):
        run_scenario_d()
    if args.scenario in ('E', 'all'):
        run_scenario_e()

    print("\n>>> ALL SPECIFIED LOAD TEST SCENARIOS COMPLETED <<<\n")
