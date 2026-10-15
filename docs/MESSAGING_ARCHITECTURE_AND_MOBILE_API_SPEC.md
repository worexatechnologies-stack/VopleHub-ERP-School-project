# Production-Ready Parent–Teacher Messaging Platform
## Technical Architecture, Mobile API Contract & Deployment Guide

---

## 1. System Architecture Overview

The Parent–Teacher Messaging Platform is an enterprise-grade, multi-tenant real-time messaging subsystem embedded within Volpehub Education School ERP. It serves both the **Next.js / React Web client** and **native Mobile apps (iOS & Android)** through a unified Django REST Framework API, Django Channels ASGI WebSockets, PostgreSQL, and a Redis-backed Channel Layer and Outbox worker.

```
                    ┌─────────────────────────┐
                    │    React / Next.js      │
                    │       Web Client        │
                    └───────────┬─────────────┘
                                │ (HTTPS / WSS)
                                │
┌───────────────────────────────┴──────────────────────────────┐
│                  Unified Client Contract                     │
│    (Same Endpoints, Headers, WebSocket Events, Authorization)│
└───────────────────────────────┬──────────────────────────────┘
                                │ (HTTPS / WSS)
                    ┌───────────┴─────────────┐
                    │     Native Mobile       │
                    │   Client (iOS/Android)  │
                    └─────────────────────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
      ┌─────────────────┐               ┌─────────────────┐
      │   Django REST   │               │ Django Channels │
      │   Framework     │               │   ASGI/Daphne   │
      │   HTTP / HTTPS  │               │   WebSockets    │
      └────────┬────────┘               └────────┬────────┘
               │                                 │
               ▼                                 ▼
┌────────────────────────────────┐      ┌─────────────────┐
│     PostgreSQL Database        │      │   Redis 7.0+    │
│  (Authoritative Source of      │      │ (Channel Layer, │
│   Truth, ACID Transactions,    │      │  Outbox Broker, │
│   Transactional Outbox Table)  │      │  Cache & Rate-  │
└──────────────┬─────────────────┘      │   Limiting)     │
               │                        └────────▲────────┘
               │                                 │
               ▼                                 │
┌────────────────────────────────┐               │
│ Transactional Outbox Sweeper / ├───────────────┘
│   Celery Background Worker     │ (Event Broadcast / FCM & APNs Push)
└────────────────────────────────┘
```

---

## 2. Multi-Tenant Role-Based Access Control (RBAC)

All operations (HTTP REST endpoints, file attachment downloads, and WebSocket event distribution) strictly enforce the following security boundaries:

| Actor | Permitted Messaging Actions | Prohibited Actions |
|---|---|---|
| **Parent** | May converse **only** with teachers who actively instruct their actively enrolled children at their school. Can access conversation details only for their linked children. | Cannot initiate conversations with teachers not assigned to their children. Cannot chat with students directly. Cannot access other schools' data. |
| **Teacher** | May converse with parents of students enrolled in their assigned classes/subjects, or school administrators. | Cannot message parents of students outside their teaching roster or cross-school tenants. |
| **School Admin** | Can initiate administrative conversations with faculty and parents within their specific school tenant. | Cannot intercept or tamper with private conversations without an auditable compliance event. |
| **Student** | Direct messaging is **strictly disabled** for students to ensure child safety and prevent unsupervised messaging. | Blocked from all conversation creation and participation endpoints (`403 Forbidden`). |

---

## 3. Data Models & Database Schemas

### 3.1 `Conversation`
- **`id`** (`UUIDField`, Primary Key): Secure non-sequential identifier avoiding IDOR enumeration.
- **`school`** (`ForeignKey` to `School`): Enforces multi-tenant isolation.
- **`conversation_type`** (`CharField`): `direct`, `group`, or `announcement`.
- **`student`** (`ForeignKey` to `Student`, Optional): Explicit academic context linking the conversation to a specific child.
- **`created_at`**, **`updated_at`**: Stable server timestamps.

### 3.2 `ConversationParticipant`
- **`id`** (`UUIDField`, Primary Key).
- **`conversation`** (`ForeignKey` to `Conversation`).
- **`user`** (`ForeignKey` to `User`).
- **`role`** (`CharField`): `parent`, `teacher`, `admin`, `member`.
- **`last_read_message`** (`ForeignKey` to `DirectMessage`, nullable).
- **`last_read_at`** (`DateTimeField`, nullable): Read cursor timestamp.
- **`is_muted`**, **`is_archived`**: Participant preferences.
- **Constraint**: `unique_together = ('conversation', 'user')`.

### 3.3 `DirectMessage`
- **`id`** (`UUIDField`, Primary Key).
- **`conversation`** (`ForeignKey` to `Conversation`).
- **`sender`** (`ForeignKey` to `User`).
- **`body`** (`TextField`): Message content.
- **`message_type`** (`CharField`): `text`, `image`, `file`, `system`.
- **`client_idempotency_key`** (`CharField`, Indexed): Client-generated UUID preventing duplicate message creation on network retries.
- **`reply_to`** (`ForeignKey` to `self`, nullable): Threaded reply reference.
- **`is_read`**, **`read_at`**: Direct read tracking.
- **`edited_at`**: Nullable timestamp populated upon PATCH edits.
- **`is_deleted`**, **`deleted_at`**: Soft-delete flag complying with institutional retention policies.

### 3.4 `MessageAttachment`
- **`id`** (`UUIDField`, Primary Key).
- **`message`** (`ForeignKey` to `DirectMessage`).
- **`file`** (`FileField`): Stored securely under private storage (`chat_attachments/%Y/%m/`).
- **`file_name`**, **`file_type`**, **`file_size`**: Verified metadata.
- **`uploaded_at`**: Server creation timestamp.

### 3.5 `OutboxEvent`
- **`id`** (`UUIDField`, Primary Key).
- **`event_type`** (`CharField`): `message.created`, `message.updated`, `message.deleted`, `conversation.read`.
- **`aggregate_id`** (`CharField`): Conversation or Message UUID.
- **`payload`** (`JSONField`): Sanitized event data ready for broadcast.
- **`status`** (`CharField`): `PENDING`, `DISPATCHED`, `FAILED`.
- **`created_at`**, **`dispatched_at`**: Delivery lifecycle audit trail.

---

## 4. Mobile API Contract (iOS & Android)

### 4.1 Authentication & Session Handling
- **Header**: `Authorization: Bearer <jwt_access_token>`
- Token refresh: Standard SimpleJWT `POST /api/v1/auth/token/refresh/`.
- Mobile clients store the token in secure hardware storage (**iOS Keychain** / **Android EncryptedSharedPreferences**).

---

### 4.2 Endpoints

#### 1. List Conversations
- **`GET /api/v1/conversations/`** (or `/api/v1/chat/conversations/`)
- **Query Params**:
  - `page`: Page number (default: 1)
  - `page_size`: Results per page (default: 20)
  - `search`: Filter by participant name or student name
- **Response `200 OK`**:
```json
{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "conversation_type": "direct",
      "student": {
        "id": 12,
        "first_name": "Johnny",
        "last_name": "Doe",
        "grade_level": "Grade 5"
      },
      "other_participant": {
        "id": 34,
        "name": "Sarah Connor",
        "email": "teacher@school.edu",
        "role": "teacher"
      },
      "last_message": {
        "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "body": "Johnny did great in math today!",
        "sender_id": 34,
        "created_at": "2026-10-15T09:30:00Z"
      },
      "unread_count": 1,
      "updated_at": "2026-10-15T09:30:00Z"
    }
  ]
}
```

---

#### 2. Start / Fetch Existing Conversation
- **`POST /api/v1/conversations/start/`** (or `/api/v1/chat/conversations/start/`)
- **Request Body**:
```json
{
  "recipient_id": 34,
  "student_id": 12
}
```
- **Response `200 OK`**: Returns the `Conversation` object. If a conversation between these parties for this student already exists, it is returned idempotently without duplicates.

---

#### 3. Fetch Message History (Cursor Pagination)
- **`GET /api/v1/conversations/{id}/messages/`**
- **Query Params**:
  - `limit`: Number of messages (default: 30, max: 100)
  - `before`: ISO-8601 timestamp (e.g. `2026-10-15T09:00:00Z`) for fetching older messages when scrolling up.
  - `after`: ISO-8601 timestamp for catching up missed messages after coming back online.
- **Response `200 OK`**:
```json
{
  "messages": [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "conversation": "550e8400-e29b-41d4-a716-446655440000",
      "sender": {
        "id": 34,
        "name": "Sarah Connor",
        "email": "teacher@school.edu",
        "role": "teacher"
      },
      "body": "Johnny did great in math today!",
      "message_type": "text",
      "client_idempotency_key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "is_read": false,
      "created_at": "2026-10-15T09:30:00Z",
      "edited_at": null,
      "attachments": []
    }
  ],
  "has_more": false,
  "oldest_timestamp": "2026-10-15T09:30:00Z"
}
```

---

#### 4. Send Message (Idempotent)
- **`POST /api/v1/conversations/{id}/messages/`**
- **Headers**:
  - `Idempotency-Key`: `<client-uuid>` (e.g. `9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d`)
- **Request Body** (JSON or `multipart/form-data` for attachments):
```json
{
  "body": "Thank you for the update!",
  "client_idempotency_key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "reply_to": null
}
```
- **Response `201 Created`** (or `200 OK` if duplicate idempotency key is submitted).
- *Guarantees*: If network drops after DB commit, client retry with the same `client_idempotency_key` returns the existing message without inserting a second copy.

---

#### 5. Mark Conversation as Read
- **`POST /api/v1/conversations/{id}/read/`**
- **Request Body**:
```json
{
  "message_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```
- **Response `200 OK`**:
```json
{
  "status": "marked_read",
  "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
  "read_at": "2026-10-15T09:35:00Z",
  "unread_count": 0
}
```

---

#### 6. Global Unread Counter
- **`GET /api/v1/unread-count/`**
- **Response `200 OK`**:
```json
{
  "unread_count": 0
}
```

---

#### 7. Secure Attachment Download
- **`GET /api/v1/attachments/{id}/download/`**
- Enforces participant validation before returning the file with `Content-Disposition`. Public or unauthenticated downloads are strictly blocked (`403 Forbidden`).

---

## 5. Real-Time WebSocket Protocol

### 5.1 Connection URL & Authentication
- **Endpoint**: `ws://<domain>/ws/chat/?token=<jwt_access_token>` (or `wss://`)
- Handshake middleware (`JWTAuthMiddleware`) validates the token and attaches the authenticated user. If invalid, the socket closes with code `4001`.

### 5.2 Server-to-Client Event Payloads

#### `connection.ready`
Emitted immediately upon successful connection:
```json
{
  "type": "connection.ready",
  "user_id": 42,
  "server_timestamp": "2026-10-15T09:30:00Z"
}
```

#### `message.created`
Broadcast to all conversation participants:
```json
{
  "type": "message.created",
  "message": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "conversation": "550e8400-e29b-41d4-a716-446655440000",
    "sender": { "id": 34, "name": "Sarah Connor" },
    "body": "Johnny did great in math today!",
    "client_idempotency_key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "created_at": "2026-10-15T09:30:00Z",
    "attachments": []
  }
}
```

#### `conversation.read`
Broadcast when the other participant reads messages:
```json
{
  "type": "conversation.read",
  "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": 34,
  "read_at": "2026-10-15T09:35:00Z"
}
```

#### `unread_count.updated`
Pushed to the specific recipient's channel group:
```json
{
  "type": "unread_count.updated",
  "unread_count": 2
}
```

---

## 6. Mobile Offline Sync & Push Notification Architecture

### 6.1 Lifecycle & Reconnection Strategy
Native mobile apps (iOS / Android) experience frequent process suspension, background termination, and network transitions (Wi-Fi to 5G):

1. **Foreground**: Establish WebSocket connection for sub-100ms real-time delivery.
2. **Background / Suspension**:
   - The OS closes background WebSockets after a brief grace period.
   - Incoming messages trigger **Push Notifications (FCM / APNs)** via the transactional outbox worker.
   - Notification payload contains generic, privacy-conscious alert: `{"title": "New message from Sarah Connor", "data": {"conversation_id": "..."}}`.
3. **App Resume**:
   - The app reads its local latest timestamp: `latestLocalTimestamp`.
   - The app calls `GET /api/v1/conversations/{id}/messages/?after={latestLocalTimestamp}` to fetch all messages received while suspended.
   - The app re-establishes the WebSocket connection.

---

## 7. Production Deployment & Operational Runbook

### 7.1 Environment Variables
```env
# Database
DATABASE_URL=postgresql://volpe_user:secret@postgres.internal:5432/volpehub_education

# Redis (Channel Layer, Outbox, Caching)
REDIS_URL=redis://redis.internal:6379/1
REDIS_CHANNEL_URL=redis://redis.internal:6379/2

# ASGI & Django
DJANGO_SETTINGS_MODULE=config.settings.production
ALLOWED_HOSTS=api.school.edu,school.edu
CORS_ALLOWED_ORIGINS=https://school.edu,https://mobile.school.edu

# Storage
DEFAULT_FILE_STORAGE=storages.backends.s3boto3.S3Boto3Storage
AWS_STORAGE_BUCKET_NAME=school-messaging-private
AWS_QUERYSTRING_AUTH=True
```

### 7.2 ASGI Daphne Service Setup (`systemd`)
```ini
[Unit]
Description=Daphne ASGI Server for School Messaging
After=network.target

[Service]
User=appuser
WorkingDirectory=/opt/schoolproject/backend
ExecStart=/opt/schoolproject/backend/.venv/bin/daphne -b 0.0.0.0 -p 8001 config.asgi:application
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

### 7.3 Celery Worker for Outbox Sweeping
```ini
[Unit]
Description=Celery Worker for Messaging Outbox
After=network.target

[Service]
User=appuser
WorkingDirectory=/opt/schoolproject/backend
ExecStart=/opt/schoolproject/backend/.venv/bin/celery -A config worker -l info -Q messaging,default
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

---

## 8. Verification & Test Suite Summary

The messaging architecture has been validated with 16 automated tests covering all critical boundaries:

- **Idempotency Deduplication**: Verified that duplicate `client_idempotency_key` payloads do not create redundant database rows.
- **Cross-School Tenant Isolation**: Verified that teachers from School A cannot access or create conversations with parents from School B.
- **Student Direct Messaging Block**: Verified that students attempting to initiate or join chat conversations receive `403 Forbidden`.
- **Parent–Teacher Boundary**: Verified that parents can only initiate conversations with teachers assigned to their specific enrolled children.
- **Read Cursor & Unread Counter**: Verified that marking a conversation read updates participant cursors and resets unread badge counts.
- **Message Editing & Soft Delete**: Verified PATCH edits record `edited_at` and DELETE marks `is_deleted=True` while preserving institutional audit logs.
- **Transactional Outbox Event Generation**: Verified that every committed message creates an associated `OutboxEvent` for asynchronous real-time dispatch.
