const prismaModelNames = [
  'tenant',
  'user',
  'refreshToken',
  'session',
  'subscription',
  'invitation',
  'verificationToken',
  'auditLog',
  'restaurant',
  'branch',
  'floor',
  'diningArea',
  'table',
  'menuCategory',
  'product',
  'variantGroup',
  'productVariant',
  'modifierGroup',
  'modifier',
  'productVariantModifier',
  'productTag',
  'allergen',
  'productTagAssignment',
  'productAllergenAssignment',
  'productImage',
  'productAvailability',
  'nutritionalInfo',
  'businessHours',
  'businessException',
  'order',
  'orderItem',
  'orderItemModifier',
  'orderStatusHistory',
  'orderNote',
  'kitchenTicket',
  'payment',
  'paymentWebhookReceipt',
  'ingredient',
  'supplier',
  'productIngredient',
  'notification',
  'message',
  'report',
  'feedback',
  'taxRate',
  'serviceCharge',
  'unit',
  'campaign',
  'kitchenStation',
  'kitchenTicketItem',
  'customer',
  'customerAddress',
  'customerPreference',
  'visitHistory',
  'giftCard',
  'giftCardTransaction',
  'loyaltyProgram',
  'loyaltyTier',
  'loyaltyPointsTransaction',
  'membership',
  'membershipHistory',
  'reward',
  'wallet',
  'walletTransaction',
  'referral',
  'customerSegment',
  'customerSegmentAssignment',
  'customerAnalytics',
  'crmTimelineEntry',
  'communicationTemplate',
  'communicationLog',
  'campaignTemplate',
  'campaignRecipient',
  'campaignAnalytics',
  'campaignApproval',
  'promotion',
  'promotionBranchRestriction',
  'promotionProductRestriction',
  'promotionCategoryRestriction',
  'promotionUsage',
  'eventRule',
  'eventLog',
  'inventoryCategory',
  'inventoryUnit',
  'inventoryLocation',
  'inventoryItem',
  'inventoryBatch',
  'supplierDetail',
  'supplierContact',
  'supplierDocument',
  'purchaseOrder',
  'purchaseOrderItem',
  'purchaseOrderApproval',
  'goodsReceipt',
  'goodsReceiptItem',
  'stockMovement',
  'branchTransfer',
  'branchTransferItem',
  'recipe',
  'recipeItem',
  'stockAdjustment',
  'wasteEntry',
  'inventoryCount',
  'expirationAlert',
  'warehouse',
  'warehouseZone',
  'storageBin',
  'warehouseBranch',
  'barcode',
  'inventoryForecast',
  'reorderSuggestion',
  'consumptionRecord',
  'cycleCount',
  'cycleCountItem',
  'supplierPerformanceMetric',
  'inventoryValuation',
  'scheduledReport',
  'reportExport',
  'analyticsDashboard',
  'apiKey',
];

export interface MockDelegate {
  fields: Record<string, unknown>;
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  delete: jest.Mock;
  deleteMany: jest.Mock;
  count: jest.Mock;
  upsert: jest.Mock;
  aggregate: jest.Mock;
  groupBy: jest.Mock;
  createMany: jest.Mock;
}

export interface MockDelegateWithTransaction extends MockDelegate {
  $queryRaw: jest.Mock;
}

function createMockDelegate(): MockDelegate {
  return {
    fields: {} as Record<string, unknown>,
    findUnique: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    upsert: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
}

function createMockDelegateWithTransaction(): MockDelegateWithTransaction {
  return {
    ...createMockDelegate(),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

/**
 * Maps every prisma model name to a {@link MockDelegate}. Keeping the model
 * names as a literal-union keyed record (rather than an inferred object literal
 * built from a `Record<string, ...>` spread, which drops its index signature)
 * is what lets `prisma[model].<method>` type-check in the 50+ spec files that
 * construct services with `createMockPrisma()`.
 */
export type PrismaModelName = (typeof prismaModelNames)[number];

export interface MockPrismaModelDelegates {
  tenant: MockDelegate;
  user: MockDelegate;
  refreshToken: MockDelegate;
  session: MockDelegate;
  subscription: MockDelegate;
  invitation: MockDelegate;
  verificationToken: MockDelegate;
  auditLog: MockDelegate;
  restaurant: MockDelegate;
  branch: MockDelegate;
  floor: MockDelegate;
  diningArea: MockDelegate;
  table: MockDelegate;
  menuCategory: MockDelegate;
  product: MockDelegate;
  variantGroup: MockDelegate;
  productVariant: MockDelegate;
  modifierGroup: MockDelegate;
  modifier: MockDelegate;
  productVariantModifier: MockDelegate;
  productTag: MockDelegate;
  allergen: MockDelegate;
  productTagAssignment: MockDelegate;
  productAllergenAssignment: MockDelegate;
  productImage: MockDelegate;
  productAvailability: MockDelegate;
  nutritionalInfo: MockDelegate;
  businessHours: MockDelegate;
  businessException: MockDelegate;
  order: MockDelegate;
  orderItem: MockDelegate;
  orderItemModifier: MockDelegate;
  orderStatusHistory: MockDelegate;
  orderNote: MockDelegate;
  kitchenTicket: MockDelegate;
  payment: MockDelegate;
  paymentWebhookReceipt: MockDelegate;
  ingredient: MockDelegate;
  supplier: MockDelegate;
  productIngredient: MockDelegate;
  notification: MockDelegate;
  message: MockDelegate;
  report: MockDelegate;
  feedback: MockDelegate;
  taxRate: MockDelegate;
  serviceCharge: MockDelegate;
  unit: MockDelegate;
  campaign: MockDelegate;
  kitchenStation: MockDelegate;
  kitchenTicketItem: MockDelegate;
  customer: MockDelegate;
  customerAddress: MockDelegate;
  customerPreference: MockDelegate;
  visitHistory: MockDelegate;
  giftCard: MockDelegate;
  giftCardTransaction: MockDelegate;
  loyaltyProgram: MockDelegate;
  loyaltyTier: MockDelegate;
  loyaltyPointsTransaction: MockDelegate;
  membership: MockDelegate;
  membershipHistory: MockDelegate;
  reward: MockDelegate;
  wallet: MockDelegate;
  walletTransaction: MockDelegate;
  referral: MockDelegate;
  customerSegment: MockDelegate;
  customerSegmentAssignment: MockDelegate;
  customerAnalytics: MockDelegate;
  crmTimelineEntry: MockDelegate;
  communicationTemplate: MockDelegate;
  communicationLog: MockDelegate;
  campaignTemplate: MockDelegate;
  campaignRecipient: MockDelegate;
  campaignAnalytics: MockDelegate;
  campaignApproval: MockDelegate;
  promotion: MockDelegate;
  promotionBranchRestriction: MockDelegate;
  promotionProductRestriction: MockDelegate;
  promotionCategoryRestriction: MockDelegate;
  promotionUsage: MockDelegate;
  eventRule: MockDelegate;
  eventLog: MockDelegate;
  inventoryCategory: MockDelegate;
  inventoryUnit: MockDelegate;
  inventoryLocation: MockDelegate;
  inventoryItem: MockDelegate;
  inventoryBatch: MockDelegate;
  supplierDetail: MockDelegate;
  supplierContact: MockDelegate;
  supplierDocument: MockDelegate;
  purchaseOrder: MockDelegate;
  purchaseOrderItem: MockDelegate;
  purchaseOrderApproval: MockDelegate;
  goodsReceipt: MockDelegate;
  goodsReceiptItem: MockDelegate;
  stockMovement: MockDelegate;
  branchTransfer: MockDelegate;
  branchTransferItem: MockDelegate;
  recipe: MockDelegate;
  recipeItem: MockDelegate;
  stockAdjustment: MockDelegate;
  wasteEntry: MockDelegate;
  inventoryCount: MockDelegate;
  expirationAlert: MockDelegate;
  warehouse: MockDelegate;
  warehouseZone: MockDelegate;
  storageBin: MockDelegate;
  warehouseBranch: MockDelegate;
  barcode: MockDelegate;
  inventoryForecast: MockDelegate;
  reorderSuggestion: MockDelegate;
  consumptionRecord: MockDelegate;
  cycleCount: MockDelegate;
  cycleCountItem: MockDelegate;
  supplierPerformanceMetric: MockDelegate;
  inventoryValuation: MockDelegate;
  scheduledReport: MockDelegate;
  reportExport: MockDelegate;
  analyticsDashboard: MockDelegate;
  apiKey: MockDelegate;
}

export interface MockPrisma extends MockPrismaModelDelegates {
  $transaction: jest.Mock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $use: jest.Mock;
  $extends: jest.Mock;
  $queryRaw: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  $executeRawUnsafe: jest.Mock;
  softDeleteWhere: jest.Mock;
  onModuleInit: jest.Mock;
  onModuleDestroy: jest.Mock;
  reset(): void;
}

export function createMockPrisma(): MockPrisma {
  const delegates: Record<PrismaModelName, MockDelegate> = {} as Record<
    PrismaModelName,
    MockDelegate
  >;
  for (const name of prismaModelNames) {
    delegates[name as PrismaModelName] = createMockDelegate();
  }

  const txMethods: Record<PrismaModelName, MockDelegateWithTransaction> = {} as Record<
    PrismaModelName,
    MockDelegateWithTransaction
  >;
  for (const name of prismaModelNames) {
    txMethods[name as PrismaModelName] = createMockDelegateWithTransaction();
  }

  return {
    ...delegates,
    $transaction: jest.fn().mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return arg(txMethods);
      }
      return Promise.resolve(arg);
    }),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $use: jest.fn(),
    $extends: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue([]),
    softDeleteWhere: jest
      .fn()
      .mockImplementation((where: Record<string, unknown> = {}) => ({ ...where, deletedAt: null })),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
    reset() {
      for (const delegate of Object.values(delegates)) {
        for (const method of Object.values(delegate)) {
          if (jest.isMockFunction(method)) {
            method.mockClear();
            if (method.getMockImplementation()?.name !== 'defaultResolvedValue') {
              method.mockResolvedValue(undefined);
            }
          }
        }
      }
      this.$transaction.mockClear();
      this.softDeleteWhere.mockClear();
      this.$connect.mockClear();
      this.$disconnect.mockClear();
      this.$queryRaw.mockReset();
      this.$queryRaw.mockResolvedValue([]);
      this.$queryRawUnsafe.mockReset();
      this.$queryRawUnsafe.mockResolvedValue([]);
      this.$executeRawUnsafe.mockReset();
      this.$executeRawUnsafe.mockResolvedValue([]);
    },
  } as MockPrisma;
}
