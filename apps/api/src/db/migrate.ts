import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl, 1);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}

// Allow `tsx src/db/migrate.ts`.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log("Migrations applied");
    })
    .catch((err: unknown) => {
      console.error("Migration failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
