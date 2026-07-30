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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { QueryWebhookDto } from './dto/query-webhook.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Create webhook registration',
    description: 'Register a new webhook endpoint with event subscriptions',
  })
  @ApiResponse({ status: 201, description: 'Webhook created' })
  async create(@Body() dto: CreateWebhookDto, @CurrentUser() user: CurrentUserData) {
    return this.webhooksService.create(dto, user.tenantId!, user.id);
  }

  @Get()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'List webhooks',
    description: 'Get all webhook registrations with pagination',
  })
  async findAll(@Query() query: QueryWebhookDto, @CurrentUser() user: CurrentUserData) {
    return this.webhooksService.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get webhook', description: 'Get webhook registration details' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.webhooksService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update webhook', description: 'Update webhook registration settings' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.webhooksService.update(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Delete webhook', description: 'Soft-delete a webhook registration' })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.webhooksService.remove(id, user.tenantId!, user.id);
  }

  @Post(':id/rotate-secret')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Rotate webhook secret',
    description: 'Generate a new HMAC signing secret for the webhook',
  })
  async rotateSecret(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.webhooksService.rotateSecret(id, user.tenantId!, user.id);
  }

  @Get(':id/deliveries')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'List deliveries', description: 'Get delivery history for a webhook' })
  async getDeliveries(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.webhooksService.getDeliveries(id, user.tenantId!, parseInt(page), parseInt(limit));
  }
}
