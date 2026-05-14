import { sql, type Kysely } from "kysely";

/**
 * Baseline schema — keep in sync with [src/lib/db/schema.ts](../src/lib/db/schema.ts).
 * If your DB was created earlier with `drizzle-kit push`, stamp this migration instead of re-running:
 * insert into kysely_migration (name, timestamp) values ('001_initial', now());
 */
const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(255) NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db);

    await sql`
      CREATE TABLE songs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        title varchar(512) NOT NULL,
        artist varchar(512),
        difficulty integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db);

    await sql`
      CREATE TABLE song_uploads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        song_id uuid NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
        filename varchar(1024) NOT NULL,
        gp_format varchar(8) NOT NULL,
        minio_object_key text NOT NULL,
        uploaded_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db);

    await sql`
      CREATE TABLE song_tracks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        song_id uuid NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
        track_index integer NOT NULL,
        name varchar(512) NOT NULL,
        instrument varchar(256),
        tuning_json jsonb,
        is_guitar boolean NOT NULL DEFAULT true,
        source_chart_object_key text,
        user_chart_object_key text,
        has_notes boolean NOT NULL DEFAULT true,
        difficulty integer NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE TABLE practice_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        track_id uuid NOT NULL REFERENCES song_tracks (id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        score_json jsonb
      )
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS practice_sessions CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS song_tracks CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS song_uploads CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS songs CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS users CASCADE`.execute(db);
  },
};

export default migration;
