import nodemailer, { type Transporter } from "nodemailer";
import type { FastifyBaseLogger } from "fastify";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Real delivery via SMTP (use a provider with a signed DPA, EU region). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/**
 * Development only: logs that an email was sent. The body (which contains a one-time link)
 * is printed only at debug level so it never reaches production logs.
 */
export class LogMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}
  async send(message: MailMessage): Promise<void> {
    this.log.info({ subject: message.subject }, "email queued (log transport)");
    this.log.debug({ to: message.to, text: message.text }, "email body (dev only)");
  }
}

/** Tests: keeps messages in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}
