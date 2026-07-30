import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { I18nService } from '../../common/i18n/i18n.service';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async recordConsent(
    tenantId: string,
    dto: {
      type: string;
      granted: boolean;
      userId?: string;
      customerId?: string;
      ipAddress?: string;
      userAgent?: string;
    },
    _lang: string,
  ) {
    return this.prisma.consentRecord.create({
      data: {
        tenantId,
        type: dto.type,
        granted: dto.granted,
        userId: dto.userId,
        customerId: dto.customerId,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      },
    });
  }

  async revokeConsent(tenantId: string, id: string, lang: string) {
    const record = await this.prisma.consentRecord.findFirst({ where: { id, tenantId } });
    if (!record) {
      throw new NotFoundException(
        this.i18n.t('common.notFound', lang, { resource: 'Consent record' }),
      );
    }
    return this.prisma.consentRecord.update({
      where: { id },
      data: { granted: false, revokedAt: new Date() },
    });
  }

  async getConsentRecords(tenantId: string, userId?: string, customerId?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (userId) where.userId = userId;
    if (customerId) where.customerId = customerId;
    return this.prisma.consentRecord.findMany({ where, orderBy: { consentDate: 'desc' } });
  }

  async saveCookiePreferences(
    tenantId: string,
    dto: {
      userId?: string;
      visitorId?: string;
      necessary?: boolean;
      functional?: boolean;
      analytics?: boolean;
      marketing?: boolean;
      thirdParty?: boolean;
      ipAddress?: string;
      userAgent?: string;
    },
    _lang: string,
  ) {
    const existing = await this.prisma.cookiePreference.findFirst({
      where: dto.userId ? { tenantId, userId: dto.userId } : { tenantId, visitorId: dto.visitorId },
    });
    if (existing) {
      return this.prisma.cookiePreference.update({
        where: { id: existing.id },
        data: {
          functional: dto.functional,
          analytics: dto.analytics,
          marketing: dto.marketing,
          thirdParty: dto.thirdParty,
          ipAddress: dto.ipAddress,
          userAgent: dto.userAgent,
        },
      });
    }
    return this.prisma.cookiePreference.create({ data: { tenantId, ...dto } });
  }

  async getCookiePreferences(tenantId: string, userId?: string, visitorId?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (userId) where.userId = userId;
    if (visitorId) where.visitorId = visitorId;
    return this.prisma.cookiePreference.findFirst({ where });
  }

  async requestDataExport(tenantId: string, userId: string, format = 'JSON', _lang: string) {
    return this.prisma.dataExportRequest.create({
      data: { tenantId, userId, format, status: 'PENDING', requestType: 'FULL' },
    });
  }

  async getExportStatus(tenantId: string, requestId: string, lang: string) {
    const req = await this.prisma.dataExportRequest.findFirst({
      where: { id: requestId, tenantId },
    });
    if (!req) {
      throw new NotFoundException(
        this.i18n.t('common.notFound', lang, { resource: 'Export request' }),
      );
    }
    return req;
  }

  async getUserExports(tenantId: string, userId: string) {
    return this.prisma.dataExportRequest.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async processDataExport(requestId: string) {
    const req = await this.prisma.dataExportRequest.findUnique({ where: { id: requestId } });
    if (!req || req.status !== 'PENDING') return null;

    try {
      const exportDir = path.join(process.cwd(), 'exports');
      await fs.mkdir(exportDir, { recursive: true });

      const user = await this.prisma.user.findUnique({
        where: { id: req.userId },
      });

      const exportData = {
        exportedAt: new Date().toISOString(),
        userId: req.userId,
        tenantId: req.tenantId,
        user: user
          ? {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              phone: user.phone,
              role: user.role,
              createdAt: user.createdAt,
            }
          : null,
      };

      const filename = `export-${requestId}-${Date.now()}.json`;
      const filePath = path.join(exportDir, filename);
      await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));

      const stat = await fs.stat(filePath);

      return this.prisma.dataExportRequest.update({
        where: { id: requestId },
        data: {
          status: 'COMPLETED',
          filePath,
          fileSize: stat.size,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return this.prisma.dataExportRequest.update({
        where: { id: requestId },
        data: { status: 'FAILED', errorMessage: message },
      });
    }
  }

  async anonymizeUser(tenantId: string, userId: string, lang: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) {
      throw new NotFoundException(this.i18n.t('common.notFound', lang, { resource: 'User' }));
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: `[REDACTED-${userId.substring(0, 8)}]`,
        lastName: '[REDACTED]',
        email: `redacted-${userId.substring(0, 8)}@anon.local`,
        phone: null,
      },
    });
  }
}
