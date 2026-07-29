import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { Prisma, TicketItemStatus, KitchenStatus as PrismaKitchenStatus } from '@prisma/client';
import { CreateKitchenStationDto } from './dto/create-kitchen-station.dto';
import { UpdateKitchenStationDto } from './dto/update-kitchen-station.dto';
import { QueryKitchenStationDto } from './dto/query-kitchen-station.dto';
import { UpdateTicketItemStatusDto } from './dto/update-ticket-item-status.dto';
import { KdsGateway } from './kds.gateway';
import { AssignProductStationDto } from './dto/assign-product-station.dto';

@Injectable()
export class KdsService {
  private readonly logger = new Logger(KdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly kdsGateway: KdsGateway,
  ) {}

  // ---- Kitchen Station CRUD ----

  async createStation(dto: CreateKitchenStationDto, restaurantId: string, tenantId: string, userId: string) {
    const existingSlug = await this.prisma.kitchenStation.findUnique({
      where: { restaurantId_slug: { restaurantId, slug: dto.slug } },
    });
    if (existingSlug) {
      throw new ConflictException(`Station with slug "${dto.slug}" already exists in this restaurant`);
    }

    const existingName = await this.prisma.kitchenStation.findUnique({
      where: { restaurantId_name: { restaurantId, name: dto.name } },
    });
    if (existingName) {
      throw new ConflictException(`Station with name "${dto.name}" already exists in this restaurant`);
    }

    const station = await this.prisma.kitchenStation.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        color: dto.color,
        icon: dto.icon,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'KITCHEN_STATION_CREATED',
      resource: 'KitchenStation',
      resourceId: station.id,
      userId,
      tenantId,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `stations:${restaurantId}`);
    this.kdsGateway.broadcastStationUpdate(tenantId, 'station.created', station);

    return station;
  }

  async findAllStations(restaurantId: string, tenantId: string, query: QueryKitchenStationDto) {
    const cacheKey = `stations:${restaurantId}:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.KitchenStationWhereInput = {
      restaurantId,
      tenantId,
      deletedAt: null,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [stations, total] = await Promise.all([
      this.prisma.kitchenStation.findMany({
        where,
        orderBy: { displayOrder: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.kitchenStation.count({ where }),
    ]);

    const result = { data: stations, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    await this.cacheService.set(tenantId, cacheKey, result, 60);
    return result;
  }

  async findOneStation(id: string, tenantId: string) {
    const station = await this.prisma.kitchenStation.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!station) throw new NotFoundException(`Kitchen station ${id} not found`);
    return station;
  }

  async updateStation(id: string, dto: UpdateKitchenStationDto, tenantId: string, userId: string) {
    const station = await this.findOneStation(id, tenantId);
    const oldValues: Record<string, unknown> = { name: station.name, slug: station.slug };

    if (dto.name && dto.name !== station.name) {
      const existingName = await this.prisma.kitchenStation.findUnique({
        where: { restaurantId_name: { restaurantId: station.restaurantId, name: dto.name } },
      });
      if (existingName) throw new ConflictException(`Station with name "${dto.name}" already exists`);
    }

    if (dto.slug && dto.slug !== station.slug) {
      const existingSlug = await this.prisma.kitchenStation.findUnique({
        where: { restaurantId_slug: { restaurantId: station.restaurantId, slug: dto.slug } },
      });
      if (existingSlug) throw new ConflictException(`Station with slug "${dto.slug}" already exists`);
    }

    const updated = await this.prisma.kitchenStation.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'KITCHEN_STATION_UPDATED',
      resource: 'KitchenStation',
      resourceId: id,
      userId,
      tenantId,
      oldValues,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `stations:${station.restaurantId}`);
    this.kdsGateway.broadcastStationUpdate(tenantId, 'station.updated', updated);

    return updated;
  }

  async deleteStation(id: string, tenantId: string, userId: string) {
    const station = await this.findOneStation(id, tenantId);

    await this.prisma.kitchenStation.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'KITCHEN_STATION_DELETED',
      resource: 'KitchenStation',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: station.name } as Record<string, unknown>,
    });

    await this.cacheService.delete(tenantId, `stations:${station.restaurantId}`);
    this.kdsGateway.broadcastStationUpdate(tenantId, 'station.deleted', { id });
  }

  // ---- Product-Station Assignment ----

  async assignProductStation(dto: AssignProductStationDto, tenantId: string, userId: string) {
    const [product, station] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: dto.productId, tenantId, deletedAt: null } }),
      this.prisma.kitchenStation.findFirst({ where: { id: dto.stationId, tenantId, deletedAt: null } }),
    ]);

    if (!product) throw new NotFoundException(`Product ${dto.productId} not found`);
    if (!station) throw new NotFoundException(`Kitchen station ${dto.stationId} not found`);

    const updated = await this.prisma.product.update({
      where: { id: dto.productId },
      data: { stationId: dto.stationId },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_STATION_ASSIGNED',
      resource: 'Product',
      resourceId: dto.productId,
      userId,
      tenantId,
      newValues: { stationId: dto.stationId, stationName: station.name },
    });

    await this.cacheService.deletePattern(tenantId, 'list:*');
    return updated;
  }

  async unassignProductStation(productId: string, tenantId: string, userId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { stationId: null },
    });

    await this.auditLogsService.log({
      action: 'PRODUCT_STATION_UNASSIGNED',
      resource: 'Product',
      resourceId: productId,
      userId,
      tenantId,
      oldValues: { stationId: product.stationId } as Record<string, unknown>,
    });

    return updated;
  }

  // ---- Kitchen Ticket Items ----

  async findAllTicketItems(tenantId: string, stationId?: string, status?: TicketItemStatus) {
    const where: Prisma.KitchenTicketItemWhereInput = { tenantId };
    if (stationId) where.stationId = stationId;
    if (status) where.status = status;

    const items = await this.prisma.kitchenTicketItem.findMany({
      where,
      include: {
        ticket: { select: { id: true, ticketNumber: true, status: true } },
        orderItem: {
          select: {
            id: true,
            productName: true,
            variantName: true,
            quantity: true,
            preparationNotes: true,
            orderId: true,
          },
        },
        station: { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return items;
  }

  async updateTicketItemStatus(
    itemId: string,
    dto: UpdateTicketItemStatusDto,
    tenantId: string,
    userId: string,
  ) {
    const item = await this.prisma.kitchenTicketItem.findFirst({
      where: { id: itemId, tenantId },
      include: {
        ticket: { select: { id: true, ticketNumber: true, orderId: true } },
        station: { select: { id: true, name: true } },
      },
    });

    if (!item) throw new NotFoundException(`Kitchen ticket item ${itemId} not found`);

    const updateData: Prisma.KitchenTicketItemUpdateInput = {
      status: dto.status,
      ...(dto.status === TicketItemStatus.PREPARING && !item.startedAt ? { startedAt: new Date() } : {}),
      ...(dto.status === TicketItemStatus.READY || dto.status === TicketItemStatus.SERVED
        ? { completedAt: new Date() }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    const updated = await this.prisma.kitchenTicketItem.update({
      where: { id: itemId },
      data: updateData,
      include: {
        ticket: { select: { id: true, ticketNumber: true, status: true, orderId: true } },
        orderItem: {
          select: { id: true, productName: true, variantName: true, quantity: true, orderId: true },
        },
        station: { select: { id: true, name: true, color: true } },
      },
    });

    await this.auditLogsService.log({
      action: 'TICKET_ITEM_STATUS_UPDATED',
      resource: 'KitchenTicketItem',
      resourceId: itemId,
      userId,
      tenantId,
      oldValues: { status: item.status } as Record<string, unknown>,
      newValues: { status: dto.status, notes: dto.notes } as Record<string, unknown>,
    });

    this.kdsGateway.broadcastItemUpdate(tenantId, {
      ...updated,
      stationName: item.station?.name ?? null,
    });

    await this.queueService.addJob('kitchen', 'ticket-item.status-changed', {
      tenantId,
      userId,
      payload: {
        itemId,
        ticketId: item.ticket.id,
        ticketNumber: item.ticket.ticketNumber,
        status: dto.status,
      },
    });

    return updated;
  }

  // ---- KDS Dashboard Queries ----

  async getStationQueue(stationId: string, tenantId: string) {
    const station = await this.findOneStation(stationId, tenantId);

    const items = await this.prisma.kitchenTicketItem.findMany({
      where: {
        stationId,
        tenantId,
        status: { in: [TicketItemStatus.PENDING, TicketItemStatus.QUEUED, TicketItemStatus.PREPARING] },
      },
      include: {
        ticket: { select: { id: true, ticketNumber: true, status: true, createdAt: true } },
        orderItem: {
          select: {
            id: true,
            productName: true,
            variantName: true,
            quantity: true,
            preparationNotes: true,
            order: { select: { orderNumber: true, table: { select: { number: true } } } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });

    return { station: { id: station.id, name: station.name, color: station.color }, items };
  }

  async getKdsDashboard(tenantId: string, restaurantId: string) {
    const stations = await this.prisma.kitchenStation.findMany({
      where: { restaurantId, tenantId, deletedAt: null, isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    const stationQueues = await Promise.all(
      stations.map((s) => this.getStationQueue(s.id, tenantId)),
    );

    const summary = {
      totalActive: stations.length,
      totalItems: stationQueues.reduce((sum, q) => sum + q.items.length, 0),
      stations: stationQueues,
    };

    return summary;
  }

  // ---- Event Handlers ----

  @OnEvent('order.confirmed')
  async handleOrderConfirmed(payload: { tenantId: string; orderId: string }) {
    try {
      const { tenantId, orderId } = payload;

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            where: { voidedAt: null },
            include: {
              product: { select: { id: true, stationId: true } },
            },
          },
        },
      });

      if (!order) {
        this.logger.warn(`Order ${orderId} not found for KDS ticket creation`);
        return;
      }

      const itemsByStation = new Map<string, typeof order.items>();
      const unassignedItems: typeof order.items = [];

      for (const item of order.items) {
        const stationId = item.product.stationId;
        if (stationId) {
          if (!itemsByStation.has(stationId)) itemsByStation.set(stationId, []);
          itemsByStation.get(stationId)!.push(item);
        } else {
          unassignedItems.push(item);
        }
      }

      await this.prisma.$transaction(async (tx) => {
        for (const [stationId, stationItems] of itemsByStation) {
          const ticketCount = await tx.kitchenTicket.count({
            where: { orderId },
          });

          const ticket = await tx.kitchenTicket.create({
            data: {
              orderId,
              tenantId,
              stationId,
              ticketNumber: ticketCount + 1,
              status: PrismaKitchenStatus.PENDING,
              priority: 0,
            },
          });

          for (const item of stationItems) {
            await tx.kitchenTicketItem.create({
              data: {
                ticketId: ticket.id,
                orderItemId: item.id,
                tenantId,
                stationId,
                status: TicketItemStatus.PENDING,
                sortOrder: 0,
              },
            });
          }

          const fullTicket = await tx.kitchenTicket.findUnique({
            where: { id: ticket.id },
            include: {
              items: {
                include: {
                  orderItem: {
                    select: { productName: true, variantName: true, quantity: true, preparationNotes: true },
                  },
                  station: { select: { name: true, color: true } },
                },
              },
            },
          });

          this.kdsGateway.broadcastTicketUpdate(tenantId, 'ticket.created', fullTicket);
        }

        if (unassignedItems.length > 0) {
          const ticketCount = await tx.kitchenTicket.count({
            where: { orderId },
          });

          const ticket = await tx.kitchenTicket.create({
            data: {
              orderId,
              tenantId,
              stationId: null,
              ticketNumber: ticketCount + 1,
              status: PrismaKitchenStatus.PENDING,
              priority: 0,
            },
          });

          for (const item of unassignedItems) {
            await tx.kitchenTicketItem.create({
              data: {
                ticketId: ticket.id,
                orderItemId: item.id,
                tenantId,
                stationId: null,
                status: TicketItemStatus.PENDING,
                sortOrder: 0,
              },
            });
          }

          const fullTicket = await tx.kitchenTicket.findUnique({
            where: { id: ticket.id },
            include: {
              items: {
                include: {
                  orderItem: {
                    select: { productName: true, variantName: true, quantity: true, preparationNotes: true },
                  },
                  station: { select: { name: true, color: true } },
                },
              },
            },
          });

          this.kdsGateway.broadcastTicketUpdate(tenantId, 'ticket.created', fullTicket);
        }
      });

      await this.queueService.addJob('kitchen', 'order.confirmed.kds', {
        tenantId,
        payload: { orderId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to handle order.confirmed for ${payload.orderId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
