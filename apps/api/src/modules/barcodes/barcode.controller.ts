import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { BarcodeService } from './barcode.service';
import { GenerateBarcodeDto } from './dto/generate-barcode.dto';

@Controller('barcodes')
export class BarcodeController {
  constructor(private readonly barcodeService: BarcodeService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  async generate(@Body() dto: GenerateBarcodeDto, @CurrentUser() user: CurrentUserData) {
    return this.barcodeService.generate(dto, user.tenantId!, user.id);
  }

  @Get('lookup/:code')
  async lookupByBarcode(@Param('code') code: string, @CurrentUser() user: CurrentUserData) {
    return this.barcodeService.lookupByBarcode(code, user.tenantId!);
  }

  @Get('lookup/qr/:qrCode')
  async lookupByQrCode(@Param('qrCode') qrCode: string, @CurrentUser() user: CurrentUserData) {
    return this.barcodeService.lookupByQrCode(qrCode, user.tenantId!);
  }

  @Get('item/:itemId')
  async getBarcodesForItem(@Param('itemId') itemId: string, @CurrentUser() user: CurrentUserData) {
    return this.barcodeService.getBarcodesForItem(itemId, user.tenantId!);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.barcodeService.delete(id, user.tenantId!, user.id);
  }

  @Post(':id/primary')
  @Roles('OWNER', 'MANAGER')
  async setPrimary(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.barcodeService.setPrimary(id, user.tenantId!, user.id);
  }
}
