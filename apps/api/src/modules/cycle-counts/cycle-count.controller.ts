import {
  Controller, Get, Post, Put, Delete, Param, Query, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CycleCountService } from './cycle-count.service';
import { CreateCycleCountDto } from './dto/create-cycle-count.dto';
import { UpdateCycleCountDto } from './dto/update-cycle-count.dto';
import { QueryCycleCountDto } from './dto/query-cycle-count.dto';
import { RecordCountDto } from './dto/record-count.dto';

@Controller('cycle-counts')
export class CycleCountController {
  constructor(private readonly cycleCountService: CycleCountService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(@Body() dto: CreateCycleCountDto, @CurrentUser() user: CurrentUserData) {
    return this.cycleCountService.create(dto, user.tenantId!, user.id);
  }

  @Get()
  async findAll(@Query() query: QueryCycleCountDto, @CurrentUser() user: CurrentUserData) {
    return this.cycleCountService.findAll(user.tenantId!, query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.cycleCountService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCycleCountDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.cycleCountService.update(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.cycleCountService.remove(id, user.tenantId!, user.id);
  }

  @Post(':id/start')
  @Roles('OWNER', 'MANAGER')
  async startCount(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.cycleCountService.startCount(id, user.tenantId!, user.id);
  }

  @Post(':id/complete')
  @Roles('OWNER', 'MANAGER')
  async completeCount(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.cycleCountService.completeCount(id, user.tenantId!, user.id);
  }

  @Post(':id/reconcile')
  @Roles('OWNER', 'MANAGER')
  async reconcile(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.cycleCountService.reconcile(id, user.tenantId!, user.id);
  }

  @Post(':id/item/:itemId/count')
  @Roles('OWNER', 'MANAGER')
  async recordItemCount(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RecordCountDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.cycleCountService.recordItemCount(id, itemId, dto, user.tenantId!, user.id);
  }

  @Get(':id/items')
  async getItems(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.cycleCountService.getItems(id, user.tenantId!);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.cycleCountService.cancel(id, user.tenantId!, user.id);
  }
}
