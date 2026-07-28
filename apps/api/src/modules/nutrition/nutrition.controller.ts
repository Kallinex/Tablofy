import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NutritionService } from './nutrition.service';
import { CreateNutritionalInfoDto } from './dto/create-nutritional-info.dto';
import { UpdateNutritionalInfoDto } from './dto/update-nutritional-info.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('nutrition')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/products/:productId/nutrition')
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create or update nutritional info for a product (upsert)' })
  @ApiResponse({ status: 201, description: 'Nutritional info created or updated' })
  async upsert(
    @Param('productId') productId: string,
    @Body() dto: CreateNutritionalInfoDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.nutritionService.upsert(dto, productId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get nutritional info for a product' })
  async findOne(@Param('productId') productId: string, @CurrentUser() user: CurrentUserData) {
    return this.nutritionService.findOne(productId, user.tenantId!);
  }

  @Put()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update nutritional info for a product' })
  async update(
    @Param('productId') productId: string,
    @Body() dto: UpdateNutritionalInfoDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    const fullDto: CreateNutritionalInfoDto = {
      calories: dto.calories,
      protein: dto.protein,
      carbs: dto.carbs,
      fat: dto.fat,
      fiber: dto.fiber,
      sugar: dto.sugar,
      sodium: dto.sodium,
      metadata: dto.metadata,
    };
    return this.nutritionService.upsert(fullDto, productId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete()
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete nutritional info for a product' })
  async softDelete(
    @Param('productId') productId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.nutritionService.softDelete(productId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Nutritional info deleted successfully' };
  }
}
