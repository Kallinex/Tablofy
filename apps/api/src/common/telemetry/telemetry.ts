import { Logger } from '@nestjs/common';

export type TelemetryDecision =
  | { enabled: false; reason: string }
  | { enabled: true; reason: string; endpoint: string };

/**
 * Decides whether telemetry should start, from environment only.
 *
 * Kept separate from {@link initTelemetry} so the decision is unit-testable
 * without constructing an SDK or touching the network.
 */
export function resolveTelemetryEnv(env: NodeJS.ProcessEnv = process.env): TelemetryDecision {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || '';
  const requested = env.OTEL_ENABLED?.trim();

  if (requested !== 'true') {
    return {
      enabled: false,
      reason:
        requested === undefined || requested === ''
          ? 'OTEL_ENABLED not set'
          : `OTEL_ENABLED is ${JSON.stringify(requested)}, not "true"`,
    };
  }
  if (endpoint === '') {
    // Enabled but with nowhere to send data: exporting nowhere would look like
    // tracing works while silently dropping every span.
    return {
      enabled: false,
      reason: 'OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT is not set',
    };
  }

  return { enabled: true, reason: 'enabled', endpoint };
}

export interface TelemetryInitResult {
  enabled: boolean;
  reason: string;
  sdk?: unknown;
}

/**
 * Starts the OpenTelemetry SDK.
 *
 * The SDK patches instrumented libraries (express, ioredis, pg, bullmq...) by
 * hooking Node's module loader, so anything already in `require.cache` is never
 * instrumented. A normal Nest provider would run far too late, and so would an
 * awaited call inside `bootstrap()`, because `main.ts` has already required
 * AppModule by then.
 *
 * Therefore this must be synchronous, and must run from an import that precedes
 * every other import in the entrypoint (see `instrumentation.ts`). The OTel
 * packages are pulled in with `require` inside the enabled branch so that
 * development and test runs do not pay to load the SDK at all.
 *
 * Telemetry is opt-in, and any failure is logged and swallowed: an unreachable
 * collector must degrade observability, never availability.
 */
export function initTelemetry(env: NodeJS.ProcessEnv = process.env): TelemetryInitResult {
  const decision = resolveTelemetryEnv(env);
  if (!decision.enabled) {
    return { enabled: false, reason: decision.reason };
  }

  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    const {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
      ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
    } = require('@opentelemetry/semantic-conventions');
    const {
      ParentBasedSampler,
      TraceIdRatioBasedSampler,
    } = require('@opentelemetry/sdk-trace-base');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const tracesEnabled = env.OTEL_TRACES_ENABLED?.trim() !== 'false';
    const metricsEnabled = env.OTEL_METRICS_ENABLED?.trim() !== 'false';
    const exportTimeoutMs = Number.parseInt(env.OTEL_EXPORTER_OTLP_TIMEOUT ?? '', 10) || 10000;
    const metricIntervalMs = Number.parseInt(env.OTEL_METRIC_EXPORT_INTERVAL ?? '', 10) || 60000;

    const parsedRatio = Number.parseFloat(env.OTEL_TRACES_SAMPLER_ARG ?? '');
    const sampleRatio =
      Number.isFinite(parsedRatio) && parsedRatio >= 0 && parsedRatio <= 1 ? parsedRatio : 0.1;

    // ParentBased honours an upstream sampling decision (for example from the
    // load balancer) instead of re-deciding per hop and orphaning the trace.
    const traceSampler = new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRatio),
    });

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME?.trim() || 'tablofy-api',
        [ATTR_SERVICE_VERSION]: env.npm_package_version || '0.0.0',
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env.NODE_ENV || 'development',
      }),
      traceExporter: tracesEnabled
        ? new OTLPTraceExporter({
            url: `${decision.endpoint}/v1/traces`,
            timeoutMillis: exportTimeoutMs,
          })
        : undefined,
      // NodeSDK wants a MetricReader; OTLPMetricExporter is only the push
      // exporter it must be wrapped in, and it needs a flush interval.
      metricReader: metricsEnabled
        ? new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: `${decision.endpoint}/v1/metrics`,
              timeoutMillis: exportTimeoutMs,
            }),
            exportIntervalMillis: metricIntervalMs,
          })
        : undefined,
      traceSampler,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Filesystem spans are extremely noisy and rarely actionable for an API.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdk.start();

    Logger.log(
      `OpenTelemetry started (traces=${tracesEnabled}, metrics=${metricsEnabled}, sampleRatio=${sampleRatio})`,
      'Telemetry',
    );

    return { enabled: true, reason: decision.reason, sdk };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.warn(
      `OpenTelemetry failed to start: ${message}. Continuing without tracing.`,
      'Telemetry',
    );
    return { enabled: false, reason: `failed: ${message}` };
  }
}
