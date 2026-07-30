import {
  Controller,
  Get,
  Post,
  Put,
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
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { QueryTransferDto } from './dto/query-transfer.dto';
import { ReceiveTransferDto } from './dto/receive-transfer.dto';
import { StockMovementType } from '@prisma/client';

@ApiTags('Transfers & Stock Movements')
@ApiBearerAuth()
@Controller()
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  // ============================================
  // Branch Transfer CRUD
  // ============================================

  @Post('transfers')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a branch transfer' })
  async createTransfer(@Body() dto: CreateTransferDto, @CurrentUser() user: CurrentUserData) {
    return this.transfersService.createTransfer(dto, user.tenantId!, user.id);
  }

  @Get('transfers')
  @ApiOperation({ summary: 'List branch transfers' })
  async listTransfers(@Query() query: QueryTransferDto, @CurrentUser() user: CurrentUserData) {
    return this.transfersService.listTransfers(user.tenantId!, query);
  }

  @Get('transfers/:id')
  @ApiOperation({ summary: 'Get transfer by ID' })
  async getTransfer(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.transfersService.getTransfer(id, user.tenantId!);
  }

  @Put('transfers/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update draft transfer' })
  async updateTransfer(
    @Param('id') id: string,
    @Body() dto: UpdateTransferDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.transfersService.updateTransfer(id, dto, user.tenantId!, user.id);
  }

  @Delete('transfers/:id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete draft transfer' })
  async deleteTransfer(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.transfersService.deleteTransfer(id, user.tenantId!, user.id);
  }

  // ============================================
  // Transfer Workflow
  // ============================================

  @Post('transfers/:id/submit')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Submit draft transfer for approval' })
  async submitTransfer(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.transfersService.submitTransfer(id, user.tenantId!, user.id);
  }

  @Post('transfers/:id/approve')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Approve pending transfer' })
  async approveTransfer(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.transfersService.approveTransfer(id, user.tenantId!, user.id, user.role);
  }

  @Post('transfers/:id/start')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Dispatch approved transfer (deducts inventory)' })
  async startTransfer(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.transfersService.startTransfer(id, user.tenantId!, user.id);
  }

  @Post('transfers/:id/receive')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Receive transfer items (adds to inventory)' })
  async receiveTransfer(
    @Param('id') id: string,
    @Body() dto: ReceiveTransferDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.transfersService.receiveTransfer(id, dto, user.tenantId!, user.id);
  }

  @Post('transfers/:id/cancel')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Cancel a transfer' })
  async cancelTransfer(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.transfersService.cancelTransfer(id, user.tenantId!, user.id, reason);
  }

  // ============================================
  // Stock Movements
  // ============================================

  @Get('stock-movements')
  @ApiOperation({ summary: 'List stock movements' })
  async getMovements(
    @Query()
    query: {
      page?: number;
      limit?: number;
      type?: string;
      itemId?: string;
      branchId?: string;
      fromDate?: string;
      toDate?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.transfersService.getMovements(user.tenantId!, {
      ...query,
      type: query.type as StockMovementType,
    });
  }

  @Get('stock-movements/:id')
  @ApiOperation({ summary: 'Get stock movement by ID' })
  async getMovement(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.transfersService.getMovement(id, user.tenantId!);
  }

  @Get('stock-movements/item/:itemId')
  @ApiOperation({ summary: 'Get stock movement history for an item' })
  async getMovementsByItem(
    @Param('itemId') itemId: string,
    @Query()
    query: {
      page?: number;
      limit?: number;
      type?: string;
      fromDate?: string;
      toDate?: string;
    },
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.transfersService.getMovementsByItem(itemId, user.tenantId!, {
      ...query,
      type: query.type as StockMovementType,
    });
  }
}
