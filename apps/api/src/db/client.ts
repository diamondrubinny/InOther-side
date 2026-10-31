import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;
/** Either the root db handle or a transaction handle. */
export type DbExecutor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute" | "transaction">;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDb(url: string, poolMax: number): DbHandle {
  const client = postgres(url, {
    max: poolMax,
    // Never let Postgres notices (which may contain data) hit stdout.
    onnotice: () => {},
    connection: { application_name: "inother-api" },
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
