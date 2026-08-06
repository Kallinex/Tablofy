import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentsService } from './payments.service';
import { StripeProvider } from './providers/stripe.provider';
import { PaymobProvider } from './providers/paymob.provider';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [
    PaymentsService,
    {
      provide: 'STRIPE_PROVIDER_OPTIONS',
      useFactory: (config: ConfigService) => ({
        mode: (() => {
          const mode = config.get<'mock' | 'live'>('payments.mode', 'mock');
          return mode === 'live' && !config.get<string>('payments.stripeSecretKey', '')
            ? 'mock'
            : mode;
        })(),
        secretKey: config.get<string>('payments.stripeSecretKey', ''),
        webhookSecret: config.get<string>('payments.stripeWebhookSecret', ''),
        apiBase: config.get<string>('payments.stripeApiBase'),
      }),
      inject: [ConfigService],
    },
    {
      provide: StripeProvider,
      useFactory: (options: {
        mode: 'mock' | 'live';
        secretKey: string;
        webhookSecret: string;
        apiBase?: string;
      }) => new StripeProvider(options),
      inject: ['STRIPE_PROVIDER_OPTIONS'],
    },
    {
      provide: 'PAYMOB_PROVIDER_OPTIONS',
      useFactory: (config: ConfigService) => ({
        mode: (() => {
          const mode = config.get<'mock' | 'live'>('payments.mode', 'mock');
          return mode === 'live' && !config.get<string>('payments.paymobApiKey', '')
            ? 'mock'
            : mode;
        })(),
        apiKey: config.get<string>('payments.paymobApiKey', ''),
        integrationId: config.get<number>('payments.paymobIntegrationId', 0),
        webhookSecret: config.get<string>('payments.paymobWebhookSecret', ''),
        apiBase: config.get<string>('payments.paymobApiBase'),
      }),
      inject: [ConfigService],
    },
    {
      provide: PaymobProvider,
      useFactory: (options: {
        mode: 'mock' | 'live';
        apiKey: string;
        integrationId: number;
        webhookSecret: string;
        apiBase?: string;
      }) => new PaymobProvider(options),
      inject: ['PAYMOB_PROVIDER_OPTIONS'],
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
