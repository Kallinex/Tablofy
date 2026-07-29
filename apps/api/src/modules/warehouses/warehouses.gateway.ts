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
  namespace: '/warehouses',
  cors: { origin: '*', credentials: true },
})
export class WarehousesGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WarehousesGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Warehouses WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Warehouse client connected: ${client.id}`);
    const tenantId = client.handshake.query.tenantId as string;
    if (tenantId) {
      client.join(`tenant:${tenantId}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Warehouse client disconnected: ${client.id}`);
  }

  broadcastWarehouseUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastZoneUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastBinUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
