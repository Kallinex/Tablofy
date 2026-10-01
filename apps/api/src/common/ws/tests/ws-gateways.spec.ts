import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WsAuthService } from '../ws-auth.service';
import { BarcodeGateway } from '../../../modules/barcodes/barcode.gateway';
import { CampaignsGateway } from '../../../modules/campaigns/campaigns.gateway';
import { CrmGateway } from '../../../modules/crm/crm.gateway';
import { CustomersGateway } from '../../../modules/customers/customers.gateway';
import { CycleCountGateway } from '../../../modules/cycle-counts/cycle-count.gateway';
import { ForecastingGateway } from '../../../modules/forecasting/forecasting.gateway';
import { InventoryGateway } from '../../../modules/inventory/inventory.gateway';
import { KdsGateway } from '../../../modules/kds/kds.gateway';
import { LiveAnalyticsGateway } from '../../../modules/live-analytics/live-analytics.gateway';
import { PurchasingGateway } from '../../../modules/purchasing/purchasing.gateway';
import { RecipesGateway } from '../../../modules/recipes/recipes.gateway';
import { TransfersGateway } from '../../../modules/transfers/transfers.gateway';
import { WarehousesGateway } from '../../../modules/warehouses/warehouses.gateway';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

interface GatewayServer {
  to(room: string): { emit(event: string, data?: unknown): void };
}

interface GatewayInstance {
  server?: GatewayServer;
  afterInit(): void;
  handleConnection(client: Socket): Promise<void>;
  handleDisconnect(client: Socket): void;
}

type GatewayCtor = new (wsAuth: WsAuthService) => object;
type MethodTarget = Record<string, (...args: unknown[]) => unknown>;

interface GatewayCase {
  name: string;
  ctor: GatewayCtor;
  /** Broadcast methods shaped as (tenantId, event, data). */
  broadcasts: string[];
  /** Gateways exposing joinTenant / leaveTenant subscription handlers. */
  roomSubscriptions?: boolean;
}

const GATEWAYS: GatewayCase[] = [
  { name: 'BarcodeGateway', ctor: BarcodeGateway, broadcasts: ['broadcastBarcodeUpdate'] },
  {
    name: 'CampaignsGateway',
    ctor: CampaignsGateway,
    broadcasts: ['broadcastCampaignUpdate', 'broadcastPromotionUpdate'],
    roomSubscriptions: true,
  },
  {
    name: 'CrmGateway',
    ctor: CrmGateway,
    broadcasts: [
      'broadcastTimelineUpdate',
      'broadcastCommunicationUpdate',
      'broadcastEventRuleUpdate',
    ],
    roomSubscriptions: true,
  },
  {
    name: 'CustomersGateway',
    ctor: CustomersGateway,
    broadcasts: [
      'broadcastCustomerUpdate',
      'broadcastLoyaltyUpdate',
      'broadcastMembershipUpdate',
      'broadcastRewardUpdate',
      'broadcastWalletUpdate',
    ],
  },
  {
    name: 'CycleCountGateway',
    ctor: CycleCountGateway,
    broadcasts: ['broadcastCycleCountUpdate', 'broadcastItemUpdate'],
  },
  {
    name: 'ForecastingGateway',
    ctor: ForecastingGateway,
    broadcasts: ['broadcastForecastUpdate', 'broadcastReorderUpdate'],
  },
  {
    name: 'InventoryGateway',
    ctor: InventoryGateway,
    broadcasts: [
      'broadcastItemUpdate',
      'broadcastCategoryUpdate',
      'broadcastUnitUpdate',
      'broadcastLocationUpdate',
      'broadcastAdjustmentUpdate',
      'broadcastWasteUpdate',
      'broadcastCountUpdate',
      'broadcastBatchUpdate',
      'broadcastLowStockAlert',
    ],
  },
  {
    name: 'KdsGateway',
    ctor: KdsGateway,
    broadcasts: ['broadcastTicketUpdate', 'broadcastStationUpdate'],
  },
  { name: 'LiveAnalyticsGateway', ctor: LiveAnalyticsGateway, broadcasts: ['broadcast'] },
  {
    name: 'PurchasingGateway',
    ctor: PurchasingGateway,
    broadcasts: ['broadcastPurchaseUpdate', 'broadcastGoodsReceived'],
  },
  {
    name: 'RecipesGateway',
    ctor: RecipesGateway,
    broadcasts: ['broadcastRecipeUpdate', 'broadcastInventoryUpdate'],
  },
  {
    name: 'TransfersGateway',
    ctor: TransfersGateway,
    broadcasts: ['broadcastTransferUpdate', 'broadcastMovement'],
  },
  {
    name: 'WarehousesGateway',
    ctor: WarehousesGateway,
    broadcasts: ['broadcastWarehouseUpdate', 'broadcastZoneUpdate', 'broadcastBinUpdate'],
  },
];

function createWsAuthMock() {
  return {
    authenticate: jest.fn().mockResolvedValue(true),
    joinAuthorizedRoom: jest.fn().mockResolvedValue(true),
    resolveRequestedTenantId: jest.fn().mockReturnValue(testTenantId),
    assertTenantAllowed: jest.fn().mockReturnValue(true),
  };
}

function createClientMock() {
  return { id: 'socket-1', join: jest.fn(), leave: jest.fn() };
}

describe.each(GATEWAYS)('$name', ({ ctor, broadcasts, roomSubscriptions }) => {
  let wsAuth: ReturnType<typeof createWsAuthMock>;
  let client: ReturnType<typeof createClientMock>;
  let gateway: GatewayInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    wsAuth = createWsAuthMock();
    client = createClientMock();
    gateway = new ctor(wsAuth as unknown as WsAuthService) as unknown as GatewayInstance;
    gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  const invoke = (method: string, ...args: unknown[]) => {
    const target = gateway as unknown as MethodTarget;
    expect(typeof target[method]).toBe('function');
    return target[method](...args);
  };

  it('initializes without throwing', () => {
    expect(() => gateway.afterInit()).not.toThrow();
  });

  describe('handleConnection', () => {
    it('drops unauthenticated sockets before joining any room', async () => {
      wsAuth.authenticate.mockResolvedValue(false);

      await gateway.handleConnection(client as unknown as Socket);

      expect(wsAuth.joinAuthorizedRoom).not.toHaveBeenCalled();
    });

    it('drops authenticated sockets that are not authorized for the tenant room', async () => {
      wsAuth.joinAuthorizedRoom.mockResolvedValue(false);

      await gateway.handleConnection(client as unknown as Socket);

      expect(wsAuth.joinAuthorizedRoom).toHaveBeenCalledWith(client, testTenantId);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('client connected'));
    });

    it('joins the authorized tenant room for an allowed socket', async () => {
      await gateway.handleConnection(client as unknown as Socket);

      expect(wsAuth.authenticate).toHaveBeenCalledWith(client);
      expect(wsAuth.joinAuthorizedRoom).toHaveBeenCalledWith(client, testTenantId);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('socket-1'));
    });
  });

  it('logs on disconnect', () => {
    gateway.handleDisconnect(client as unknown as Socket);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('socket-1'));
  });

  describe('broadcasts', () => {
    it.each(broadcasts)('%s emits to the tenant room only', (method) => {
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to };

      invoke(method, testTenantId, 'some.event', { id: 'x' });

      expect(to).toHaveBeenCalledWith(`tenant:${testTenantId}`);
      expect(emit).toHaveBeenCalledWith('some.event', { id: 'x' });
    });

    it.each(broadcasts)('%s is a no-op before the server is attached', (method) => {
      gateway.server = undefined;

      expect(() => invoke(method, testTenantId, 'some.event', {})).not.toThrow();
    });
  });

  if (roomSubscriptions) {
    describe('tenant room subscriptions', () => {
      it('refuses to join a tenant the socket is not allowed into', () => {
        wsAuth.assertTenantAllowed.mockReturnValue(false);

        invoke('handleJoinTenant', client, testTenantId);

        expect(client.join).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
      });

      it('joins an allowed tenant room', () => {
        invoke('handleJoinTenant', client, testTenantId);

        expect(wsAuth.assertTenantAllowed).toHaveBeenCalledWith(client, testTenantId);
        expect(client.join).toHaveBeenCalledWith(`tenant:${testTenantId}`);
      });

      it('leaves a tenant room', () => {
        invoke('handleLeaveTenant', client, testTenantId);

        expect(client.leave).toHaveBeenCalledWith(`tenant:${testTenantId}`);
      });
    });
  }
});

describe('KdsGateway.broadcastItemUpdate', () => {
  let gateway: GatewayInstance;

  beforeEach(() => {
    gateway = new KdsGateway({} as WsAuthService) as unknown as GatewayInstance;
  });

  it('always emits the item.status.changed event', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    gateway.server = { to };

    (gateway as unknown as MethodTarget).broadcastItemUpdate(testTenantId, { status: 'READY' });

    expect(to).toHaveBeenCalledWith(`tenant:${testTenantId}`);
    expect(emit).toHaveBeenCalledWith('item.status.changed', { status: 'READY' });
  });
});
