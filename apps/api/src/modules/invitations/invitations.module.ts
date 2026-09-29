import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RedisModule } from '../../redis/redis.module';
import { UsersModule } from '../users/users.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, RedisModule, UsersModule, CommonModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
