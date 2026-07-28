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
import { ProductIngredientsService } from './product-ingredients.service';
import {
  CreateProductIngredientDto,
  UpdateProductIngredientDto,
} from './dto/product-ingredient.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('product-ingredients')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/product-ingredients')
export class ProductIngredientsController {
  constructor(private readonly productIngredientsService: ProductIngredientsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Link an ingredient to a product' })
  @ApiResponse({ status: 201, description: 'Ingredient linked' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateProductIngredientDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productIngredientsService.create(dto, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('product/:productId')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List ingredients for a product' })
  async findByProduct(@Param('productId') productId: string, @CurrentUser() user: CurrentUserData) {
    return this.productIngredientsService.findByProduct(productId, user.tenantId!);
  }

  @Get('product/:productId/cost')
  @Roles('OWNER', 'MANAGER', 'VIEWER')
  @ApiOperation({ summary: 'Calculate total cost per unit for a product' })
  async getProductCost(
    @Param('productId') productId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.productIngredientsService.getProductCost(productId, user.tenantId!);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a product-ingredient link by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.productIngredientsService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a product-ingredient link' })
  async update(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductIngredientDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productIngredientsService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an ingredient from a product' })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData, @Req() req: Request) {
    await this.productIngredientsService.remove(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Ingredient removed from product successfully' };
  }
}
