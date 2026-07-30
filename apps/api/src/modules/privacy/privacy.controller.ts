import { Controller, Post, Get, Param, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PrivacyService } from './privacy.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('privacy')
@ApiBearerAuth()
@Roles('OWNER', 'MANAGER')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Post('consent')
  @ApiOperation({ summary: 'Record user consent' })
  recordConsent(
    @Body() dto: { type: string; granted: boolean; userId?: string; customerId?: string },
    @Req() req: Request & { tenantId: string; lang: string; user?: { id: string } },
  ) {
    return this.privacyService.recordConsent(
      req.tenantId,
      { ...dto, userId: dto.userId || req.user?.id },
      req.lang,
    );
  }

  @Post('consent/:id/revoke')
  @ApiOperation({ summary: 'Revoke user consent' })
  revokeConsent(@Param('id') id: string, @Req() req: Request & { tenantId: string; lang: string }) {
    return this.privacyService.revokeConsent(req.tenantId, id, req.lang);
  }

  @Get('consent')
  @ApiOperation({ summary: 'Get consent records' })
  getConsentRecords(
    @Req() req: Request & { tenantId: string; user?: { id: string } },
    @Body('userId') userId?: string,
  ) {
    return this.privacyService.getConsentRecords(req.tenantId, userId || req.user?.id);
  }

  @Post('cookies')
  @ApiOperation({ summary: 'Save cookie preferences' })
  saveCookiePreferences(
    @Body()
    dto: {
      visitorId?: string;
      necessary?: boolean;
      functional?: boolean;
      analytics?: boolean;
      marketing?: boolean;
      thirdParty?: boolean;
    },
    @Req() req: Request & { tenantId: string; lang: string; user?: { id: string } },
  ) {
    return this.privacyService.saveCookiePreferences(
      req.tenantId,
      { ...dto, userId: req.user?.id },
      req.lang,
    );
  }

  @Get('cookies')
  @ApiOperation({ summary: 'Get cookie preferences' })
  getCookiePreferences(@Req() req: Request & { tenantId: string; user?: { id: string } }) {
    return this.privacyService.getCookiePreferences(req.tenantId, req.user?.id);
  }

  @Post('export')
  @ApiOperation({ summary: 'Request data export' })
  requestDataExport(
    @Req() req: Request & { tenantId: string; lang: string; user: { id: string } },
  ) {
    return this.privacyService.requestDataExport(req.tenantId, req.user.id, 'JSON', req.lang);
  }

  @Get('export')
  @ApiOperation({ summary: 'Get my export requests' })
  getUserExports(@Req() req: Request & { tenantId: string; user: { id: string } }) {
    return this.privacyService.getUserExports(req.tenantId, req.user.id);
  }

  @Get('export/:id')
  @ApiOperation({ summary: 'Get export status' })
  getExportStatus(
    @Param('id') id: string,
    @Req() req: Request & { tenantId: string; lang: string },
  ) {
    return this.privacyService.getExportStatus(req.tenantId, id, req.lang);
  }

  @Post('anonymize')
  @ApiOperation({ summary: 'Anonymize my user data (GDPR right to erasure)' })
  anonymizeUser(@Req() req: Request & { tenantId: string; lang: string; user: { id: string } }) {
    return this.privacyService.anonymizeUser(req.tenantId, req.user.id, req.lang);
  }
}
