import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

@Global()
@Module({
  providers: [
    {
      provide: 'SENTRY_INIT',
      useFactory: (configService: ConfigService) => {
        const dsn = configService.get<string>('sentry.dsn', '');
        const enabled = configService.get<boolean>('sentry.enabled', false);
        if (process.env.SENTRY_ENABLED === 'true' && !process.env.SENTRY_DSN) {
          Logger.warn(
            'SENTRY_ENABLED=true but SENTRY_DSN is not set. Sentry error tracking will be disabled.',
            'SentryModule',
          );
        }
        if (enabled && dsn) {
          Sentry.init({
            dsn,
            environment: configService.get('sentry.environment', 'development'),
            tracesSampleRate: configService.get('sentry.tracesSampleRate', 0.1),
            integrations: [
              Sentry.httpIntegration(),
              Sentry.onUncaughtExceptionIntegration(),
              Sentry.onUnhandledRejectionIntegration(),
            ],
            attachStacktrace: true,
          });
        }
        return Sentry;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['SENTRY_INIT'],
})
export class SentryModule {}
