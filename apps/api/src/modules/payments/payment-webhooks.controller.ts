import {
  Controller,
  Post,
  HttpCode,
  Req,
  Headers,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenantCheck } from '../../common/decorators/skip-tenant.decorator';

@ApiExcludeController()
@SkipTenantCheck()
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  async stripe(@Req() req: Request, @Headers('stripe-signature') signature?: string) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const payload = raw ? raw.toString('utf8') : JSON.stringify(req.body ?? {});
    return this.paymentsService.handleGatewayWebhook('stripe', payload, signature);
  }

  @Public()
  @Post('paymob')
  @HttpCode(200)
  async paymob(@Body() body: { hmac?: string }) {
    const payload = JSON.stringify(body);
    return this.paymentsService.handleGatewayWebhook('paymob', payload, body.hmac ?? '');
  }
}
