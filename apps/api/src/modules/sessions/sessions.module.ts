import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [AuditLogsModule, RedisModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
