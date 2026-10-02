import { registerAs } from '@nestjs/config';

export interface SmsConfig {
  /** Health-probe endpoint of the SMS gateway; empty when SMS is not configured. */
  providerUrl: string;
  /** Optional bearer token sent with the health probe. */
  apiKey: string;
}

export default registerAs(
  'sms',
  (): SmsConfig => ({
    providerUrl: process.env.SMS_PROVIDER_URL || '',
    apiKey: process.env.SMS_API_KEY || '',
  }),
);
