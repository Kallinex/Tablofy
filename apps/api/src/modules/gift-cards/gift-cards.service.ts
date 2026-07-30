import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { CreateGiftCardDto } from './dto/create-gift-card.dto';
import { RechargeGiftCardDto } from './dto/recharge-gift-card.dto';
import { RedeemGiftCardDto } from './dto/redeem-gift-card.dto';
import * as crypto from 'crypto';

@Injectable()
export class GiftCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async create(tenantId: string, dto: CreateGiftCardDto, lang: string, issuedById?: string) {
    const code = this.generateCode();
    return this.prisma.giftCard.create({
      data: {
        code,
        tenantId,
        initialBalance: dto.initialBalance,
        currentBalance: dto.initialBalance,
        currency: dto.currency ?? 'USD',
        issueType: dto.issueType ?? 'MANUAL',
        recipientName: dto.recipientName,
        recipientEmail: dto.recipientEmail,
        recipientPhone: dto.recipientPhone,
        message: dto.message,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        issuedById,
        transactions: {
          create: {
            tenantId,
            type: 'ISSUE',
            amount: dto.initialBalance,
            balanceBefore: 0,
            balanceAfter: dto.initialBalance,
            currency: dto.currency ?? 'USD',
          },
        },
      },
    });
  }

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.giftCard.findMany({
        where: { tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.giftCard.count({ where: { tenantId } }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(tenantId: string, id: string, lang: string) {
    const giftCard = await this.prisma.giftCard.findFirst({ where: { id, tenantId } });
    if (!giftCard) {
      throw new NotFoundException(this.i18n.t('giftCard.notFound', lang));
    }
    return giftCard;
  }

  async findByCode(tenantId: string, code: string, lang: string) {
    const giftCard = await this.prisma.giftCard.findFirst({ where: { code, tenantId } });
    if (!giftCard) {
      throw new NotFoundException(this.i18n.t('giftCard.invalidCode', lang));
    }
    return giftCard;
  }

  async recharge(
    tenantId: string,
    id: string,
    dto: RechargeGiftCardDto,
    lang: string,
    performedById?: string,
  ) {
    const giftCard = await this.findOne(tenantId, id, lang);
    if (giftCard.status !== 'ACTIVE') {
      throw new BadRequestException(this.i18n.t('giftCard.deactivated', lang));
    }
    if (giftCard.expiresAt && new Date() > giftCard.expiresAt) {
      throw new BadRequestException(this.i18n.t('giftCard.expired', lang));
    }

    const balanceBefore = Number(giftCard.currentBalance);
    const balanceAfter = balanceBefore + dto.amount;

    const [updated] = await Promise.all([
      this.prisma.giftCard.update({
        where: { id },
        data: { currentBalance: balanceAfter },
      }),
      this.prisma.giftCardTransaction.create({
        data: {
          giftCardId: id,
          tenantId,
          type: 'RECHARGE',
          amount: dto.amount,
          balanceBefore,
          balanceAfter,
          description: dto.description,
          performedById,
        },
      }),
    ]);

    return updated;
  }

  async redeem(
    tenantId: string,
    id: string,
    dto: RedeemGiftCardDto,
    lang: string,
    performedById?: string,
  ) {
    const giftCard = await this.findOne(tenantId, id, lang);
    if (giftCard.status !== 'ACTIVE') {
      throw new BadRequestException(this.i18n.t('giftCard.deactivated', lang));
    }
    if (giftCard.expiresAt && new Date() > giftCard.expiresAt) {
      throw new BadRequestException(this.i18n.t('giftCard.expired', lang));
    }
    if (Number(giftCard.currentBalance) < dto.amount) {
      throw new BadRequestException(this.i18n.t('giftCard.insufficientBalance', lang));
    }

    const balanceBefore = Number(giftCard.currentBalance);
    const balanceAfter = balanceBefore - dto.amount;

    const [updated] = await Promise.all([
      this.prisma.giftCard.update({
        where: { id },
        data: { currentBalance: balanceAfter },
      }),
      this.prisma.giftCardTransaction.create({
        data: {
          giftCardId: id,
          tenantId,
          type: 'REDEEM',
          amount: dto.amount,
          balanceBefore,
          balanceAfter,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType,
          description: dto.description,
          performedById,
        },
      }),
    ]);

    return updated;
  }

  async getTransactions(tenantId: string, id: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.giftCardTransaction.findMany({
        where: { giftCardId: id, tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.giftCardTransaction.count({ where: { giftCardId: id, tenantId } }),
    ]);
    return { data, total, page, limit };
  }

  async deactivate(tenantId: string, id: string, lang: string) {
    await this.findOne(tenantId, id, lang);
    await this.prisma.giftCard.update({
      where: { id },
      data: { status: 'DEACTIVATED' },
    });
    return { message: this.i18n.t('giftCard.deactivated', lang) };
  }

  private generateCode(): string {
    return 'GC-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  }
}
