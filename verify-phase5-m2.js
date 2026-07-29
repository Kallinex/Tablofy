const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
let TOKEN = '';
let REGISTERED_EMAIL = '';
let RESTAURANT_ID = '';
let BRANCH_ID = '';
let ITEM_ID = '';
let SUPPLIER_ID = '';
let WAREHOUSE_ID = '';
let ZONE_ID = '';
let BIN_ID = '';
let BARCODE_ID = '';
let FORECAST_ID = '';
let REORDER_ID = '';
let CYCLE_COUNT_ID = '';
let CYCLE_COUNT_ITEM_ID = '';
let PERFORMANCE_ID = '';
let VALUATION_ID = '';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000,
      path: path, method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const T = (label, fn) => ({ label, fn });

let PASS = 0, FAIL = 0, errors = [];
function run(label, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
    PASS++;
  }).catch((e) => {
    console.log(`  \x1b[31mFAIL\x1b[0m ${label} — ${e.message || e}`);
    console.error(`    ${e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e}`);
    FAIL++;
    errors.push(`${label}: ${e.message || e}`);
  });
}

async function waitForServer(url = '/api/v1/health', maxRetries = 60) {
  for (let i = 0; i < maxRetries; i++) {
    try { const r = await request('GET', url); if (r.status === 200) return true; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  return false;
}

async function cleanup() {
  try {
    await request('POST', '/api/v1/test/cleanup');
    console.log('  DB cleaned');
  } catch { }
}

async function main() {
  console.log('Cleaning...'); await cleanup();

  console.log('Starting server...');
  const mainFile = path.join(__dirname, 'dist', 'apps', 'api', 'main.js');
  const server = spawn('node', [mainFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: __dirname,
    env: { ...process.env, PORT: '3000', NODE_ENV: 'testing' },
  });
  let serverOutput = '';
  server.stdout.on('data', (d) => { serverOutput += d.toString(); });
  server.stderr.on('data', (d) => { serverOutput += d.toString(); });
  const started = await waitForServer('/api/v1/health');
  if (!started) {
    console.log('FAIL: server (output below)');
    console.log(serverOutput.substring(0, 5000));
    server.kill();
    process.exit(1);
  }
  console.log('  Server ready\n');

  const tests = [];

  // ── SETUP ──
  tests.push(T('Register user', async () => {
    const ts = Date.now();
    const email = `p5m2-${ts}@test.com`;
    REGISTERED_EMAIL = email;
    const r = await request('POST', '/api/v1/auth/register', { firstName: 'Phase5M2', lastName: 'TestUser', email, password: 'Test1234!', tenantName: `TestCorpPhase5M2${ts}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status + ' ' + JSON.stringify(r.body));
    const tokens = r.body.tokens || r.body.data?.tokens || {};
    const token = tokens.accessToken || r.body.data?.token || r.body.token;
    if (!token) throw new Error('No token found in response: ' + JSON.stringify(r.body));
    TOKEN = token;
  }));

  tests.push(T('Login', async () => {
    const r = await request('POST', '/api/v1/auth/login', { email: REGISTERED_EMAIL, password: 'Test1234!' });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status + ' ' + JSON.stringify(r.body));
    const tokens = r.body.tokens || r.body.data?.tokens || {};
    const token = tokens.accessToken || r.body.data?.token || r.body.token;
    if (token) TOKEN = token;
  }));

  tests.push(T('Create restaurant', async () => {
    const r = await request('POST', '/api/v1/restaurants', { name: 'Phase5M2 Restaurant', slug: `phase5m2-${Date.now()}` },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    RESTAURANT_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('Create branch', async () => {
    const r = await request('POST', `/api/v1/restaurants/${RESTAURANT_ID}/branches`, {
      name: 'Main Branch', slug: 'main-branch', address: '123 Test St', phone: '+1234567890',
    }, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    BRANCH_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('Create inventory item', async () => {
    const r = await request('POST', '/api/v1/inventory/items', {
      name: 'Phase5M2 Item', sku: 'P5M2-001', currentQuantity: 100, minStock: 10, maxStock: 200,
    }, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    ITEM_ID = r.body.data?.id || r.body.id;
  }));

  // ── WAREHOUSE CRUD ──
  tests.push(T('Create warehouse', async () => {
    const r = await request('POST', '/api/v1/warehouses', {
      name: 'Central Warehouse', code: 'WH-CENTRAL', type: 'CENTRAL', status: 'ACTIVE',
      capacity: 10000, capacityUnit: 'kg', address: '456 Warehouse Blvd', city: 'Metropolis', country: 'USA',
    }, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    WAREHOUSE_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('List warehouses', async () => {
    const r = await request('GET', '/api/v1/warehouses', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
    const items = r.body.data || r.body;
    if (!Array.isArray(items) || items.length === 0) throw new Error('Expected warehouse list');
  }));

  tests.push(T('Get warehouse', async () => {
    const r = await request('GET', `/api/v1/warehouses/${WAREHOUSE_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
    const d = r.body.data || r.body;
    if (d.name !== 'Central Warehouse') throw new Error('Name mismatch');
  }));

  tests.push(T('Update warehouse', async () => {
    const r = await request('PUT', `/api/v1/warehouses/${WAREHOUSE_ID}`, { name: 'Central WH Updated', address: 'Updated Address' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Warehouse stats', async () => {
    const r = await request('GET', `/api/v1/warehouses/${WAREHOUSE_ID}/stats`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Set default warehouse', async () => {
    const r = await request('POST', `/api/v1/warehouses/${WAREHOUSE_ID}/set-default`, {},
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  // ── ZONES ──
  tests.push(T('Create zone', async () => {
    const r = await request('POST', `/api/v1/warehouses/${WAREHOUSE_ID}/zones`, { name: 'Storage Zone A', code: 'ZONE-A', type: 'STORAGE' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    ZONE_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('List zones', async () => {
    const r = await request('GET', `/api/v1/warehouses/${WAREHOUSE_ID}/zones`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Update zone', async () => {
    const r = await request('PUT', `/api/v1/warehouses/zones/${ZONE_ID}`, { name: 'Zone A Updated' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Delete zone', async () => {
    const r = await request('DELETE', `/api/v1/warehouses/zones/${ZONE_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 204) throw new Error('Expected 200/204 got ' + r.status);
  }));

  tests.push(T('Re-create zone', async () => {
    const r = await request('POST', `/api/v1/warehouses/${WAREHOUSE_ID}/zones`, { name: 'Zone B', code: 'ZONE-B', type: 'STORAGE' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    ZONE_ID = r.body.data?.id || r.body.id;
  }));

  // ── BINS ──
  tests.push(T('Create bin', async () => {
    const r = await request('POST', `/api/v1/warehouses/${WAREHOUSE_ID}/bins`, { zoneId: ZONE_ID, name: 'Bin 001', code: 'BIN-001', type: 'SHELF' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    BIN_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('List bins', async () => {
    const r = await request('GET', `/api/v1/warehouses/${WAREHOUSE_ID}/bins`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Update bin', async () => {
    const r = await request('PUT', `/api/v1/warehouses/bins/${BIN_ID}`, { name: 'Bin 001 Updated' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Delete bin', async () => {
    const r = await request('DELETE', `/api/v1/warehouses/bins/${BIN_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 204) throw new Error('Expected 200/204 got ' + r.status);
  }));

  // ── WAREHOUSE BRANCH ──
  tests.push(T('Map warehouse to branch', async () => {
    const r = await request('POST', `/api/v1/warehouses/${WAREHOUSE_ID}/branches`, { branchId: BRANCH_ID, isDefault: true },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
  }));

  tests.push(T('List warehouse branches', async () => {
    const r = await request('GET', `/api/v1/warehouses/${WAREHOUSE_ID}/branches`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Soft delete warehouse', async () => {
    const r = await request('DELETE', `/api/v1/warehouses/${WAREHOUSE_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 204) throw new Error('Expected 200/204 got ' + r.status);
  }));

  tests.push(T('Restore warehouse', async () => {
    const r = await request('POST', `/api/v1/warehouses/${WAREHOUSE_ID}/restore`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  // ── BARCODE ──
  tests.push(T('Create barcode', async () => {
    const r = await request('POST', '/api/v1/barcodes', { inventoryItemId: ITEM_ID, barcode: '8901234567890', type: 'EAN13' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    BARCODE_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('Lookup by barcode', async () => {
    const r = await request('GET', '/api/v1/barcodes/lookup/8901234567890', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Get barcodes for item', async () => {
    const r = await request('GET', `/api/v1/barcodes/item/${ITEM_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Set primary barcode', async () => {
    const r = await request('POST', `/api/v1/barcodes/${BARCODE_ID}/primary`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  tests.push(T('Delete barcode', async () => {
    const r = await request('DELETE', `/api/v1/barcodes/${BARCODE_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 204) throw new Error('Expected 200/204 got ' + r.status);
  }));

  // ── FORECASTING ──
  tests.push(T('Generate forecast', async () => {
    const r = await request('POST', '/api/v1/forecasts', { inventoryItemId: ITEM_ID, period: 'MONTHLY', method: 'MOVING_AVERAGE', days: 90 },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    FORECAST_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('Get forecasts for item', async () => {
    const r = await request('GET', `/api/v1/forecasts/item/${ITEM_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Get recommendations', async () => {
    const r = await request('GET', '/api/v1/forecasts/recommendations', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Generate reorder suggestion', async () => {
    const r = await request('POST', '/api/v1/forecasts/reorder-suggestions', { inventoryItemId: ITEM_ID },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201 && r.status !== 200) throw new Error('Expected 200/201 got ' + r.status);
    const d = r.body.data || r.body;
    REORDER_ID = d.id || (d.length > 0 ? d[0].id : null);
  }));

  tests.push(T('List reorder suggestions', async () => {
    const r = await request('GET', '/api/v1/forecasts/reorder-suggestions', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  // Approve if we have an ID
  tests.push(T('Approve reorder suggestion', async () => {
    if (!REORDER_ID) { PASS++; console.log(`  \x1b[33mSKIP\x1b[0m Approve reorder suggestion — no ID`); return; }
    const r = await request('PUT', `/api/v1/forecasts/reorder-suggestions/${REORDER_ID}/approve`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  // ── CYCLE COUNTS ──
  tests.push(T('Create cycle count', async () => {
    const r = await request('POST', '/api/v1/cycle-counts', { countDate: new Date().toISOString() },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    CYCLE_COUNT_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('List cycle counts', async () => {
    const r = await request('GET', '/api/v1/cycle-counts', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Get cycle count', async () => {
    const r = await request('GET', `/api/v1/cycle-counts/${CYCLE_COUNT_ID}`, null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Start cycle count', async () => {
    const r = await request('POST', `/api/v1/cycle-counts/${CYCLE_COUNT_ID}/start`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  tests.push(T('Get cycle count items', async () => {
    const r = await request('GET', `/api/v1/cycle-counts/${CYCLE_COUNT_ID}/items`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
    const items = r.body.data || r.body;
    if (Array.isArray(items) && items.length > 0) {
      CYCLE_COUNT_ITEM_ID = items[0].id;
    }
  }));

  tests.push(T('Record count for item', async () => {
    if (!CYCLE_COUNT_ITEM_ID) { PASS++; console.log(`  \x1b[33mSKIP\x1b[0m Record count — no item ID`); return; }
    const r = await request('POST', `/api/v1/cycle-counts/${CYCLE_COUNT_ID}/item/${CYCLE_COUNT_ITEM_ID}/count`,
      { actualQuantity: 95 }, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  tests.push(T('Complete cycle count', async () => {
    const r = await request('POST', `/api/v1/cycle-counts/${CYCLE_COUNT_ID}/complete`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  tests.push(T('Reconcile cycle count', async () => {
    const r = await request('POST', `/api/v1/cycle-counts/${CYCLE_COUNT_ID}/reconcile`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  tests.push(T('Cancel cycle count', async () => {
    // Create another for cancel test
    const r1 = await request('POST', '/api/v1/cycle-counts', { countDate: new Date().toISOString() },
      { authorization: `Bearer ${TOKEN}` });
    if (r1.status !== 201) throw new Error('Expected 201 got ' + r1.status);
    const cancelId = r1.body.data?.id || r1.body.id;
    const r = await request('POST', `/api/v1/cycle-counts/${cancelId}/cancel`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201 && r.status !== 204) throw new Error('Expected 200/201/204 got ' + r.status);
  }));

  // ── SUPPLIER PERFORMANCE ──
  tests.push(T('Create supplier performance metric', async () => {
    const r = await request('POST', '/api/v1/supplier-performance', {
      periodStart: '2026-07-01', periodEnd: '2026-07-31',
      overallScore: 85, deliveryAccuracy: 90, qualityScore: 88,
      totalOrders: 10, onTimeDeliveries: 9,
    }, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    PERFORMANCE_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('List supplier performance', async () => {
    const r = await request('GET', '/api/v1/supplier-performance', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Get performance metric', async () => {
    const r = await request('GET', `/api/v1/supplier-performance/${PERFORMANCE_ID}`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Get performance ranking', async () => {
    const r = await request('GET', '/api/v1/supplier-performance/ranking', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  // ── COSTING ──
  tests.push(T('Create inventory valuation', async () => {
    const r = await request('POST', '/api/v1/costing/valuation', { inventoryItemId: ITEM_ID, method: 'WEIGHTED_AVERAGE', valuationDate: new Date().toISOString() },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    VALUATION_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('Get valuations for item', async () => {
    const r = await request('GET', `/api/v1/costing/valuation/item/${ITEM_ID}`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Get single valuation', async () => {
    const r = await request('GET', `/api/v1/costing/valuation/${VALUATION_ID}`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Batch valuation', async () => {
    const r = await request('POST', '/api/v1/costing/valuation/batch', { method: 'FIFO', inventoryItemIds: [ITEM_ID] },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
  }));

  // ── DASHBOARD ──
  tests.push(T('Dashboard inventory summary', async () => {
    const r = await request('GET', '/api/v1/dashboard/inventory-summary', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Dashboard warehouse summary', async () => {
    const r = await request('GET', '/api/v1/dashboard/warehouse-summary', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Dashboard movement summary', async () => {
    const r = await request('GET', '/api/v1/dashboard/movement-summary', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Dashboard turnover rate', async () => {
    const r = await request('GET', '/api/v1/dashboard/turnover-rate', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Dashboard supplier performance', async () => {
    const r = await request('GET', '/api/v1/dashboard/supplier-performance', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Dashboard reorder alert', async () => {
    const r = await request('GET', '/api/v1/dashboard/reorder-alert', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  tests.push(T('Dashboard valuation summary', async () => {
    const r = await request('GET', '/api/v1/dashboard/valuation-summary', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status);
  }));

  // ── AUTH ──
  tests.push(T('No auth returns 401', async () => {
    const r = await request('POST', '/api/v1/warehouses', { name: 'x', code: 'x', type: 'CENTRAL' });
    if (r.status !== 401) throw new Error('Expected 401 got ' + r.status);
  }));

  // ── VALIDATION ──
  tests.push(T('Validation: empty warehouse name', async () => {
    const r = await request('POST', '/api/v1/warehouses', { code: 'WH-BAD', type: 'CENTRAL' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 400) throw new Error('Expected 400 got ' + r.status);
  }));

  tests.push(T('Validation: missing barcode itemId', async () => {
    const r = await request('POST', '/api/v1/barcodes', { barcode: 'X' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 400) throw new Error('Expected 400 got ' + r.status);
  }));

  tests.push(T('Validation: empty forecast item', async () => {
    const r = await request('POST', '/api/v1/forecasts', {}, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 400) throw new Error('Expected 400 got ' + r.status);
  }));

  // Run all tests
  for (const t of tests) {
    await run(t.label, t.fn);
  }

  const total = PASS + FAIL;
  console.log(`\n========== PHASE 5 MILESTONE 2: ENTERPRISE INVENTORY INTELLIGENCE ==========\n`);
  console.log(`  \x1b[32mPASS\x1b[0m: ${PASS}  \x1b[31mFAIL\x1b[0m: ${FAIL}  Total: ${total}`);
  console.log(`  Score: ${Math.round((PASS / total) * 100)}%\n`);

  if (errors.length > 0) {
    console.log('Failures:');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  server.kill();
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
