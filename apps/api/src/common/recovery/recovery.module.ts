import { Global, Module } from '@nestjs/common';
import { RecoveryService } from './recovery.service';

@Global()
@Module({
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
