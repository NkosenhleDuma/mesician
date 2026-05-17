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

---

## Practice feels half-speed or highway timing looks wrong on old uploads

**Symptom:** Notes drift badly relative to synth playback, or everything feels ~**2× too slow** unless you crank playback speed.

**Cause:** Stored `chart.json` was generated with an ingest bug (tick→seconds used **480** ticks per quarter instead of AlphaTab’s **960**). Charts already in MinIO keep stale times until re-ingested.

**What to do**

1. Upgrade to a build that includes the TPQ fix in `src/lib/gp/parse.ts` (`TICKS_PER_QUARTER === 960`).
2. **Re-upload** the Guitar Pro file for affected songs (or delete ingestion / tracks and upload again) so `machine/` and effective `source/` charts are regenerated.

See [architecture.md](architecture.md) for how GP timing is derived.

---

## Highway gaps before repeats were fixed

If an older chart showed **empty timeline space** around repeat marks while Guitar Pro playback did not: that came from using first-pass-only `beat.timer` values. Current ingest walks **`MidiTickLookup`** in playback order so repeats expand correctly. **Re-upload** the GP file to refresh stored charts.
