import { IntegrationProvider, IntegrationResult } from './integration-provider.interface';

export interface EmailData {
  to: string | string[];
  subject: string;
  body: string;
  htmlBody?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

export interface SmsData {
  to: string;
  body: string;
  senderId?: string;
}

export interface WhatsAppData {
  to: string;
  templateName?: string;
  body: string;
  mediaUrl?: string;
  parameters?: Record<string, string>;
}

export interface EmailProvider extends IntegrationProvider {
  send(data: EmailData): Promise<IntegrationResult<{ messageId: string }>>;
  verifyAddress(email: string): Promise<IntegrationResult<boolean>>;
}

export interface SmsProvider extends IntegrationProvider {
  send(data: SmsData): Promise<IntegrationResult<{ messageId: string }>>;
}

export interface WhatsAppProvider extends IntegrationProvider {
  send(data: WhatsAppData): Promise<IntegrationResult<{ messageId: string }>>;
  verifyNumber(phone: string): Promise<IntegrationResult<boolean>>;
}
