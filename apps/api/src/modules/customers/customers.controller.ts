import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import { SetCustomerPreferenceDto } from './dto/set-customer-preference.dto';
import { EarnPointsDto } from './dto/earn-points.dto';
import { RedeemPointsDto } from './dto/redeem-points.dto';
import { AdjustPointsDto } from './dto/adjust-points.dto';
import { WalletRechargeDto } from './dto/wallet-recharge.dto';
import { WalletSpendDto } from './dto/wallet-spend.dto';
import { WalletRefundDto } from './dto/wallet-refund.dto';
import { CreateRewardDto } from './dto/create-reward.dto';
import { CreateReferralDto } from './dto/create-referral.dto';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { BulkAssignSegmentDto } from './dto/bulk-assign-segment.dto';
import { MembershipUpgradeDto } from './dto/membership-upgrade.dto';
import { RewardStatus } from '@prisma/client';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // ============================================
  // Customer CRUD
  // ============================================

  @Post()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'CASHIER')
  @ApiOperation({ summary: 'Create customer' })
  async create(@Body() dto: CreateCustomerDto, @CurrentUser() user: CurrentUserData) {
    return this.customersService.create(dto, user.tenantId!, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List customers' })
  async findAll(@Query() query: QueryCustomerDto, @CurrentUser() user: CurrentUserData) {
    return this.customersService.findAll(user.tenantId!, query);
  }

  @Get('tiers')
  @ApiOperation({ summary: 'Get available loyalty tiers' })
  async getTiers(@CurrentUser() user: CurrentUserData) {
    return this.customersService.getAvailableTiers(user.tenantId!);
  }

  @Get('segments')
  @ApiOperation({ summary: 'List all segments' })
  async listSegments(@CurrentUser() user: CurrentUserData) {
    return this.customersService.listSegments(user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.findById(id, user.tenantId!);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Update customer' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.update(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete customer' })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.customersService.softDelete(id, user.tenantId!, user.id);
  }

  @Post(':id/restore')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Restore soft-deleted customer' })
  async restore(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.restore(id, user.tenantId!, user.id);
  }

  // ============================================
  // Addresses
  // ============================================

  @Post(':id/addresses')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Create customer address' })
  async createAddress(
    @Param('id') id: string,
    @Body() dto: CreateCustomerAddressDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.createAddress(id, dto, user.tenantId!);
  }

  @Put('addresses/:addressId')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Update customer address' })
  async updateAddress(
    @Param('addressId') addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateAddress(addressId, dto, user.tenantId!);
  }

  @Delete('addresses/:addressId')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete customer address' })
  async deleteAddress(@Param('addressId') addressId: string, @CurrentUser() user: CurrentUserData) {
    await this.customersService.deleteAddress(addressId, user.tenantId!);
  }

  // ============================================
  // Preferences
  // ============================================

  @Post(':id/preferences')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Set customer preference' })
  async setPreference(
    @Param('id') id: string,
    @Body() dto: SetCustomerPreferenceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.setPreference(id, dto, user.tenantId!);
  }

  @Delete(':id/preferences/:key')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete customer preference' })
  async deletePreference(
    @Param('id') id: string,
    @Param('key') key: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.customersService.deletePreference(id, key, user.tenantId!);
  }

  // ============================================
  // Loyalty Points
  // ============================================

  @Post(':id/loyalty/earn')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @ApiOperation({ summary: 'Earn loyalty points' })
  async earnPoints(
    @Param('id') id: string,
    @Body() dto: EarnPointsDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.earnPoints(id, dto, user.tenantId!, user.id);
  }

  @Post(':id/loyalty/redeem')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @ApiOperation({ summary: 'Redeem loyalty points' })
  async redeemPoints(
    @Param('id') id: string,
    @Body() dto: RedeemPointsDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.redeemPoints(id, dto, user.tenantId!, user.id);
  }

  @Post(':id/loyalty/adjust')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Adjust loyalty points (admin)' })
  async adjustPoints(
    @Param('id') id: string,
    @Body() dto: AdjustPointsDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.adjustPoints(id, dto, user.tenantId!, user.id);
  }

  @Get(':id/loyalty/balance')
  @ApiOperation({ summary: 'Get points balance' })
  async getPointsBalance(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.getPointsBalance(id, user.tenantId!);
  }

  @Get(':id/loyalty/history')
  @ApiOperation({ summary: 'Get point transaction history' })
  async getPointHistory(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.customersService.getPointHistory(id, user!.tenantId!, page ?? 1, limit ?? 20);
  }

  // ============================================
  // Membership
  // ============================================

  @Get(':id/membership')
  @ApiOperation({ summary: 'Get customer membership' })
  async getMembership(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.getMembership(id, user.tenantId!);
  }

  @Put(':id/membership/upgrade')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Upgrade/downgrade membership tier' })
  async upgradeMembership(
    @Param('id') id: string,
    @Body() dto: MembershipUpgradeDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.upgradeMembership(id, dto, user.tenantId!, user.id);
  }

  @Get(':id/membership/history')
  @ApiOperation({ summary: 'Get membership change history' })
  async getMembershipHistory(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.getMembershipHistory(id, user.tenantId!);
  }

  // ============================================
  // Rewards
  // ============================================

  @Post(':id/rewards')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create reward for customer' })
  async createReward(
    @Param('id') id: string,
    @Body() dto: CreateRewardDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.createReward(id, dto, user.tenantId!, user.id);
  }

  @Post('rewards/:rewardId/redeem')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @ApiOperation({ summary: 'Redeem a reward' })
  async redeemReward(@Param('rewardId') rewardId: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.redeemReward(rewardId, user.tenantId!, user.id);
  }

  @Post('rewards/:rewardId/cancel')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Cancel a reward' })
  async cancelReward(@Param('rewardId') rewardId: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.cancelReward(rewardId, user.tenantId!);
  }

  @Get(':id/rewards')
  @ApiOperation({ summary: 'Get customer rewards' })
  async getCustomerRewards(
    @Param('id') id: string,
    @Query('status') status?: RewardStatus,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.customersService.getCustomerRewards(id, user!.tenantId!, status);
  }

  // ============================================
  // Wallet
  // ============================================

  @Get(':id/wallet')
  @ApiOperation({ summary: 'Get customer wallet' })
  async getWallet(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.getWallet(id, user.tenantId!);
  }

  @Post(':id/wallet/recharge')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @ApiOperation({ summary: 'Recharge wallet' })
  async rechargeWallet(
    @Param('id') id: string,
    @Body() dto: WalletRechargeDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.rechargeWallet(id, dto, user.tenantId!, user.id);
  }

  @Post(':id/wallet/spend')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  @ApiOperation({ summary: 'Spend from wallet' })
  async spendWallet(
    @Param('id') id: string,
    @Body() dto: WalletSpendDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.spendWallet(id, dto, user.tenantId!, user.id);
  }

  @Post(':id/wallet/refund')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Refund to wallet' })
  async refundWallet(
    @Param('id') id: string,
    @Body() dto: WalletRefundDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.refundWallet(id, dto, user.tenantId!, user.id);
  }

  @Get(':id/wallet/transactions')
  @ApiOperation({ summary: 'Get wallet transactions' })
  async getWalletTransactions(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.customersService.getWalletTransactions(id, user!.tenantId!, page ?? 1, limit ?? 20);
  }

  // ============================================
  // Referrals
  // ============================================

  @Post(':id/referrals')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Create referral' })
  async createReferral(
    @Param('id') id: string,
    @Body() dto: CreateReferralDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.createReferral(id, dto, user.tenantId!, user.id);
  }

  @Post('referrals/:referralId/complete')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Complete referral and award points' })
  async completeReferral(
    @Param('referralId') referralId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.completeReferral(referralId, user.tenantId!);
  }

  @Get(':id/referrals/stats')
  @ApiOperation({ summary: 'Get referral statistics' })
  async getReferralStats(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.getReferralStats(id, user.tenantId!);
  }

  // ============================================
  // Segments
  // ============================================

  @Post('segments')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create customer segment' })
  async createSegment(@Body() dto: CreateSegmentDto, @CurrentUser() user: CurrentUserData) {
    return this.customersService.createSegment(dto, user.tenantId!);
  }

  @Put('segments/:segmentId')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update segment' })
  async updateSegment(
    @Param('segmentId') segmentId: string,
    @Body() dto: UpdateSegmentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.updateSegment(segmentId, dto, user.tenantId!);
  }

  @Delete('segments/:segmentId')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete segment' })
  async deleteSegment(@Param('segmentId') segmentId: string, @CurrentUser() user: CurrentUserData) {
    await this.customersService.deleteSegment(segmentId, user.tenantId!);
  }

  @Post('segments/:segmentId/assign/:customerId')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Assign customer to segment' })
  async assignToSegment(
    @Param('segmentId') segmentId: string,
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.assignCustomerToSegment(customerId, segmentId, user.tenantId!);
  }

  @Delete('segments/:segmentId/assign/:customerId')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove customer from segment' })
  async removeFromSegment(
    @Param('segmentId') segmentId: string,
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.customersService.removeCustomerFromSegment(customerId, segmentId, user.tenantId!);
  }

  @Post('segments/:segmentId/bulk-assign')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Bulk assign customers to segment' })
  async bulkAssignSegment(
    @Param('segmentId') segmentId: string,
    @Body() dto: BulkAssignSegmentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.customersService.bulkAssignSegment(segmentId, dto, user.tenantId!);
  }

  // ============================================
  // Analytics
  // ============================================

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Get customer analytics' })
  async getAnalytics(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.getCustomerAnalytics(id, user.tenantId!);
  }

  @Post(':id/analytics/recompute')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Recompute customer analytics' })
  async recomputeAnalytics(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.customersService.recomputeAnalytics(id, user.tenantId!);
  }

  // ============================================
  // Visit History
  // ============================================

  @Get(':id/visits')
  @ApiOperation({ summary: 'Get visit history' })
  async getVisitHistory(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.customersService.getVisitHistory(id, user!.tenantId!, page ?? 1, limit ?? 20);
  }

  // ============================================
  // Marketing
  // ============================================

  @Get('marketing/email-list')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get email list for marketing' })
  async getEmailList(
    @Query('segmentId') segmentId?: string,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.customersService.getEmailList(user!.tenantId!, segmentId);
  }

  @Get('marketing/sms-list')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get SMS list for marketing' })
  async getSmsList(@Query('segmentId') segmentId?: string, @CurrentUser() user?: CurrentUserData) {
    return this.customersService.getSmsList(user!.tenantId!, segmentId);
  }

  @Get('marketing/export')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Export customers' })
  async exportCustomers(
    @Query('format') format?: 'csv' | 'json',
    @Query('segmentId') segmentId?: string,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.customersService.exportCustomers(user!.tenantId!, format ?? 'json', segmentId);
  }
}
