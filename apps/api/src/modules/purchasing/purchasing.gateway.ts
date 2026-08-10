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
  namespace: '/purchasing',
})
export class PurchasingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PurchasingGateway.name);

  constructor(private readonly wsAuthService: WsAuthService) {}

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Purchasing WebSocket gateway initialized');
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
    this.logger.log(`Purchasing client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Purchasing client disconnected: ${client.id}`);
  }

  broadcastPurchaseUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastGoodsReceived(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }
}
