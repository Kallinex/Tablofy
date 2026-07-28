import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProductVariantsService } from './product-variants.service';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { QueryProductVariantDto } from './dto/query-product-variant.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('product-variants')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/products/:productId/variants')
export class ProductVariantsController {
  constructor(private readonly productVariantsService: ProductVariantsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a new variant for a product' })
  @ApiResponse({ status: 201, description: 'Product variant created' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateProductVariantDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productVariantsService.create(
      dto,
      productId,
      restaurantId,
      user.tenantId!,
      user.id,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all variants for a product' })
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Param('productId') productId: string,
    @Query() query: QueryProductVariantDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.productVariantsService.findAll({
      tenantId: user.tenantId!,
      productId,
      restaurantId,
      page: query.page,
      limit: query.limit,
      search: query.search,
      isActive: query.isActive,
      variantGroupId: query.variantGroupId,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a product variant by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.productVariantsService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a product variant' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductVariantDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productVariantsService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a product variant' })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.productVariantsService.softDelete(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Product variant deleted successfully' };
  }

  @Post(':id/restore')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted product variant' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productVariantsService.restore(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
