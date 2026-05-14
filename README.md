# Mesician

Web app for Guitar Pro–based guitar practice: upload `.gp` / `.gp3` / `.gp4` / `.gp5` / `.gpx`, classify track difficulty from the uploaded tab, practice the original arrangement in a PixiJS note highway, use simple synthesized playback, and store latency per browser.

## Stack

- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4
- PostgreSQL (Drizzle ORM for queries, [Kysely](https://kysely.dev/) for versioned migrations), MinIO (S3-compatible storage)
- [@coderline/alphatab](https://www.alphatab.net/) for Guitar Pro import
- PixiJS 8 for the highway renderer

## Quick start (local, without Docker for the app)

1. **Environment file**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` if you change Postgres or MinIO credentials. Compose and `npm run dev` both read these values (Next.js loads `.env` automatically).

2. **Start Postgres and MinIO** (app runs on the host with `npm run dev`; the `app` service in `docker-compose.local.yml` stays commented out):

   ```bash
   docker compose --env-file .env -f docker-compose.local.yml up -d postgres minio migrate
   ```

   The `migrate` service runs [Kysely migrations](docs/migrations.md) once Postgres is healthy, then exits. To start infra only and run migrations manually: `up -d postgres minio` then `npm run db:migrate`.

3. **Environment variables** (see [`.env.example`](.env.example) for the full list):

   | Variable | Example |
   | --- | --- |
   | `DATABASE_URL` | `postgres://mesician:mesician@localhost:5432/mesician` |
   | `JWT_SECRET` | Long random string (min 16 chars) |
   | `S3_ENDPOINT` | `http://localhost:9000` |
   | `S3_ACCESS_KEY` | `minio` |
   | `S3_SECRET_KEY` | `minio12345` |
   | `S3_BUCKET` | `mesician` |

4. **Database schema**

   ```bash
   npm run db:migrate
   ```

   (Skip if the `migrate` Compose service already ran successfully.) Optional Drizzle shortcut for local prototyping only: `npm run db:push`.

5. **Run the app**

   ```bash
   npm install
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Sign up, create a song, upload a GP file, then open a track under **Practice**.

## Reset for this schema change

When switching from the old level-derivation model to the new difficulty-classification model, wipe stored data first:

```bash
docker compose down -v
```

Then clear the MinIO bucket, run `npm run db:migrate`, and re-upload Guitar Pro files so difficulty is recomputed from the fresh ingest.

## Full stack with Docker (app + Postgres + MinIO)

Production-oriented file: [`docker-compose.prod.yml`](docker-compose.prod.yml). It runs a one-shot `migrate` service before `app` (same [`Dockerfile.migrate`](Dockerfile.migrate) as local). Set `DATABASE_URL` to use the Docker service hostname `postgres` (e.g. `postgres://USER:PASS@postgres:5432/DB`), not `localhost`, for services inside Compose.

```bash
docker compose --env-file .env -f docker-compose.prod.yml up --build -d
```

The app image entrypoint ([`docker-entrypoint.sh`](docker-entrypoint.sh)) runs `npm run db:migrate` (via `tsx scripts/migrate.ts`) before `next start`, so schema stays applied even without the separate `migrate` service.

## Documentation

- [Architecture overview](docs/architecture.md)
- [Troubleshooting (MinIO storage, etc.)](docs/troubleshooting.md)
- [Database migrations (Kysely)](docs/migrations.md)
- [Chart JSON schema (`chart.json`)](docs/chart-json.md)
- [HTTP API (Route Handlers)](docs/api.md)
- [Mic scoring / note recognition (implementation)](NOTE_RECOGNITION_README.md)

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Routes, UI, API route handlers |
| `src/lib/db/` | Drizzle schema and DB client |
| `migrations/` | Kysely migration files |
| `scripts/migrate.ts` | Migration CLI |
| `src/lib/gp/` | Guitar Pro → internal chart |
| `src/lib/chart/` | `chart.json` types, difficulty classification, merge |
| `src/lib/audio/` | Web Audio transport + simple synth scheduling |
| `src/lib/scoring/` | Onset-driven mic scoring (worklet FFT + YIN / harmonic verify) |
| `src/components/practice/` | Pixi highway + practice shell |

## Ops notes

- MinIO bucket is created on first `putObject` (`ensureBucket` in `src/lib/s3/client.ts`).
- Raw uploads live under `songs/{songId}/uploads/`; machine charts under `.../machine/chart.json`; effective source charts under `.../source/chart.json`; user edits under `.../user/chart.json`.
