import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getEnv } from "../env";

const globalForDb = globalThis as unknown as {
  dbConn?: ReturnType<typeof postgres>;
};

export function getDb() {
  const env = getEnv();
  if (!globalForDb.dbConn) {
    globalForDb.dbConn = postgres(env.DATABASE_URL, { max: 10 });
  }
  return drizzle(globalForDb.dbConn, { schema });
}

export type Db = ReturnType<typeof getDb>;
