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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('products')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a new product for a restaurant' })
  @ApiResponse({ status: 201, description: 'Product created' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateProductDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productsService.create(dto, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all products for a restaurant' })
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query() query: QueryProductDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.productsService.findAll({
      tenantId: user.tenantId!,
      restaurantId,
      page: query.page,
      limit: query.limit,
      search: query.search,
      isActive: query.isActive,
      isFeatured: query.isFeatured,
      menuCategoryId: query.menuCategoryId,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a product by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.productsService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a product' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productsService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a product' })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.productsService.softDelete(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Product deleted successfully' };
  }

  @Post(':id/restore')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted product' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productsService.restore(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
