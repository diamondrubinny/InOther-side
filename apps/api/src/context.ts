import type { FastifyBaseLogger } from "fastify";
import type { Env } from "./config/env.js";
import type { Database } from "./db/client.js";
import { LocalKeyProvider, type KeyProvider } from "./lib/crypto/keys.js";
import { Hmac } from "./lib/crypto/tokens.js";
import { LogMailer, MemoryMailer, SmtpMailer, type Mailer } from "./lib/mailer.js";

/** Dependencies shared by all modules. Created once per process (or per test). */
export interface AppContext {
  env: Env;
  db: Database;
  keys: KeyProvider;
  hmac: Hmac;
  mailer: Mailer;
  log: FastifyBaseLogger;
  /** Injectable clock for deterministic tests. */
  now: () => Date;
}

export interface ContextOverrides {
  mailer?: Mailer;
  keys?: KeyProvider;
  now?: () => Date;
}

export function createContext(env: Env, db: Database, log: FastifyBaseLogger, overrides: ContextOverrides = {}): AppContext {
  const mailer =
    overrides.mailer ??
    (env.MAIL_TRANSPORT === "smtp"
      ? new SmtpMailer(env.SMTP_URL as string, env.MAIL_FROM)
      : env.MAIL_TRANSPORT === "memory"
        ? new MemoryMailer()
        : new LogMailer(log));
  return {
    env,
    db,
    keys: overrides.keys ?? new LocalKeyProvider(env.MASTER_KEY_BASE64, env.MASTER_KEY_ID),
    hmac: new Hmac(env.HMAC_SECRET_BASE64),
    mailer,
    log,
    now: overrides.now ?? (() => new Date()),
  };
}
