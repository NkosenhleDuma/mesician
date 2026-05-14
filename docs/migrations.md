# Database migrations (Kysely)

Schema changes are **versioned SQL/TS migrations** run by [Kysely’s `Migrator`](https://kysely.dev/docs/migrations). The app continues to use **Drizzle** for queries ([`src/lib/db/schema.ts`](../src/lib/db/schema.ts)); keep the ORM schema and migrations aligned.

## Commands

| Command | Action |
| --- | --- |
| `npm run db:migrate` | Apply all pending migrations (`migrateToLatest`) |
| `npm run db:migrate:down` | Roll back one migration (`migrateDown`) |
| `npm run db:push` | Drizzle-only introspect/push (escape hatch; prefer migrations for shared/prod DBs) |

Requires `DATABASE_URL` (see [`.env.example`](../.env.example)).

## Layout

- [`migrations/`](../migrations/) — one file per migration; name sorts alphabetically (e.g. `001_initial.ts`, `002_add_foo.ts`).
- [`scripts/migrate.ts`](../scripts/migrate.ts) — CLI entry (also used by Docker).

Kysely records applied migrations in tables `kysely_migration` and `kysely_migration_lock` (defaults).

## Docker

- **Slim image**: [`Dockerfile.migrate`](../Dockerfile.migrate) installs only `kysely`, `pg`, and `tsx`.
- **Compose**: [`docker-compose.local.yml`](../docker-compose.local.yml) defines a one-shot `migrate` service that waits for Postgres `healthcheck`, then runs `migrateToLatest` and exits.

```bash
docker compose --env-file .env -f docker-compose.local.yml up -d postgres minio migrate
```

Inside Compose, `DATABASE_URL` uses host `postgres`, not `localhost`.

## Existing databases (`drizzle-kit push` only)

If tables already exist from `drizzle-kit push` and match [`001_initial`](../migrations/001_initial.ts), **do not** run `001_initial` again. Either:

1. **Stamp** the migration (insert a row so Kysely treats it as applied). Kysely stores `timestamp` as an ISO **string** (`varchar`):

   ```sql
   INSERT INTO kysely_migration (name, timestamp)
   VALUES ('001_initial', '2026-01-19T12:00:00.000Z');
   ```

   The migration **name** must match the filename without extension (e.g. `001_initial` for `001_initial.ts`).

2. Or **dump/rebuild** a fresh database and run `npm run db:migrate` from empty.

## Adding a migration

1. Add `migrations/00X_description.ts` exporting `default { async up(db), async down(db) }`.
2. Update Drizzle [`schema.ts`](../src/lib/db/schema.ts) to match.
3. Run `npm run db:migrate` locally; in CI/prod run the same or rely on the `migrate` container.

Avoid drift: the migration is the source of truth for DDL; Drizzle should mirror it for types and relations.
