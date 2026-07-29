import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: '/kitchen',
  cors: { origin: '*', credentials: true },
})
export class KdsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(KdsGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('KDS WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`KDS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`KDS client disconnected: ${client.id}`);
  }

  broadcastTicketUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastItemUpdate(tenantId: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit('item.status.changed', data);
  }

  broadcastStationUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
