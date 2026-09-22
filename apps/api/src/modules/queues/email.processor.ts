import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService, QueueJobData } from './queue.service';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

interface EmailAttachment {
  filename: string;
  path?: string;
  content?: Buffer;
  contentType?: string;
}

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: EmailAttachment[];
}

@Injectable()
export class EmailProcessor implements OnModuleInit {
  private readonly logger = new Logger(EmailProcessor.name);
  private transporter?: Transporter;

  constructor(
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.queueService.registerWorker('email', this.process.bind(this), 3);
    if (!this.configService.get<string>('smtp.host', '')) {
      this.logger.warn(
        'Email transport is not configured (SMTP_HOST unset). Email jobs will fail, retry, and dead-letter.',
      );
    }
    this.logger.log('Email processor registered');
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.configService.get<string>('smtp.host', '');
    if (!host) {
      throw new Error(
        'Email transport is not configured. Set SMTP_HOST (plus SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM) before enqueueing email jobs. The job fails, is retried, and dead-letters instead of being silently marked as sent.',
      );
    }

    const port = this.configService.get<number>('smtp.port', 587);
    const secure = this.configService.get<boolean>('smtp.secure', false);
    const user = this.configService.get<string>('smtp.user', '');
    const pass = this.configService.get<string>('smtp.pass', '');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
    return this.transporter;
  }

  async process(job: Job<QueueJobData>): Promise<{ sent: boolean; to: string }> {
    const { tenantId, payload } = job.data;
    const {
      to,
      subject,
      body,
      html,
      attachments: rawAttachments,
    } = payload as unknown as EmailPayload;

    if (!to || !subject) {
      throw new Error('Email job is missing required payload fields (to, subject)');
    }

    const transporter = this.getTransporter();
    const from =
      this.configService.get<string>('smtp.from', '') ||
      this.configService.get<string>('smtp.user', '');
    if (!from) {
      throw new Error(
        'SMTP_FROM (or SMTP_USER) is required to send email. Set SMTP_FROM before enqueueing email jobs.',
      );
    }

    const attachments: nodemailer.SendMailOptions['attachments'] = [];
    for (const attachment of rawAttachments ?? []) {
      if (attachment.path !== undefined && attachment.path !== null) {
        const content = await this.readAttachment(attachment.path);
        attachments.push({
          filename: attachment.filename,
          content,
          contentType: attachment.contentType,
        });
      } else if (attachment.content) {
        attachments.push({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        });
      }
    }

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: body,
      html,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    this.logger.log(
      `[Email] Sent to ${to} for tenant ${tenantId}: ${subject} (id: ${info.messageId})`,
    );
    await job.updateProgress(100);

    return { sent: true, to };
  }

  private async readAttachment(filePath: string): Promise<Buffer> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('Email attachment path is invalid');
    }

    const root = path.resolve(
      this.configService.get<string>('EXPORT_DIR', path.join(process.cwd(), 'exports')),
    );
    const resolved = path.resolve(filePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('Email attachment path is invalid');
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolved);
    } catch {
      throw new Error(`Email attachment file is missing: ${filePath}`);
    }
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Email attachment file is missing or empty: ${filePath}`);
    }

    return fs.promises.readFile(resolved);
  }
}
