import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { CampaignQueryDto } from './dto/campaign-query.dto';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { PromotionQueryDto } from './dto/promotion-query.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  // ── Campaigns ──

  @Post('campaigns')
  @Roles('OWNER', 'MANAGER')
  async createCampaign(@Body() dto: CreateCampaignDto, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.createCampaign(dto, tenantId, user.id ?? undefined);
  }

  @Get('campaigns')
  @Roles('OWNER', 'MANAGER')
  async listCampaigns(@CurrentUser() user: CurrentUserData, @Query() query?: CampaignQueryDto) {
    const tenantId = user.tenantId!;
    return this.campaignsService.listCampaigns(tenantId, query);
  }

  @Get('campaigns/stats')
  @Roles('OWNER', 'MANAGER')
  async getCampaignStats(@CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.getCampaignStats(tenantId);
  }

  @Get('campaigns/:id')
  @Roles('OWNER', 'MANAGER')
  async getCampaign(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.getCampaign(id, tenantId);
  }

  @Put('campaigns/:id')
  @Roles('OWNER', 'MANAGER')
  async updateCampaign(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.campaignsService.updateCampaign(id, dto, tenantId, user.id ?? undefined);
  }

  @Delete('campaigns/:id')
  @Roles('OWNER', 'MANAGER')
  async deleteCampaign(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    await this.campaignsService.deleteCampaign(id, tenantId, user.id ?? undefined);
    return { deleted: true };
  }

  @Post('campaigns/:id/execute')
  @Roles('OWNER', 'MANAGER')
  async executeCampaign(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.executeCampaign(id, tenantId, user.id ?? undefined);
  }

  @Post('campaigns/:id/pause')
  @Roles('OWNER', 'MANAGER')
  async pauseCampaign(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.pauseCampaign(id, tenantId, user.id ?? undefined);
  }

  @Post('campaigns/:id/clone')
  @Roles('OWNER', 'MANAGER')
  async cloneCampaign(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.cloneCampaign(id, tenantId, user.id ?? undefined);
  }

  @Post('campaigns/:id/approve')
  @Roles('OWNER', 'MANAGER')
  async approveCampaign(
    @Param('id') id: string,
    @Body('approved') approved: boolean,
    @Body('reason') reason: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.campaignsService.approveCampaign(id, tenantId, user.id!, approved, reason);
  }

  @Get('campaigns/:id/analytics')
  @Roles('OWNER', 'MANAGER')
  async getCampaignAnalytics(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.getCampaignAnalytics(id, tenantId);
  }

  // ── Promotions ──

  @Post('promotions')
  @Roles('OWNER', 'MANAGER')
  async createPromotion(@Body() dto: CreatePromotionDto, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.createPromotion(dto, tenantId, user.id ?? undefined);
  }

  @Get('promotions')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async listPromotions(@CurrentUser() user: CurrentUserData, @Query() query?: PromotionQueryDto) {
    const tenantId = user.tenantId!;
    return this.campaignsService.listPromotions(tenantId, query);
  }

  @Get('promotions/stats')
  @Roles('OWNER', 'MANAGER')
  async getPromotionStats(@CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.getPromotionStats(tenantId);
  }

  @Get('promotions/code/:code')
  async getPromotionByCode(@Param('code') code: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.getPromotionByCode(code, tenantId);
  }

  @Get('promotions/:id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async getPromotion(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.campaignsService.getPromotion(id, tenantId);
  }

  @Put('promotions/:id')
  @Roles('OWNER', 'MANAGER')
  async updatePromotion(
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.campaignsService.updatePromotion(id, dto, tenantId, user.id ?? undefined);
  }

  @Delete('promotions/:id')
  @Roles('OWNER', 'MANAGER')
  async deletePromotion(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    await this.campaignsService.deletePromotion(id, tenantId, user.id ?? undefined);
    return { deleted: true };
  }

  @Post('promotions/validate')
  async validatePromotion(
    @Body('code') code: string,
    @Body('customerId') customerId?: string,
    @Body('orderAmount') orderAmount?: number,
    @CurrentUser() user?: CurrentUserData,
  ) {
    const tenantId = user?.tenantId ?? undefined;
    return this.campaignsService.validatePromotion(code, tenantId, customerId, orderAmount);
  }

  @Post('promotions/use')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  async usePromotion(
    @Body('code') code: string,
    @Body('customerId') customerId: string,
    @Body('orderAmount') orderAmount: number,
    @Body('orderId') orderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.campaignsService.usePromotion(code, customerId, orderAmount, tenantId, orderId);
  }
}
