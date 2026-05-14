# Troubleshooting

## MinIO: `XMinioStorageFull` / “minimum free drive threshold”

**Symptom:** Uploads fail with `XMinioStorageFull` or “Storage backend has reached its minimum free drive threshold” (often surfacing from `putObject` in `src/lib/s3/client.ts`).

**Cause:** MinIO refuses writes when the **filesystem that holds its data directory** does not have enough free space. Open-source MinIO historically enforces on the order of **~900 MiB** free on that filesystem. `PUT` may also **stage** data on the same disk before committing, so margins need to stay comfortable.

Docker **named volumes** usually live under Docker’s data root (often on your **root** `/` partition). That disk can be almost full while another mount (e.g. where you cloned the repo) still has plenty of space—so uploads fail even though your project drive looks fine.

**What to do**

1. See **which** disk is tight: `df -h`, and `docker system df` for Docker’s usage.
2. Free space on the disk that actually backs Docker storage (often **>1 GiB** headroom), or prune unused images/containers with care: `docker system prune` (review what it will remove).
3. Remove unneeded objects in the MinIO console (e.g. `http://localhost:9001`) or empty the dev bucket if safe.
4. **Local compose:** [`docker-compose.local.yml`](../docker-compose.local.yml) bind-mounts MinIO to `./.docker/minio-data` so object data sits on the **same filesystem as the repository**. After switching from an old named volume, recreate the stack; see below if you need old data.

**Optional: copy data from an old Docker volume**

If you previously used a named volume `miniodata` and need those objects after moving to the bind mount, you can copy once (adjust volume name from `docker volume ls`):

```bash
docker compose --env-file .env -f docker-compose.local.yml down
mkdir -p .docker/minio-data
docker run --rm -v mesician_miniodata:/from -v "$(pwd)/.docker/minio-data:/to" busybox cp -a /from/. /to/
docker compose --env-file .env -f docker-compose.local.yml up -d minio
```

The prefix `mesician_` depends on your Compose project name; use the actual volume name from `docker volume ls`.
