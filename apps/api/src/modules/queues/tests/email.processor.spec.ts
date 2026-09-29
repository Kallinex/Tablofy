import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailProcessor } from '../email.processor';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn((..._args: unknown[]) => ({ sendMail: mockSendMail }));

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => mockCreateTransport(...args),
}));

const queueServiceMock = {
  registerWorker: jest.fn(),
};

type ConfigMap = Record<string, string | number | boolean>;

function makeConfig(map: ConfigMap) {
  return {
    get: jest.fn((key: string, fallback?: unknown) => (key in map ? map[key] : fallback)),
  };
}

function makeJob(data: Record<string, unknown>, name = 'send-email'): Job {
  return { data, name, updateProgress: jest.fn().mockResolvedValue(undefined) } as unknown as Job;
}

const DEFAULT_CONFIG: ConfigMap = {
  'smtp.host': 'smtp.example.com',
  'smtp.port': 587,
  'smtp.secure': false,
  'smtp.user': 'user@example.com',
  'smtp.pass': 'super-secret-pass',
  'smtp.from': 'no-reply@example.com',
};

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let configMap: ConfigMap;

  beforeEach(() => {
    jest.clearAllMocks();
    configMap = { ...DEFAULT_CONFIG };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    processor = new EmailProcessor(queueServiceMock as never, makeConfig(configMap) as never);
    mockSendMail.mockResolvedValue({ messageId: 'm-1' });
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('registers an email worker on init', () => {
    processor.onModuleInit();
    expect(queueServiceMock.registerWorker).toHaveBeenCalledWith('email', expect.any(Function), 3);
  });

  it('warns on init when SMTP_HOST is not configured', () => {
    delete configMap['smtp.host'];
    processor.onModuleInit();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST'));
  });

  it('does not warn on init when SMTP is configured', () => {
    processor.onModuleInit();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('sends email successfully with valid configuration', async () => {
    const job = makeJob({
      tenantId: 'tenant-1',
      payload: {
        to: 'client@example.com',
        subject: 'Welcome',
        body: 'Hello',
        html: '<p>Hello</p>',
      },
    });

    const result = await processor.process(job);

    expect(result).toEqual({ sent: true, to: 'client@example.com' });
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user@example.com', pass: 'super-secret-pass' },
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'client@example.com',
      subject: 'Welcome',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('falls back to smtp.user as the from address when SMTP_FROM is absent', async () => {
    delete configMap['smtp.from'];
    const job = makeJob({
      payload: { to: 'a@b.com', subject: 'S', body: 'B' },
    });

    await processor.process(job);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'user@example.com' }),
    );
  });

  it('reuses a cached transporter across jobs', async () => {
    const job = makeJob({ payload: { to: 'a@b.com', subject: 'S', body: 'B' } });
    await processor.process(job);
    await processor.process(job);

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });

  it('fails explicitly when SMTP_HOST is missing', async () => {
    delete configMap['smtp.host'];
    const job = makeJob({ payload: { to: 'a@b.com', subject: 'S', body: 'B' } });

    await expect(processor.process(job)).rejects.toThrow('Email transport is not configured');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('fails explicitly when neither SMTP_FROM nor SMTP_USER is set', async () => {
    delete configMap['smtp.from'];
    delete configMap['smtp.user'];
    const job = makeJob({ payload: { to: 'a@b.com', subject: 'S', body: 'B' } });

    await expect(processor.process(job)).rejects.toThrow('SMTP_FROM');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('fails when the email job payload is malformed', async () => {
    const job = makeJob({ payload: { body: 'missing to and subject' } });

    await expect(processor.process(job)).rejects.toThrow('missing required payload fields');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('propagates provider failures so BullMQ can retry then dead-letter', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP 550 mailbox unavailable'));
    const job = makeJob({ payload: { to: 'a@b.com', subject: 'S', body: 'B' } });

    await expect(processor.process(job)).rejects.toThrow('SMTP 550 mailbox unavailable');
  });

  it('does not log SMTP credentials', async () => {
    const job = makeJob({ payload: { to: 'a@b.com', subject: 'S', body: 'B' } });

    await processor.process(job);

    const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(allLogs).not.toContain('super-secret-pass');
  });

  describe('attachments', () => {
    let tempRoot: string;

    beforeEach(async () => {
      tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'email-attach-'));
      configMap['EXPORT_DIR'] = tempRoot;
    });

    afterEach(async () => {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    it('attaches a real file from disk to the email', async () => {
      const filePath = path.join(tempRoot, 'report.csv');
      const content = Buffer.from('id,status\r\n1,PAID\r\n');
      await fs.promises.writeFile(filePath, content);

      const job = makeJob({
        payload: {
          to: 'owner@example.com',
          subject: 'Scheduled report',
          body: 'Ready',
          attachments: [{ filename: 'report.csv', path: filePath, contentType: 'text/csv' }],
        },
      });

      await processor.process(job);

      const sendCall = mockSendMail.mock.calls[0][0];
      expect(sendCall.attachments).toEqual([
        {
          filename: 'report.csv',
          content: Buffer.from('id,status\r\n1,PAID\r\n'),
          contentType: 'text/csv',
        },
      ]);
    });

    it('supports inline content attachments without touching disk', async () => {
      const job = makeJob({
        payload: {
          to: 'a@b.com',
          subject: 'S',
          body: 'B',
          attachments: [{ filename: 'a.csv', content: Buffer.from('x') }],
        },
      });

      await processor.process(job);

      expect(mockSendMail.mock.calls[0][0].attachments).toEqual([
        { filename: 'a.csv', content: Buffer.from('x'), contentType: undefined },
      ]);
    });

    it('fails explicitly when an attachment file is missing (so the job retries)', async () => {
      const job = makeJob({
        payload: {
          to: 'a@b.com',
          subject: 'S',
          body: 'B',
          attachments: [{ filename: 'missing.csv', path: path.join(tempRoot, 'missing.csv') }],
        },
      });

      await expect(processor.process(job)).rejects.toThrow(
        'Email attachment file is missing: ' + path.join(tempRoot, 'missing.csv'),
      );
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('fails explicitly when an attachment file is empty', async () => {
      const filePath = path.join(tempRoot, 'empty.csv');
      await fs.promises.writeFile(filePath, '');

      const job = makeJob({
        payload: {
          to: 'a@b.com',
          subject: 'S',
          body: 'B',
          attachments: [{ filename: 'empty.csv', path: filePath }],
        },
      });

      await expect(processor.process(job)).rejects.toThrow('missing or empty');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('rejects an attachment path outside the export root', async () => {
      const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'email-outside-'));
      try {
        const job = makeJob({
          payload: {
            to: 'a@b.com',
            subject: 'S',
            body: 'B',
            attachments: [{ filename: 'secret.txt', path: path.join(outside, 'secret.txt') }],
          },
        });

        await expect(processor.process(job)).rejects.toThrow('Email attachment path is invalid');
        expect(mockSendMail).not.toHaveBeenCalled();
      } finally {
        await fs.promises.rm(outside, { recursive: true, force: true });
      }
    });

    it('rejects an empty or non-string attachment path', async () => {
      const job = makeJob({
        payload: {
          to: 'a@b.com',
          subject: 'S',
          body: 'B',
          attachments: [{ filename: 'x.csv', path: '' }],
        },
      });

      await expect(processor.process(job)).rejects.toThrow('Email attachment path is invalid');
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });
});
