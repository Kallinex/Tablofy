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
import { ProductTagsService } from './product-tags.service';
import { AssignTagsDto } from './dto/assign-tags.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('product-tags')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/products/:productId/tags')
export class ProductTagAssignmentsController {
  constructor(private readonly productTagsService: ProductTagsService) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all tags assigned to a product' })
  async listProductTags(
    @Param('productId') productId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.productTagsService.listProductTags(productId, user.tenantId!);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign tags to a product' })
  @ApiResponse({ status: 201, description: 'Tags assigned' })
  async assignTags(
    @Param('restaurantId') restaurantId: string,
    @Param('productId') productId: string,
    @Body() dto: AssignTagsDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productTagsService.assignToProduct(
      productId,
      dto.tagIds,
      restaurantId,
      user.tenantId!,
      user.id,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @Delete(':tagId')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a tag from a product' })
  async removeTag(
    @Param('productId') productId: string,
    @Param('tagId') tagId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    await this.productTagsService.removeFromProduct(productId, tagId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Tag removed from product successfully' };
  }
}
