import postgres from "postgres";
import { rm } from "node:fs/promises";

/** Starts every run from a clean database and storage directory. */
export default async function globalSetup(): Promise<void> {
  const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://inother:inother_dev@localhost:5432/inother_e2e", { onnotice: () => {} });
  try {
    const [row] = await sql`SELECT to_regclass('public.users') AS t`;
    if (row?.t) await sql`TRUNCATE users, audit_log CASCADE`;
  } finally {
    await sql.end();
  }
  await rm("/tmp/inother-e2e-storage", { recursive: true, force: true });
}
