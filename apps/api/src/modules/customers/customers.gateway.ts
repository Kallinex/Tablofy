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
  namespace: '/customers',
  cors: { origin: '*', credentials: true },
})
export class CustomersGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CustomersGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Customers WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Customers client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Customers client disconnected: ${client.id}`);
  }

  broadcastCustomerUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastLoyaltyUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastMembershipUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastRewardUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastWalletUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
