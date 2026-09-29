import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferStatus, StockMovementType } from '@prisma/client';
import { TransfersService } from '../transfers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { TransfersGateway } from '../transfers.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('TransfersService', () => {
  let service: TransfersService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const mockGateway = {
    broadcastTransferUpdate: jest.fn(),
  };

  const baseTransfer = {
    id: 'trf-1',
    tenantId: testTenantId,
    transferNumber: 'TRF-20260810-ABC12',
    status: TransferStatus.DRAFT as TransferStatus,
    fromBranchId: 'branch-a',
    toBranchId: 'branch-b',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: TransfersGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();

    prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
      fn(prisma as unknown as MockPrisma),
    );
  });

  function mockTransfer(overrides: Partial<typeof baseTransfer> & { items?: unknown[] } = {}) {
    return { ...baseTransfer, ...overrides };
  }

  describe('createTransfer', () => {
    it('should reject a transfer between the same branch', async () => {
      await expect(
        service.createTransfer(
          { fromBranchId: 'branch-a', toBranchId: 'branch-a', items: [] } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a draft transfer with items and a generated number', async () => {
      prisma.branch.findFirst
        .mockResolvedValueOnce({ id: 'branch-a' })
        .mockResolvedValueOnce({ id: 'branch-b' });
      prisma.branchTransfer.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValue(mockTransfer({ status: TransferStatus.DRAFT }));
      prisma.branchTransfer.create.mockResolvedValue(
        mockTransfer({ status: TransferStatus.DRAFT }),
      );

      await service.createTransfer(
        {
          fromBranchId: 'branch-a',
          toBranchId: 'branch-b',
          notes: 'Kitchen stock',
          items: [
            { inventoryItemId: 'item-1', quantity: 10, unitCost: 2.5 },
            { inventoryItemId: 'item-2', quantity: 5 },
          ],
        } as never,
        testTenantId,
        testUserId,
      );

      expect(prisma.branchTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transferNumber: expect.stringMatching(/^TRF-\d{8}-/),
            status: 'DRAFT',
            requestedById: testUserId,
            items: {
              create: [
                {
                  inventoryItemId: 'item-1',
                  tenantId: testTenantId,
                  quantity: 10,
                  unitCost: 2.5,
                },
                { inventoryItemId: 'item-2', tenantId: testTenantId, quantity: 5 },
              ],
            },
          }),
        }),
      );
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TRANSFER_CREATED' }),
      );
      expect(mockGateway.broadcastTransferUpdate).toHaveBeenCalledWith(
        testTenantId,
        'transfer.created',
        expect.anything(),
      );
    });

    it('should throw ConflictException on a transfer number collision', async () => {
      prisma.branch.findFirst
        .mockResolvedValueOnce({ id: 'branch-a' })
        .mockResolvedValueOnce({ id: 'branch-b' });
      prisma.branchTransfer.findFirst.mockResolvedValue(mockTransfer());

      await expect(
        service.createTransfer(
          {
            fromBranchId: 'branch-a',
            toBranchId: 'branch-b',
            items: [{ inventoryItemId: 'item-1', quantity: 1 }],
          } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateTransfer', () => {
    it('should reject updating a non-draft transfer', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.PENDING, items: [] }),
      );

      await expect(
        service.updateTransfer('trf-1', {} as never, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should replace items when items are provided', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.DRAFT, items: [] }),
      );
      prisma.branchTransfer.update.mockResolvedValue(mockTransfer());

      await service.updateTransfer(
        'trf-1',
        {
          fromBranchId: 'branch-a',
          toBranchId: 'branch-b',
          notes: 'updated',
          items: [{ inventoryItemId: 'item-3', quantity: 7 }],
        } as never,
        testTenantId,
        testUserId,
      );

      expect(prisma.branchTransferItem.deleteMany).toHaveBeenCalledWith({
        where: { branchTransferId: 'trf-1' },
      });
      expect(prisma.branchTransferItem.createMany).toHaveBeenCalledWith({
        data: [
          {
            branchTransferId: 'trf-1',
            inventoryItemId: 'item-3',
            tenantId: testTenantId,
            quantity: 7,
          },
        ],
      });
      expect(prisma.branchTransfer.update).toHaveBeenCalled();
    });
  });

  describe('submitTransfer', () => {
    it('should require at least one item', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.DRAFT, items: [] }),
      );

      await expect(service.submitTransfer('trf-1', testTenantId, testUserId)).rejects.toThrow(
        'must have at least one item',
      );
    });

    it('should transition a draft to PENDING', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.DRAFT, items: [{ id: 'ti-1' }] }),
      );
      prisma.branchTransfer.update.mockResolvedValue(
        mockTransfer({ status: TransferStatus.PENDING }),
      );

      const result = await service.submitTransfer('trf-1', testTenantId, testUserId);

      expect(prisma.branchTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trf-1' },
          data: expect.objectContaining({ status: TransferStatus.PENDING }),
        }),
      );
      expect(result.status).toBe(TransferStatus.PENDING);
    });
  });

  describe('approveTransfer', () => {
    it('should reject approval of a non-pending transfer', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.DRAFT }),
      );

      await expect(service.approveTransfer('trf-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should approve a pending transfer', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.PENDING }),
      );
      prisma.branchTransfer.update.mockResolvedValue(
        mockTransfer({ status: TransferStatus.APPROVED }),
      );

      const result = await service.approveTransfer('trf-1', testTenantId, testUserId);

      expect(prisma.branchTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TransferStatus.APPROVED,
            approvedById: testUserId,
            approvedAt: expect.any(Date),
          }),
        }),
      );
      expect(result.status).toBe(TransferStatus.APPROVED);
    });
  });

  describe('startTransfer', () => {
    const item = {
      id: 'ti-1',
      inventoryItemId: 'item-1',
      quantity: 10,
      unitCost: 2.5,
    };

    it('should reject dispatching a non-approved transfer', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.PENDING, items: [item] }),
      );

      await expect(service.startTransfer('trf-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should decrement source inventory and record a TRANSFER_OUT movement', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.APPROVED, items: [item] }),
      );
      prisma.branchTransfer.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        name: 'Tomato',
        currentQuantity: 100,
        averageCost: 2,
      });
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.branchTransfer.update.mockResolvedValue(
        mockTransfer({ status: TransferStatus.IN_TRANSIT }),
      );

      const result = await service.startTransfer('trf-1', testTenantId, testUserId);

      expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'item-1',
            currentQuantity: { gte: 10 },
            availableQuantity: { gte: 10 },
          }),
          data: expect.objectContaining({
            currentQuantity: { decrement: 10 },
            availableQuantity: { decrement: 10 },
            version: { increment: 1 },
          }),
        }),
      );
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inventoryItemId: 'item-1',
            type: StockMovementType.TRANSFER_OUT,
            quantity: -10,
            totalCost: -25,
            referenceType: 'BranchTransfer',
            referenceId: 'trf-1',
            branchId: 'branch-a',
          }),
        }),
      );
      expect(result.status).toBe(TransferStatus.IN_TRANSIT);
    });

    it('should reject when source quantity is insufficient', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.APPROVED, items: [item] }),
      );
      prisma.branchTransfer.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        name: 'Tomato',
        currentQuantity: 3,
        averageCost: 2,
      });

      await expect(service.startTransfer('trf-1', testTenantId, testUserId)).rejects.toThrow(
        'Insufficient quantity',
      );
      expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('receiveTransfer', () => {
    const transferItem = {
      id: 'ti-1',
      inventoryItemId: 'item-1',
      quantity: 10,
      unitCost: 2.5,
      notes: null,
      receivedQuantity: null,
    };

    it('should reject receiving a non in-transit transfer', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.APPROVED, items: [transferItem] }),
      );

      await expect(
        service.receiveTransfer(
          'trf-1',
          { items: [{ inventoryItemId: 'item-1', quantityReceived: 5 }] } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject over-receiving beyond the ordered quantity', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.IN_TRANSIT, items: [transferItem] }),
      );
      prisma.branchTransfer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.receiveTransfer(
          'trf-1',
          { items: [{ inventoryItemId: 'item-1', quantityReceived: 15 }] } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow('exceeds ordered quantity');
    });

    it('should credit destination inventory and record a TRANSFER_IN movement', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.IN_TRANSIT, items: [transferItem] }),
      );
      prisma.branchTransfer.updateMany.mockResolvedValue({ count: 1 });
      prisma.branchTransferItem.update.mockResolvedValue({});
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        name: 'Tomato',
        currentQuantity: 50,
        averageCost: 2,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.branchTransfer.update.mockResolvedValue(
        mockTransfer({ status: TransferStatus.RECEIVED }),
      );

      const result = await service.receiveTransfer(
        'trf-1',
        { items: [{ inventoryItemId: 'item-1', quantityReceived: 8 }] } as never,
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: expect.objectContaining({
            currentQuantity: { increment: 8 },
            availableQuantity: { increment: 8 },
            version: { increment: 1 },
          }),
        }),
      );
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inventoryItemId: 'item-1',
            type: StockMovementType.TRANSFER_IN,
            quantity: 8,
            totalCost: 20,
            branchId: 'branch-b',
          }),
        }),
      );
      expect(result.status).toBe(TransferStatus.RECEIVED);
    });

    describe('partial receive safety', () => {
      const twoItems = [
        transferItem,
        {
          id: 'ti-2',
          inventoryItemId: 'item-2',
          quantity: 4,
          unitCost: 1,
          notes: null,
          receivedQuantity: null,
        },
      ];

      const fullReceipt = {
        items: [
          { inventoryItemId: 'item-1', quantityReceived: 10 },
          { inventoryItemId: 'item-2', quantityReceived: 4 },
        ],
      };

      function stubDestination() {
        prisma.inventoryItem.findFirst.mockResolvedValue({
          id: 'item-1',
          name: 'Tomato',
          currentQuantity: 50,
          averageCost: 2,
        });
        prisma.inventoryItem.update.mockResolvedValue({});
        prisma.stockMovement.create.mockResolvedValue({});
        prisma.branchTransferItem.update.mockResolvedValue({});
        prisma.branchTransfer.updateMany.mockResolvedValue({ count: 1 });
        prisma.branchTransfer.update.mockResolvedValue(
          mockTransfer({ status: TransferStatus.RECEIVED }),
        );
      }

      it('rejects a payload that silently omits a transferred line', async () => {
        // Receiving only line 1 used to mark the whole transfer RECEIVED: line 2
        // was never credited anywhere and its stock had already been decremented
        // from the source at dispatch, so it vanished from the books.
        prisma.branchTransfer.findFirst.mockResolvedValue(
          mockTransfer({ status: TransferStatus.IN_TRANSIT, items: twoItems }),
        );

        await expect(
          service.receiveTransfer(
            'trf-1',
            { items: [{ inventoryItemId: 'item-1', quantityReceived: 10 }] } as never,
            testTenantId,
            testUserId,
          ),
        ).rejects.toThrow(/item-2/);
        expect(prisma.branchTransfer.update).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      });

      it('rejects a payload that names the same line twice', async () => {
        prisma.branchTransfer.findFirst.mockResolvedValue(
          mockTransfer({ status: TransferStatus.IN_TRANSIT, items: twoItems }),
        );

        await expect(
          service.receiveTransfer(
            'trf-1',
            {
              items: [
                { inventoryItemId: 'item-1', quantityReceived: 5 },
                { inventoryItemId: 'item-1', quantityReceived: 5 },
                { inventoryItemId: 'item-2', quantityReceived: 4 },
              ],
            } as never,
            testTenantId,
            testUserId,
          ),
        ).rejects.toThrow(/[Dd]uplicate/);
        expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
      });

      it('accepts a full receipt and closes the transfer', async () => {
        prisma.branchTransfer.findFirst.mockResolvedValue(
          mockTransfer({ status: TransferStatus.IN_TRANSIT, items: twoItems }),
        );
        stubDestination();

        const result = await service.receiveTransfer(
          'trf-1',
          fullReceipt as never,
          testTenantId,
          testUserId,
        );

        expect(result.status).toBe(TransferStatus.RECEIVED);
        expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
      });

      it('books a shortage explicitly instead of completing silently', async () => {
        prisma.branchTransfer.findFirst.mockResolvedValue(
          mockTransfer({ status: TransferStatus.IN_TRANSIT, items: twoItems }),
        );
        stubDestination();

        const result = await service.receiveTransfer(
          'trf-1',
          {
            items: [
              { inventoryItemId: 'item-1', quantityReceived: 10 },
              { inventoryItemId: 'item-2', quantityReceived: 1 },
            ],
          } as never,
          testTenantId,
          testUserId,
        );

        // item-2 is only 1 of 4: the transfer still closes, but the loss is
        // recorded so the gap is auditable instead of invisible.
        expect(result.status).toBe(TransferStatus.RECEIVED);
        expect(auditLogs.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'TRANSFER_RECEIVED',
            newValues: expect.objectContaining({
              shortfalls: [{ inventoryItemId: 'item-2', ordered: 4, received: 1 }],
            }),
          }),
        );
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'transfer.received.short',
          expect.objectContaining({
            transferId: 'trf-1',
            shortfalls: [expect.objectContaining({ inventoryItemId: 'item-2' })],
          }),
        );
        expect(prisma.branchTransferItem.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'ti-2' },
            data: expect.objectContaining({
              receivedQuantity: 1,
              notes: expect.stringContaining('SHORT IN TRANSIT'),
            }),
          }),
        );
      });

      it('rejects a negative or fractional receipt before touching the transfer', async () => {
        prisma.branchTransfer.findFirst.mockResolvedValue(
          mockTransfer({ status: TransferStatus.IN_TRANSIT, items: [transferItem] }),
        );

        await expect(
          service.receiveTransfer(
            'trf-1',
            { items: [{ inventoryItemId: 'item-1', quantityReceived: -3 }] } as never,
            testTenantId,
            testUserId,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.receiveTransfer(
            'trf-1',
            { items: [{ inventoryItemId: 'item-1', quantityReceived: 2.5 }] } as never,
            testTenantId,
            testUserId,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.branchTransfer.updateMany).not.toHaveBeenCalled();
      });

      it('accepts a zero receipt as a declared full shortage and posts no stock movement', async () => {
        prisma.branchTransfer.findFirst.mockResolvedValue(
          mockTransfer({ status: TransferStatus.IN_TRANSIT, items: [transferItem] }),
        );
        stubDestination();

        const result = await service.receiveTransfer(
          'trf-1',
          { items: [{ inventoryItemId: 'item-1', quantityReceived: 0 }] } as never,
          testTenantId,
          testUserId,
        );

        expect(result.status).toBe(TransferStatus.RECEIVED);
        // Nothing arrived, so nothing may be credited and no zero-quantity
        // movement may be written; the line is only annotated as short.
        expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
        expect(prisma.branchTransferItem.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'ti-1' },
            data: expect.objectContaining({
              receivedQuantity: 0,
              notes: expect.stringContaining('SHORT IN TRANSIT'),
            }),
          }),
        );
      });

      it('does not credit a line that belongs to another transfer', async () => {
        prisma.branchTransfer.findFirst.mockResolvedValue(
          mockTransfer({ status: TransferStatus.IN_TRANSIT, items: twoItems }),
        );
        stubDestination();

        await expect(
          service.receiveTransfer(
            'trf-1',
            {
              items: [
                { inventoryItemId: 'item-1', quantityReceived: 10 },
                { inventoryItemId: 'item-2', quantityReceived: 4 },
                { inventoryItemId: 'item-9', quantityReceived: 3 },
              ],
            } as never,
            testTenantId,
            testUserId,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('cancelTransfer', () => {
    const item = {
      id: 'ti-1',
      inventoryItemId: 'item-1',
      quantity: 4,
      unitCost: 3,
    };

    it('should reject cancelling a received transfer', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.RECEIVED, items: [item] }),
      );

      await expect(service.cancelTransfer('trf-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reverse in-transit stock and record an ADJUSTMENT reversal', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(
        mockTransfer({ status: TransferStatus.IN_TRANSIT, items: [item] }),
      );
      prisma.branchTransfer.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        name: 'Tomato',
        currentQuantity: 30,
        averageCost: 3,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.branchTransfer.update.mockResolvedValue(
        mockTransfer({ status: TransferStatus.CANCELLED }),
      );

      const result = await service.cancelTransfer('trf-1', testTenantId, testUserId, 'Requested');

      expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentQuantity: { increment: 4 },
            availableQuantity: { increment: 4 },
          }),
        }),
      );
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inventoryItemId: 'item-1',
            type: StockMovementType.ADJUSTMENT,
            quantity: 4,
            referenceType: 'BranchTransfer',
            referenceId: 'trf-1',
          }),
        }),
      );
      expect(result.status).toBe(TransferStatus.CANCELLED);
    });
  });

  describe('getTransfer', () => {
    it('should throw NotFoundException for an unknown transfer', async () => {
      prisma.branchTransfer.findFirst.mockResolvedValue(null);

      await expect(service.getTransfer('missing', testTenantId)).rejects.toThrow(NotFoundException);
    });
  });
});
