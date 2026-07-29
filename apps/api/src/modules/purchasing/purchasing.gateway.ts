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
  namespace: '/purchasing',
  cors: { origin: '*', credentials: true },
})
export class PurchasingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PurchasingGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Purchasing WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
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

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
