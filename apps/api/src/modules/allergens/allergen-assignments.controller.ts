import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AllergensService } from './allergens.service';
import { AssignAllergensDto } from './dto/assign-allergens.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('allergens')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/products/:productId/allergens')
export class ProductAllergenAssignmentsController {
  constructor(private readonly allergensService: AllergensService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all allergens assigned to a product' })
  async listProductAllergens(
    @Param('productId') productId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.allergensService.listProductAllergens(productId, user.tenantId!);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign allergens to a product' })
  @ApiResponse({ status: 201, description: 'Allergens assigned' })
  async assignAllergens(
    @Param('restaurantId') restaurantId: string,
    @Param('productId') productId: string,
    @Body() dto: AssignAllergensDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.allergensService.assignToProduct(
      productId,
      dto.allergenIds,
      restaurantId,
      user.tenantId!,
      user.id,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @Delete(':allergenId')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an allergen from a product' })
  async removeAllergen(
    @Param('productId') productId: string,
    @Param('allergenId') allergenId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.allergensService.removeFromProduct(productId, allergenId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Allergen removed from product successfully' };
  }
}
