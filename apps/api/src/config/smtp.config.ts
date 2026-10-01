import { registerAs } from '@nestjs/config';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export default registerAs('smtp', (): SmtpConfig => {
  const host = process.env.SMTP_HOST || '';
  const from = process.env.SMTP_FROM || '';

  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!host) missing.push('SMTP_HOST');
    if (!from) missing.push('SMTP_FROM');
    if (missing.length > 0) {
      throw new Error(
        `Production environment requires ${missing.join(' and ')}. Without a configured mail ` +
          'transport, email jobs (password reset, invitations, scheduled reports) fail, retry and ' +
          'dead-letter. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM before deploying.',
      );
    }
  }

  return {
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from,
  };
});
