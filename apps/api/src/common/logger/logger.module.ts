import { Global, Module } from '@nestjs/common';
import { AppLoggerService } from './logger.service';
import { HttpLoggingMiddleware } from './http-logging.middleware';

@Global()
@Module({
  providers: [AppLoggerService, HttpLoggingMiddleware],
  exports: [AppLoggerService, HttpLoggingMiddleware],
})
export class LoggerModule {}
