"""Locust Load-Testing Suite for Volpehub Education ERP.

Simulates concurrent user load (50, 100, 200, 500 users) across optimized endpoints:
1. Student Roster (Pagination, Deferred Blobs)
2. Compound Index Filtering (Class + Section)
3. Attendance Lookup (Period, Date, Section)
4. Fee Records & School Revenue (SQL Aggregation + Redis Cache)
5. Asynchronous Export Jobs (Celery Streaming)

Usage:
    locust -f locustfile.py --host http://localhost:8000 --users 100 --spawn-rate 10 --run-time 2m
    locust -f locustfile.py --headless -u 100 -r 20 -t 60s --host http://localhost:8000
"""
import random
from locust import HttpUser, task, between


class SchoolAdminUser(HttpUser):
    wait_time = between(1, 3)
    token = None
    headers = {}

    def on_start(self):
        """Authenticate as school admin or use pre-configured test credentials."""
        login_response = self.client.post("/api/v1/auth/login/", json={
            "email": "audit_admin@example.com",
            "password": "Password123!",
        })
        if login_response.status_code == 200:
            data = login_response.json()
            self.token = data.get("access") or data.get("token")
            self.headers = {"Authorization": f"Bearer {self.token}"}
        else:
            # Fallback to direct token if testing with predefined token
            self.headers = {"Accept": "application/json"}

    @task(4)
    def view_students_roster(self):
        page = random.randint(1, 5)
        self.client.get(
            f"/api/v1/students/?page={page}&page_size=50",
            headers=self.headers,
            name="/api/v1/students/?page=[p]&page_size=50"
        )

    @task(3)
    def filter_students_by_class_and_section(self):
        cls = random.choice(["Class 1", "Class 2", "Class 3", "Class 4", "Class 5"])
        sec = random.choice(["A", "B", "C"])
        self.client.get(
            f"/api/v1/students/?class_name={cls}&section={sec}",
            headers=self.headers,
            name="/api/v1/students/?class_name=[cls]&section=[sec]"
        )

    @task(4)
    def view_attendance_records(self):
        period = random.randint(1, 6)
        self.client.get(
            f"/api/v1/attendance/?date=2026-10-12&period={period}",
            headers=self.headers,
            name="/api/v1/attendance/?date=[date]&period=[p]"
        )

    @task(3)
    def view_fee_records(self):
        page = random.randint(1, 3)
        self.client.get(
            f"/api/v1/fee-records/?page={page}&page_size=50",
            headers=self.headers,
            name="/api/v1/fee-records/?page=[p]&page_size=50"
        )

    @task(2)
    def view_school_revenue(self):
        self.client.get(
            "/api/v1/fee-structures/school-revenue/",
            headers=self.headers,
            name="/api/v1/fee-structures/school-revenue/"
        )

    @task(1)
    def trigger_and_poll_export(self):
        resp = self.client.post(
            "/api/v1/exports/",
            json={"resource_type": "students", "file_format": "csv"},
            headers=self.headers,
            name="/api/v1/exports/ [POST]"
        )
        if resp.status_code == 202:
            job_id = resp.json().get("id")
            if job_id:
                self.client.get(
                    f"/api/v1/exports/{job_id}/status/",
                    headers=self.headers,
                    name="/api/v1/exports/[id]/status/"
                )


class TeacherUser(HttpUser):
    wait_time = between(1, 4)
    headers = {}

    def on_start(self):
        login_response = self.client.post("/api/v1/auth/login/", json={
            "email": "teacher1@example.com",
            "password": "Password123!",
        })
        if login_response.status_code == 200:
            data = login_response.json()
            token = data.get("access") or data.get("token")
            self.headers = {"Authorization": f"Bearer {token}"}
        else:
            self.headers = {"Accept": "application/json"}

    @task(5)
    def get_assigned_attendance(self):
        period = random.randint(1, 4)
        self.client.get(
            f"/api/v1/attendance/?date=2026-10-12&period={period}",
            headers=self.headers,
            name="/api/v1/attendance/?date=[date]&period=[p] (Teacher)"
        )

    @task(3)
    def get_timetable(self):
        self.client.get(
            "/api/v1/timetable-slots/",
            headers=self.headers,
            name="/api/v1/timetable-slots/ (Teacher)"
        )
