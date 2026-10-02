import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsAuthService } from '../../common/ws/ws-auth.service';

@WebSocketGateway({
  namespace: '/campaigns',
})
export class CampaignsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CampaignsGateway.name);

  constructor(private readonly wsAuthService: WsAuthService) {}

  @WebSocketServer() server!: Server;

  afterInit() {
    this.logger.log('Campaigns Gateway initialized');
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
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinTenant')
  async handleJoinTenant(client: Socket, tenantId: string) {
    if (!this.wsAuthService.assertTenantAllowed(client, tenantId)) {
      this.logger.warn(`Client ${client.id} denied join for tenant:${tenantId}`);
      return;
    }
    await client.join(`tenant:${tenantId}`);
    this.logger.log(`Client ${client.id} joined tenant:${tenantId}`);
  }

  @SubscribeMessage('leaveTenant')
  async handleLeaveTenant(client: Socket, tenantId: string) {
    await client.leave(`tenant:${tenantId}`);
  }

  broadcastCampaignUpdate(tenantId: string, event: string, data: Record<string, unknown>) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastPromotionUpdate(tenantId: string, event: string, data: Record<string, unknown>) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }
}
