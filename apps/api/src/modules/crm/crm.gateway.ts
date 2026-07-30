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

@WebSocketGateway({
  namespace: '/crm',
  cors: { origin: '*', credentials: true },
})
export class CrmGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CrmGateway.name);

  @WebSocketServer() server!: Server;

  afterInit() {
    this.logger.log('CRM Gateway initialized');
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

  broadcastTimelineUpdate(tenantId: string, event: string, data: Record<string, unknown>) {
    this.server.to(`tenant:${tenantId}`).emit(event, data);
  }

  broadcastCommunicationUpdate(tenantId: string, event: string, data: Record<string, unknown>) {
    this.server.to(`tenant:${tenantId}`).emit(event, data);
  }

  broadcastEventRuleUpdate(tenantId: string, event: string, data: Record<string, unknown>) {
    this.server.to(`tenant:${tenantId}`).emit(event, data);
  }
}
