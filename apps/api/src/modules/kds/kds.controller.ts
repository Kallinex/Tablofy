import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KdsService } from './kds.service';
import { CreateKitchenStationDto } from './dto/create-kitchen-station.dto';
import { UpdateKitchenStationDto } from './dto/update-kitchen-station.dto';
import { QueryKitchenStationDto } from './dto/query-kitchen-station.dto';
import { UpdateTicketItemStatusDto } from './dto/update-ticket-item-status.dto';
import { AssignProductStationDto } from './dto/assign-product-station.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TicketItemStatus } from '@prisma/client';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';

@ApiTags('KDS - Kitchen Display System')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/kds')
export class KdsController {
  constructor(private readonly kdsService: KdsService) {}

  private tenantId(user: CurrentUserData): string {
    return user.tenantId ?? '';
  }

  // ---- Kitchen Station CRUD ----

  @Post('stations')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a kitchen station' })
  createStation(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateKitchenStationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kdsService.createStation(dto, restaurantId, this.tenantId(user), user.id);
  }

  @Get('stations')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'KITCHEN', 'CASHIER')
  @ApiOperation({ summary: 'List all kitchen stations' })
  findAllStations(
    @Param('restaurantId') restaurantId: string,
    @Query() query: QueryKitchenStationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kdsService.findAllStations(restaurantId, this.tenantId(user), query);
  }

  @Get('stations/:id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'KITCHEN', 'CASHIER')
  @ApiOperation({ summary: 'Get kitchen station by ID' })
  findOneStation(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.kdsService.findOneStation(id, this.tenantId(user));
  }

  @Put('stations/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a kitchen station' })
  updateStation(
    @Param('id') id: string,
    @Body() dto: UpdateKitchenStationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kdsService.updateStation(id, dto, this.tenantId(user), user.id);
  }

  @Delete('stations/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Soft-delete a kitchen station' })
  deleteStation(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.kdsService.deleteStation(id, this.tenantId(user), user.id);
  }

  // ---- Product-Station Assignment ----

  @Post('assign-product')
  @HttpCode(200)
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Assign a product to a kitchen station' })
  assignProductStation(@Body() dto: AssignProductStationDto, @CurrentUser() user: CurrentUserData) {
    return this.kdsService.assignProductStation(dto, this.tenantId(user), user.id);
  }

  @Delete('assign-product/:productId')
  @HttpCode(200)
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Unassign a product from its kitchen station' })
  unassignProductStation(
    @Param('productId') productId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kdsService.unassignProductStation(productId, this.tenantId(user), user.id);
  }

  // ---- KDS Ticket Items ----

  @Get('ticket-items')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'KITCHEN', 'CASHIER')
  @ApiOperation({ summary: 'List kitchen ticket items with optional filters' })
  findAllTicketItems(
    @Query('stationId') stationId: string | undefined,
    @Query('status') status: TicketItemStatus | undefined,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kdsService.findAllTicketItems(this.tenantId(user), stationId, status);
  }

  @Put('ticket-items/:id/status')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'KITCHEN')
  @ApiOperation({ summary: 'Update a ticket item status' })
  updateTicketItemStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTicketItemStatusDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kdsService.updateTicketItemStatus(id, dto, this.tenantId(user), user.id);
  }

  // ---- KDS Dashboard ----

  @Get('dashboard')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'KITCHEN', 'CASHIER')
  @ApiOperation({ summary: 'Get KDS dashboard with all station queues' })
  getKdsDashboard(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.kdsService.getKdsDashboard(this.tenantId(user), restaurantId);
  }

  @Get('station-queue/:stationId')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'KITCHEN', 'CASHIER')
  @ApiOperation({ summary: 'Get queue for a specific kitchen station' })
  getStationQueue(@Param('stationId') stationId: string, @CurrentUser() user: CurrentUserData) {
    return this.kdsService.getStationQueue(stationId, this.tenantId(user));
  }
}
