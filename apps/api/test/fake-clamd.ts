import net from "node:net";

/** The standard, harmless EICAR antivirus test string. */
export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * Minimal clamd INSTREAM server for tests. Speaks the real wire protocol so the production
 * ClamdScanner client is exercised end to end. Flags any stream containing the EICAR string.
 */
export class FakeClamd {
  private server: net.Server;
  port = 0;
  /** When true, the server drops connections (simulates clamd being down / crashing). */
  failing = false;
  scans = 0;

  constructor() {
    this.server = net.createServer((socket) => {
      if (this.failing) return socket.destroy();
      let buf = Buffer.alloc(0);
      let commandRead = false;
      const body: Buffer[] = [];
      socket.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (!commandRead) {
          const cmd = "zINSTREAM\0";
          if (buf.length < cmd.length) return;
          if (buf.subarray(0, cmd.length).toString() !== cmd) return socket.end("UNKNOWN COMMAND\0");
          buf = buf.subarray(cmd.length);
          commandRead = true;
        }
        while (buf.length >= 4) {
          const len = buf.readUInt32BE(0);
          if (len === 0) {
            this.scans++;
            const content = Buffer.concat(body).toString("latin1");
            socket.end(content.includes(EICAR) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
            return;
          }
          if (buf.length < 4 + len) return;
          body.push(buf.subarray(4, 4 + len));
          buf = buf.subarray(4 + len);
        }
      });
      socket.on("error", () => {});
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
