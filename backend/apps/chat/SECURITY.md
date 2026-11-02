# Chat data protection

Chat message text, chatbot interaction text, attachment bytes, and realtime
outbox payloads are encrypted before they are written to PostgreSQL. Outbox
content is also encrypted while it is in the Redis Channels layer. Authorized
REST and WebSocket responses decrypt the values in the API, so web and mobile
clients continue to receive the existing plaintext API shape without client
cryptography changes.

This is **encryption at rest**, not end-to-end encryption. The running backend
can decrypt chat contents. The server-side checks for authenticated users,
school scope, and conversation participants remain responsible for deciding
who may read messages.

New message notifications and conversation previews use generic text. The
`encrypt_legacy_chat_content` management command converts existing rows and
sanitizes old previews. Production deployment runs this command after the new
API replicas are healthy so old API workers do not receive encrypted rows.

The encryption keys are derived from `DJANGO_SECRET_KEY` using separate
contexts for chat data and database backups. Keep that secret stable and
available to every API, worker, backup, and restore environment. Rotating it
requires decrypting and re-encrypting chat data and backup archives first.
`BACKUP_ENCRYPTION_KEY` can be set to a separate stable backup key; preserve it
securely because it is required to restore encrypted backups.
