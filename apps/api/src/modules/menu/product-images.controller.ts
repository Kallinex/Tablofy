import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { ProductImagesService } from './product-images.service';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import { UpdateProductImageDto } from './dto/update-product-image.dto';
import { UploadProductImageDto } from './dto/upload-product-image.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ImageStorageService } from '../../common/upload/image-storage.service';
import { UploadedImageFile } from '../../common/upload/uploaded-image-file.interface';
import { Request } from 'express';

@ApiTags('product-images')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/products/:productId/images')
export class ProductImagesController {
  constructor(
    private readonly productImagesService: ProductImagesService,
    private readonly imageStorage: ImageStorageService,
  ) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Add an image to a product' })
  @ApiResponse({ status: 201, description: 'Product image created' })
  async create(
    @Param('productId') productId: string,
    @Body() dto: CreateProductImageDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productImagesService.create(dto, productId, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('upload')
  @Roles('OWNER', 'MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image file for a product' })
  @ApiResponse({ status: 201, description: 'Product image uploaded and created' })
  @ApiResponse({ status: 400, description: 'Missing, oversized or unsupported image file' })
  async upload(
    @Param('productId') productId: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body() dto: UploadProductImageDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('An image file is required in the "file" field');
    }

    const stored = await this.imageStorage.save(file, {
      tenantId: user.tenantId!,
      productId,
    });

    return this.productImagesService.create(
      {
        url: stored.url,
        altText: dto.altText,
        sortOrder: dto.sortOrder,
        isPrimary: dto.isPrimary,
      },
      productId,
      user.tenantId!,
      user.id,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List all images for a product' })
  async findAll(@Param('productId') productId: string, @CurrentUser() user: CurrentUserData) {
    return this.productImagesService.findAll(productId, user.tenantId!);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a product image by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.productImagesService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a product image' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductImageDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.productImagesService.update(id, dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a product image' })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData, @Req() req: Request) {
    await this.productImagesService.remove(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Product image deleted successfully' };
  }
}
