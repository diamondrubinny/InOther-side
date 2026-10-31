import net from "node:net";
import type { Readable } from "node:stream";

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface MalwareScanner {
  /** Throws on scanner failure (unreachable, timeout, protocol error) so callers can fail closed. */
  scan(stream: Readable): Promise<ScanResult>;
  readonly name: string;
}

/**
 * ClamAV daemon client using the INSTREAM command:
 *   "zINSTREAM\0" then chunks of <uint32 BE length><bytes>, terminated by a zero-length chunk.
 * Reply: "stream: OK\0" | "stream: <Signature> FOUND\0" | "<reason> ERROR\0".
 * NOTE: clamd's StreamMaxLength must be >= the largest allowed upload, otherwise clamd
 * returns "INSTREAM size limit exceeded" and the file is treated as a scan failure (fail closed).
 */
export class ClamdScanner implements MalwareScanner {
  readonly name = "clamd";
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  scan(stream: Readable): Promise<ScanResult> {
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let reply = "";
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        socket.destroy();
        reject(err);
      };
      socket.setTimeout(this.timeoutMs, () => fail(new Error("clamd timeout")));
      socket.on("error", fail);
      stream.on("error", fail);
      socket.on("data", (d) => {
        reply += d.toString("utf8");
        if (reply.length > 4096) fail(new Error("clamd reply too long"));
      });
      socket.on("end", () => {
        if (settled) return;
        settled = true;
        const text = reply.replace(/\0/g, "").trim();
        if (text === "stream: OK") return resolve({ clean: true });
        const found = /^stream: (.+) FOUND$/.exec(text);
        if (found?.[1]) return resolve({ clean: false, signature: found[1].slice(0, 200) });
        reject(new Error(`clamd error: ${text.slice(0, 200)}`));
      });

      socket.once("connect", async () => {
        try {
          socket.write("zINSTREAM\0");
          for await (const chunk of stream) {
            const buf = chunk as Buffer;
            const len = Buffer.alloc(4);
            len.writeUInt32BE(buf.length);
            if (!socket.write(Buffer.concat([len, buf]))) {
              await new Promise<void>((r) => socket.once("drain", () => r()));
            }
            if (settled) return;
          }
          socket.end(Buffer.alloc(4)); // zero-length terminator
        } catch (err) {
          fail(err as Error);
        }
      });
    });
  }
}

/** Development only: performs NO scan. Refused in production by config validation. */
export class NoopScanner implements MalwareScanner {
  readonly name = "noop";
  async scan(stream: Readable): Promise<ScanResult> {
    for await (const _ of stream) {
      // drain
    }
    return { clean: true };
  }
}
