/**
 * Kysely migrator — run from repo root: `npm run db:migrate`
 * Requires DATABASE_URL. Uses pg + PostgresDialect (app code may keep postgres.js + Drizzle).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from "kysely";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationFolder = path.join(__dirname, "..", "migrations");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = new Kysely({
    dialect: new PostgresDialect({ pool }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });

  const cmd = process.argv[2];
  const { error, results } =
    cmd === "down" ? await migrator.migrateDown() : await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === "Success") {
      console.log(`migration "${it.migrationName}" (${it.direction}) ok`);
    } else if (it.status === "Error") {
      console.error(`migration "${it.migrationName}" failed`);
    }
  });

  await db.destroy();

  if (error) {
    console.error(error);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
