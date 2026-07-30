import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: '/live-analytics',
  cors: { origin: '*', credentials: true },
})
export class LiveAnalyticsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(LiveAnalyticsGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Live Analytics gateway initialized');
  }

  handleConnection(client: Socket) {
    const tenantId = client.handshake.query.tenantId as string;
    if (tenantId) client.join(`tenant:${tenantId}`);
    this.logger.log(`Live Analytics client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Live Analytics client disconnected: ${client.id}`);
  }

  broadcast(tenantId: string, event: string, data: unknown) {
    this.server?.to(`tenant:${tenantId}`)?.emit(event, data);
  }
}
