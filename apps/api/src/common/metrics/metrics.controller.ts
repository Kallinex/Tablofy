import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../decorators/public.decorator';
import { SkipTenantCheck } from '../decorators/skip-tenant.decorator';
import { MetricsService } from './metrics.service';

@Controller()
@SkipTenantCheck()
export class MetricsController {
  private readonly authToken: string;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {
    this.authToken = this.configService.get('metrics.authToken', '');
  }

  @Get('metrics')
  @Public()
  async getMetrics(@Headers('authorization') auth?: string): Promise<string> {
    if (this.authToken) {
      const expected = `Bearer ${this.authToken}`;
      if (auth !== expected) {
        throw new UnauthorizedException('Invalid metrics auth token');
      }
    }
    return this.metricsService.getMetrics();
  }
}
