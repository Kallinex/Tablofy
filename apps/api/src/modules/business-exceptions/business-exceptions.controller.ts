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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { BusinessExceptionsService } from './business-exceptions.service';
import {
  CreateBusinessExceptionDto,
  UpdateBusinessExceptionDto,
} from './dto/business-exceptions.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('business-exceptions')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/business-exceptions')
export class BusinessExceptionsController {
  constructor(private readonly businessExceptionsService: BusinessExceptionsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a business exception (holiday/special hours)' })
  @ApiResponse({ status: 201, description: 'Exception created' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateBusinessExceptionDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.businessExceptionsService.create(dto, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List business exceptions (optionally filter by date range)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.businessExceptionsService.findAll(restaurantId, user!.tenantId!, { from, to });
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a business exception by ID' })
  async findOne(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.businessExceptionsService.findOne(id, restaurantId, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a business exception' })
  async update(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBusinessExceptionDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.businessExceptionsService.update(id, dto, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a business exception' })
  async remove(
    @Param('restaurantId') restaurantId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.businessExceptionsService.remove(id, restaurantId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Business exception deleted successfully' };
  }
}
