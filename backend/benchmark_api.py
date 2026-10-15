import os
import sys
import time
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from apps.accounts.models import User
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

# Pick an active school admin
user = User.objects.filter(role=User.Role.SCHOOL_ADMIN, is_active=True).first()
if not user:
    user = User.objects.filter(role=User.Role.SUPER_ADMIN, is_active=True).first()

print(f"Using test user: {user.email} (role: {user.role}, school_id: {user.school_id})")

token = str(RefreshToken.for_user(user).access_token)

client = APIClient()
client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

endpoints = [
    ('/api/v1/auth/me/', 'Auth Me'),
    ('/api/v1/schools/', 'Schools List'),
    ('/api/v1/classes/', 'Classes List'),
    ('/api/v1/sections/', 'Sections List'),
    ('/api/v1/academic-years/', 'Academic Years List'),
    ('/api/v1/students/', 'Students List'),
    ('/api/v1/teachers/', 'Teachers List'),
]

print("\n" + "=" * 70)
print(f"{'ENDPOINT':<32} | {'WARMUP (ms)':<12} | {'FAST FETCH AVG (ms)':<18} | {'STATUS'}")
print("=" * 70)

results = []
for url, label in endpoints:
    # 1. Warm-up request (populates fast cache / Redis)
    t0 = time.perf_counter()
    res0 = client.get(url)
    t1 = time.perf_counter()
    warmup_ms = (t1 - t0) * 1000

    # 2. Measure subsequent cached fetches (10 iterations)
    times = []
    statuses = []
    for _ in range(10):
        start = time.perf_counter()
        res = client.get(url)
        end = time.perf_counter()
        times.append((end - start) * 1000)
        statuses.append(res.status_code)

    avg_ms = sum(times) / len(times)
    min_ms = min(times)
    max_ms = max(times)
    status_code = statuses[0]

    status_str = f"HTTP {status_code}"
    print(f"{label:<32} | {warmup_ms:9.2f} ms | {avg_ms:6.2f} ms (min {min_ms:.2f}) | {status_str}")
    results.append({
        'endpoint': label,
        'url': url,
        'warmup_ms': warmup_ms,
        'avg_ms': avg_ms,
        'min_ms': min_ms,
        'status': status_code
    })

print("=" * 70)
