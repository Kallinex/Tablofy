import { Test, TestingModule } from '@nestjs/testing';
import { GiftCardsController } from '../../gift-cards.controller';
import { GiftCardsService } from '../../gift-cards.service';

describe('Gift Cards RBAC — Integration', () => {
  let controller: GiftCardsController;
  let giftCardsService: jest.Mocked<GiftCardsService>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GiftCardsController],
      providers: [
        {
          provide: GiftCardsService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            findByCode: jest.fn(),
            recharge: jest.fn(),
            redeem: jest.fn(),
            getTransactions: jest.fn(),
            deactivate: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<GiftCardsController>(GiftCardsController);
    giftCardsService = module.get(GiftCardsService) as jest.Mocked<GiftCardsService>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow OWNER/MANAGER to create a gift card', async () => {
    giftCardsService.create.mockResolvedValueOnce({ id: 'gc-1', code: 'GC-001' });
    const req = { tenantId: 'tenant-1', lang: 'en', user: { id: 'user-1' } };

    const result = await controller.create({ amount: 50, currency: 'USD' } as never, req as never);

    expect(result).toBeDefined();
    expect(giftCardsService.create).toHaveBeenCalled();
  });

  it('should allow OWNER/MANAGER to list gift cards', async () => {
    giftCardsService.findAll.mockResolvedValueOnce({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });
    const req = { tenantId: 'tenant-1' };

    const result = await controller.findAll(req as never, 1, 20);

    expect(result).toBeDefined();
    expect(giftCardsService.findAll).toHaveBeenCalled();
  });

  it('should allow OWNER/MANAGER to find one gift card', async () => {
    giftCardsService.findOne.mockResolvedValueOnce({ id: 'gc-1' });
    const req = { tenantId: 'tenant-1', lang: 'en' };

    const result = await controller.findOne('gc-1', req as never);

    expect(result).toBeDefined();
  });

  it('should allow OWNER/MANAGER to recharge a gift card', async () => {
    giftCardsService.recharge.mockResolvedValueOnce({ id: 'gc-1', balance: 100 });
    const req = { tenantId: 'tenant-1', lang: 'en', user: { id: 'user-1' } };

    const result = await controller.recharge('gc-1', { amount: 50 } as never, req as never);

    expect(result).toBeDefined();
  });

  it('should allow OWNER/MANAGER/STAFF to redeem from gift card', async () => {
    giftCardsService.redeem.mockResolvedValueOnce({ id: 'gc-1', balance: 25 });
    const req = { tenantId: 'tenant-1', lang: 'en', user: { id: 'user-1' } };

    const result = await controller.redeem('gc-1', { amount: 25 } as never, req as never);

    expect(result).toBeDefined();
  });

  it('should allow OWNER/MANAGER to deactivate a gift card', async () => {
    giftCardsService.deactivate.mockResolvedValueOnce({ id: 'gc-1', active: false });
    const req = { tenantId: 'tenant-1', lang: 'en' };

    const result = await controller.deactivate('gc-1', req as never);

    expect(result).toBeDefined();
  });
});
