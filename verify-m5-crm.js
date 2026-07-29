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
    try {
      const r = await req('GET', url);
      if (r.status === 200) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function cleanDB() {
  const { PrismaClient } = require('./node_modules/@prisma/client');
  const p = new PrismaClient();
  try {
    const tbls = [
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
    const email = `m5crm-${Date.now()}@test.com`;
    const reg = await req('POST', '/api/v1/auth/register', {
      email,
      password: 'Test1234!',
      firstName: 'CRM',
      lastName: 'Test',
      tenantName: `CRMTenant-${Date.now()}`,
    });
    if (reg.status !== 201) { fail('Register', reg.body); proc.kill(); process.exit(1); }
    pass('Register user');

    const login = await req('POST', '/api/v1/auth/login', {
      email: reg.body.user.email,
      password: 'Test1234!',
    });
    if (login.status !== 200) { fail('Login', login.body); proc.kill(); process.exit(1); }
    pass('Login');
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    const rest = await req('POST', '/api/v1/restaurants', {
      name: 'CRM Rest', slug: `crm-rest-${Date.now()}`,
    }, auth);
    if (rest.status !== 201) { fail('Create restaurant', rest.body); proc.kill(); process.exit(1); }
    pass('Create restaurant');

    const cust = await req('POST', '/api/v1/customers', {
      firstName: 'Jane', lastName: 'Doe',
      email: `jane-${Date.now()}@test.com`,
      source: 'CRM_TEST', tags: ['crm'],
    }, auth);
    if (cust.status !== 201) { fail('Create customer', cust.body); proc.kill(); process.exit(1); }
    pass('Create customer');
    const custId = cust.body.id;

    // ===================== CRM TIMELINE =====================

    const tlEntry = await req('POST', `/api/v1/crm/customers/${custId}/timeline`, {
      type: 'NOTE_ADDED',
      title: 'Called customer',
      description: 'Discussed new menu items',
      metadata: { agent: 'John' },
    }, auth);
    tlEntry.status === 201 ? pass('Add timeline entry') : fail('Add timeline entry', tlEntry.body);

    const tlList = await req('GET', `/api/v1/crm/customers/${custId}/timeline`, null, auth);
    (tlList.status === 200 && tlList.body.data && tlList.body.data.length === 1)
      ? pass('Get timeline (1 entry)') : fail('Get timeline', tlList.body);

    const tlFiltered = await req('GET', `/api/v1/crm/customers/${custId}/timeline?type=NOTE_ADDED`, null, auth);
    tlFiltered.status === 200 ? pass('Filter timeline by type') : fail('Filter timeline', tlFiltered.status);

    // ===================== COMMUNICATION TEMPLATES =====================

    const tpl = await req('POST', '/api/v1/crm/templates', {
      name: 'Welcome Email',
      channel: 'EMAIL',
      subject: 'Welcome {{name}}!',
      body: '<h1>Welcome</h1>',
      variables: ['name'],
    }, auth);
    tpl.status === 201 ? pass('Create communication template') : fail('Create template', tpl.body);
    const tplId = tpl.body.id;

    const tplList = await req('GET', '/api/v1/crm/templates', null, auth);
    const tplListArr = Array.isArray(tplList.body) ? tplList.body : (tplList.body.data || []);
    (tplList.status === 200 && tplListArr.length >= 1)
      ? pass('List templates') : fail('List templates', tplList.body);

    const tplGet = await req('GET', `/api/v1/crm/templates/${tplId}`, null, auth);
    (tplGet.status === 200 && tplGet.body.name === 'Welcome Email')
      ? pass('Get template') : fail('Get template', tplGet.body);

    const tplUpd = await req('PUT', `/api/v1/crm/templates/${tplId}`, { name: 'Welcome Updated' }, auth);
    (tplUpd.status === 200 && tplUpd.body.name === 'Welcome Updated')
      ? pass('Update template') : fail('Update template', tplUpd.body);

    const tplDel = await req('DELETE', `/api/v1/crm/templates/${tplId}`, null, auth);
    tplDel.status === 200 ? pass('Delete template') : fail('Delete template', tplDel.status);

    // ===================== COMMUNICATION LOGS =====================

    const comm = await req('POST', '/api/v1/crm/communications', {
      customerId: custId,
      channel: 'EMAIL',
      recipient: cust.body.email,
      subject: 'Special Offer',
      body: 'Check out our new items!',
    }, auth);
    comm.status === 201 ? pass('Send communication') : fail('Send communication', comm.body);
    const commId = comm.body.id || (comm.body.data && comm.body.data.id);

    const commList = await req('GET', '/api/v1/crm/communications', null, auth);
    commList.status === 200 ? pass('List communications') : fail('List communications', commList.status);

    if (commId) {
      const commStatus = await req('PUT', `/api/v1/crm/communications/${commId}/status`, { status: 'DELIVERED' }, auth);
      commStatus.status === 200 ? pass('Update communication status') : fail('Update comm status', commStatus.body);
    }

    // ===================== EVENT RULES =====================

    const rule = await req('POST', '/api/v1/crm/event-rules', {
      name: 'Birthday Greeting',
      event: 'CUSTOMER_BIRTHDAY',
      condition: {},
      action: { type: 'SEND_EMAIL', config: { template: 'birthday' } },
      isActive: true,
      description: 'Send birthday email',
    }, auth);
    rule.status === 201 ? pass('Create event rule') : fail('Create event rule', rule.body);
    const ruleId = rule.body.id;

    const ruleList = await req('GET', '/api/v1/crm/event-rules', null, auth);
    const ruleListArr = Array.isArray(ruleList.body) ? ruleList.body : (ruleList.body.data || []);
    (ruleList.status === 200 && ruleListArr.length >= 1)
      ? pass('List event rules') : fail('List event rules', ruleList.body);

    const ruleGet = await req('GET', `/api/v1/crm/event-rules/${ruleId}`, null, auth);
    (ruleGet.status === 200 && ruleGet.body.name === 'Birthday Greeting')
      ? pass('Get event rule') : fail('Get event rule', ruleGet.body);

    const ruleUpd = await req('PUT', `/api/v1/crm/event-rules/${ruleId}`, { description: 'Updated' }, auth);
    (ruleUpd.status === 200 && ruleUpd.body.description === 'Updated')
      ? pass('Update event rule') : fail('Update event rule', ruleUpd.body);

    const ruleDel = await req('DELETE', `/api/v1/crm/event-rules/${ruleId}`, null, auth);
    ruleDel.status === 200 ? pass('Delete event rule') : fail('Delete event rule', ruleDel.status);

    // ===================== EVENT LOGS =====================

    const evtLogs = await req('GET', '/api/v1/crm/event-logs', null, auth);
    evtLogs.status === 200 ? pass('List event logs') : fail('List event logs', evtLogs.status);

    // ===================== CRM ANALYTICS =====================

    const crmAnalytics = await req('GET', '/api/v1/crm/analytics', null, auth);
    crmAnalytics.status === 200 ? pass('CRM analytics') : fail('CRM analytics', crmAnalytics.status);

    // ===================== CAMPAIGNS =====================

    const camp = await req('POST', '/api/v1/campaigns', {
      name: 'Summer Sale',
      description: 'Summer promotion campaign',
      type: 'EMAIL',
      status: 'DRAFT',
      startsAt: '2026-08-01T00:00:00Z',
      endsAt: '2026-08-31T00:00:00Z',
      budget: 5000,
      template: {
        channel: 'EMAIL',
        subject: 'Summer Sale {{name}}!',
        body: '<p>Summer sale body</p>',
      },
      targeting: {
        customerIds: [custId],
      },
    }, auth);
    camp.status === 201 ? pass('Create campaign') : fail('Create campaign', camp.body);
    const campId = camp.body.id || (camp.body.data && camp.body.data.id);

    const campList = await req('GET', '/api/v1/campaigns', null, auth);
    campList.status === 200 ? pass('List campaigns') : fail('List campaigns', campList.status);

    const campGet = await req('GET', `/api/v1/campaigns/${campId}`, null, auth);
    campGet.status === 200 ? pass('Get campaign') : fail('Get campaign', campGet.status);

    const campStats = await req('GET', '/api/v1/campaigns/stats', null, auth);
    campStats.status === 200 ? pass('Campaign stats') : fail('Campaign stats', campStats.status);

    const campUpd = await req('PUT', `/api/v1/campaigns/${campId}`, { description: 'Updated summer sale' }, auth);
    campUpd.status === 200 ? pass('Update campaign') : fail('Update campaign', campUpd.body);

    if (campId) {
      const campAnalytics = await req('GET', `/api/v1/campaigns/${campId}/analytics`, null, auth);
      campAnalytics.status === 200 ? pass('Campaign analytics') : fail('Campaign analytics', campAnalytics.status);
    }

    // POST returns 201 by default in NestJS
    if (campId) {
      const campApprove = await req('POST', `/api/v1/campaigns/${campId}/approve`, { approved: true, reason: 'Looks good' }, auth);
      campApprove.status === 201 ? pass('Approve campaign') : fail('Approve campaign', campApprove.body);
    }

    if (campId) {
      const campExec = await req('POST', `/api/v1/campaigns/${campId}/execute`, null, auth);
      campExec.status === 201 ? pass('Execute campaign') : fail('Execute campaign', campExec.body);
    }

    if (campId) {
      const campPause = await req('POST', `/api/v1/campaigns/${campId}/pause`, null, auth);
      campPause.status === 201 ? pass('Pause campaign') : fail('Pause campaign', campPause.body);
    }

    // ===================== PROMOTIONS =====================

    const prom = await req('POST', '/api/v1/promotions', {
      code: `SUMMER${Date.now()}`,
      name: 'Summer Discount',
      description: '10% off everything',
      type: 'PERCENTAGE',
      value: 10,
      status: 'ACTIVE',
      minOrderAmount: 20,
      usageLimit: 100,
      usagePerCustomer: 1,
    }, auth);
    prom.status === 201 ? pass('Create promotion') : fail('Create promotion', prom.body);
    const promId = prom.body.id || (prom.body.data && prom.body.data.id);
    const promCode = prom.body.code || (prom.body.data && prom.body.data.code);

    const promCodeGet = await req('GET', `/api/v1/promotions/code/${promCode}`, null, auth);
    promCodeGet.status === 200 ? pass('Get promotion by code') : fail('Get promotion by code', promCodeGet.status);

    const promGet = await req('GET', `/api/v1/promotions/${promId}`, null, auth);
    promGet.status === 200 ? pass('Get promotion') : fail('Get promotion', promGet.status);

    const promStats = await req('GET', '/api/v1/promotions/stats', null, auth);
    promStats.status === 200 ? pass('Promotion stats') : fail('Promotion stats', promStats.status);

    const promList = await req('GET', '/api/v1/promotions', null, auth);
    promList.status === 200 ? pass('List promotions') : fail('List promotions', promList.status);

    const promValidate = await req('POST', '/api/v1/promotions/validate', {
      code: promCode,
      customerId: custId,
      orderAmount: 50,
    }, auth);
    promValidate.status === 201 ? pass('Validate promotion') : fail('Validate promotion', promValidate.body);

    const promUse = await req('POST', '/api/v1/promotions/use', {
      code: promCode,
      customerId: custId,
      orderAmount: 50,
      orderId: 'test-order-123',
    }, auth);
    promUse.status === 201 ? pass('Use promotion') : fail('Use promotion', promUse.body);

    const promUpd = await req('PUT', `/api/v1/promotions/${promId}`, { description: 'Updated discount' }, auth);
    promUpd.status === 200 ? pass('Update promotion') : fail('Update promotion', promUpd.body);

    // ===================== VALIDATION / ERROR HANDLING =====================

    const badProm = await req('POST', '/api/v1/promotions', { code: 'BAD', name: '' }, auth);
    badProm.status === 400 ? pass('Validation: empty promotion name') : fail('Validation: empty promotion', badProm.status);

    const noAuthReq = await req('GET', '/api/v1/crm/templates');
    noAuthReq.status === 401 ? pass('No auth returns 401') : fail('No auth', noAuthReq.status);

    const notFound = await req('GET', '/api/v1/promotions/nonexistent-id', null, auth);
    notFound.status === 404 ? pass('Promotion 404') : fail('Promotion 404', notFound.status);

    // ===================== SOFT DELETE =====================

    if (campId) {
      const campDel = await req('DELETE', `/api/v1/campaigns/${campId}`, null, auth);
      campDel.status === 200 ? pass('Soft delete campaign') : fail('Delete campaign', campDel.status);
    }

    const promDel = await req('DELETE', `/api/v1/promotions/${promId}`, null, auth);
    promDel.status === 200 ? pass('Soft delete promotion') : fail('Delete promotion', promDel.status);

  } catch (e) {
    fail('Exception', e.message);
  }

  proc.kill();

  console.log('\n========== PHASE 4 MILESTONE 2: CRM & CAMPAIGNS ==========\n');
  console.log(`  \x1b[32mPASS\x1b[0m: ${passed}  \x1b[31mFAIL\x1b[0m: ${failed}  Total: ${passed + failed}`);
  const pct = passed + failed > 0 ? Math.round(passed / (passed + failed) * 100) : 0;
  console.log(`  Score: ${pct}%\n`);
}

main().catch(console.error);
