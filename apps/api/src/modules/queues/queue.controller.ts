import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('queues')
@ApiBearerAuth()
@Controller('queues')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get(':name/stats')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get queue stats' })
  async getStats(@Param('name') name: string) {
    return this.queueService.getQueueStats(name);
  }
}
