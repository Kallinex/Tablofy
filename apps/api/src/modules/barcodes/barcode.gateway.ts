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
  namespace: '/barcodes',
  cors: { origin: '*', credentials: true },
})
export class BarcodeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BarcodeGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Barcode WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Barcode client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Barcode client disconnected: ${client.id}`);
  }

  broadcastBarcodeUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
