const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
let TOKEN = '';
let REGISTERED_EMAIL = '';
let RESTAURANT_ID = '';
let SCHEDULED_REPORT_ID = '';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000,
      path, method,
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
    const bodyStr = typeof (e.body || e.resBody) !== 'undefined' ? ` body=${JSON.stringify(e.body || e.resBody).substring(0,300)}` : '';
    console.log(`  \x1b[31mFAIL\x1b[0m ${label} — ${e.message || e}${bodyStr}`);
    FAIL++;
    errors.push(`${label}: ${e.message || e}${bodyStr}`);
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
  try { await request('POST', '/api/v1/test/cleanup'); } catch { }
}

async function main() {
  console.log('Cleaning...'); await cleanup();

  console.log('Starting server...');
  const mainFile = path.join(__dirname, 'dist', 'apps', 'api', 'main.js');
  const server = spawn('node', [mainFile], {
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: __dirname,
    env: { ...process.env, PORT: '3000', NODE_ENV: 'development' },
  });
  const started = await waitForServer('/api/v1/health');
  if (!started) {
    console.log('FAIL: server');
    server.kill();
    process.exit(1);
  }
  console.log('  Server ready\n');

  const tests = [];

  // ── SETUP ──
  tests.push(T('Register user', async () => {
    const ts = Date.now();
    const email = `p5m3-${ts}@test.com`;
    REGISTERED_EMAIL = email;
    const r = await request('POST', '/api/v1/auth/register', { firstName: 'Phase5M3', lastName: 'Test', email, password: 'Test1234!', tenantName: `CorpP5M3${ts}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    const t = r.body.tokens || r.body.data?.tokens || {};
    TOKEN = t.accessToken || r.body.data?.token || r.body.token;
    if (!TOKEN) throw new Error('No token: ' + JSON.stringify(r.body));
  }));

  tests.push(T('Login', async () => {
    const r = await request('POST', '/api/v1/auth/login', { email: REGISTERED_EMAIL, password: 'Test1234!' });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
    const t = r.body.tokens || r.body.data?.tokens || {};
    const tk = t.accessToken || r.body.data?.token || r.body.token;
    if (tk) TOKEN = tk;
  }));

  // ── 1. EXECUTIVE DASHBOARD (7 endpoints) ──
  tests.push(T('Exec Dashboard: kpi', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/kpi', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ' ' + JSON.stringify(r.body).substring(0,100));
  }));

  tests.push(T('Exec Dashboard: top-products', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/top-products', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Exec Dashboard: top-categories', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/top-categories', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Exec Dashboard: top-branches', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/top-branches', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Exec Dashboard: top-employees', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/top-employees', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Exec Dashboard: top-customers', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/top-customers', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Exec Dashboard: sales-trend', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/sales-trend', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 2. SALES ANALYTICS (14 endpoints - select 6) ──
  tests.push(T('Sales Analytics: overview', async () => {
    const r = await request('GET', '/api/v1/sales-analytics/overview', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Sales Analytics: revenue-comparison', async () => {
    const r = await request('GET', '/api/v1/sales-analytics/revenue-comparison', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Sales Analytics: by-category', async () => {
    const r = await request('GET', '/api/v1/sales-analytics/by-category', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Sales Analytics: payment-methods', async () => {
    const r = await request('GET', '/api/v1/sales-analytics/payment-methods', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Sales Analytics: peak-hours', async () => {
    const r = await request('GET', '/api/v1/sales-analytics/peak-hours', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Sales Analytics: conversion', async () => {
    const r = await request('GET', '/api/v1/sales-analytics/conversion', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 3. KITCHEN ANALYTICS (6 endpoints - select 3) ──
  tests.push(T('Kitchen Analytics: overview', async () => {
    const r = await request('GET', '/api/v1/kitchen-analytics/overview', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Kitchen Analytics: queue', async () => {
    const r = await request('GET', '/api/v1/kitchen-analytics/queue', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Kitchen Analytics: efficiency', async () => {
    const r = await request('GET', '/api/v1/kitchen-analytics/efficiency', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 4. INVENTORY ANALYTICS (10 endpoints - select 4) ──
  tests.push(T('Inventory Analytics: turnover', async () => {
    const r = await request('GET', '/api/v1/inventory-analytics/turnover', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Inventory Analytics: dead-stock', async () => {
    const r = await request('GET', '/api/v1/inventory-analytics/dead-stock', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Inventory Analytics: waste', async () => {
    const r = await request('GET', '/api/v1/inventory-analytics/waste', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Inventory Analytics: consumption', async () => {
    const r = await request('GET', '/api/v1/inventory-analytics/consumption', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 5. CUSTOMER ANALYTICS (11 endpoints - select 3) ──
  tests.push(T('Customer Analytics: overview', async () => {
    const r = await request('GET', '/api/v1/customer-analytics/overview', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Customer Analytics: churn', async () => {
    const r = await request('GET', '/api/v1/customer-analytics/churn', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Customer Analytics: rfm', async () => {
    const r = await request('GET', '/api/v1/customer-analytics/rfm', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 6. CRM ANALYTICS (8 endpoints - select 3) ──
  tests.push(T('CRM Analytics: overview', async () => {
    const r = await request('GET', '/api/v1/crm-analytics/overview', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('CRM Analytics: campaign-roi', async () => {
    const r = await request('GET', '/api/v1/crm-analytics/campaign-roi', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('CRM Analytics: promotions', async () => {
    const r = await request('GET', '/api/v1/crm-analytics/promotions', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 7. SUPPLIER ANALYTICS (9 endpoints - select 4) ──
  tests.push(T('Supplier Analytics: overview', async () => {
    const r = await request('GET', '/api/v1/supplier-analytics/overview', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Supplier Analytics: scorecards', async () => {
    const r = await request('GET', '/api/v1/supplier-analytics/scorecards', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Supplier Analytics: purchase-trends', async () => {
    const r = await request('GET', '/api/v1/supplier-analytics/purchase-trends', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Supplier Analytics: ranking', async () => {
    const r = await request('GET', '/api/v1/supplier-analytics/ranking', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 8. FINANCIAL ANALYTICS (10 endpoints - select 4) ──
  tests.push(T('Financial Analytics: overview', async () => {
    const r = await request('GET', '/api/v1/financial-analytics/overview', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Financial Analytics: revenue', async () => {
    const r = await request('GET', '/api/v1/financial-analytics/revenue', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Financial Analytics: refunds', async () => {
    const r = await request('GET', '/api/v1/financial-analytics/refunds', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Financial Analytics: cogs', async () => {
    const r = await request('GET', '/api/v1/financial-analytics/cogs', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 9. FORECASTING DASHBOARD (8 endpoints - select 3) ──
  tests.push(T('Forecasting: sales', async () => {
    const r = await request('GET', '/api/v1/forecasting-dashboard/sales', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Forecasting: demand', async () => {
    const r = await request('GET', '/api/v1/forecasting-dashboard/demand', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Forecasting: seasonality', async () => {
    const r = await request('GET', '/api/v1/forecasting-dashboard/seasonality', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 10. EXPORT ENGINE (5 endpoints - select 3) ──
  tests.push(T('Export Engine: generate', async () => {
    const r = await request('POST', '/api/v1/export-engine/generate', { type: 'CSV', reportType: 'sales' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  tests.push(T('Export Engine: list exports', async () => {
    const r = await request('GET', '/api/v1/export-engine/exports', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Export Engine: dashboard snapshot', async () => {
    const r = await request('POST', '/api/v1/export-engine/dashboard-snapshot', {},
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201) throw new Error('Expected 200/201 got ' + r.status);
  }));

  // ── 11. SCHEDULED REPORTS (6 endpoints - select 3) ──
  tests.push(T('Scheduled Reports: create', async () => {
    const r = await request('POST', '/api/v1/scheduled-reports', {
      name: 'Daily Sales Report', type: 'SALES', schedule: '0 8 * * *', recipients: ['test@test.com'], format: 'PDF',
    }, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 201) throw new Error('Expected 201 got ' + r.status);
    SCHEDULED_REPORT_ID = r.body.data?.id || r.body.id;
  }));

  tests.push(T('Scheduled Reports: list', async () => {
    const r = await request('GET', '/api/v1/scheduled-reports', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Scheduled Reports: trigger', async () => {
    if (!SCHEDULED_REPORT_ID) { PASS++; console.log(`  \x1b[33mSKIP\x1b[0m trigger — no ID`); return; }
    const r = await request('POST', `/api/v1/scheduled-reports/${SCHEDULED_REPORT_ID}/trigger`, null,
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200 && r.status !== 201 && r.status !== 202) throw new Error('Expected 200/201/202 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── 12. LIVE ANALYTICS (6 endpoints - select 2) ──
  tests.push(T('Live Analytics: kpi', async () => {
    const r = await request('GET', '/api/v1/live-analytics/kpi', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  tests.push(T('Live Analytics: dashboard', async () => {
    const r = await request('GET', '/api/v1/live-analytics/dashboard', null, { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 200) throw new Error('Expected 200 got ' + r.status + ': ' + JSON.stringify(r.body).substring(0,500));
  }));

  // ── AUTH ──
  tests.push(T('No auth returns 401', async () => {
    const r = await request('GET', '/api/v1/executive-dashboard/kpi');
    if (r.status !== 401) throw new Error('Expected 401 got ' + r.status);
  }));

  // ── VALIDATION ──
  tests.push(T('Validation: empty report name', async () => {
    const r = await request('POST', '/api/v1/scheduled-reports', { type: 'SALES', schedule: '0 8 * * *' },
      { authorization: `Bearer ${TOKEN}` });
    if (r.status !== 400) throw new Error('Expected 400 got ' + r.status);
  }));

  // Run all tests
  for (const t of tests) {
    await run(t.label, t.fn);
  }

  const total = PASS + FAIL;
  console.log(`\n========== PHASE 5 MILESTONE 3: ENTERPRISE ANALYTICS & BI ==========\n`);
  console.log(`  \x1b[32mPASS\x1b[0m: ${PASS}  \x1b[31mFAIL\x1b[0m: ${FAIL}  Total: ${total}`);
  console.log(`  Score: ${Math.round((PASS / total) * 100)}%\n`);

  if (errors.length > 0) {
    console.log('Failures:');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  server.kill();
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
