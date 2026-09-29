import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
