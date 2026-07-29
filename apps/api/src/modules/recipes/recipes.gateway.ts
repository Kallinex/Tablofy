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
  namespace: '/recipes',
  cors: { origin: '*', credentials: true },
})
export class RecipesGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RecipesGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Recipes WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Recipes client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Recipes client disconnected: ${client.id}`);
  }

  broadcastRecipeUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastInventoryUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
