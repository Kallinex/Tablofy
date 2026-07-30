import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CostingService } from './costing.service';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { BatchValuationDto } from './dto/query-valuation.dto';

@Controller('costing')
export class CostingController {
  constructor(private readonly costingService: CostingService) {}

  @Post('valuation')
  @Roles('OWNER', 'MANAGER')
  async createValuation(@Body() dto: CreateValuationDto, @CurrentUser() user: CurrentUserData) {
    return this.costingService.createValuation(dto, user.tenantId!, user.id);
  }

  @Get('valuation/:id')
  async getValuation(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.costingService.getValuation(id, user.tenantId!);
  }

  @Get('valuation/item/:itemId')
  async getValuationsForItem(
    @Param('itemId') itemId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.costingService.getValuationsForItem(itemId, user.tenantId!);
  }

  @Post('valuation/batch')
  @Roles('OWNER', 'MANAGER')
  async batchValuation(@Body() dto: BatchValuationDto, @CurrentUser() user: CurrentUserData) {
    return this.costingService.batchValuation(dto, user.tenantId!, user.id);
  }
}
