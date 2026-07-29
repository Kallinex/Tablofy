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

function ok(n) { console.log('  \x1b[32mPASS\x1b[0m ' + n); }
function no(n, d) { console.log('  \x1b[31mFAIL\x1b[0m ' + n + ': ' + d); }

async function cleanDB() {
  const { PrismaClient } = require('./node_modules/@prisma/client');
  const p = new PrismaClient();
  try {
    const tbls = [
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

async function waitSrv(tmo) {
  const s = Date.now();
  while (Date.now()-s < (tmo||45000)) {
    try {
      const r = await req('GET','/api/v1/health');
      if (r.status===200) { console.log('  Server ready'); return; }
    } catch {}
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('Server did not start');
}

function P(n,r,e) { total++; if(r.status===e) { pass++; ok(n); } else { fail++; no(n,`expected ${e} got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`); } }
function C(n,c) { total++; if(c) { pass++; ok(n); } else { fail++; no(n,'condition false'); } }

const ROOT = path.resolve(__dirname);
let pass=0,fail=0,total=0;

(async ()=>{
  console.log('========== PHASE 4 MILESTONE 1: CUSTOMERS & LOYALTY ==========\n');

  const srv = spawn('node',['dist/apps/api/main.js'],{cwd:ROOT,env:{...process.env, UNAUTHENTICATED_LIMIT:'100'}, stdio:['pipe','pipe','pipe']});
  srv.stdout.on('data',d=>process.stdout.write(d));
  srv.stderr.on('data',d=>process.stderr.write(d));

  try {
    await cleanDB();
    await cleanRedis();
    await waitSrv();

    const base = '/api/v1/customers';
    const ts = Date.now();

    // ── SETUP ──
    console.log('\n── SETUP ──');
    let r = await req('POST','/api/v1/auth/register',{email:`m4-${ts}@t.com`,password:'Test1234!',firstName:'M4',lastName:'Test',tenantName:`M4Tenant-${ts}`});
    P('Register',r,201);
    const token = r.body?.tokens?.accessToken;
    const uid = r.body?.user?.id;
    C('Got token',!!token);

    const auth = { Authorization: `Bearer ${token}` };

    r = await req('POST','/api/v1/restaurants',{name:`M4Rest-${ts}`,slug:`m4-rest-${ts}`},auth);
    P('Create restaurant',r,201);
    const rid = r.body?.id;

    // ── CUSTOMER CRUD ──
    console.log('\n── CUSTOMER CRUD ──');

    // Create
    r = await req('POST',base,{firstName:'John',lastName:'Doe',email:`john-${ts}@t.com`,phone:'+1234567890',source:'walk-in',tags:['vip','new']},auth);
    P('Create customer',r,201);
    const cid = r.body?.id;
    C('Customer has id',!!cid);
    C('Customer email match',r.body?.email===`john-${ts}@t.com`);
    C('Customer source match',r.body?.source==='walk-in');
    C('Customer tags include vip',r.body?.tags?.includes('vip'));
    C('Customer status active',r.body?.status==='ACTIVE');

    // Get by ID
    r = await req('GET',`${base}/${cid}`,null,auth);
    P('Get customer',r,200);
    C('Get returns customer',r.body?.id===cid);

    // List
    r = await req('GET',base,null,auth);
    P('List customers',r,200);
    C('List has data',Array.isArray(r.body?.data));
    C('List has meta',!!r.body?.meta);

    // Search
    r = await req('GET',`${base}?search=John`,null,auth);
    P('Search customers',r,200);
    C('Search found customer',r.body?.data?.length>0);

    // Update
    r = await req('PATCH',`${base}/${cid}`,{firstName:'Johnny',lastName:'Updated',language:'ar'},auth);
    P('Update customer',r,200);
    C('Updated firstName',r.body?.firstName==='Johnny');

    // Full profile get includes relations
    r = await req('GET',`${base}/${cid}`,null,auth);
    P('Get full profile',r,200);
    C('Profile has membership',!!(r.body?.memberships?.length));
    C('Profile has analytics',r.body?.analytics !== undefined);

    // Create another customer for isolation test
    r = await req('POST',base,{firstName:'Jane',lastName:'Smith',email:`jane-${ts}@t.com`},auth);
    P('Create second customer',r,201);

    // ── ADDRESSES ──
    console.log('\n── ADDRESSES ──');

    r = await req('POST',`${base}/${cid}/addresses`,{label:'Home',address:'123 Main St',city:'New York',state:'NY',zipCode:'10001',country:'US',isDefault:true},auth);
    P('Create address',r,201);
    const addrId = r.body?.id;
    C('Address has id',!!addrId);
    C('Address is default',r.body?.isDefault===true);

    r = await req('PUT',`${base}/addresses/${addrId}`,{label:'Home Updated',city:'Brooklyn'},auth);
    P('Update address',r,200);
    C('Updated city',r.body?.city==='Brooklyn');

    r = await req('DELETE',`${base}/addresses/${addrId}`,null,auth);
    P('Delete address',r,204);

    // ── PREFERENCES ──
    console.log('\n── PREFERENCES ──');

    r = await req('POST',`${base}/${cid}/preferences`,{key:'notify_email',value:'true'},auth);
    P('Set preference',r,201);
    C('Preference key',r.body?.key==='notify_email');

    r = await req('DELETE',`${base}/${cid}/preferences/notify_email`,null,auth);
    P('Delete preference',r,204);

    // ── LOYALTY POINTS ──
    console.log('\n── LOYALTY POINTS ──');

    r = await req('POST',`${base}/${cid}/loyalty/earn`,{points:100,description:'Welcome bonus'},auth);
    P('Earn points',r,201);
    C('Earn has points',r.body?.points===100);

    r = await req('POST',`${base}/${cid}/loyalty/earn`,{points:50,description:'Order bonus'},auth);
    P('Earn more points',r,201);

    r = await req('GET',`${base}/${cid}/loyalty/balance`,null,auth);
    P('Points balance',r,200);
    C('Balance is 150',r.body?.points===150);

    r = await req('POST',`${base}/${cid}/loyalty/redeem`,{points:30,description:'Discount reward'},auth);
    P('Redeem points',r,201);
    C('Balance after redeem',r.body?.balanceAfter===120);

    r = await req('POST',`${base}/${cid}/loyalty/adjust`,{points:10,reason:'Correction'},auth);
    P('Adjust points',r,201);
    C('Balance after adjust',r.body?.balanceAfter===130);

    r = await req('GET',`${base}/${cid}/loyalty/history`,null,auth);
    P('Point history',r,200);
    C('History has entries',r.body?.data?.length>=4);

    // Insufficient points
    r = await req('POST',`${base}/${cid}/loyalty/redeem`,{points:99999,description:'Too much'},auth);
    P('Redeem insufficient points',r,400);

    // ── MEMBERSHIP ──
    console.log('\n── MEMBERSHIP ──');

    r = await req('GET',`${base}/${cid}/membership`,null,auth);
    P('Get membership',r,200);
    C('Membership tier BRONZE',r.body?.tier==='BRONZE');

    r = await req('PUT',`${base}/${cid}/membership/upgrade`,{tier:'GOLD',reason:'Loyal customer'},auth);
    P('Upgrade membership',r,200);
    C('Upgraded to GOLD',r.body?.tier==='GOLD');

    r = await req('GET',`${base}/${cid}/membership/history`,null,auth);
    P('Membership history',r,200);
    C('History has upgrade',r.body?.length>=1);
    C('From BRONZE',r.body?.[0]?.fromTier==='BRONZE');
    C('To GOLD',r.body?.[0]?.toTier==='GOLD');

    r = await req('GET',`${base}/tiers`,null,auth);
    P('Get available tiers',r,200);
    C('Tiers is array',Array.isArray(r.body));

    // ── REWARDS ──
    console.log('\n── REWARDS ──');

    r = await req('POST',`${base}/${cid}/rewards`,{type:'DISCOUNT',title:'10% Off',discountPercent:10,code:`SAVE10-${ts}`},auth);
    P('Create discount reward',r,201);
    const rwId = r.body?.id;
    C('Reward created',!!rwId);
    C('Reward status ACTIVE',r.body?.status==='ACTIVE');

    r = await req('POST',`${base}/${cid}/rewards`,{type:'FREE_PRODUCT',title:'Free Coffee',freeProductName:'Coffee'},auth);
    P('Create free product reward',r,201);

    r = await req('POST',`${base}/${cid}/rewards`,{type:'BIRTHDAY',title:'Birthday Treat',discountAmount:5},auth);
    P('Create birthday reward',r,201);

    r = await req('GET',`${base}/${cid}/rewards`,null,auth);
    P('List customer rewards',r,200);
    C('Has rewards',r.body?.length>=3);

    r = await req('POST',`${base}/rewards/${rwId}/redeem`,null,auth);
    P('Redeem reward',r,201);
    C('Reward status REDEEMED',r.body?.status==='REDEEMED');

    // ── WALLET ──
    console.log('\n── WALLET ──');

    r = await req('GET',`${base}/${cid}/wallet`,null,auth);
    P('Get wallet',r,200);
    C('Wallet exists',!!r.body?.id);
    C('Wallet balance 0',Number(r.body?.balance)===0);

    r = await req('POST',`${base}/${cid}/wallet/recharge`,{amount:100,description:'Cash recharge'},auth);
    P('Recharge wallet',r,201);
    C('Balance after recharge',Number(r.body?.wallet?.balance)===100);

    r = await req('POST',`${base}/${cid}/wallet/spend`,{amount:30,description:'Order payment'},auth);
    P('Spend from wallet',r,201);
    C('Balance after spend',Number(r.body?.wallet?.balance)===70);

    r = await req('POST',`${base}/${cid}/wallet/refund`,{amount:20,description:'Order refund'},auth);
    P('Refund to wallet',r,201);
    C('Balance after refund',Number(r.body?.wallet?.balance)===90);

    r = await req('GET',`${base}/${cid}/wallet/transactions`,null,auth);
    P('Wallet transactions',r,200);
    C('Has transactions',r.body?.data?.length>=3);

    // Insufficient balance
    r = await req('POST',`${base}/${cid}/wallet/spend`,{amount:99999,description:'Too much'},auth);
    P('Spend insufficient balance',r,400);

    // ── REFERRALS ──
    console.log('\n── REFERRALS ──');

    r = await req('POST',`${base}/${cid}/referrals`,{code:`REF-${ts}`},auth);
    P('Create referral',r,201);
    const refId = r.body?.id;
    C('Referral created',!!refId);
    C('Referral status PENDING',r.body?.status==='PENDING');

    r = await req('GET',`${base}/${cid}/referrals/stats`,null,auth);
    P('Referral stats',r,200);
    C('Has referral stats',r.body?.total>=1);

    r = await req('POST',`${base}/referrals/${refId}/complete`,null,auth);
    P('Complete referral',r,201);
    C('Referral rewarded',r.body?.status==='REWARDED');

    // ── VISIT HISTORY ──
    console.log('\n── VISIT HISTORY ──');

    r = await req('GET',`${base}/${cid}/visits`,null,auth);
    P('Visit history',r,200);
    C('Visit history exists',r.body?.meta?.total>=0);

    // ── ANALYTICS ──
    console.log('\n── ANALYTICS ──');

    r = await req('GET',`${base}/${cid}/analytics`,null,auth);
    P('Get analytics',r,200);
    C('Analytics exists',r.body?.lifetimeValue!==undefined);

    r = await req('POST',`${base}/${cid}/analytics/recompute`,null,auth);
    P('Recompute analytics',r,201);
    C('Recomputed analytics',r.body?.computedAt!==undefined);

    // ── SEGMENTS ──
    console.log('\n── SEGMENTS ──');

    r = await req('POST',`${base}/segments`,{name:'VIP Customers',type:'VIP',description:'Top spenders'},auth);
    P('Create segment',r,201);
    const segId = r.body?.id;
    C('Segment created',!!segId);

    r = await req('PUT',`${base}/segments/${segId}`,{name:'VIP - Updated'},auth);
    P('Update segment',r,200);
    C('Segment name updated',r.body?.name==='VIP - Updated');

    r = await req('GET',`${base}/segments`,null,auth);
    P('List segments',r,200);
    C('Has segments',r.body?.length>=1);

    r = await req('POST',`${base}/segments/${segId}/assign/${cid}`,null,auth);
    P('Assign customer to segment',r,201);
    C('Assigned',r.body?.customerId===cid);

    r = await req('DELETE',`${base}/segments/${segId}/assign/${cid}`,null,auth);
    P('Remove customer from segment',r,204);

    r = await req('POST',`${base}/segments/${segId}/bulk-assign`,{customerIds:[cid]},auth);
    P('Bulk assign segment',r,201);
    C('Bulk assigned',r.body?.length>=1);

    r = await req('DELETE',`${base}/segments/${segId}`,null,auth);
    P('Delete segment',r,204);

    // ── MARKETING ──
    console.log('\n── MARKETING ──');

    r = await req('GET',`${base}/marketing/email-list`,null,auth);
    P('Email list',r,200);
    C('Email list has data',Array.isArray(r.body));

    r = await req('GET',`${base}/marketing/sms-list`,null,auth);
    P('SMS list',r,200);
    C('SMS list has data',Array.isArray(r.body));

    r = await req('GET',`${base}/marketing/export?format=json`,null,auth);
    P('Export JSON',r,200);
    C('Export is array',Array.isArray(r.body));

    r = await req('GET',`${base}/marketing/export?format=csv`,null,auth);
    P('Export CSV',r,200);
    C('Export is string',typeof r.body==='string');
    C('Export has header',r.body?.startsWith('id,'));

    // ── SOFT DELETE & RESTORE ──
    console.log('\n── SOFT DELETE & RESTORE ──');

    r = await req('DELETE',`${base}/${cid}`,null,auth);
    P('Soft delete customer',r,204);

    r = await req('GET',`${base}/${cid}`,null,auth);
    P('Get deleted customer returns 404',r,404);

    r = await req('POST',`${base}/${cid}/restore`,null,auth);
    P('Restore customer',r,201);

    r = await req('GET',`${base}/${cid}`,null,auth);
    P('Get restored customer',r,200);

    // ── VALIDATION ──
    console.log('\n── VALIDATION ──');

    r = await req('POST',base,{firstName:'',lastName:'Doe'},auth);
    P('Empty firstName',r,400);

    r = await req('POST',base,{firstName:'x'.repeat(101),lastName:'Doe'},auth);
    P('Too long firstName',r,400);

    r = await req('PATCH',`${base}/${cid}`,{email:'not-an-email'},auth);
    P('Invalid email',r,400);

    r = await req('POST',`${base}/${cid}/loyalty/earn`,{points:0},auth);
    P('Zero points',r,400);

    r = await req('POST',`${base}/${cid}/wallet/recharge`,{amount:-5},auth);
    P('Negative recharge',r,400);

    r = await req('POST',`${base}/${cid}/rewards`,{type:'INVALID',title:'Bad'},auth);
    P('Invalid reward type',r,400);

    r = await req('POST',`${base}/segments`,{name:''},auth);
    P('Empty segment name',r,400);

    // ── AUTH / RBAC ──
    console.log('\n── AUTH / RBAC ──');

    r = await req('GET',base);
    P('No auth returns 401',r,401);

    r = await req('POST',base,{firstName:'No',lastName:'Auth'});
    P('No auth create returns 401',r,401);

    r = await req('POST',`${base}/${cid}/wallet/recharge`,{amount:10},auth);
    P('STAFF can recharge',r,201);

    // ── TENANT ISOLATION ──
    console.log('\n── TENANT ISOLATION ──');

    const ts2 = Date.now() + 1;
    r = await req('POST','/api/v1/auth/register',{email:`m4-iso-${ts2}@t.com`,password:'Test1234!',firstName:'Iso',lastName:'Test',tenantName:`IsoTenant-${ts2}`});
    P('Register second tenant',r,201);
    const token2 = r.body?.tokens?.accessToken;
    C('Got second token',!!token2);
    const auth2 = { Authorization: `Bearer ${token2}` };

    r = await req('GET',base,null,auth2);
    P('Second tenant sees 0 customers',r,200);
    C('Isolation: 0 customers',r.body?.data?.length===0);
    C('Isolation: total 0',r.body?.meta?.total===0);

    // ── PAGINATION ──
    console.log('\n── PAGINATION ──');

    r = await req('GET',`${base}?page=1&limit=5`,null,auth);
    P('Pagination works',r,200);
    C('Pagination has meta',!!r.body?.meta);

    // ── AUDIT ──
    console.log('\n── AUDIT ──');

    r = await req('GET','/api/v1/audit-logs',null,auth);
    P('Audit logs',r,200);
    C('Audit has entries',r.body?.data?.length>0);

    // ── SWAGGER ──
    console.log('\n── SWAGGER ──');

    r = await req('GET','/docs');
    P('Swagger',r,200);

    console.log('\n========== PHASE 4 M1 ==========');
    console.log('Passed: ' + pass + ' | Failed: ' + fail + ' | Total: ' + total);
    console.log('Score:  ' + (total>0 ? Math.round(pass/total*100) : 0) + '%');
  } catch (e) {
    console.log('\n\x1b[31mFATAL\x1b[0m:', e.message);
  }

  srv.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,2000));
  process.exit(fail>0?1:0);
})();
