import type { FastifyBaseLogger } from "fastify";
import type { Env } from "./config/env.js";
import type { Database } from "./db/client.js";
import { LocalKeyProvider, type KeyProvider } from "./lib/crypto/keys.js";
import { Hmac } from "./lib/crypto/tokens.js";
import { LogMailer, MemoryMailer, SmtpMailer, type Mailer } from "./lib/mailer.js";
import { BullMediaQueue, type MediaQueue } from "./lib/queue.js";
import { ClamdScanner, NoopScanner, type MalwareScanner } from "./lib/scanner.js";
import { createStorage, type ObjectStorage } from "./lib/storage.js";

/** Dependencies shared by all modules. Created once per process (or per test). */
export interface AppContext {
  env: Env;
  db: Database;
  keys: KeyProvider;
  hmac: Hmac;
  mailer: Mailer;
  storage: ObjectStorage;
  scanner: MalwareScanner;
  mediaQueue: MediaQueue;
  log: FastifyBaseLogger;
  /** Injectable clock for deterministic tests. */
  now: () => Date;
}

export interface ContextOverrides {
  mailer?: Mailer;
  keys?: KeyProvider;
  storage?: ObjectStorage;
  scanner?: MalwareScanner;
  mediaQueue?: MediaQueue;
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
  const scanner =
    overrides.scanner ??
    (env.SCANNER === "clamd" ? new ClamdScanner(env.CLAMD_HOST, env.CLAMD_PORT, env.CLAMD_TIMEOUT_MS) : new NoopScanner());
  if (scanner.name === "noop") log.warn("malware scanning is DISABLED (SCANNER=noop); development only");
  return {
    env,
    db,
    keys: overrides.keys ?? new LocalKeyProvider(env.MASTER_KEY_BASE64, env.MASTER_KEY_ID),
    hmac: new Hmac(env.HMAC_SECRET_BASE64),
    mailer,
    storage: overrides.storage ?? createStorage(env),
    scanner,
    mediaQueue: overrides.mediaQueue ?? new BullMediaQueue(env.REDIS_URL),
    log,
    now: overrides.now ?? (() => new Date()),
  };
}
