import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WsAuthService } from './ws-auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Record<string, unknown> => ({
        secret: configService.get<string>('jwt.secret'),
      }),
    }),
  ],
  providers: [WsAuthService],
  exports: [WsAuthService],
})
export class WsAuthModule {}
