import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app/app.module';
import { collectConfigWarnings } from './config/config-warnings';
import { AppLoggerService } from './common/logger/logger.service';
import { SocketIoAdapter } from './common/ws/socket-io.adapter';
import { BullBoardModule, BULL_BOARD_PATH } from './common/bull-board/bull-board.module';
import { createSwaggerBasicAuthMiddleware } from './common/security/swagger-auth.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.enableShutdownHooks(['SIGINT', 'SIGTERM'], { useProcessExit: true });

  const configService = app.get(ConfigService);
  const logger = await app.resolve(AppLoggerService);
  logger.setContext('Bootstrap');

  app.useLogger(logger);

  const port = configService.get<number>('app.port') ?? 3000;
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api';
  const corsOrigins = configService.get<string[]>('app.corsOrigins') ?? ['http://localhost:4200'];
  const corsCredentials = configService.get<boolean>('app.corsCredentials') ?? true;
  const nodeEnv = configService.get<string>('app.nodeEnv') ?? 'development';
  const isProduction = nodeEnv === 'production';
  const shutdownTimeoutMs = configService.get<number>('app.shutdownTimeoutMs') ?? 15000;
  const sentryEnabled = configService.get<boolean>('sentry.enabled', false);

  // Non-fatal production checks: surface degraded observability instead of
  // silently booting a process that operators cannot monitor.
  for (const warning of collectConfigWarnings(configService)) {
    logger.warn(warning);
  }

  app.setGlobalPrefix(apiPrefix);

  // Behind a reverse proxy (nginx / ALB / Cloudflare) every request would otherwise
  // share a single request.ip, collapsing the per-IP rate-limit budget of all users
  // into one bucket. TRUST_PROXY accepts a hop count (e.g. "1") or Express values
  // ("loopback", "linklocal", "uniquelocal", true). Unset = proxy headers ignored.
  const trustProxyRaw = (configService.get<string>('app.trustProxy') ?? '').trim();
  if (trustProxyRaw !== '' && trustProxyRaw.toLowerCase() !== 'false') {
    const hops = Number(trustProxyRaw);
    app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : trustProxyRaw);
    logger.log(`trust proxy enabled: ${String(trustProxyRaw)}`);
  } else if (isProduction) {
    logger.warn(
      'TRUST_PROXY is not set. If this API runs behind a reverse proxy/load balancer, ' +
        'all requests share one request.ip and the per-IP rate limit will throttle every user together. ' +
        'Set TRUST_PROXY to the number of proxy hops (e.g. 1).',
    );
  }

  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
    defaultVersion: '1',
  });

  app.enableCors({
    origin: isProduction ? corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: corsCredentials,
  });

  app.useWebSocketAdapter(new SocketIoAdapter(app));

  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              fontSrc: ["'self'"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: isProduction,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: isProduction
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
      ieNoOpen: true,
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    }),
  );

  // Compress JSON/text responses over the threshold. Disabled with
  // COMPRESSION_ENABLED=false (e.g. when a CDN/reverse proxy already compresses).
  const compressionEnabled = configService.get<boolean>('app.compressionEnabled') ?? true;
  const compressionThreshold = configService.get<number>('app.compressionThreshold') ?? 1024;
  if (compressionEnabled) {
    app.use(compression({ threshold: compressionThreshold }));
  }

  // Serve uploaded images. The upload directory is created on boot so the
  // static middleware always has a valid root. CORP is relaxed to cross-origin
  // so the SPA (often on a different origin than the API) can render them.
  const uploadDirectory =
    configService.get<string>('upload.directory') ?? join(process.cwd(), 'uploads');
  try {
    mkdirSync(uploadDirectory, { recursive: true });
  } catch (error) {
    logger.warn(
      `Upload directory "${uploadDirectory}" could not be created: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  app.useStaticAssets(uploadDirectory, {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
    maxAge: 86400000,
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // The OpenAPI document enumerates every endpoint, DTO and business concept
  // (inventory, transfers, cycle counts, webhooks...). Serving it in production
  // hands an attacker the full map of the API, so it is opt-in there.
  // SWAGGER_ENABLED=true forces it on; unset/anything else means "off" in
  // production and "on" everywhere else.
  const swaggerEnv = (configService.get<string>('app.swaggerEnabled') ?? '').trim();
  const swaggerEnabled = isProduction
    ? swaggerEnv.toLowerCase() === 'true'
    : swaggerEnv.toLowerCase() !== 'false';

  if (swaggerEnabled && isProduction) {
    const swaggerAuthUser = configService.get<string>('app.swaggerAuthUser') ?? '';
    const swaggerAuthPassword = configService.get<string>('app.swaggerAuthPassword') ?? '';
    if (!swaggerAuthUser || !swaggerAuthPassword) {
      throw new Error(
        'SWAGGER_ENABLED=true in production requires SWAGGER_AUTH_USER and SWAGGER_AUTH_PASSWORD. ' +
          'The OpenAPI document enumerates every endpoint and must not be publicly reachable.',
      );
    }
    // Protect /docs, /docs-json and /docs-yaml before the UI is mounted.
    app.use(
      ['/docs', '/docs-json', '/docs-yaml'],
      createSwaggerBasicAuthMiddleware(swaggerAuthUser, swaggerAuthPassword),
    );
    logger.log('Swagger docs enabled in production behind HTTP Basic auth.');
  }

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Tablofy API')
      .setDescription('Enterprise Identity & Multi-Tenant Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & Authorization')
      .addTag('tenants', 'Multi-Tenant Management')
      .addTag('users', 'User Management')
      .addTag('sessions', 'Session Management')
      .addTag('invitations', 'Invitation Management')
      .addTag('restaurants', 'Restaurant Management')
      .addTag('branches', 'Branch Management')
      .addTag('floors', 'Floor Management')
      .addTag('dining-areas', 'Dining Area Management')
      .addTag('tables', 'Table Management & Status')
      .addTag('menu-categories', 'Menu Category Management')
      .addTag('products', 'Product Management')
      .addTag('product-images', 'Product Image Management')
      .addTag('product-availability', 'Product Availability Schedules')
      .addTag('variant-groups', 'Variant Group Management')
      .addTag('product-variants', 'Product Variant Management')
      .addTag('modifier-groups', 'Modifier Group Management')
      .addTag('modifiers', 'Modifier Management')
      .addTag('product-tags', 'Product Tag Management & Assignment')
      .addTag('allergens', 'Allergen Management & Product Assignment')
      .addTag('nutrition', 'Nutritional Information Management')
      .addTag('business-hours', 'Business Hours Management')
      .addTag('business-exceptions', 'Business Exceptions (Holidays/Special Hours)')
      .addTag('restaurant-settings', 'Restaurant Settings')
      .addTag('branch-settings', 'Branch Settings')
      .addTag('tax-rates', 'Tax Rate Management')
      .addTag('service-charges', 'Service Charge Management')
      .addTag('units', 'Units of Measurement')
      .addTag('queues', 'Job Queue Monitoring')
      .addTag('ingredients', 'Ingredient Management')
      .addTag('suppliers', 'Supplier Management')
      .addTag('product-ingredients', 'Product-Ingredient Cost Tracking')
      .addTag('usage', 'Usage Tracking & Analytics')
      .addTag('health', 'Health Checks')
      .addTag('metrics', 'Prometheus Metrics')
      .addTag('webhooks', 'Webhook Registration & Delivery')
      .addTag('api-keys', 'API Key Management')
      .addTag('gift-cards', 'Gift Card Management')
      .addTag('privacy', 'GDPR & Privacy Management')
      .addTag('backup', 'Backup & Recovery')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  } else if (isProduction) {
    logger.log('Swagger disabled (production default). Set SWAGGER_ENABLED=true to expose /docs.');
  }

  const bullBoardModule = app.get(BullBoardModule);
  app.use(BULL_BOARD_PATH, bullBoardModule.createAuthMiddleware(), bullBoardModule.getRouter());

  await app.init();

  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}/${apiPrefix}/v1`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs available at: http://localhost:${port}/docs`);
  }

  const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  let isShuttingDown = false;

  // enableShutdownHooks() above handles the graceful close (destroy hooks,
  // HTTP server close, shutdown hooks). These listeners only enforce the
  // forced-exit deadline so a hung shutdown cannot block forever.
  const beginShutdownWatchdog = (reason: string): void => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.log(`Shutting down gracefully: ${reason}`);

    const forceExitTimer = setTimeout(() => {
      logger.error(
        `Graceful shutdown did not complete within ${shutdownTimeoutMs}ms; forcing exit.`,
      );
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExitTimer.unref();
  };

  for (const signal of shutdownSignals) {
    process.on(signal, () => beginShutdownWatchdog(`Received ${signal}`));
  }

  // Signal-based shutdown is handled by enableShutdownHooks(); the forced
  // shutdown below is only for non-signal fatal conditions (unhandled
  // rejections / uncaught exceptions) when Sentry's own handlers are disabled.
  const forceShutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.log(`Forced shutdown: ${reason}`);

    const forceExitTimer = setTimeout(() => {
      logger.error(
        `Graceful shutdown did not complete within ${shutdownTimeoutMs}ms; forcing exit.`,
      );
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExitTimer.unref();

    try {
      await app.close();
      clearTimeout(forceExitTimer);
      logger.log('Application shut down successfully');
    } catch (error) {
      logger.error('Error during graceful shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      process.exit(exitCode);
    }
  };

  // Sentry's onUncaughtException/onUnhandledRejection integrations handle these when enabled.
  // When Sentry is disabled we still need explicit handlers with fallback logging.
  if (!sentryEnabled) {
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection detected', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      void forceShutdown('unhandledRejection', 1);
    });

    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception detected', {
        error: error.message,
        stack: error.stack,
      });
      void forceShutdown('uncaughtException', 1);
    });
  }
}

bootstrap();
