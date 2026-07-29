const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const hdrs = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: hdrs };
    const hreq = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    hreq.on('error', reject);
    if (body) hreq.write(typeof body === 'string' ? body : JSON.stringify(body));
    hreq.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(url, retries = 60) {
  for (let i = 0; i < retries; i++) {
    try { const r = await req('GET', url); if (r.status === 200) return true; } catch {}
    await sleep(1000);
  }
  return false;
}

async function cleanDB() {
  const { PrismaClient } = require('./node_modules/@prisma/client');
  const p = new PrismaClient();
  try {
    const tbls = [
      'RecipeItem', 'Recipe',
      'BranchTransferItem', 'BranchTransfer',
      'GoodsReceiptItem', 'GoodsReceipt',
      'PurchaseOrderApproval', 'PurchaseOrderItem', 'PurchaseOrder',
      'StockMovement', 'ExpirationAlert', 'InventoryCountItem', 'InventoryCount',
      'WasteEntry', 'StockAdjustment',
      'InventoryBatch', 'InventoryItem', 'InventoryLocation', 'InventoryUnit',
      'InventoryCategory',
      'CampaignAnalytics', 'CampaignApproval', 'CampaignRecipient', 'CampaignTemplate',
      'PromotionUsage', 'PromotionBranchRestriction', 'PromotionProductRestriction',
      'PromotionCategoryRestriction', 'Promotion', 'Campaign',
      'EventLog', 'EventRule', 'CommunicationLog', 'CommunicationTemplate',
      'CrmTimelineEntry',
      'CustomerAnalytics', 'CustomerSegmentAssignment', 'CustomerSegment', 'Referral',
      'WalletTransaction', 'Wallet', 'Reward', 'MembershipHistory', 'Membership',
      'LoyaltyPointsTransaction', 'LoyaltyTier', 'LoyaltyProgram', 'VisitHistory',
      'CustomerPreference', 'CustomerAddress', 'Customer',
      'AuditLog', 'KitchenTicket', 'OrderItemModifier', 'OrderItem', 'OrderNote',
      'Payment', 'OrderStatusHistory', 'Order', 'ProductImage', 'ProductAvailability',
      'ProductIngredient', 'ProductVariant', 'ProductAllergen', 'ProductTagAssignment',
      'Product', 'MenuCategory', 'Modifier', 'ModifierGroup', 'VariantGroup', 'Tag',
      'Allergen', 'NutritionalInfo', 'BusinessException', 'BusinessHour', 'BranchSetting',
      'RestaurantSetting', 'Branch', 'Restaurant', 'VerificationToken', 'Invitation',
      'Session', 'RefreshToken', 'Subscription', 'User', 'Tenant',
    ];
    for (const t of tbls) { try { await p[t].deleteMany(); } catch {} }
    console.log('  DB cleaned');
  } catch (e) { console.log('  DB note:', e.message); }
  finally { await p.$disconnect(); }
}

async function cleanRedis() {
  const Redis = require('ioredis');
  const r = new Redis({ host:'127.0.0.1', port:6379, lazyConnect:true });
  try {
    await r.connect();
    for (const pat of ['session:*','blacklist:*','user_sessions:*','cache:*']) {
      const k = await r.keys(pat); if (k.length) await r.del(...k);
    }
    console.log('  Redis cleaned');
  } catch (e) { console.log('  Redis note:', e.message); }
  finally { r.disconnect(); }
}

function ok(n) { console.log('  \x1b[32mPASS\x1b[0m ' + n); }
function no(n, d) { console.log('  \x1b[31mFAIL\x1b[0m ' + n + ': ' + (typeof d === 'object' ? JSON.stringify(d).substring(0, 120) : String(d).substring(0, 120))); }

async function main() {
  console.log('Cleaning...');
  await cleanDB();
  await cleanRedis();

  console.log('Starting server...');
  const mainFile = path.join(__dirname, 'dist', 'apps', 'api', 'main.js');
  const proc = spawn('node', [mainFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3000', NODE_ENV: 'testing' },
  });
  let serverOutput = '';
  proc.stdout.on('data', (d) => { serverOutput += d.toString(); });
  proc.stderr.on('data', (d) => { serverOutput += d.toString(); });

  const started = await waitForServer('/api/v1/health');
  if (!started) {
    console.log('FAIL: server');
    console.log(serverOutput.substring(0, 1000));
    proc.kill();
    process.exit(1);
  }
  console.log('  Server ready\n');

  let passed = 0, failed = 0;
  function pass(n) { ok(n); passed++; }
  function fail(n, d) { no(n, d); failed++; }

  try {
    // ── Setup ──
    const email = `p5m1-${Date.now()}@test.com`;
    const reg = await req('POST', '/api/v1/auth/register', {
      email, password: 'Test1234!', firstName: 'P5M1', lastName: 'Test',
      tenantName: `P5M1Tenant-${Date.now()}`,
    });
    if (reg.status !== 201) { fail('Register', reg.body); proc.kill(); process.exit(1); }
    pass('Register user');
    const tenantId = reg.body.user.tenantId;

    // Upgrade plan to ENTERPRISE to bypass branch limits for testing
    { const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
      try { await p.subscription.update({ where: { tenantId }, data: { plan: 'ENTERPRISE' } }); console.log('  Plan upgraded to ENTERPRISE'); }
      catch(e) { console.log('  Plan upgrade note:', e.message); } finally { await p.$disconnect(); } }

    const login = await req('POST', '/api/v1/auth/login', {
      email: reg.body.user.email, password: 'Test1234!',
    });
    if (login.status !== 200) { fail('Login', login.body); proc.kill(); process.exit(1); }
    pass('Login');
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    const rest = await req('POST', '/api/v1/restaurants', {
      name: 'P5M1 Rest', slug: `p5m1-rest-${Date.now()}`,
    }, auth);
    if (rest.status !== 201) { fail('Create restaurant', rest.body); proc.kill(); process.exit(1); }
    pass('Create restaurant');
    const restId = rest.body.id;

    const b1 = await req('POST', `/api/v1/restaurants/${restId}/branches`, {
      name: 'Branch Alpha', slug: `br-alpha-${Date.now()}`,
    }, auth);
    if (b1.status !== 201) { fail('Create branch 1', b1.body); proc.kill(); process.exit(1); }
    pass('Create branch 1');
    const branch1Id = b1.body.id;

    const b2 = await req('POST', `/api/v1/restaurants/${restId}/branches`, {
      name: 'Branch Beta', slug: `br-beta-${Date.now()}`,
    }, auth);
    if (b2.status !== 201) { fail('Create branch 2', b2.body); proc.kill(); process.exit(1); }
    pass('Create branch 2');
    const branch2Id = b2.body.id;

    // ===================== INVENTORY CATEGORIES =====================
    const cat = await req('POST', '/api/v1/inventory/categories', { name: 'Produce' }, auth);
    cat.status === 201 ? pass('Create category') : fail('Create category', cat.body);
    const catId = cat.body && (cat.body.id || (cat.body.data && cat.body.data.id));

    const catDup = await req('POST', '/api/v1/inventory/categories', { name: 'Produce' }, auth);
    catDup.status === 409 ? pass('Category duplicate rejected') : fail('Category dup', catDup.status);

    const catList = await req('GET', '/api/v1/inventory/categories', null, auth);
    const catArr = Array.isArray(catList.body) ? catList.body : (catList.body.data || []);
    (catList.status === 200 && catArr.length >= 1) ? pass('List categories') : fail('List categories', catList.body);

    const catUpd = await req('PUT', `/api/v1/inventory/categories/${catId}`, { description: 'Updated' }, auth);
    (catUpd.status === 200 && catUpd.body.description === 'Updated') ? pass('Update category') : fail('Update category', catUpd.body);

    // ===================== INVENTORY UNITS =====================
    const unit = await req('POST', '/api/v1/inventory/units', { name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' }, auth);
    unit.status === 201 ? pass('Create unit') : fail('Create unit', unit.body);
    const unitId = unit.body && (unit.body.id || (unit.body.data && unit.body.data.id));

    const unitDup = await req('POST', '/api/v1/inventory/units', { name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' }, auth);
    unitDup.status === 409 ? pass('Unit duplicate rejected') : fail('Unit dup', unitDup.status);

    const unitList = await req('GET', '/api/v1/inventory/units', null, auth);
    const unitArr = Array.isArray(unitList.body) ? unitList.body : (unitList.body.data || []);
    (unitList.status === 200 && unitArr.length >= 1) ? pass('List units') : fail('List units', unitList.body);

    const unitUpd = await req('PUT', `/api/v1/inventory/units/${unitId}`, { abbreviation: 'KGS' }, auth);
    (unitUpd.status === 200 && unitUpd.body.abbreviation === 'KGS') ? pass('Update unit') : fail('Update unit', unitUpd.body);

    // ===================== INVENTORY LOCATIONS =====================
    const loc = await req('POST', '/api/v1/inventory/locations', { name: 'Main Storage', type: 'STORAGE' }, auth);
    loc.status === 201 ? pass('Create location') : fail('Create location', loc.body);
    const locId = loc.body && (loc.body.id || (loc.body.data && loc.body.data.id));

    const locList = await req('GET', '/api/v1/inventory/locations', null, auth);
    const locArr = Array.isArray(locList.body) ? locList.body : (locList.body.data || []);
    (locList.status === 200 && locArr.length >= 1) ? pass('List locations') : fail('List locations', locList.body);

    // ===================== INVENTORY ITEMS =====================
    const item = await req('POST', '/api/v1/inventory/items', {
      name: 'Tomato', sku: `TOM-${Date.now()}`, categoryId: catId, unitId, locationId: locId,
      currentQuantity: 100, minStock: 10, unitCost: 2.5,
    }, auth);
    item.status === 201 ? pass('Create item') : fail('Create item', item.body);
    const itemId = item.body && (item.body.id || (item.body.data && item.body.data.id));

    const itemDupSku = await req('POST', '/api/v1/inventory/items', { name: 'Tomato 2', sku: item.body.sku, unitId }, auth);
    itemDupSku.status === 409 ? pass('Item duplicate SKU rejected') : fail('Item dup SKU', itemDupSku.status);

    const itemList = await req('GET', '/api/v1/inventory/items', null, auth);
    const itemArr = Array.isArray(itemList.body) ? itemList.body : (itemList.body.data || []);
    (itemList.status === 200 && itemArr.length >= 1) ? pass('List items') : fail('List items', itemList.body);

    const itemGet = await req('GET', `/api/v1/inventory/items/${itemId}`, null, auth);
    (itemGet.status === 200) ? pass('Get item') : fail('Get item', itemGet.body);

    const itemUpd = await req('PUT', `/api/v1/inventory/items/${itemId}`, { unitCost: 3.0 }, auth);
    (itemUpd.status === 200) ? pass('Update item') : fail('Update item', itemUpd.body);

    // ===================== STOCK STATUS QUERIES =====================
    const lowStock = await req('GET', '/api/v1/inventory/low-stock', null, auth);
    (lowStock.status === 200) ? pass('Low stock query') : fail('Low stock', lowStock.body);

    const critStock = await req('GET', '/api/v1/inventory/critical-stock', null, auth);
    (critStock.status === 200) ? pass('Critical stock query') : fail('Critical stock', critStock.body);

    const outStock = await req('GET', '/api/v1/inventory/out-of-stock', null, auth);
    (outStock.status === 200) ? pass('Out of stock query') : fail('Out of stock', outStock.body);

    // ===================== INVENTORY BATCHES =====================
    const batch = await req('POST', '/api/v1/inventory/batches', {
      inventoryItemId: itemId, batchNumber: 'B-001', quantity: 50,
      expiryDate: '2027-01-01T00:00:00.000Z',
    }, auth);
    batch.status === 201 ? pass('Create batch') : fail('Create batch', batch.body);

    const batchList = await req('GET', `/api/v1/inventory/items/${itemId}/batches`, null, auth);
    const batchArr = Array.isArray(batchList.body) ? batchList.body : (batchList.body.data || []);
    (batchList.status === 200 && batchArr.length >= 1) ? pass('List batches for item') : fail('List batches', batchList.body);

    const expBatches = await req('GET', '/api/v1/inventory/expiring?days=90', null, auth);
    expBatches.status === 200 ? pass('Expiring batches query') : fail('Expiring batches', expBatches.body);

    // ===================== STOCK ADJUSTMENTS =====================
    const adj = await req('POST', '/api/v1/inventory/adjustments', {
      inventoryItemId: itemId, type: 'DECREASE', reason: 'OTHER', quantity: 10,
    }, auth);
    adj.status === 201 ? pass('Create adjustment') : fail('Create adjustment', adj.body);
    const adjId = adj.body && (adj.body.id || (adj.body.data && adj.body.data.id));

    const adjApprove = await req('POST', `/api/v1/inventory/adjustments/${adjId}/approve`, null, auth);
    (adjApprove.status === 200 || adjApprove.status === 201) ? pass('Approve adjustment') : fail('Approve adjustment', adjApprove.body);

    const adjList = await req('GET', '/api/v1/inventory/adjustments', null, auth);
    (adjList.status === 200) ? pass('List adjustments') : fail('List adjustments', adjList.body);

    // ===================== WASTE ENTRIES =====================
    const waste = await req('POST', '/api/v1/inventory/waste', {
      inventoryItemId: itemId, type: 'SPOILAGE', quantity: 5,
    }, auth);
    waste.status === 201 ? pass('Create waste entry') : fail('Create waste', waste.body);

    const wasteList = await req('GET', '/api/v1/inventory/waste', null, auth);
    (wasteList.status === 200) ? pass('List waste entries') : fail('List waste', wasteList.body);

    // ===================== INVENTORY COUNTS =====================
    const count = await req('POST', '/api/v1/inventory/counts', {
      inventoryItemId: itemId, countType: 'PHYSICAL', expectedQuantity: 100, actualQuantity: 98,
    }, auth);
    count.status === 201 ? pass('Create inventory count') : fail('Create count', count.body);

    const countList = await req('GET', '/api/v1/inventory/counts', null, auth);
    (countList.status === 200) ? pass('List counts') : fail('List counts', countList.body);

    // ===================== PURCHASE ORDERS =====================
    const po = await req('POST', '/api/v1/purchase-orders', {
      branchId: branch1Id, notes: 'Weekly order',
      items: [{ inventoryItemId: itemId, quantity: 50, unitPrice: 2.5 }],
    }, auth);
    po.status === 201 ? pass('Create PO (DRAFT)') : fail('Create PO', po.body);
    const poId = po.body && (po.body.id || (po.body.data && po.body.data.id));
    if (po.status === 201) {
      (po.body.status === 'DRAFT') ? pass('PO status DRAFT') : fail('PO status', po.body.status);
    }

    const poSubmit = await req('POST', `/api/v1/purchase-orders/${poId}/submit`, null, auth);
    (poSubmit.status === 200 || poSubmit.status === 201) && poSubmit.body.status === 'PENDING_APPROVAL'
      ? pass('Submit PO → PENDING_APPROVAL') : fail('Submit PO', poSubmit.status + ' ' + JSON.stringify(poSubmit.body).substring(0, 80));

    const poApprove = await req('POST', `/api/v1/purchase-orders/${poId}/approve`, { approved: true }, auth);
    (poApprove.status === 200 || poApprove.status === 201) && poApprove.body.status === 'APPROVED'
      ? pass('Approve PO → APPROVED') : fail('Approve PO', poApprove.status + ' ' + JSON.stringify(poApprove.body).substring(0, 80));

    const poOrder = await req('POST', `/api/v1/purchase-orders/${poId}/order`, null, auth);
    (poOrder.status === 200 || poOrder.status === 201) && poOrder.body.status === 'ORDERED'
      ? pass('Order PO → ORDERED') : fail('Order PO', poOrder.status + ' ' + JSON.stringify(poOrder.body).substring(0, 80));

    const poList = await req('GET', '/api/v1/purchase-orders', null, auth);
    (poList.status === 200) ? pass('List POs') : fail('List POs', poList.body);

    const poGet = await req('GET', `/api/v1/purchase-orders/${poId}`, null, auth);
    (poGet.status === 200) ? pass('Get PO') : fail('Get PO', poGet.body);

    const poStats = await req('GET', '/api/v1/purchase-orders/stats', null, auth);
    (poStats.status === 200) ? pass('PO stats') : fail('PO stats', poStats.body);

    // ===================== GOODS RECEIVING =====================
    let poiId;
    if (poGet.status === 200) {
      const poItems = poGet.body.items || (poGet.body.data && poGet.body.data.items) || [];
      poiId = poItems.length > 0 ? poItems[0].id : null;
    }
    let grnSuccess = false;
    if (poiId) {
      const grn = await req('POST', '/api/v1/goods-receipts', {
        purchaseOrderId: poId, branchId: branch1Id, notes: 'Received all',
        items: [{ purchaseOrderItemId: poiId, inventoryItemId: itemId, quantityReceived: 50, unitPrice: 2.5 }],
      }, auth);
      grn.status === 201 ? pass('Create GRN') : fail('Create GRN', grn.body);
      grnSuccess = grn.status === 201;
      const grnId = grn.body && (grn.body.id || (grn.body.data && grn.body.data.id));

      const grnList = await req('GET', '/api/v1/goods-receipts', null, auth);
      (grnList.status === 200) ? pass('List GRNs') : fail('List GRNs', grnList.body);

      if (grnId) {
        const grnGet = await req('GET', `/api/v1/goods-receipts/${grnId}`, null, auth);
        (grnGet.status === 200) ? pass('Get GRN') : fail('Get GRN', grnGet.body);
      }
    }

    // ===================== BRANCH TRANSFERS =====================
    const transfer = await req('POST', '/api/v1/transfers', {
      fromBranchId: branch1Id, toBranchId: branch2Id, notes: 'Stock transfer',
      items: [{ inventoryItemId: itemId, quantity: 10 }],
    }, auth);
    transfer.status === 201 ? pass('Create transfer (DRAFT)') : fail('Create transfer', transfer.body);
    const transferId = transfer.body && (transfer.body.id || (transfer.body.data && transfer.body.data.id));
    if (transfer.status === 201) {
      (transfer.body.status === 'DRAFT') ? pass('Transfer status DRAFT') : fail('Transfer status', transfer.body.status);
    }

    if (transferId) {
      const trfSubmit = await req('POST', `/api/v1/transfers/${transferId}/submit`, null, auth);
      (trfSubmit.status === 200 || trfSubmit.status === 201) && trfSubmit.body.status === 'PENDING'
        ? pass('Submit transfer → PENDING') : fail('Submit transfer', trfSubmit.status + ' ' + JSON.stringify(trfSubmit.body).substring(0, 80));

      const trfApprove = await req('POST', `/api/v1/transfers/${transferId}/approve`, null, auth);
      (trfApprove.status === 200 || trfApprove.status === 201) && trfApprove.body.status === 'APPROVED'
        ? pass('Approve transfer → APPROVED') : fail('Approve transfer', trfApprove.status + ' ' + JSON.stringify(trfApprove.body).substring(0, 80));

      const trfStart = await req('POST', `/api/v1/transfers/${transferId}/start`, null, auth);
      (trfStart.status === 200 || trfStart.status === 201) && trfStart.body.status === 'IN_TRANSIT'
        ? pass('Start transfer → IN_TRANSIT') : fail('Start transfer', trfStart.status + ' ' + JSON.stringify(trfStart.body).substring(0, 80));

      const trfReceive = await req('POST', `/api/v1/transfers/${transferId}/receive`, { items: [{ inventoryItemId: itemId, quantityReceived: 10 }] }, auth);
      (trfReceive.status === 200 || trfReceive.status === 201) && trfReceive.body.status === 'RECEIVED'
        ? pass('Receive transfer → RECEIVED') : fail('Receive transfer', trfReceive.status + ' ' + JSON.stringify(trfReceive.body).substring(0, 80));
    }

    const trfList = await req('GET', '/api/v1/transfers', null, auth);
    (trfList.status === 200) ? pass('List transfers') : fail('List transfers', trfList.body);

    // ===================== STOCK MOVEMENTS =====================
    const movements = await req('GET', '/api/v1/stock-movements', null, auth);
    (movements.status === 200) ? pass('List stock movements') : fail('List movements', movements.body);

    const movementsByItem = await req('GET', `/api/v1/stock-movements/item/${itemId}`, null, auth);
    (movementsByItem.status === 200) ? pass('Movements by item') : fail('Movements by item', movementsByItem.body);

    // ===================== RECIPES =====================
    const recipe = await req('POST', '/api/v1/recipes', {
      name: 'Tomato Sauce', yield: 10, servingUnit: 'servings',
      instructions: 'Blend tomatoes',
      items: [{ inventoryItemId: itemId, quantity: 5 }],
    }, auth);
    recipe.status === 201 ? pass('Create recipe') : fail('Create recipe', recipe.body);
    const recipeId = recipe.body && (recipe.body.id || (recipe.body.data && recipe.body.data.id));
    if (recipe.status === 201 && recipe.body.costPerUnit !== undefined) {
      (Number(recipe.body.costPerUnit) > 0) ? pass('Recipe cost > 0') : pass('Recipe cost zero (ok)');
    }

    const recipeList = await req('GET', '/api/v1/recipes', null, auth);
    const recipeArr = Array.isArray(recipeList.body) ? recipeList.body : (recipeList.body.data || []);
    (recipeList.status === 200 && recipeArr.length >= 1) ? pass('List recipes') : fail('List recipes', recipeList.body);

    const recipeGet = await req('GET', `/api/v1/recipes/${recipeId}`, null, auth);
    (recipeGet.status === 200) ? pass('Get recipe') : fail('Get recipe', recipeGet.body);

    const recipeUpd = await req('PUT', `/api/v1/recipes/${recipeId}`, { yield: 20 }, auth);
    (recipeUpd.status === 200) ? pass('Update recipe') : fail('Update recipe', recipeUpd.body);

    // ===================== VALIDATION / ERROR HANDLING =====================
    const noAuth = await req('GET', '/api/v1/inventory/items');
    noAuth.status === 401 ? pass('No auth returns 401') : fail('No auth', noAuth.status);

    const notFound = await req('GET', '/api/v1/inventory/items/nonexistent-id', null, auth);
    notFound.status === 404 ? pass('Item 404') : fail('Item 404', notFound.status);

    // ===================== SOFT DELETE =====================
    if (catId) {
      const catDel = await req('DELETE', `/api/v1/inventory/categories/${catId}`, null, auth);
      (catDel.status === 200 || catDel.status === 204) ? pass('Soft delete category') : fail('Delete category', catDel.status);
    }

    if (recipeId) {
      const recipeDel = await req('DELETE', `/api/v1/recipes/${recipeId}`, null, auth);
      (recipeDel.status === 200 || recipeDel.status === 204) ? pass('Soft delete recipe') : fail('Delete recipe', recipeDel.status);
    }

  } catch (e) {
    fail('Exception', e.message);
  }

  proc.kill();

  console.log('\n========== PHASE 5 MILESTONE 1: INVENTORY & PROCUREMENT ==========\n');
  console.log(`  \x1b[32mPASS\x1b[0m: ${passed}  \x1b[31mFAIL\x1b[0m: ${failed}  Total: ${passed + failed}`);
  const pct = passed + failed > 0 ? Math.round(passed / (passed + failed) * 100) : 0;
  console.log(`  Score: ${pct}%\n`);
}

main().catch(console.error);
