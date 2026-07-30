import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ScheduledReportsService } from './scheduled-reports.service';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';
import { UpdateScheduledReportDto } from './dto/update-scheduled-report.dto';
import { ScheduledReportQueryDto } from './dto/scheduled-report-query.dto';

@Controller('scheduled-reports')
export class ScheduledReportsController {
  constructor(private readonly scheduledReportsService: ScheduledReportsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateScheduledReportDto, @CurrentUser() user: CurrentUserData) {
    return this.scheduledReportsService.create(user.tenantId!, user.id, dto);
  }

  @Get()
  async findAll(@Query() query: ScheduledReportQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.scheduledReportsService.findAll(user.tenantId!, query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.scheduledReportsService.findOne(user.tenantId!, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateScheduledReportDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.scheduledReportsService.update(user.tenantId!, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.scheduledReportsService.remove(user.tenantId!, id);
  }

  @Post(':id/trigger')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.ACCEPTED)
  async trigger(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.scheduledReportsService.trigger(user.tenantId!, user.id, id);
  }
}
