import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GiftCardsService } from './gift-cards.service';
import { CreateGiftCardDto } from './dto/create-gift-card.dto';
import { RechargeGiftCardDto } from './dto/recharge-gift-card.dto';
import { RedeemGiftCardDto } from './dto/redeem-gift-card.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Request } from 'express';

@ApiTags('gift-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('gift-cards')
export class GiftCardsController {
  constructor(private readonly giftCardsService: GiftCardsService) {}

  @Post()
  @ApiOperation({ summary: 'Issue a new gift card' })
  create(
    @Body() dto: CreateGiftCardDto,
    @Req() req: Request & { tenantId: string; lang: string; user?: { id: string } },
  ) {
    return this.giftCardsService.create(req.tenantId, dto, req.lang, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: 'List gift cards' })
  findAll(
    @Req() req: Request & { tenantId: string },
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.giftCardsService.findAll(req.tenantId, +page, +limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get gift card by ID' })
  findOne(@Param('id') id: string, @Req() req: Request & { tenantId: string; lang: string }) {
    return this.giftCardsService.findOne(req.tenantId, id, req.lang);
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Get gift card by code' })
  findByCode(
    @Param('code') code: string,
    @Req() req: Request & { tenantId: string; lang: string },
  ) {
    return this.giftCardsService.findByCode(req.tenantId, code, req.lang);
  }

  @Post(':id/recharge')
  @ApiOperation({ summary: 'Recharge a gift card' })
  recharge(
    @Param('id') id: string,
    @Body() dto: RechargeGiftCardDto,
    @Req() req: Request & { tenantId: string; lang: string; user?: { id: string } },
  ) {
    return this.giftCardsService.recharge(req.tenantId, id, dto, req.lang, req.user?.id);
  }

  @Post(':id/redeem')
  @ApiOperation({ summary: 'Redeem from a gift card' })
  redeem(
    @Param('id') id: string,
    @Body() dto: RedeemGiftCardDto,
    @Req() req: Request & { tenantId: string; lang: string; user?: { id: string } },
  ) {
    return this.giftCardsService.redeem(req.tenantId, id, dto, req.lang, req.user?.id);
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Get gift card transactions' })
  getTransactions(
    @Param('id') id: string,
    @Req() req: Request & { tenantId: string },
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.giftCardsService.getTransactions(req.tenantId, id, +page, +limit);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a gift card' })
  deactivate(@Param('id') id: string, @Req() req: Request & { tenantId: string; lang: string }) {
    return this.giftCardsService.deactivate(req.tenantId, id, req.lang);
  }
}
