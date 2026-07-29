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
  namespace: '/cycle-counts',
  cors: { origin: '*', credentials: true },
})
export class CycleCountGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CycleCountGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('CycleCount WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`CycleCount client connected: ${client.id}`);
    const tenantId = client.handshake.query.tenantId as string;
    if (tenantId) {
      client.join(`tenant:${tenantId}`);
    }
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

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
