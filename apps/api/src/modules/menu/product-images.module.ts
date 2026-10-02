import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { ProductImagesService } from './product-images.service';
import { ProductImagesController } from './product-images.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';
import {
  buildImageUploadOptions,
  DEFAULT_MAX_IMAGE_SIZE_BYTES,
} from '../../common/upload/image-upload.options';

@Module({
  imports: [
    AuditLogsModule,
    CommonModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildImageUploadOptions(
          configService.get<number>('upload.maxImageSizeBytes') ?? DEFAULT_MAX_IMAGE_SIZE_BYTES,
        ),
    }),
  ],
  controllers: [ProductImagesController],
  providers: [ProductImagesService],
  exports: [ProductImagesService],
})
export class ProductImagesModule {}
