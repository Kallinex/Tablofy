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
  namespace: '/transfers',
  cors: { origin: '*', credentials: true },
})
export class TransfersGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TransfersGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Transfers WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Transfers client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Transfers client disconnected: ${client.id}`);
  }

  broadcastTransferUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastMovement(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
