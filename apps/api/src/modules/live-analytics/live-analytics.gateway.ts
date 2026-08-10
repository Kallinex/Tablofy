import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { WsAuthService } from '../../common/ws/ws-auth.service';

@WebSocketGateway({
  namespace: '/live-analytics',
})
export class LiveAnalyticsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(LiveAnalyticsGateway.name);

  constructor(private readonly wsAuthService: WsAuthService) {}

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Live Analytics gateway initialized');
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
    this.logger.log(`Live Analytics client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Live Analytics client disconnected: ${client.id}`);
  }

  broadcast(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }
}
