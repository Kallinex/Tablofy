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
  namespace: '/forecasting',
  cors: { origin: '*', credentials: true },
})
export class ForecastingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ForecastingGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Forecasting WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Forecasting client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Forecasting client disconnected: ${client.id}`);
  }

  broadcastForecastUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  broadcastReorderUpdate(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }

  joinTenantRoom(client: Socket, tenantId: string) {
    client.join(`tenant:${tenantId}`);
  }
}
