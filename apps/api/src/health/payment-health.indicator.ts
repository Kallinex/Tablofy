import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { probeDependency } from './dependency-probe';

interface GatewayProbe {
  name: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Probes the configured payment gateways (Stripe / Paymob).
 *
 * In `mock` mode no gateway is contacted and the indicator reports `up` with
 * `configured: false`. In `test`/`live` mode only the gateways with credentials
 * are probed; if none are configured the check is skipped rather than failed.
 */
@Injectable()
export class PaymentHealthIndicator {
  private readonly logger = new Logger(PaymentHealthIndicator.name);

  constructor(private readonly configService: ConfigService) {}

  async isHealthy(key = 'payment'): Promise<HealthIndicatorResult> {
    const mode = this.configService.get<string>('payments.mode') ?? 'mock';
    if (mode === 'mock') {
      return { [key]: { status: 'up', configured: false, mode } };
    }

    const probes = this.gatewayProbes();
    if (probes.length === 0) {
      return { [key]: { status: 'up', configured: false, mode } };
    }

    const details: Record<string, unknown> = {};
    let reachable = true;

    for (const probe of probes) {
      const result = await probeDependency(probe.url, probe.headers);
      details[probe.name] = result;
      if (!result.reachable) {
        reachable = false;
        this.logger.warn(
          `Payment gateway "${probe.name}" health probe failed (${result.error ?? result.status})`,
        );
      }
    }

    if (!reachable) {
      throw new HealthCheckError('Payment gateway unreachable', {
        [key]: { status: 'down', configured: true, mode, gateways: details },
      });
    }

    return { [key]: { status: 'up', configured: true, mode, gateways: details } };
  }

  private gatewayProbes(): GatewayProbe[] {
    const probes: GatewayProbe[] = [];

    const stripeKey = this.configService.get<string>('payments.stripeSecretKey') ?? '';
    if (stripeKey) {
      const stripeBase = this.configService.get<string>('payments.stripeApiBase') ?? '';
      probes.push({
        name: 'stripe',
        url: `${stripeBase.replace(/\/+$/, '')}/v1/balance`,
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
    }

    const paymobKey = this.configService.get<string>('payments.paymobApiKey') ?? '';
    if (paymobKey) {
      const paymobBase = this.configService.get<string>('payments.paymobApiBase') ?? '';
      probes.push({
        name: 'paymob',
        url: `${paymobBase.replace(/\/+$/, '')}/auth/tokens`,
        headers: { Authorization: `Bearer ${paymobKey}` },
      });
    }

    return probes;
  }
}
