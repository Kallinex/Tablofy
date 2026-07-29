import {
  Controller, Get, Post, Put, Param, Query, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ForecastingService } from './forecasting.service';
import { GenerateForecastDto } from './dto/generate-forecast.dto';
import { QueryForecastDto } from './dto/query-forecast.dto';
import { ApproveReorderSuggestionDto, CompleteReorderSuggestionDto } from './dto/reorder-suggestion.dto';

@Controller('forecasts')
export class ForecastingController {
  constructor(private readonly forecastingService: ForecastingService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  async generateForecast(@Body() dto: GenerateForecastDto, @CurrentUser() user: CurrentUserData) {
    return this.forecastingService.generateForecast(dto, user.tenantId!, user.id);
  }

  @Get('item/:itemId')
  async getForecastsForItem(
    @Param('itemId') itemId: string,
    @Query() query: QueryForecastDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingService.getForecastsForItem(itemId, user.tenantId!, query);
  }

  @Get('recommendations')
  async getReorderRecommendations(@CurrentUser() user: CurrentUserData) {
    return this.forecastingService.getReorderRecommendations(user.tenantId!);
  }

  @Post('reorder-suggestions')
  @Roles('OWNER', 'MANAGER')
  async generateReorderSuggestions(@CurrentUser() user: CurrentUserData) {
    return this.forecastingService.generateReorderSuggestions(user.tenantId!, user.id);
  }

  @Get('reorder-suggestions')
  async getReorderSuggestions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.forecastingService.getReorderSuggestions(user!.tenantId!, page ?? 1, limit ?? 20);
  }

  @Get('reorder-suggestions/:id')
  async getReorderSuggestion(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.forecastingService.getReorderSuggestion(id, user.tenantId!);
  }

  @Put('reorder-suggestions/:id/approve')
  @Roles('OWNER', 'MANAGER')
  async approveSuggestion(
    @Param('id') id: string,
    @Body() dto: ApproveReorderSuggestionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingService.approveSuggestion(id, user.id, user.tenantId!, dto);
  }

  @Put('reorder-suggestions/:id/complete')
  @Roles('OWNER', 'MANAGER')
  async completeSuggestion(
    @Param('id') id: string,
    @Body() dto: CompleteReorderSuggestionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.forecastingService.completeSuggestion(id, user.id, user.tenantId!, dto);
  }
}
