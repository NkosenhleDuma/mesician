import { sql, type Kysely } from "kysely";

const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE note_game_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        config jsonb NOT NULL,
        result jsonb NOT NULL,
        started_at timestamptz NOT NULL,
        ended_at timestamptz NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE INDEX note_game_sessions_user_started_idx
      ON note_game_sessions (user_id, started_at DESC)
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS note_game_sessions CASCADE`.execute(db);
  },
};

export default migration;
