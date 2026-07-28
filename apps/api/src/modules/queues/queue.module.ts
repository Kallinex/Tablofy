import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { EmailProcessor } from './email.processor';
import { CleanupProcessor } from './cleanup.processor';
import { NotificationProcessor } from './notification.processor';

@Global()
@Module({
  controllers: [QueueController],
  providers: [QueueService, EmailProcessor, CleanupProcessor, NotificationProcessor],
  exports: [QueueService],
})
export class QueueModule {}
