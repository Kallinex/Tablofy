import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/campaigns',
  cors: { origin: '*', credentials: true },
})
export class CampaignsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CampaignsGateway.name);

  @WebSocketServer() server!: Server;

  afterInit() {
    this.logger.log('Campaigns Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinTenant')
  handleJoinTenant(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
    this.logger.log(`Client ${client.id} joined tenant:${tenantId}`);
  }

  @SubscribeMessage('leaveTenant')
  handleLeaveTenant(client: Socket, tenantId: string) {
    client.leave(`tenant:${tenantId}`);
  }

  broadcastCampaignUpdate(tenantId: string, event: string, data: Record<string, unknown>) {
    this.server.to(`tenant:${tenantId}`).emit(event, data);
  }

  broadcastPromotionUpdate(tenantId: string, event: string, data: Record<string, unknown>) {
    this.server.to(`tenant:${tenantId}`).emit(event, data);
  }
}
