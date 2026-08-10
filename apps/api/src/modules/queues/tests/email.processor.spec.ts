import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailProcessor } from '../email.processor';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

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
});
