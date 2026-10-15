# School ERP backend

Copy `.env.example` to `.env`, then run `docker compose up --build`. The API is at `http://localhost:8000/api/v1/` and OpenAPI documentation is at `/api/docs/`.

## Migration map

| Browser key | API replacement |
| --- | --- |
| `school_erp_api_token` | `/auth/login/`, `/auth/refresh/`, `/auth/logout/`, `/auth/me/` |
| `erp_students` | `/students/` CRUD with nested documents/history |
| `erp_academic_year` | `/academic-years/active/` + promotion job |
| `erp_brand_settings`, `sa_schools` | `/schools/{id}/` |
| `erp_timetable_slots` | `/timetable/slots/` |
| `erp_school_timings` | `/timetable/config/` |
| `erp_timetable_notifications` | `/timetable/notifications/` |
| `erp_fee_categories`, `sa_fee_categories` | `/finance/fee-categories/` |
| `erp_fee_structures` | `/finance/fee-structures/` |
| `erp_individual_fees` | `/finance/invoices/` |
| `sa_users`, `sa_admins` | `/superadmin/users/`, `/superadmin/admins/` |
| `sa_audit_logs`, `sa_login_history` | `/superadmin/audit-logs/`, `/superadmin/login-history/` |
| `sa_system_settings` | `/superadmin/system-settings/` |
| `sa_exam_types` | `/exams/types/` |
| `sa_public_learners` | `/public-learning/learners/` |
