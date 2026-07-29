import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { CustomersGateway } from './customers.gateway';
import {
  Prisma, CustomerStatus, LoyaltyTransactionType, WalletTransactionType,
  RewardType, RewardStatus, MembershipTier, SegmentType, ReferralStatus, Currency,
} from '@prisma/client';
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

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: CustomersGateway,
  ) {}

  // ============================================
  // Customer CRUD
  // ============================================

  async create(dto: CreateCustomerDto, tenantId: string, userId: string) {
    if (dto.email) {
      const existing = await this.prisma.customer.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email } },
      });
      if (existing && !existing.deletedAt) {
        throw new ConflictException('Customer with this email already exists');
      }
    }

    const customer = await this.prisma.customer.create({
      data: {
        tenantId,
        restaurantId: dto.restaurantId,
        email: dto.email,
        phone: dto.phone,
        firstName: dto.firstName,
        lastName: dto.lastName,
        avatarUrl: dto.avatarUrl,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        anniversary: dto.anniversary ? new Date(dto.anniversary) : undefined,
        language: dto.language ?? 'en',
        notes: dto.notes,
        status: dto.status ?? CustomerStatus.ACTIVE,
        preferredBranchId: dto.preferredBranchId,
        preferredTableId: dto.preferredTableId,
        tags: dto.tags ?? [],
        source: dto.source,
      },
    });

    await this.ensureMembership(customer.id, tenantId);
    await this.ensureWallet(customer.id, tenantId);

    await this.auditLogsService.log({
      action: 'CUSTOMER_CREATED',
      resource: 'Customer',
      resourceId: customer.id,
      userId,
      tenantId,
      newValues: { email: dto.email, firstName: dto.firstName, lastName: dto.lastName },
    });

    await this.cacheService.delete(tenantId, 'customers:list');
    this.gateway.broadcastCustomerUpdate(tenantId, 'customer.created', customer);

    return this.findById(customer.id, tenantId);
  }

  async findAll(tenantId: string, query: QueryCustomerDto) {
    const cacheKey = `customers:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.preferredBranchId) where.preferredBranchId = query.preferredBranchId;
    if (query.source) where.source = query.source;
    if (query.hasEmail === true) where.email = { not: null };
    if (query.hasPhone === true) where.phone = { not: null };

    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.tag) {
      where.tags = { has: query.tag };
    }

    if (query.minVisits !== undefined) {
      where.visitHistory = { some: {} };
    }

    const orderBy: Prisma.CustomerOrderByWithRelationInput = {};
    if (query.sortBy === 'firstName') orderBy.firstName = query.sortOrder ?? 'asc';
    else if (query.sortBy === 'lastName') orderBy.lastName = query.sortOrder ?? 'asc';
    else if (query.sortBy === 'createdAt') orderBy.createdAt = query.sortOrder ?? 'desc';
    else orderBy.createdAt = 'desc';

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          memberships: { orderBy: { joinedAt: 'desc' }, take: 1 },
          analytics: true,
          wallets: true,
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 120);
    return result;
  }

  async findById(id: string, tenantId: string) {
    const cacheKey = `customer:${id}`;
    const cached = await this.cacheService.get<Record<string, unknown>>(tenantId, cacheKey);
    if (cached) return cached;

    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        addresses: true,
        preferences: true,
        visitHistory: { orderBy: { visitedAt: 'desc' }, take: 10 },
            memberships: { orderBy: { joinedAt: 'desc' }, take: 1 },
        rewards: { orderBy: { createdAt: 'desc' }, take: 20 },
        wallets: true,
        referralsMade: { take: 10 },
        analytics: true,
        segmentAssignments: { include: { segment: true } },
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    await this.cacheService.set(tenantId, cacheKey, customer, 300);
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, tenantId: string, userId: string) {
    const customer = await this.findById(id, tenantId);

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        anniversary: dto.anniversary ? new Date(dto.anniversary) : undefined,
        language: dto.language,
        notes: dto.notes,
        status: dto.status,
        preferredBranchId: dto.preferredBranchId,
        preferredTableId: dto.preferredTableId,
        tags: dto.tags,
        source: dto.source,
        version: { increment: 1 },
      },
    });

    await this.auditLogsService.log({
      action: 'CUSTOMER_UPDATED',
      resource: 'Customer',
      resourceId: id,
      userId,
      tenantId,
      oldValues: customer as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `customer:${id}`);
    await this.cacheService.delete(tenantId, 'customers:list');
    this.gateway.broadcastCustomerUpdate(tenantId, 'customer.updated', updated);

    return updated;
  }

  async softDelete(id: string, tenantId: string, userId: string) {
    const customer = await this.findById(id, tenantId);

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), status: CustomerStatus.INACTIVE },
    });

    await this.auditLogsService.log({
      action: 'CUSTOMER_DELETED',
      resource: 'Customer',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: (customer as Record<string, unknown>).status as string },
    });

    await this.cacheService.delete(tenantId, `customer:${id}`);
    await this.cacheService.delete(tenantId, 'customers:list');
    this.gateway.broadcastCustomerUpdate(tenantId, 'customer.deleted', { id });
  }

  async restore(id: string, tenantId: string, userId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!customer) throw new NotFoundException('Deleted customer not found');

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: null, status: CustomerStatus.ACTIVE },
    });

    await this.auditLogsService.log({
      action: 'CUSTOMER_RESTORED',
      resource: 'Customer',
      resourceId: id,
      userId,
      tenantId,
    });

    await this.cacheService.delete(tenantId, `customer:${id}`);
    await this.cacheService.delete(tenantId, 'customers:list');
    this.gateway.broadcastCustomerUpdate(tenantId, 'customer.restored', { id });
  }

  // ============================================
  // Addresses
  // ============================================

  async createAddress(customerId: string, dto: CreateCustomerAddressDto, tenantId: string) {
    await this.findById(customerId, tenantId);

    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.customerAddress.create({
      data: {
        customerId,
        tenantId,
        label: dto.label,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        zipCode: dto.zipCode,
        country: dto.country,
        isDefault: dto.isDefault ?? false,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  async updateAddress(addressId: string, dto: UpdateCustomerAddressDto, tenantId: string) {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, tenantId },
    });
    if (!address) throw new NotFoundException('Address not found');

    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({
        where: { customerId: address.customerId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.customerAddress.update({
      where: { id: addressId },
      data: {
        label: dto.label,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        zipCode: dto.zipCode,
        country: dto.country,
        isDefault: dto.isDefault,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  async deleteAddress(addressId: string, tenantId: string) {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, tenantId },
    });
    if (!address) throw new NotFoundException('Address not found');

    await this.prisma.customerAddress.delete({ where: { id: addressId } });
  }

  // ============================================
  // Preferences
  // ============================================

  async setPreference(customerId: string, dto: SetCustomerPreferenceDto, tenantId: string) {
    await this.findById(customerId, tenantId);

    return this.prisma.customerPreference.upsert({
      where: { customerId_key: { customerId, key: dto.key } },
      update: { value: dto.value },
      create: { customerId, tenantId, key: dto.key, value: dto.value },
    });
  }

  async deletePreference(customerId: string, key: string, tenantId: string) {
    await this.findById(customerId, tenantId);

    const pref = await this.prisma.customerPreference.findUnique({
      where: { customerId_key: { customerId, key } },
    });
    if (!pref) throw new NotFoundException('Preference not found');

    await this.prisma.customerPreference.delete({ where: { customerId_key: { customerId, key } } });
  }

  // ============================================
  // Loyalty Points
  // ============================================

  async earnPoints(customerId: string, dto: EarnPointsDto, tenantId: string, userId: string) {
    const customer = await this.findById(customerId, tenantId);

    const membership = await this.ensureMembership(customerId, tenantId);
    const tierConfig = await this.getTierConfig(membership.tier, tenantId);
    const multiplier = tierConfig?.multiplier ?? 1;
    const adjustedPoints = Math.round(Number(dto.points) * Number(multiplier));

    const newBalance = membership.points + adjustedPoints;

    const txn = await this.prisma.loyaltyPointsTransaction.create({
      data: {
        customerId,
        tenantId,
        points: adjustedPoints,
        type: LoyaltyTransactionType.EARNED,
        description: dto.description ?? 'Points earned',
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
        balanceAfter: newBalance,
        expiresAt: await this.calculateExpiry(tenantId),
      },
    });

    await this.prisma.membership.update({
      where: { customerId_tenantId: { customerId, tenantId } },
      data: {
        points: newBalance,
        lifetimePoints: { increment: adjustedPoints },
        lastActivityAt: new Date(),
      },
    });

    await this.checkTierUpgrade(customerId, tenantId);

    await this.auditLogsService.log({
      action: 'LOYALTY_POINTS_EARNED',
      resource: 'LoyaltyPoints',
      resourceId: txn.id,
      userId,
      tenantId,
      newValues: { customerId, points: adjustedPoints, total: newBalance },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    await this.cacheService.delete(tenantId, `loyalty:${customerId}`);
    this.gateway.broadcastLoyaltyUpdate(tenantId, 'loyalty.earned', { customerId, points: adjustedPoints, balance: newBalance });

    return txn;
  }

  async redeemPoints(customerId: string, dto: RedeemPointsDto, tenantId: string, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.points < dto.points) {
      throw new BadRequestException('Insufficient points');
    }

    const newBalance = membership.points - dto.points;

    const txn = await this.prisma.loyaltyPointsTransaction.create({
      data: {
        customerId,
        tenantId,
        points: -dto.points,
        type: LoyaltyTransactionType.REDEEMED,
        description: dto.description ?? 'Points redeemed',
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
        balanceAfter: newBalance,
      },
    });

    await this.prisma.membership.update({
      where: { customerId_tenantId: { customerId, tenantId } },
      data: { points: newBalance, lastActivityAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'LOYALTY_POINTS_REDEEMED',
      resource: 'LoyaltyPoints',
      resourceId: txn.id,
      userId,
      tenantId,
      newValues: { customerId, points: dto.points, remaining: newBalance },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    await this.cacheService.delete(tenantId, `loyalty:${customerId}`);
    this.gateway.broadcastLoyaltyUpdate(tenantId, 'loyalty.redeemed', { customerId, points: -dto.points, balance: newBalance });

    return txn;
  }

  async adjustPoints(customerId: string, dto: AdjustPointsDto, tenantId: string, userId: string) {
    const membership = await this.ensureMembership(customerId, tenantId);

    const newBalance = membership.points + dto.points;

    const txn = await this.prisma.loyaltyPointsTransaction.create({
      data: {
        customerId,
        tenantId,
        points: dto.points,
        type: LoyaltyTransactionType.ADJUSTED,
        description: `Adjustment: ${dto.reason}`,
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
        balanceAfter: newBalance,
      },
    });

    await this.prisma.membership.update({
      where: { customerId_tenantId: { customerId, tenantId } },
      data: { points: newBalance, lastActivityAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'LOYALTY_POINTS_ADJUSTED',
      resource: 'LoyaltyPoints',
      resourceId: txn.id,
      userId,
      tenantId,
      newValues: { customerId, adjustment: dto.points, reason: dto.reason, balance: newBalance },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    await this.cacheService.delete(tenantId, `loyalty:${customerId}`);

    return txn;
  }

  async getPointHistory(customerId: string, tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { customerId, tenantId };

    const [data, total] = await Promise.all([
      this.prisma.loyaltyPointsTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loyaltyPointsTransaction.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrevious: page > 1 },
    };
  }

  async getPointsBalance(customerId: string, tenantId: string) {
    const cacheKey = `loyalty:${customerId}`;
    const cached = await this.cacheService.get<{ points: number; tier: string }>(tenantId, cacheKey);
    if (cached) return cached;

    const membership = await this.prisma.membership.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
    });

    if (!membership) {
      return { points: 0, tier: MembershipTier.BRONZE, lifetimePoints: 0 };
    }

    const result = {
      points: membership.points,
      tier: membership.tier,
      lifetimePoints: membership.lifetimePoints,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 120);
    return result;
  }

  // ============================================
  // Membership
  // ============================================

  async getMembership(customerId: string, tenantId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
      include: { customer: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    return membership;
  }

  async upgradeMembership(customerId: string, dto: MembershipUpgradeDto, tenantId: string, userId: string) {
    const membership = await this.ensureMembership(customerId, tenantId);
    const oldTier = membership.tier;

    const updated = await this.prisma.membership.update({
      where: { customerId_tenantId: { customerId, tenantId } },
      data: {
        tier: dto.tier,
        tierUpgradedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    await this.prisma.membershipHistory.create({
      data: {
        customerId,
        tenantId,
        fromTier: oldTier,
        toTier: dto.tier,
        reason: dto.reason ?? 'Manual upgrade',
        pointsAtTime: membership.points,
      },
    });

    await this.auditLogsService.log({
      action: 'MEMBERSHIP_UPGRADED',
      resource: 'Membership',
      resourceId: membership.id,
      userId,
      tenantId,
      oldValues: { tier: oldTier },
      newValues: { tier: dto.tier, reason: dto.reason },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    await this.cacheService.delete(tenantId, `loyalty:${customerId}`);
    this.gateway.broadcastMembershipUpdate(tenantId, 'membership.changed', { customerId, fromTier: oldTier, toTier: dto.tier });

    return updated;
  }

  async getMembershipHistory(customerId: string, tenantId: string) {
    return this.prisma.membershipHistory.findMany({
      where: { customerId, tenantId },
      orderBy: { changedAt: 'desc' },
      take: 50,
    });
  }

  async getAvailableTiers(tenantId: string) {
    return this.prisma.loyaltyTier.findMany({
      where: { tenantId },
      orderBy: { minPoints: 'asc' },
    });
  }

  // ============================================
  // Rewards
  // ============================================

  async createReward(customerId: string, dto: CreateRewardDto, tenantId: string, userId: string) {
    await this.findById(customerId, tenantId);

    const reward = await this.prisma.reward.create({
      data: {
        customerId,
        tenantId,
        restaurantId: dto.restaurantId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        code: dto.code,
        discountPercent: dto.discountPercent,
        discountAmount: dto.discountAmount,
        freeProductId: dto.freeProductId,
        freeProductName: dto.freeProductName,
        minOrderAmount: dto.minOrderAmount,
        status: RewardStatus.ACTIVE,
        issuedAt: new Date(),
        expiredAt: dto.expiredAt ? new Date(dto.expiredAt) : undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'REWARD_CREATED',
      resource: 'Reward',
      resourceId: reward.id,
      userId,
      tenantId,
      newValues: { customerId, type: dto.type, title: dto.title },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    return reward;
  }

  async redeemReward(rewardId: string, tenantId: string, userId: string) {
    const reward = await this.prisma.reward.findFirst({
      where: { id: rewardId, tenantId },
    });
    if (!reward) throw new NotFoundException('Reward not found');
    if (reward.status !== RewardStatus.ACTIVE) {
      throw new BadRequestException(`Reward is ${reward.status.toLowerCase()}`);
    }
    if (reward.expiredAt && reward.expiredAt < new Date()) {
      await this.prisma.reward.update({ where: { id: rewardId }, data: { status: RewardStatus.EXPIRED } });
      throw new BadRequestException('Reward has expired');
    }

    const updated = await this.prisma.reward.update({
      where: { id: rewardId },
      data: { status: RewardStatus.REDEEMED, redeemedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'REWARD_REDEEMED',
      resource: 'Reward',
      resourceId: rewardId,
      userId,
      tenantId,
    });

    await this.cacheService.delete(tenantId, `customer:${reward.customerId}`);
    this.gateway.broadcastRewardUpdate(tenantId, 'reward.redeemed', { rewardId, customerId: reward.customerId });
    return updated;
  }

  async cancelReward(rewardId: string, tenantId: string) {
    const reward = await this.prisma.reward.findFirst({
      where: { id: rewardId, tenantId },
    });
    if (!reward) throw new NotFoundException('Reward not found');

    const updated = await this.prisma.reward.update({
      where: { id: rewardId },
      data: { status: RewardStatus.CANCELLED },
    });

    await this.cacheService.delete(tenantId, `customer:${reward.customerId}`);
    return updated;
  }

  async getCustomerRewards(customerId: string, tenantId: string, status?: RewardStatus) {
    const where: Prisma.RewardWhereInput = { customerId, tenantId };
    if (status) where.status = status;

    return this.prisma.reward.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============================================
  // Wallet
  // ============================================

  async getWallet(customerId: string, tenantId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async rechargeWallet(customerId: string, dto: WalletRechargeDto, tenantId: string, userId: string) {
    const wallet = await this.ensureWallet(customerId, tenantId);

    const amount = Math.round(dto.amount * 100) / 100;

    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: amount },
        version: { increment: 1 },
      },
    });

    const txn = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        tenantId,
        customerId,
        type: WalletTransactionType.RECHARGE,
        amount,
        balanceBefore: Number(wallet.balance),
        balanceAfter: Number(updated.balance),
        description: dto.description ?? 'Wallet recharge',
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
      },
    });

    await this.auditLogsService.log({
      action: 'WALLET_RECHARGED',
      resource: 'Wallet',
      resourceId: wallet.id,
      userId,
      tenantId,
      newValues: { customerId, amount, balance: Number(updated.balance) },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    this.gateway.broadcastWalletUpdate(tenantId, 'wallet.updated', { customerId, balance: Number(updated.balance) });

    return { wallet: updated, transaction: txn };
  }

  async spendWallet(customerId: string, dto: WalletSpendDto, tenantId: string, userId: string) {
    const wallet = await this.ensureWallet(customerId, tenantId);

    const amount = Math.round(dto.amount * 100) / 100;

    if (Number(wallet.balance) < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        version: { increment: 1 },
      },
    });

    const txn = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        tenantId,
        customerId,
        type: WalletTransactionType.SPEND,
        amount: -amount,
        balanceBefore: Number(wallet.balance),
        balanceAfter: Number(updated.balance),
        description: dto.description ?? 'Wallet spend',
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
      },
    });

    await this.auditLogsService.log({
      action: 'WALLET_SPENT',
      resource: 'Wallet',
      resourceId: wallet.id,
      userId,
      tenantId,
      newValues: { customerId, amount, balance: Number(updated.balance) },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    this.gateway.broadcastWalletUpdate(tenantId, 'wallet.updated', { customerId, balance: Number(updated.balance) });

    return { wallet: updated, transaction: txn };
  }

  async refundWallet(customerId: string, dto: WalletRefundDto, tenantId: string, userId: string) {
    const wallet = await this.ensureWallet(customerId, tenantId);

    const amount = Math.round(dto.amount * 100) / 100;

    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: amount },
        version: { increment: 1 },
      },
    });

    const txn = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        tenantId,
        customerId,
        type: WalletTransactionType.REFUND,
        amount,
        balanceBefore: Number(wallet.balance),
        balanceAfter: Number(updated.balance),
        description: dto.description ?? 'Wallet refund',
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
      },
    });

    await this.auditLogsService.log({
      action: 'WALLET_REFUNDED',
      resource: 'Wallet',
      resourceId: wallet.id,
      userId,
      tenantId,
      newValues: { customerId, amount, balance: Number(updated.balance) },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    this.gateway.broadcastWalletUpdate(tenantId, 'wallet.updated', { customerId, balance: Number(updated.balance) });

    return { wallet: updated, transaction: txn };
  }

  async getWalletTransactions(customerId: string, tenantId: string, page = 1, limit = 20) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const skip = (page - 1) * limit;
    const where = { walletId: wallet.id };

    const [data, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrevious: page > 1 },
    };
  }

  // ============================================
  // Referrals
  // ============================================

  async createReferral(customerId: string, dto: CreateReferralDto, tenantId: string, userId: string) {
    await this.findById(customerId, tenantId);

    const existing = await this.prisma.referral.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new ConflictException('Referral code already exists');

    const referral = await this.prisma.referral.create({
      data: {
        referrerId: customerId,
        referredId: dto.referredId,
        tenantId,
        code: dto.code,
        referredEmail: dto.referredEmail,
        referredPhone: dto.referredPhone,
        status: ReferralStatus.PENDING,
      },
    });

    await this.auditLogsService.log({
      action: 'REFERRAL_CREATED',
      resource: 'Referral',
      resourceId: referral.id,
      userId,
      tenantId,
      newValues: { referrerId: customerId, code: dto.code },
    });

    return referral;
  }

  async completeReferral(referralId: string, tenantId: string) {
    const referral = await this.prisma.referral.findFirst({
      where: { id: referralId, tenantId },
    });
    if (!referral) throw new NotFoundException('Referral not found');

    const program = await this.prisma.loyaltyProgram.findUnique({
      where: { tenantId },
    });

    const referrerPoints = program?.referrerPoints ?? 50;
    const referredPoints = program?.referredPoints ?? 25;

    await this.earnPoints(
      referral.referrerId,
      { points: referrerPoints, description: 'Referral reward' },
      tenantId,
      'system',
    );

    if (referral.referredId) {
      await this.earnPoints(
        referral.referredId,
        { points: referredPoints, description: 'Signup referral bonus' },
        tenantId,
        'system',
      );
    }

    return this.prisma.referral.update({
      where: { id: referralId },
      data: {
        status: ReferralStatus.REWARDED,
        rewardGiven: true,
        rewardPoints: referrerPoints,
        referredAt: new Date(),
      },
    });
  }

  async getReferralStats(customerId: string, tenantId: string) {
    const [total, rewarded, pending] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: customerId, tenantId } }),
      this.prisma.referral.count({ where: { referrerId: customerId, tenantId, status: ReferralStatus.REWARDED } }),
      this.prisma.referral.count({ where: { referrerId: customerId, tenantId, status: ReferralStatus.PENDING } }),
    ]);

    const pointsEarned = await this.prisma.referral.aggregate({
      where: { referrerId: customerId, tenantId },
      _sum: { rewardPoints: true },
    });

    return { total, rewarded, pending, pointsEarned: pointsEarned._sum.rewardPoints ?? 0 };
  }

  // ============================================
  // Segments
  // ============================================

  async createSegment(dto: CreateSegmentDto, tenantId: string) {
    return this.prisma.customerSegment.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type ?? SegmentType.CUSTOM,
        description: dto.description,
        rules: (dto.rules ?? Prisma.DbNull) as Prisma.InputJsonValue,
        isDynamic: dto.isDynamic ?? false,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateSegment(segmentId: string, dto: UpdateSegmentDto, tenantId: string) {
    const segment = await this.prisma.customerSegment.findFirst({
      where: { id: segmentId, tenantId },
    });
    if (!segment) throw new NotFoundException('Segment not found');

    return this.prisma.customerSegment.update({
      where: { id: segmentId },
      data: {
        name: dto.name,
        type: dto.type,
        description: dto.description,
        rules: dto.rules !== undefined ? dto.rules as Prisma.InputJsonValue : undefined,
        isDynamic: dto.isDynamic,
        isActive: dto.isActive,
      },
    });
  }

  async deleteSegment(segmentId: string, tenantId: string) {
    const segment = await this.prisma.customerSegment.findFirst({
      where: { id: segmentId, tenantId },
    });
    if (!segment) throw new NotFoundException('Segment not found');

    await this.prisma.customerSegmentAssignment.deleteMany({ where: { segmentId } });
    await this.prisma.customerSegment.delete({ where: { id: segmentId } });
  }

  async listSegments(tenantId: string) {
    const cacheKey = 'segments:list';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const segments = await this.prisma.customerSegment.findMany({
      where: { tenantId },
      include: { _count: { select: { assignments: true } } },
      orderBy: { name: 'asc' },
    });

    await this.cacheService.set(tenantId, cacheKey, segments, 300);
    return segments;
  }

  async assignCustomerToSegment(customerId: string, segmentId: string, tenantId: string) {
    await this.findById(customerId, tenantId);

    const segment = await this.prisma.customerSegment.findFirst({
      where: { id: segmentId, tenantId },
    });
    if (!segment) throw new NotFoundException('Segment not found');

    const assignment = await this.prisma.customerSegmentAssignment.upsert({
      where: { customerId_segmentId: { customerId, segmentId } },
      update: {},
      create: { customerId, segmentId, tenantId },
    });

    await this.cacheService.delete(tenantId, 'segments:list');
    await this.cacheService.delete(tenantId, `customer:${customerId}`);

    return assignment;
  }

  async removeCustomerFromSegment(customerId: string, segmentId: string, tenantId: string) {
    const assignment = await this.prisma.customerSegmentAssignment.findUnique({
      where: { customerId_segmentId: { customerId, segmentId } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    await this.prisma.customerSegmentAssignment.delete({
      where: { customerId_segmentId: { customerId, segmentId } },
    });

    await this.cacheService.delete(tenantId, 'segments:list');
    await this.cacheService.delete(tenantId, `customer:${customerId}`);
  }

  async bulkAssignSegment(segmentId: string, dto: BulkAssignSegmentDto, tenantId: string) {
    const segment = await this.prisma.customerSegment.findFirst({
      where: { id: segmentId, tenantId },
    });
    if (!segment) throw new NotFoundException('Segment not found');

    const results = [];
    for (const customerId of dto.customerIds) {
      try {
        const assignment = await this.prisma.customerSegmentAssignment.upsert({
          where: { customerId_segmentId: { customerId, segmentId } },
          update: {},
          create: { customerId, segmentId, tenantId },
        });
        results.push(assignment);
      } catch { continue; }
    }

    await this.cacheService.delete(tenantId, 'segments:list');
    return results;
  }

  // ============================================
  // Analytics
  // ============================================

  async getCustomerAnalytics(customerId: string, tenantId: string) {
    const analytics = await this.prisma.customerAnalytics.findUnique({
      where: { customerId },
    });

    if (!analytics) {
      return {
        lifetimeValue: 0,
        averageOrderValue: 0,
        visitFrequency: 0,
        totalVisits: 0,
        totalSpend: 0,
        totalOrders: 0,
        lastVisitAt: null,
        lastOrderAt: null,
        rewardUsageCount: 0,
        rewardPointsEarned: 0,
        rewardPointsRedeemed: 0,
        daysSinceLastVisit: 0,
      };
    }

    return analytics;
  }

  async recomputeAnalytics(customerId: string, tenantId: string) {
    const visits = await this.prisma.visitHistory.findMany({
      where: { customerId, tenantId },
    });

    const totalVisits = visits.length;
    const totalSpend = visits.reduce((sum, v) => sum + Number(v.totalSpent ?? 0), 0);
    const totalOrders = visits.filter(v => v.orderId).length;
    const averageOrderValue = totalOrders > 0 ? totalSpend / totalOrders : 0;
    const lastVisit = visits.length > 0 ? visits.reduce((latest, v) =>
      v.visitedAt > latest.visitedAt ? v : latest
    ) : null;

    const membership = await this.prisma.membership.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
    });

    const pointsEarned = await this.prisma.loyaltyPointsTransaction.aggregate({
      where: { customerId, tenantId, type: LoyaltyTransactionType.EARNED },
      _sum: { points: true },
    });

    const pointsRedeemed = await this.prisma.loyaltyPointsTransaction.aggregate({
      where: { customerId, tenantId, type: LoyaltyTransactionType.REDEEMED },
      _sum: { points: true },
    });

    const rewardsUsed = await this.prisma.reward.count({
      where: { customerId, tenantId, status: RewardStatus.REDEEMED },
    });

    const daysSinceLastVisit = lastVisit
      ? Math.floor((Date.now() - new Date(lastVisit.visitedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return this.prisma.customerAnalytics.upsert({
      where: { customerId },
      update: {
        lifetimeValue: totalSpend,
        averageOrderValue,
        visitFrequency: totalVisits,
        totalVisits,
        totalSpend,
        totalOrders,
        lastVisitAt: lastVisit?.visitedAt ?? null,
        rewardUsageCount: rewardsUsed,
        rewardPointsEarned: pointsEarned._sum.points ?? 0,
        rewardPointsRedeemed: Math.abs(pointsRedeemed._sum.points ?? 0),
        daysSinceLastVisit,
        computedAt: new Date(),
      },
      create: {
        customerId,
        tenantId,
        lifetimeValue: totalSpend,
        averageOrderValue,
        visitFrequency: totalVisits,
        totalVisits,
        totalSpend,
        totalOrders,
        lastVisitAt: lastVisit?.visitedAt ?? null,
        rewardUsageCount: rewardsUsed,
        rewardPointsEarned: pointsEarned._sum.points ?? 0,
        rewardPointsRedeemed: Math.abs(pointsRedeemed._sum.points ?? 0),
        daysSinceLastVisit,
        computedAt: new Date(),
      },
    });
  }

  // ============================================
  // Visit History
  // ============================================

  async recordVisit(customerId: string, data: {
    restaurantId?: string;
    branchId?: string;
    orderId?: string;
    totalSpent?: number;
    itemsCount?: number;
  }, tenantId: string) {
    await this.findById(customerId, tenantId);

    const visit = await this.prisma.visitHistory.create({
      data: {
        customerId,
        tenantId,
        restaurantId: data.restaurantId,
        branchId: data.branchId,
        orderId: data.orderId,
        totalSpent: data.totalSpent ?? 0,
        itemsCount: data.itemsCount ?? 0,
        visitedAt: new Date(),
      },
    });

    await this.prisma.membership.update({
      where: { customerId_tenantId: { customerId, tenantId } },
      data: {
        totalVisits: { increment: 1 },
        totalSpent: { increment: data.totalSpent ?? 0 },
        lastActivityAt: new Date(),
      },
    });

    await this.cacheService.delete(tenantId, `customer:${customerId}`);
    return visit;
  }

  async getVisitHistory(customerId: string, tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { customerId, tenantId };

    const [data, total] = await Promise.all([
      this.prisma.visitHistory.findMany({ where, skip, take: limit, orderBy: { visitedAt: 'desc' } }),
      this.prisma.visitHistory.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrevious: page > 1 },
    };
  }

  // ============================================
  // Marketing Lists & Export
  // ============================================

  async getEmailList(tenantId: string, segmentId?: string) {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      email: { not: null },
      status: CustomerStatus.ACTIVE,
    };

    if (segmentId) {
      where.segmentAssignments = { some: { segmentId } };
    }

    const customers = await this.prisma.customer.findMany({
      where,
      select: { id: true, email: true, firstName: true, lastName: true, language: true },
    });

    return customers;
  }

  async getSmsList(tenantId: string, segmentId?: string) {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      phone: { not: null },
      status: CustomerStatus.ACTIVE,
    };

    if (segmentId) {
      where.segmentAssignments = { some: { segmentId } };
    }

    const customers = await this.prisma.customer.findMany({
      where,
      select: { id: true, phone: true, firstName: true, lastName: true },
    });

    return customers;
  }

  async exportCustomers(tenantId: string, format: 'csv' | 'json' = 'json', segmentId?: string) {
    const where: Prisma.CustomerWhereInput = { tenantId, deletedAt: null };
    if (segmentId) {
      where.segmentAssignments = { some: { segmentId } };
    }

    const customers = await this.prisma.customer.findMany({
      where,
      include: { memberships: { orderBy: { joinedAt: 'desc' }, take: 1 }, analytics: true },
    });

    if (format === 'csv') {
      const header = 'id,firstName,lastName,email,phone,status,tier,points,totalSpend,totalVisits,lastVisitAt,createdAt';
      const rows = (customers as Array<Record<string, unknown>>).map(c => {
        const membership = (c.memberships as Array<Record<string, unknown>> | undefined)?.[0] ?? null;
        const analytics = c.analytics as Record<string, unknown> | null;
        return `"${c.id}","${c.firstName}","${c.lastName}","${c.email ?? ''}","${c.phone ?? ''}","${c.status}","${membership?.tier ?? ''}",${membership?.points ?? 0},${analytics?.totalSpend ?? 0},${analytics?.totalVisits ?? 0},"${analytics?.lastVisitAt ? new Date(analytics.lastVisitAt as string).toISOString() : ''}","${new Date(c.createdAt as string).toISOString()}"`;
      });
      return [header, ...rows].join('\n');
    }

    return customers;
  }

  // ============================================
  // Internal Helpers
  // ============================================

  private async ensureMembership(customerId: string, tenantId: string) {
    let membership = await this.prisma.membership.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
    });

    if (!membership) {
      membership = await this.prisma.membership.create({
        data: { customerId, tenantId, tier: MembershipTier.BRONZE },
      });
    }

    return membership;
  }

  private async ensureWallet(customerId: string, tenantId: string) {
    let wallet = await this.prisma.wallet.findUnique({
      where: { customerId_tenantId: { customerId, tenantId } },
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { customerId, tenantId },
      });
    }

    return wallet;
  }

  private async getTierConfig(tier: MembershipTier, tenantId: string) {
    const program = await this.prisma.loyaltyProgram.findUnique({
      where: { tenantId },
      include: { tiers: true },
    });

    return program?.tiers.find(t => t.tier === tier) ?? null;
  }

  private async calculateExpiry(tenantId: string): Promise<Date | undefined> {
    const program = await this.prisma.loyaltyProgram.findUnique({
      where: { tenantId },
    });

    if (!program || !program.pointsExpireDays) return undefined;

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + program.pointsExpireDays);
    return expiry;
  }

  private async checkTierUpgrade(customerId: string, tenantId: string) {
    const membership = await this.ensureMembership(customerId, tenantId);
    const tiers = await this.prisma.loyaltyTier.findMany({
      where: { tenantId },
      orderBy: { minPoints: 'asc' },
    });

    let newTier: MembershipTier | null = null;
    for (const tier of tiers) {
      if (membership.points >= tier.minPoints && membership.points <= (tier.maxPoints ?? Infinity)) {
        newTier = tier.tier;
      }
    }

    if (newTier && newTier !== membership.tier) {
      const oldTier = membership.tier;
      await this.prisma.membership.update({
        where: { customerId_tenantId: { customerId, tenantId } },
        data: { tier: newTier, tierUpgradedAt: new Date() },
      });

      await this.prisma.membershipHistory.create({
        data: { customerId, tenantId, fromTier: oldTier, toTier: newTier, reason: 'Automatic upgrade', pointsAtTime: membership.points },
      });

      this.gateway.broadcastMembershipUpdate(tenantId, 'membership.changed', { customerId, fromTier: oldTier, toTier: newTier });
    }
  }
}
