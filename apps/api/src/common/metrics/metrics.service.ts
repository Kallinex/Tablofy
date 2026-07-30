import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as promClient from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private registered = false;

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

  async getMetrics(): Promise<string> {
    return promClient.register.metrics();
  }
}
