import { Module } from '@nestjs/common';
import { SsrfClientService } from './ssrf-client.service';

@Module({
  providers: [SsrfClientService],
  exports: [SsrfClientService],
})
export class SsrfModule {}
