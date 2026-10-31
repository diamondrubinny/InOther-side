import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Env } from "../config/env.js";

/**
 * Object storage abstraction. Everything written here is already encrypted by the application
 * (see lib/crypto/stream.ts); storage never sees plaintext media.
 */
export interface ObjectStorage {
  put(key: string, body: Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]{0,250}$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) throw new Error("unsafe storage key");
}

/** Filesystem storage for development and tests. Not for production (no redundancy). */
export class LocalStorage implements ObjectStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("unsafe storage key");
    return full;
  }

  async put(key: string, body: Readable): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.part`;
    try {
      await pipeline(body, createWriteStream(tmp, { mode: 0o600 }));
      await rename(tmp, full);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<Readable> {
    const full = this.resolve(key);
    await stat(full); // throws if missing
    return createReadStream(full);
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.resolve(key))).size;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafeKey(prefix.replace(/\/$/, ""));
    await rm(this.resolve(prefix.replace(/\/$/, "")), { recursive: true, force: true });
  }
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    opts: { region: string; endpoint?: string; forcePathStyle: boolean },
    private readonly kmsKeyId?: string,
  ) {
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      forcePathStyle: opts.forcePathStyle,
    });
  }

  async put(key: string, body: Readable): Promise<void> {
    assertSafeKey(key);
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
        ...(this.kmsKeyId ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: this.kmsKeyId } : {}),
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
    });
    await upload.done();
  }

  async get(key: string): Promise<Readable> {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!(res.Body instanceof Readable)) throw new Error("unexpected S3 body type");
    return res.Body;
  }

  async size(key: string): Promise<number | null> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (list.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}

export function createStorage(env: Env): ObjectStorage {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3Storage(
      env.S3_BUCKET as string,
      { region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE },
      env.S3_SSE_KMS_KEY_ID,
    );
  }
  return new LocalStorage(env.STORAGE_LOCAL_DIR);
}

/** Storage key layout. IDs are server-generated UUIDs; user file names are never used. */
export const mediaKeys = {
  quarantine: (vaultId: string, assetId: string) => `quarantine/${vaultId}/${assetId}`,
  content: (vaultId: string, assetId: string) => `media/${vaultId}/${assetId}`,
  vaultPrefixes: (vaultId: string) => [`quarantine/${vaultId}/`, `media/${vaultId}/`],
};
