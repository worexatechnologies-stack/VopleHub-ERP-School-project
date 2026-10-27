import os
import sys
import time
import urllib.request
import urllib.error
import random
from concurrent.futures import ThreadPoolExecutor
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from apps.accounts.models import User
from rest_framework_simplejwt.tokens import RefreshToken

def run_campus_load_test():
    print("=" * 80)
    print("  VOLPEHUB ERP - REPRODUCIBLE 850 CAMPUS USERS SHARED-IP LOAD TEST")
    print("=" * 80)

    # 1. Fetch active users
    users = list(User.objects.filter(is_active=True, must_change_password=False).select_related('school')[:850])
    num_users = len(users)
    print(f"Loaded {num_users} active users from database (students, parents, teachers, admins).")

    # 2. Generate valid JWT tokens
    print("Pre-generating genuine JWT access tokens...")
    user_tokens = []
    for u in users:
        token = str(RefreshToken.for_user(u).access_token)
        user_tokens.append({'user': u, 'token': token, 'role': u.role})

    # Shared campus NAT IP
    CAMPUS_IP = "203.0.113.195"
    BASE_URL = os.environ.get('LOAD_TEST_BASE_URL', 'http://web:80' if os.path.exists('/.dockerenv') else 'http://localhost:3001')

    # Request endpoints mix
    endpoints_pool = [
        "/api/v1/auth/me/",
        "/api/v1/classes/",
        "/api/v1/subjects/",
    ]

    # Generate 2 requests per virtual user = 1,700 total requests
    tasks = []
    for ut in user_tokens:
        for _ in range(2):
            endpoint = random.choice(endpoints_pool)
            tasks.append({
                'url': f"{BASE_URL}{endpoint}",
                'token': ut['token'],
                'user_id': ut['user'].id,
                'role': ut['role'],
            })

    random.shuffle(tasks)
    total_tasks = len(tasks)
    concurrency = 50

    print(f"Starting load test: {total_tasks} requests across {num_users} virtual users on IP {CAMPUS_IP}")
    print(f"Target URL: {BASE_URL} (Nginx reverse proxy)")
    print(f"Concurrency: {concurrency} workers -> Nginx -> Gunicorn ASGI (3 workers) -> Redis")
    print("-" * 80)

    results = []

    def send_request(task):
        req = urllib.request.Request(task['url'])
        req.add_header('Authorization', f"Bearer {task['token']}")
        req.add_header('X-Forwarded-For', CAMPUS_IP)
        req.add_header('User-Agent', f"CampusClient/1.0 (User-{task['user_id']})")

        start = time.perf_counter()
        status_code = None
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                status_code = resp.status
        except urllib.error.HTTPError as e:
            status_code = e.code
            try:
                body = e.read().decode('utf-8')
                print(f"[HTTP {status_code}] User {task['user_id']} ({task['role']}) -> {task['url']}: {body}")
            except Exception:
                pass
        except Exception as e:
            status_code = 599
            print(f"[EXC {status_code}] User {task['user_id']} ({task['role']}) -> {task['url']}: {e}")

        duration_ms = (time.perf_counter() - start) * 1000.0
        resp_data = None
        if status_code != 200:
            try:
                resp_data = e.read().decode('utf-8'); print('FAILED TASK:', task['role'], task['url'], task['user_id'], resp_data)
            except Exception:
                pass
        return {'status': status_code, 'duration_ms': duration_ms, 'url': task['url'], 'role': task['role'], 'data': resp_data}

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        results = list(executor.map(send_request, tasks))
    total_elapsed = time.perf_counter() - t0

    # Metrics
    status_counts = {}
    latencies = []
    for r in results:
        s = r['status']
        status_counts[s] = status_counts.get(s, 0) + 1
        latencies.append(r['duration_ms'])

    latencies.sort()
    count = len(latencies)
    p50 = latencies[int(count * 0.50)]
    p95 = latencies[int(count * 0.95)]
    p99 = latencies[int(count * 0.99)]
    avg_ms = sum(latencies) / count
    throughput = count / total_elapsed

    print(f"Completed in:       {total_elapsed:.2f} seconds")
    print(f"Throughput:         {throughput:.1f} requests/sec")
    print(f"Total Requests:     {count}")
    print(f"Status Breakdown:   {status_counts}")
    failures = [r for r in results if r['status'] != 200]
    if failures:
        print("Sample non-200 responses:")
        for f in failures[:5]:
            print(f"  Role: {f['role']}, URL: {f['url']}, Status: {f['status']}, Body: {f.get('data')}")
    print(f"Latency P50:        {p50:.1f} ms")
    print(f"Latency P95:        {p95:.1f} ms")
    print(f"Latency P99:        {p99:.1f} ms")
    print(f"Latency Avg:        {avg_ms:.1f} ms")
    print("=" * 80)

    # Assertions
    assert status_counts.get(200, 0) == count, f"Expected 100% 200 OK, got: {status_counts}"
    assert status_counts.get(429, 0) == 0, f"False positive 429 lockouts detected: {status_counts.get(429, 0)}"
    print(">>> VERIFICATION SUCCESS: 850 USERS SERVED ON SHARED CAMPUS IP WITH ZERO FALSE 429s! <<<\n")

if __name__ == '__main__':
    run_campus_load_test()
