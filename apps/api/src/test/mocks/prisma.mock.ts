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
];

function createMockDelegate() {
  return {
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

function createMockDelegateWithTransaction() {
  return {
    ...createMockDelegate(),
  };
}

export function createMockPrisma() {
  const delegates: Record<string, ReturnType<typeof createMockDelegate>> = {};
  for (const name of prismaModelNames) {
    delegates[name] = createMockDelegate();
  }

  const txMethods: Record<string, ReturnType<typeof createMockDelegateWithTransaction>> = {};
  for (const name of prismaModelNames) {
    txMethods[name] = createMockDelegateWithTransaction();
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
    },
  };
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
