import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import { AppLoggerService } from './common/logger/logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const logger = app.get(AppLoggerService);
  logger.setContext('Bootstrap');

  app.useLogger(logger);

  const port = configService.get<number>('app.port') ?? 3000;
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api';
  const corsOrigins = configService.get<string[]>('app.corsOrigins') ?? ['http://localhost:4200'];
  const corsCredentials = configService.get<boolean>('app.corsCredentials') ?? true;
  const nodeEnv = configService.get<string>('app.nodeEnv') ?? 'development';
  const isProduction = nodeEnv === 'production';

  app.setGlobalPrefix(apiPrefix);

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

  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}/${apiPrefix}/v1`);
  logger.log(`Swagger docs available at: http://localhost:${port}/docs`);

  const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of shutdownSignals) {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      logger.log('Application shut down successfully');
      process.exit(0);
    });
  }
}

bootstrap();
