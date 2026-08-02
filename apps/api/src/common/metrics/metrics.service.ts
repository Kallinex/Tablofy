import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as promClient from 'prom-client';
import { PerformanceObserver, monitorEventLoopDelay } from 'perf_hooks';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private registered = false;
  private collectionInterval?: NodeJS.Timeout;
  private readonly eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();

  httpDuration: promClient.Histogram<string>;
  httpCount: promClient.Counter<string>;
  httpErrors: promClient.Counter<string>;
  dbQueryDuration: promClient.Histogram<string>;
  redisLatency: promClient.Histogram<string>;
  bullQueueDuration: promClient.Histogram<string>;
  bullQueueDepth: promClient.Gauge<string>;
  ordersCreated: promClient.Counter<string>;
  ordersCompleted: promClient.Counter<string>;
  revenue: promClient.Counter<string>;
  inventoryMovements: promClient.Counter<string>;
  kitchenTickets: promClient.Counter<string>;
  paymentsCompleted: promClient.Counter<string>;
  paymentsFailed: promClient.Counter<string>;
  paymentsRefunded: promClient.Counter<string>;
  deadLetter: promClient.Counter<string>;
  eventLoopDelay: promClient.Gauge<string>;
  memoryUsage: promClient.Gauge<string>;
  cpuUsage: promClient.Gauge<string>;
  gcDuration: promClient.Gauge<string>;

  constructor(private readonly configService: ConfigService) {
    this.httpDuration = new promClient.Histogram({
      name: 'http_request_duration_ms',
      help: 'HTTP request duration in ms',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    });

    this.httpCount = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    this.httpErrors = new promClient.Counter({
      name: 'http_errors_total',
      help: 'Total HTTP errors',
      labelNames: ['method', 'route', 'status_code'],
    });

    this.dbQueryDuration = new promClient.Histogram({
      name: 'db_query_duration_ms',
      help: 'Database query duration in ms',
      labelNames: ['query_type'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    });

    this.redisLatency = new promClient.Histogram({
      name: 'redis_latency_ms',
      help: 'Redis command latency in ms',
      labelNames: ['command'],
      buckets: [1, 2, 5, 10, 25, 50, 100],
    });

    this.bullQueueDuration = new promClient.Histogram({
      name: 'bull_queue_job_duration_ms',
      help: 'BullMQ job processing duration in ms',
      labelNames: ['queue', 'status'],
      buckets: [10, 50, 100, 500, 1000, 5000, 10000],
    });

    this.bullQueueDepth = new promClient.Gauge({
      name: 'bull_queue_depth',
      help: 'BullMQ queue depth',
      labelNames: ['queue', 'status'],
    });

    this.ordersCreated = new promClient.Counter({
      name: 'orders_created_total',
      help: 'Total orders created',
    });

    this.ordersCompleted = new promClient.Counter({
      name: 'orders_completed_total',
      help: 'Total orders completed',
    });

    this.revenue = new promClient.Counter({
      name: 'revenue_total',
      help: 'Total revenue in cents',
    });

    this.inventoryMovements = new promClient.Counter({
      name: 'inventory_movements_total',
      help: 'Total inventory movements',
    });

    this.kitchenTickets = new promClient.Counter({
      name: 'kitchen_tickets_total',
      help: 'Total kitchen tickets created',
    });

    this.paymentsCompleted = new promClient.Counter({
      name: 'payments_completed_total',
      help: 'Total payments completed',
    });

    this.paymentsFailed = new promClient.Counter({
      name: 'payments_failed_total',
      help: 'Total payments failed',
    });

    this.paymentsRefunded = new promClient.Counter({
      name: 'payments_refunded_total',
      help: 'Total payments refunded',
    });

    this.deadLetter = new promClient.Counter({
      name: 'bull_queue_dead_letter_total',
      help: 'Total jobs moved to the dead letter queue',
      labelNames: ['queue'],
    });

    this.eventLoopDelay = new promClient.Gauge({
      name: 'node_event_loop_delay_ms',
      help: 'Node.js event loop delay in ms',
    });

    this.memoryUsage = new promClient.Gauge({
      name: 'node_memory_usage_bytes',
      help: 'Node.js memory usage in bytes',
      labelNames: ['type'],
    });

    this.cpuUsage = new promClient.Gauge({
      name: 'node_cpu_usage_percent',
      help: 'Node.js CPU usage percent',
    });

    this.gcDuration = new promClient.Gauge({
      name: 'node_gc_duration_ms',
      help: 'Node.js garbage collection duration in ms',
      labelNames: ['type'],
    });
  }

  onModuleInit() {
    if (this.configService.get('metrics.collectDefaultMetrics', true)) {
      promClient.collectDefaultMetrics({
        register: promClient.register,
        eventLoopMonitoringPrecision: 10,
      });
      this.registered = true;
    }
    this.setupGcObserver();
    this.startCollectionLoop();
  }

  onModuleDestroy() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }
    this.eventLoopHistogram.disable();
  }

  private setupGcObserver() {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const kind = (entry as unknown as { kind?: number }).kind;
          this.gcDuration.set({ type: kind === 2 ? 'major' : 'minor' }, entry.duration);
        }
      });
      observer.observe({ entryTypes: ['gc'] });
    } catch (error) {
      this.logger.warn(
        `GC metric observer unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private startCollectionLoop() {
    const intervalMs = this.configService.get<number>('metrics.collectIntervalMs', 10000);
    if (!intervalMs || intervalMs <= 0) {
      return;
    }
    this.eventLoopHistogram.enable();
    this.collectionInterval = setInterval(() => {
      this.eventLoopDelay.set(parseFloat(this.eventLoopHistogram.mean.toFixed(2)));
      this.eventLoopHistogram.reset();

      const memory = process.memoryUsage();
      this.memoryUsage.set({ type: 'rss' }, memory.rss);
      this.memoryUsage.set({ type: 'heapUsed' }, memory.heapUsed);
      this.memoryUsage.set({ type: 'heapTotal' }, memory.heapTotal);
      this.memoryUsage.set({ type: 'external' }, memory.external);

      this.cpuUsage.set(this.measureCpuUsagePercent());
    }, intervalMs);
    this.collectionInterval.unref();
  }

  private measureCpuUsagePercent(): number {
    const now = Date.now();
    const usage = process.cpuUsage();
    const userDelta = usage.user - this.lastCpuUsage.user;
    const systemDelta = usage.system - this.lastCpuUsage.system;
    const elapsedMs = now - this.lastCpuTime;
    this.lastCpuUsage = usage;
    this.lastCpuTime = now;
    if (elapsedMs <= 0) {
      return 0;
    }
    const cpuMs = (userDelta + systemDelta) / 1000;
    const percent = (cpuMs / elapsedMs) * 100;
    return parseFloat(Math.min(100, percent).toFixed(2));
  }

  observeHttpDuration(method: string, route: string, statusCode: number, duration: number) {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpDuration.observe(labels, duration);
    this.httpCount.inc(labels);
    if (statusCode >= 400) {
      this.httpErrors.inc(labels);
    }
  }

  observeDbQuery(queryType: string, duration: number) {
    this.dbQueryDuration.observe({ query_type: queryType }, duration);
  }

  observeRedisLatency(command: string, duration: number) {
    this.redisLatency.observe({ command }, duration);
  }

  observeBullJob(queue: string, status: string, duration: number) {
    this.bullQueueDuration.observe({ queue, status }, duration);
  }

  setBullQueueDepth(queue: string, status: string, depth: number) {
    this.bullQueueDepth.set({ queue, status }, depth);
  }

  incrementOrdersCreated() {
    this.ordersCreated.inc();
  }

  incrementOrdersCompleted() {
    this.ordersCompleted.inc();
  }

  addRevenue(cents: number) {
    this.revenue.inc(cents);
  }

  incrementInventoryMovements() {
    this.inventoryMovements.inc();
  }

  incrementKitchenTickets() {
    this.kitchenTickets.inc();
  }

  incrementPaymentsCompleted() {
    this.paymentsCompleted.inc();
  }

  incrementPaymentsFailed() {
    this.paymentsFailed.inc();
  }

  incrementPaymentsRefunded() {
    this.paymentsRefunded.inc();
  }

  incrementBullQueueDeadLetter(queue: string) {
    this.deadLetter.inc({ queue });
  }

  async getMetrics(): Promise<string> {
    return promClient.register.metrics();
  }
}
