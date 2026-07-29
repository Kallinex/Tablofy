import {
  Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateTimelineEntryDto } from './dto/create-timeline-entry.dto';
import { CreateCommunicationDto } from './dto/create-communication.dto';
import { CreateCommunicationTemplateDto } from './dto/create-communication-template.dto';
import { UpdateCommunicationTemplateDto } from './dto/update-communication-template.dto';
import { CreateEventRuleDto } from './dto/create-event-rule.dto';
import { UpdateEventRuleDto } from './dto/update-event-rule.dto';
import { TimelineEventType, CommunicationStatus } from '@prisma/client';

@Controller('crm')
@UseGuards(JwtAuthGuard)
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  // ── Timeline ──

  @Post('customers/:customerId/timeline')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async addTimelineEntry(
    @Param('customerId') customerId: string,
    @Body() dto: CreateTimelineEntryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.addTimelineEntry(customerId, dto, tenantId, user.id ?? undefined);
  }

  @Get('customers/:customerId/timeline')
  async getTimeline(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: TimelineEventType,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.getTimeline(customerId, tenantId, page, limit, type);
  }

  // ── Communication Templates ──

  @Post('templates')
  @Roles('OWNER', 'MANAGER')
  async createTemplate(
    @Body() dto: CreateCommunicationTemplateDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.createTemplate(dto, tenantId, user.id ?? undefined);
  }

  @Get('templates')
  @Roles('OWNER', 'MANAGER')
  async listTemplates(
    @CurrentUser() user: CurrentUserData,
    @Query('channel') channel?: string,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.listTemplates(tenantId, channel);
  }

  @Get('templates/:id')
  @Roles('OWNER', 'MANAGER')
  async getTemplate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.getTemplate(id, tenantId);
  }

  @Put('templates/:id')
  @Roles('OWNER', 'MANAGER')
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateCommunicationTemplateDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.updateTemplate(id, dto, tenantId, user.id ?? undefined);
  }

  @Delete('templates/:id')
  @Roles('OWNER', 'MANAGER')
  async deleteTemplate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    await this.crmService.deleteTemplate(id, tenantId, user.id ?? undefined);
    return { deleted: true };
  }

  // ── Communication Logs ──

  @Post('communications')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  async sendCommunication(
    @Body() dto: CreateCommunicationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.sendCommunication(dto, tenantId, user.id ?? undefined);
  }

  @Get('communications')
  @Roles('OWNER', 'MANAGER')
  async getCommunicationLogs(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('customerId') customerId?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.getCommunicationLogs(tenantId, page, limit, customerId, channel, status);
  }

  @Put('communications/:id/status')
  @Roles('OWNER', 'MANAGER')
  async updateCommunicationStatus(
    @Param('id') id: string,
    @Body('status') status: CommunicationStatus,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.updateCommunicationStatus(id, status, tenantId);
  }

  // ── Event Rules ──

  @Post('event-rules')
  @Roles('OWNER', 'MANAGER')
  async createEventRule(
    @Body() dto: CreateEventRuleDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.createEventRule(dto, tenantId, user.id ?? undefined);
  }

  @Get('event-rules')
  @Roles('OWNER', 'MANAGER')
  async listEventRules(
    @CurrentUser() user: CurrentUserData,
    @Query('event') event?: string,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.listEventRules(tenantId, event);
  }

  @Get('event-rules/:id')
  @Roles('OWNER', 'MANAGER')
  async getEventRule(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.getEventRule(id, tenantId);
  }

  @Put('event-rules/:id')
  @Roles('OWNER', 'MANAGER')
  async updateEventRule(
    @Param('id') id: string,
    @Body() dto: UpdateEventRuleDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.updateEventRule(id, dto, tenantId, user.id ?? undefined);
  }

  @Delete('event-rules/:id')
  @Roles('OWNER', 'MANAGER')
  async deleteEventRule(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const tenantId = user.tenantId!;
    await this.crmService.deleteEventRule(id, tenantId, user.id ?? undefined);
    return { deleted: true };
  }

  // ── Event Logs ──

  @Get('event-logs')
  @Roles('OWNER', 'MANAGER')
  async getEventLogs(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('event') event?: string,
  ) {
    const tenantId = user.tenantId!;
    return this.crmService.getEventLogs(tenantId, page, limit, event);
  }

  // ── Analytics ──

  @Get('analytics')
  @Roles('OWNER', 'MANAGER')
  async getCrmAnalytics(@CurrentUser() user: CurrentUserData) {
    const tenantId = user.tenantId!;
    return this.crmService.getCrmAnalytics(tenantId);
  }
}
