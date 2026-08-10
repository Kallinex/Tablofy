import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { WsAuthService } from '../../common/ws/ws-auth.service';

@WebSocketGateway({
  namespace: '/cycle-counts',
})
export class CycleCountGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CycleCountGateway.name);

  constructor(private readonly wsAuthService: WsAuthService) {}

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('CycleCount WebSocket gateway initialized');
  }

  async handleConnection(client: Socket) {
    const authenticated = await this.wsAuthService.authenticate(client);
    if (!authenticated) {
      return;
    }
    const joined = await this.wsAuthService.joinAuthorizedRoom(
      client,
      this.wsAuthService.resolveRequestedTenantId(client),
    );
    if (!joined) {
      return;
    }
    this.logger.log(`CycleCount client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`CycleCount client disconnected: ${client.id}`);
  }

  broadcastCycleCountUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastItemUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }
}
