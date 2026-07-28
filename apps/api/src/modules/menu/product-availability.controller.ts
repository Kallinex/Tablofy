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
import { ProductAvailabilityService } from './product-availability.service';
import { CreateProductAvailabilityDto } from './dto/create-product-availability.dto';
import { UpdateProductAvailabilityDto } from './dto/update-product-availability.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('product-availability')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/products/:productId/availability')
export class ProductAvailabilityController {
  constructor(private readonly productAvailabilityService: ProductAvailabilityService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Add availability schedule to a product' })
  @ApiResponse({ status: 201, description: 'Product availability created' })
  async create(
    @Param('productId') productId: string,
    @Body() dto: CreateProductAvailabilityDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productAvailabilityService.create(dto, productId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List availability schedules for a product' })
  async findAll(@Param('productId') productId: string, @CurrentUser() user: CurrentUserData) {
    return this.productAvailabilityService.findAll(productId, user.tenantId!);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a product availability by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.productAvailabilityService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a product availability schedule' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductAvailabilityDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productAvailabilityService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a product availability schedule' })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData, @Req() req: Request) {
    await this.productAvailabilityService.remove(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Product availability deleted successfully' };
  }
}
