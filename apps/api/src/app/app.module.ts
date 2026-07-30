import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { HealthModule } from '../health/health.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../modules/auth/auth.module';
import { TenantsModule } from '../modules/tenants/tenants.module';
import { UsersModule } from '../modules/users/users.module';
import { SessionsModule } from '../modules/sessions/sessions.module';
import { InvitationsModule } from '../modules/invitations/invitations.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { RestaurantsModule } from '../modules/restaurants/restaurants.module';
import { BranchesModule } from '../modules/branches/branches.module';
import { FloorsModule } from '../modules/floors/floors.module';
import { DiningAreasModule } from '../modules/dining-areas/dining-areas.module';
import { TablesModule } from '../modules/tables/tables.module';
import { MenuCategoriesModule } from '../modules/menu/menu-categories.module';
import { ProductsModule } from '../modules/menu/products.module';
import { ProductImagesModule } from '../modules/menu/product-images.module';
import { ProductAvailabilityModule } from '../modules/menu/product-availability.module';
import { VariantGroupsModule } from '../modules/variant-groups/variant-groups.module';
import { ProductVariantsModule } from '../modules/product-variants/product-variants.module';
import { ModifierGroupsModule } from '../modules/modifier-groups/modifier-groups.module';
import { ModifiersModule } from '../modules/modifiers/modifiers.module';
import { ProductTagsModule } from '../modules/tags/product-tags.module';
import { AllergensModule } from '../modules/allergens/allergens.module';
import { NutritionModule } from '../modules/nutrition/nutrition.module';
import { BusinessHoursModule } from '../modules/business-hours/business-hours.module';
import { BusinessExceptionsModule } from '../modules/business-exceptions/business-exceptions.module';
import { RestaurantSettingsModule } from '../modules/restaurant-settings/restaurant-settings.module';
import { BranchSettingsModule } from '../modules/branch-settings/branch-settings.module';
import { TaxRatesModule } from '../modules/tax-rates/tax-rates.module';
import { ServiceChargesModule } from '../modules/service-charges/service-charges.module';
import { UnitsModule } from '../modules/units/units.module';
import { QueueModule } from '../modules/queues/queue.module';
import { SchedulerModule } from '../modules/scheduler/scheduler.module';
import { IngredientsModule } from '../modules/ingredients/ingredients.module';
import { SuppliersModule } from '../modules/suppliers/suppliers.module';
import { ProductIngredientsModule } from '../modules/product-ingredients/product-ingredients.module';
import { UsageModule } from '../modules/usage/usage.module';
import { OrdersModule } from '../modules/orders/orders.module';
import { CustomersModule } from '../modules/customers/customers.module';
import { CrmModule } from '../modules/crm/crm.module';
import { CampaignsModule } from '../modules/campaigns/campaigns.module';
import { KdsModule } from '../modules/kds/kds.module';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { PurchasingModule } from '../modules/purchasing/purchasing.module';
import { TransfersModule } from '../modules/transfers/transfers.module';
import { RecipesModule } from '../modules/recipes/recipes.module';
import { WarehousesModule } from '../modules/warehouses/warehouse.module';
import { BarcodeModule } from '../modules/barcodes/barcode.module';
import { ForecastingModule } from '../modules/forecasting/forecasting.module';
import { CycleCountModule } from '../modules/cycle-counts/cycle-count.module';
import { SupplierPerformanceModule } from '../modules/supplier-performance/supplier-performance.module';
import { CostingModule } from '../modules/costing/costing.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { ExecutiveDashboardModule } from '../modules/executive-dashboard/executive-dashboard.module';
import { SalesAnalyticsModule } from '../modules/sales-analytics/sales-analytics.module';
import { KitchenAnalyticsModule } from '../modules/kitchen-analytics/kitchen-analytics.module';
import { InventoryAnalyticsModule } from '../modules/inventory-analytics/inventory-analytics.module';
import { CustomerAnalyticsModule } from '../modules/customer-analytics/customer-analytics.module';
import { CrmAnalyticsModule } from '../modules/crm-analytics/crm-analytics.module';
import { SupplierAnalyticsModule } from '../modules/supplier-analytics/supplier-analytics.module';
import { FinancialAnalyticsModule } from '../modules/financial-analytics/financial-analytics.module';
import { ForecastingDashboardModule } from '../modules/forecasting-dashboard/forecasting-dashboard.module';
import { ExportEngineModule } from '../modules/export-engine/export-engine.module';
import { ScheduledReportsModule } from '../modules/scheduled-reports/scheduled-reports.module';
import { LiveAnalyticsModule } from '../modules/live-analytics/live-analytics.module';
import { WebhooksModule } from '../modules/webhooks/webhooks.module';
import { ApiKeysModule } from '../modules/api-keys/api-keys.module';
import { IntegrationsModule } from '../modules/integrations/integrations.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { GiftCardsModule } from '../modules/gift-cards/gift-cards.module';
import { PrivacyModule } from '../modules/privacy/privacy.module';
import { BackupModule } from '../modules/backup/backup.module';
import { WebhookEventEmitter } from '../modules/webhooks/webhook-event-emitter';
import { DomainEventModule } from '../common/event-emitter/domain-event.module';
import { CommonModule } from '../common/common.module';
import { I18nModule } from '../common/i18n/i18n.module';
import { RecoveryModule } from '../common/recovery/recovery.module';
import { CorrelationModule } from '../common/correlation/correlation.module';
import { LoggerModule } from '../common/logger/logger.module';
import { MetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { MonitoringModule } from '../common/monitoring/monitoring.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { PlanThrottleGuard } from '../common/guards/plan-throttle.guard';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { PerformanceMonitorInterceptor } from '../common/monitoring/performance-monitor.interceptor';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TenantMiddleware } from '../common/middleware/tenant.middleware';
import { CorrelationMiddleware } from '../common/correlation/correlation.middleware';
import { HttpLoggingMiddleware } from '../common/logger/http-logging.middleware';
import { PrometheusMiddleware } from '../common/metrics/prometheus.middleware';
import { I18nMiddleware } from '../common/i18n/i18n.middleware';
import {
  validate,
  appConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  throttleConfig,
  loggingConfig,
  monitoringConfig,
  metricsConfig,
  sentryConfig,
  webhookConfig,
  apiKeysConfig,
} from '../config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        jwtConfig,
        throttleConfig,
        loggingConfig,
        monitoringConfig,
        metricsConfig,
        sentryConfig,
        webhookConfig,
        apiKeysConfig,
      ],
      envFilePath: '.env',
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('throttle.ttl') ?? 60000,
            limit: configService.get<number>('throttle.limit') ?? 60,
          },
        ],
      }),
    }),
    ScheduleModule.forRoot(),
    CorrelationModule,
    LoggerModule,
    MetricsModule,
    SentryModule,
    MonitoringModule,
    PrismaModule,
    RedisModule,
    DomainEventModule,
    CommonModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    SessionsModule,
    InvitationsModule,
    AuditLogsModule,
    RestaurantsModule,
    BranchesModule,
    FloorsModule,
    DiningAreasModule,
    TablesModule,
    MenuCategoriesModule,
    ProductsModule,
    ProductImagesModule,
    ProductAvailabilityModule,
    VariantGroupsModule,
    ProductVariantsModule,
    ModifierGroupsModule,
    ModifiersModule,
    ProductTagsModule,
    AllergensModule,
    NutritionModule,
    BusinessHoursModule,
    BusinessExceptionsModule,
    RestaurantSettingsModule,
    BranchSettingsModule,
    TaxRatesModule,
    ServiceChargesModule,
    UnitsModule,
    QueueModule,
    SchedulerModule,
    IngredientsModule,
    SuppliersModule,
    ProductIngredientsModule,
    UsageModule,
    OrdersModule,
    CustomersModule,
    CrmModule,
    CampaignsModule,
    KdsModule,
    InventoryModule,
    PurchasingModule,
    TransfersModule,
    RecipesModule,
    WarehousesModule,
    BarcodeModule,
    ForecastingModule,
    CycleCountModule,
    SupplierPerformanceModule,
    CostingModule,
    DashboardModule,
    ExecutiveDashboardModule,
    SalesAnalyticsModule,
    KitchenAnalyticsModule,
    InventoryAnalyticsModule,
    CustomerAnalyticsModule,
    CrmAnalyticsModule,
    SupplierAnalyticsModule,
    FinancialAnalyticsModule,
    ForecastingDashboardModule,
    ExportEngineModule,
    ScheduledReportsModule,
    LiveAnalyticsModule,
    WebhooksModule,
    ApiKeysModule,
    IntegrationsModule,
    PaymentsModule,
    GiftCardsModule,
    PrivacyModule,
    BackupModule,
    I18nModule,
    RecoveryModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PlanThrottleGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceMonitorInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    WebhookEventEmitter,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        CorrelationMiddleware,
        I18nMiddleware,
        HttpLoggingMiddleware,
        PrometheusMiddleware,
        TenantMiddleware,
      )
      .forRoutes('*');
  }
}
