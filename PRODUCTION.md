# VolpeHub Production Deployment & Operations Guide

This guide outlines the production deployment architecture, security model, environment configuration, and operations for VolpeHub on the Hostinger KVM 8 VPS (`187.127.157.140`).

---

## 1. System Architecture & Coexistence

VolpeHub is deployed as an independent Docker Compose project alongside the existing "My Dear Partner" deployment on the same VPS.

| Dimension | VolpeHub | My Dear Partner |
| :--- | :--- | :--- |
| **Directory** | `/opt/volpehub` | `/opt/mydearpartner` |
| **Compose Project** | `volpehub` (`-p volpehub`) | `mydearpartner` |
| **Docker Network** | `volpehub_default` (isolated bridge) | `mydearpartner_default` |
| **Database** | `volpehub_education` in PostgreSQL 16 (`db`) | `mydearpartner` in PostgreSQL 15 |
| **Volumes** | `volpehub_postgres_data`, `volpehub_redis_data`, etc. | `mydearpartner_*` |
| **Public Ports** | `8081` (HTTP) / `8444` (HTTPS) via Caddy | `80` (HTTP) / `443` (HTTPS) via Nginx |
| **Registry** | GitHub Container Registry (`ghcr.io`) | Local build / Docker Hub |

> [!IMPORTANT]
> Because My Dear Partner's Nginx container binds ports `80` and `443` on the host, VolpeHub's edge proxy (Caddy) binds to `${CADDY_HTTP_PORT:-8081}` and `${CADDY_HTTPS_PORT:-8444}` to guarantee zero port collisions and zero disruption to My Dear Partner.

---

## 2. Server Preparation (One-Time Setup)

On the VPS (`187.127.157.140`), execute the following commands as root to prepare the dedicated `/opt/volpehub` directory and permissions:

```bash
# 1. Create deployment directory structure
mkdir -p /opt/volpehub/docker/postgres
mkdir -p /opt/volpehub/backups

# 2. (Optional but recommended) Create dedicated least-privilege deploy user
useradd -m -s /bin/bash -g docker volpehub-deploy || usermod -aG docker volpehub-deploy
mkdir -p /home/volpehub-deploy/.ssh
chmod 700 /home/volpehub-deploy/.ssh

# Copy deploy SSH public key to authorized_keys
cp ~/.ssh/authorized_keys /home/volpehub-deploy/.ssh/authorized_keys
chown -R volpehub-deploy:docker /home/volpehub-deploy/.ssh /opt/volpehub
chmod 600 /home/volpehub-deploy/.ssh/authorized_keys
chmod 775 /opt/volpehub
```

---

## 3. Production Environment File (`/opt/volpehub/.env`)

Create `/opt/volpehub/.env` on the VPS with production secrets. **Never commit this file to Git.**

```ini
# Core Django Settings
DJANGO_SECRET_KEY=change-to-a-very-long-random-production-secret-at-least-50-characters
DJANGO_DEBUG=false
DJANGO_SETTINGS_MODULE=config.settings.prod
ALLOWED_HOSTS=volpehub.education,www.volpehub.education,187.127.157.140,localhost,127.0.0.1
CORS_ALLOW_ALL_ORIGINS=false
CORS_ALLOWED_ORIGINS=https://volpehub.education,https://www.volpehub.education
CSRF_TRUSTED_ORIGINS=https://volpehub.education,https://www.volpehub.education

# Database Configuration (Unique to VolpeHub)
POSTGRES_DB=volpehub_education
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=generate-strong-unique-postgres-password
APP_DB_USER=volpehub_education
APP_DB_PASSWORD=generate-strong-unique-app-password
DATABASE_URL=postgres://volpehub_education:generate-strong-unique-app-password@db:5432/volpehub_education

# Cache & Redis (Unique to VolpeHub)
REDIS_PASSWORD=generate-strong-unique-redis-password
REDIS_URL=redis://:generate-strong-unique-redis-password@redis:6379/0

# Worker & Concurrency Tuning (Hostinger KVM 8: 8 vCPUs, 32GB RAM)
WEB_CONCURRENCY=6
GUNICORN_TIMEOUT=120
CELERY_CONCURRENCY=4

# Domain & Edge Ports
DOMAIN=volpehub.education
LETSENCRYPT_EMAIL=admin@volpehub.education
CADDY_HTTP_PORT=8081
CADDY_HTTPS_PORT=8444

# Superadmin Bootstrap (Idempotent initial setup)
BOOTSTRAP_SUPERADMIN_EMAIL=admin@volpehub.education
BOOTSTRAP_SUPERADMIN_PASSWORD=generate-initial-strong-superadmin-password
BOOTSTRAP_SUPERADMIN_NAME=VolpeHub Administrator

# Backups
BACKUP_RETENTION_DAYS=14
BACKUP_INTERVAL_SECONDS=86400
```

---

## 4. GitHub Actions CI/CD Pipeline Configuration

### A. Repository Variables (`Settings -> Secrets and variables -> Actions -> Variables`)
- None required (defaults fallback to repository owner and git commit SHA).

### B. Repository Secrets (`Settings -> Secrets and variables -> Actions -> Secrets`)
Configure the following secrets in the GitHub repository:

| Secret Name | Description | Example / Source |
| :--- | :--- | :--- |
| `SSH_HOST` | Hostinger VPS IP address or hostname | `187.127.157.140` |
| `SSH_USER` | Deployment user with docker group access | `volpehub-deploy` or `root` |
| `SSH_PRIVATE_KEY` | Ed25519 or RSA deployment private key | Paste contents of private key (`~/.ssh/github_actions_deploy`) |
| `SSH_KNOWN_HOSTS` | Strict host key line for the VPS | Output of `ssh-keyscan -H 187.127.157.140` |
| `GHCR_PULL_TOKEN` | Read-only GitHub PAT for package pull | GitHub Personal Access Token (`read:packages`) |

> [!NOTE]
> `GITHUB_TOKEN` is automatically provided by GitHub Actions with `packages: write` permissions to publish container images to GHCR.

### C. GitHub Environment Protection
1. Navigate to **Settings → Environments → New environment**.
2. Name the environment: `production`.
3. Set **Deployment branches** to `Selected branches` → `main`.
4. (Recommended) Enable **Required reviewers** for production releases.

---

## 5. Deployment Procedures

### Automated Deployment (Recommended)
1. Push your validated code to the `main` branch.
2. The GitHub Actions workflow (`.github/workflows/cd.yml`) will:
   - Run type checks, frontend build, and Django backend unit tests.
   - Build multi-stage production Docker images and push them to GHCR tagged with `${{ github.sha }}`.
   - Establish a secure SSH session with strict host verification.
   - Sync `docker-compose.prod.yml`, `Caddyfile`, and scripts to `/opt/volpehub/`.
   - Take an automated pre-deployment snapshot of PostgreSQL (`backup.sh`).
   - Run a dedicated backup container that creates a verified PostgreSQL dump daily and removes dumps older than the configured retention period.
   - Run safe database migrations: `docker compose -f docker-compose.prod.yml -p volpehub run --rm api python manage.py migrate --noinput`.
   - Apply service updates: `docker compose -f docker-compose.prod.yml -p volpehub up -d --remove-orphans`.
   - Verify container health status via `/api/health/`.

### Manual CLI First-Deployment (Bootstrap on VPS)
```bash
cd /opt/volpehub
# Ensure .env is populated
./deploy.sh
```

---

## 6. Verification & Health Monitoring

To verify the running VolpeHub stack without affecting any other service:

```bash
# 1. Check container statuses
docker compose -f docker-compose.prod.yml -p volpehub ps

# 2. Check health endpoint directly
curl -I http://localhost:8000/api/health/
# Expected: HTTP/1.1 200 OK {"status":"ok","database":"ok","service":"volpehub-api"}

# 3. View API logs
docker compose -f docker-compose.prod.yml -p volpehub logs --tail=50 -f api

# 4. View Caddy proxy logs
docker compose -f docker-compose.prod.yml -p volpehub logs --tail=50 -f caddy
```

---

## 7. Rollback & Disaster Recovery

### Application Rollback
To roll back the container stack to the previous working release:

```bash
cd /opt/volpehub
./rollback.sh
```

Or roll back to a specific Git commit SHA:
```bash
cd /opt/volpehub
./rollback.sh 5e0e6a1...
```

### Database Restore Procedure
Database restore is **only** required if a destructive migration damaged application data.

```bash
cd /opt/volpehub
# List available backups
ls -lh ./backups/

# Restore specific dump file
./restore.sh ./backups/volpehub-20261019-120000.dump
```
