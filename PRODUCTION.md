# volpehub.education Production Deployment

Target server: KVM 8, 8 vCPU, 32 GB RAM, 400 GB NVMe, 32 TB bandwidth.

## 1. Configure environment

Create `backend/.env` from `backend/.env.example` and replace:

- `DJANGO_SECRET_KEY`
- `POSTGRES_PASSWORD`
- `DATABASE_URL` password portion
- domain values if not using `volpehub.education`

## 2. Start production stack

```bash
docker compose -f docker-compose.prod.yml --env-file backend/.env up -d --build
```

PostgreSQL creates the production database automatically from `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.

The API container automatically:

- waits for PostgreSQL
- runs `python manage.py migrate --noinput`
- runs `python manage.py collectstatic --noinput`
- starts Gunicorn with Uvicorn workers

## 3. Recommended worker sizing

Default `WEB_CONCURRENCY=9` is set for 8 vCPU. If the app is mostly API-bound, keep 9. If memory pressure appears, reduce to 6 or 7.

## 4. Persistent data

Production data is stored in Docker volumes:

- `postgres_data`
- `redis_data`
- `static_data`

Configure server-provider weekly backups or snapshots to include these Docker volumes.

## 5. Health checks

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

HTTPS is terminated by the included Caddy service. Set `DOMAIN` and `LETSENCRYPT_EMAIL`, ensure DNS points to this server, and allow inbound ports 80 and 443 before starting the stack.

## 6. Firebase Cloud Messaging

1. In Firebase Console, create/select the project, register a **Web app**, enable Cloud Messaging, and generate a **Web Push VAPID key**.
2. Put the public web-app values (`VITE_FIREBASE_*`) in `backend/.env`; Docker passes these only into the frontend build. They are public identifiers, not server credentials.
3. Create a Firebase Admin service account. Store its JSON in your secret manager or mount it read-only into both the `api` and `celery_worker` containers. Set `FIREBASE_ENABLED=true` and either:

   ```bash
   FIREBASE_SERVICE_ACCOUNT_FILE=/run/secrets/firebase-service-account.json
   ```

   or set `FIREBASE_SERVICE_ACCOUNT_JSON` from the secret manager. Never add the service-account JSON to Git, frontend environment variables, or the browser.
4. Rebuild the frontend after changing any `VITE_FIREBASE_*` value. Firebase Messaging requires HTTPS in production (localhost is allowed for development).

FCM tokens are stored per device in PostgreSQL. The API automatically deletes tokens Firebase reports as invalid, and retries temporary delivery failures through Celery with exponential backoff.

## 7. First administrator and backups

Set `BOOTSTRAP_SUPERADMIN_EMAIL`, `BOOTSTRAP_SUPERADMIN_PASSWORD`, and `BOOTSTRAP_SUPERADMIN_NAME` in `backend/.env`. Run `./deploy.sh` to start the stack and create the account idempotently.

Schedule `./backup.sh` nightly with cron. It writes PostgreSQL dumps to `./backups` and retains them for `BACKUP_RETENTION_DAYS` (14 by default).
