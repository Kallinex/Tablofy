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
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { QueryApiKeyDto } from './dto/query-api-key.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Create API key',
    description: 'Generate a new API key with specified scopes',
  })
  @ApiResponse({ status: 201, description: 'API key created - returns key only once' })
  async create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: CurrentUserData) {
    return this.apiKeysService.create(dto, user.tenantId!, user.id);
  }

  @Get()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'List API keys',
    description: 'Get all API keys for the tenant (key values hidden)',
  })
  async findAll(@Query() query: QueryApiKeyDto, @CurrentUser() user: CurrentUserData) {
    return this.apiKeysService.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get API key', description: 'Get API key details (key value hidden)' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.apiKeysService.findOne(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Update API key',
    description: 'Update API key name, scopes, or rate limit',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.apiKeysService.update(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Delete API key',
    description: 'Soft-delete an API key (immediately invalidates)',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.apiKeysService.remove(id, user.tenantId!, user.id);
  }

  @Post(':id/rotate')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Rotate API key',
    description: 'Generate a new key value (old key immediately invalidated)',
  })
  async rotate(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.apiKeysService.rotate(id, user.tenantId!, user.id);
  }
}
