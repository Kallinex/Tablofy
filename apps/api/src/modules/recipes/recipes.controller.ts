import {
  Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { RecipesService } from './recipes.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { QueryRecipeDto } from './dto/query-recipe.dto';
import { CreateRecipeItemDto } from './dto/create-recipe-item.dto';
import { UpdateRecipeItemDto } from './dto/update-recipe-item.dto';

@ApiTags('Recipes')
@ApiBearerAuth()
@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Post()
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @ApiOperation({ summary: 'Create recipe' })
  async create(@Body() dto: CreateRecipeDto, @CurrentUser() user: CurrentUserData) {
    return this.recipesService.createRecipe(dto, user.tenantId!, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List recipes' })
  async findAll(@Query() query: QueryRecipeDto, @CurrentUser() user: CurrentUserData) {
    return this.recipesService.listRecipes(user.tenantId!, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get recipe by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.recipesService.getRecipe(id, user.tenantId!);
  }

  @Put(':id')
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @ApiOperation({ summary: 'Update recipe' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRecipeDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.recipesService.updateRecipe(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete recipe' })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.recipesService.deleteRecipe(id, user.tenantId!, user.id);
  }

  @Get(':id/cost')
  @ApiOperation({ summary: 'Get recipe cost breakdown' })
  async getCost(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.recipesService.getRecipeCost(id, user.tenantId!);
  }

  @Post(':recipeId/items')
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @ApiOperation({ summary: 'Add item to recipe' })
  async addItem(
    @Param('recipeId') recipeId: string,
    @Body() dto: CreateRecipeItemDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.recipesService.addRecipeItem(recipeId, dto, user.tenantId!, user.id);
  }

  @Put('items/:id')
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @ApiOperation({ summary: 'Update recipe item' })
  async updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateRecipeItemDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.recipesService.updateRecipeItem(id, dto, user.tenantId!, user.id);
  }

  @Delete('items/:id')
  @Roles('OWNER', 'MANAGER', 'CHEF')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove recipe item' })
  async removeItem(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.recipesService.removeRecipeItem(id, user.tenantId!, user.id);
  }

  @Post('deduct-order/:orderId')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Manually trigger inventory deduction for order' })
  async deductOrder(@Param('orderId') orderId: string, @CurrentUser() user: CurrentUserData) {
    return this.recipesService.deductInventoryForOrder(orderId, user.tenantId!);
  }

  @Post('rollback-order/:orderId')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Rollback inventory deduction for order' })
  async rollbackOrder(@Param('orderId') orderId: string, @CurrentUser() user: CurrentUserData) {
    return this.recipesService.rollbackDeduction(orderId, user.tenantId!);
  }

  @Get('deduction/:orderId')
  @ApiOperation({ summary: 'Get deduction report for order' })
  async getDeduction(@Param('orderId') orderId: string, @CurrentUser() user: CurrentUserData) {
    return this.recipesService.getDeductionReport(orderId, user.tenantId!);
  }
}
