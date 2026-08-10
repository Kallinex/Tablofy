import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

export class SocketIoAdapter extends IoAdapter {
  private readonly configService: ConfigService;

  constructor(app: INestApplicationContext) {
    super(app);
    this.configService = app.get(ConfigService);
  }

  createIOServer(port: number, options?: ServerOptions): ReturnType<IoAdapter['createIOServer']> {
    const corsOrigins = this.configService.get<string[]>('app.corsOrigins') ?? [
      'http://localhost:4200',
    ];
    const corsCredentials = this.configService.get<boolean>('app.corsCredentials') ?? true;
    const nodeEnv = this.configService.get<string>('app.nodeEnv') ?? 'development';

    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: nodeEnv === 'production' ? corsOrigins : true,
        credentials: corsCredentials,
      },
    });
  }
}
