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
    const tbls = ['AuditLog','KitchenTicket','OrderItemModifier','OrderItem','OrderNote','Payment','OrderStatusHistory','Order','ProductImage','ProductAvailability','ProductIngredient','ProductVariant','ProductAllergen','ProductTagAssignment','Product','MenuCategory','Modifier','ModifierGroup','VariantGroup','Tag','Allergen','NutritionalInfo','BusinessException','BusinessHour','BranchSetting','RestaurantSetting','Branch','Restaurant','VerificationToken','Invitation','Session','RefreshToken','Subscription','User','Tenant'];
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
    for (const pat of ['session:*','blacklist:*','user_sessions:*','order_cache:*','menu_category:*','product:*']) {
      const k = await r.keys(pat); if (k.length) await r.del(...k);
    }
    console.log('  Redis cleaned');
  } catch (e) { console.log('  Redis note:', e.message); }
  finally { r.disconnect(); }
}
async function waitSrv(tmo) {
  const s = Date.now();
  while (Date.now()-s < (tmo||45000)) {
    try { if ((await req('GET','/api/v1/health')).status===200) return true; } catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  return false;
}

(async () => {
  console.log('Cleaning...');
  await cleanDB(); await cleanRedis();
  const ROOT = 'D:\\New folder (8)\\tablofy';
  console.log('Starting server...');
  const ls = require('fs').createWriteStream(path.join(ROOT,'server-orders.log'));
  const srv = spawn('node',['dist/apps/api/main.js'],{cwd:ROOT,stdio:['pipe','pipe','pipe']});
  srv.stdout.on('data',d=>ls.write(d)); srv.stderr.on('data',d=>ls.write(d));
  if (!(await waitSrv())) { console.log('FAIL: server'); srv.kill(); process.exit(1); }
  console.log('Ready\n');

  let pass=0, fail=0, total=0;
  const P = (n,r,e) => { total++; (r.status===e ? (pass++, ok(n+' ['+r.status+']')) : (fail++, no(n, 'got '+r.status+' exp '+e+' | '+JSON.stringify(r.body).substring(0,200)))); };
  const C = (n,c) => { total++; (c ? (pass++, ok(n)) : (fail++, no(n,'false'))); };
  const R = (rid) => '/api/v1/restaurants/' + rid;
  let ts, aid, bid, tok, auth;

  try {
    ts = Date.now();
    console.log('── SETUP ──');
    let r = await req('POST','/api/v1/auth/register', { email:'o-'+ts+'@t.com', password:'Order123!', firstName:'Ord', lastName:'Tst', tenantName:'OT-'+ts });
    P('Register', r, 201); tok = r.body.tokens?.accessToken;
    r = await req('POST','/api/v1/auth/login', { email:'o-'+ts+'@t.com', password:'Order123!' });
    P('Login', r, 200); auth = { Authorization:'Bearer '+(r.body.tokens?.accessToken||tok) };
    r = await req('POST','/api/v1/restaurants', { name:'OR', slug:'or-'+ts }, auth);
    P('Restaurant', r, 201); aid = r.body.id;
    r = await req('POST','/api/v1/restaurants/'+aid+'/menu-categories', { name:'Cat', sortOrder:1 }, auth);
    P('Category', r, 201); const catId = r.body.id;
    r = await req('POST','/api/v1/restaurants/'+aid+'/products', { name:'P1', basePrice:15.99, menuCategoryId:catId, sku:'P1-'+ts }, auth);
    P('Product1', r, 201); const p1 = r.body.id;
    r = await req('POST','/api/v1/restaurants/'+aid+'/products', { name:'P2', basePrice:9.99, menuCategoryId:catId, sku:'P2-'+ts }, auth);
    P('Product2', r, 201); const p2 = r.body.id;
    r = await req('POST','/api/v1/restaurants/'+aid+'/branches', { name:'Main', slug:'main-'+ts, address:'123' }, auth);
    P('Branch', r, 201); bid = r.body.id;

    const base = R(aid);

    // ── CRUD ──
    console.log('\n── CRUD ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 },{ productId:p2, productName:'P2', quantity:1, unitPrice:9.99 }] }, auth);
    P('Create', r, 201); const oid = r.body.id;
    C('DRAFT', r.body.status==='DRAFT'); C('Items', r.body.items?.length===2);

    r = await req('GET', base+'/orders', null, auth); P('List', r, 200); C('In list', r.body.data?.some(o=>o.id===oid));
    r = await req('GET', base+'/orders/'+oid, null, auth); P('Get', r, 200); C('Items2', r.body.items?.length===2);
    r = await req('PUT', base+'/orders/'+oid, { notes:'Upd' }, auth); P('Update', r, 200); C('Notes', r.body.notes==='Upd');

    r = await req('DELETE', base+'/orders/'+oid, null, auth); P('SoftDel', r, 200);
    r = await req('GET', base+'/orders/'+oid, null, auth); C('Deleted404', r.status===404);
    r = await req('GET', base+'/orders', null, auth); C('Excluded', !r.body.data?.some(o=>o.id===oid));
    r = await req('POST', base+'/orders/'+oid+'/restore', null, auth); P('Restore', r, 200);
    r = await req('GET', base+'/orders/'+oid, null, auth); C('NoDelAt', !r.body.deletedAt);
    r = await req('GET', base+'/orders', null, auth); C('Back', r.body.data?.some(o=>o.id===oid));

    // ── NOTES ──
    console.log('\n── NOTES ──');
    r = await req('POST', base+'/orders/'+oid+'/notes', { content:'Rush!', type:'CUSTOMER' }, auth);
    P('AddNote', r, 201); C('Content', r.body.content==='Rush!');

    // ── STATE MACHINE ──
    console.log('\n── STATE MACHINE ──');
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'PENDING' }, auth); P('DRAFT->PENDING', r, 200); C('st:PENDING', r.body.status==='PENDING');
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'CONFIRMED' }, auth); P('PENDING->CONFIRMED', r, 200); C('st:CONFIRMED', r.body.status==='CONFIRMED');
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'IN_PREPARATION' }, auth); P('->IN_PREP', r, 200); C('st:IN_PREP', r.body.status==='IN_PREPARATION');
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'READY' }, auth); P('->READY', r, 200); C('st:READY', r.body.status==='READY');
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'SERVED' }, auth); P('->SERVED', r, 200); C('st:SERVED', r.body.status==='SERVED');
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'COMPLETED' }, auth); P('->COMPLETED', r, 200); C('st:COMPLETED', r.body.status==='COMPLETED');
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'DRAFT' }, auth); P('COMPLETED->DRAFT=400', r, 400);
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'COMPLETED' }, auth); P('Same=400', r, 400);

    // ── VOIDED ──
    console.log('\n── VOIDED ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:1, unitPrice:15.99 }] }, auth); P('CreateVoid', r, 201);
    const v1 = r.body.id;
    r = await req('POST', base+'/orders/'+v1+'/status', { status:'VOIDED', reason:'Cancelled' }, auth); P('DRAFT->VOIDED', r, 200); C('Void', r.body.status==='VOIDED');

    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:1, unitPrice:15.99 }] }, auth); P('CreateVoid2', r, 201);
    const v2 = r.body.id;
    await req('POST', base+'/orders/'+v2+'/status', { status:'PENDING' }, auth);
    r = await req('POST', base+'/orders/'+v2+'/status', { status:'CONFIRMED' }, auth); C('OK', r.status===200);
    r = await req('POST', base+'/orders/'+v2+'/status', { status:'VOIDED' }, auth); P('CONFIRMED->VOIDED', r, 200); C('Void', r.body.status==='VOIDED');

    // ── ITEM VOID ──
    console.log('\n── ITEM VOID ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 },{ productId:p2, productName:'P2', quantity:1, unitPrice:9.99 }] }, auth); P('CreateItemVoid', r, 201);
    const vi = r.body.id, ii = r.body.items[0].id;
    r = await req('POST', base+'/orders/'+vi+'/items/'+ii+'/void', { reason:'OOS' }, auth); P('VoidItem', r, 200);
    r = await req('GET', base+'/orders/'+vi, null, auth); C('VoidedAt', !!r.body.items?.find(x=>x.id===ii)?.voidedAt);

    // ── LOCKING ──
    console.log('\n── LOCKING ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:1, unitPrice:15.99 }] }, auth); P('LockCreate', r, 201);
    const lk = r.body.id;
    r = await req('POST', base+'/orders/'+lk+'/status', { status:'PENDING' }, auth); P('Lock1', r, 200);
    r = await req('POST', base+'/orders/'+lk+'/status', { status:'CONFIRMED' }, auth); P('Lock2', r, 200);

    // ── DISCOUNTS ──
    console.log('\n── DISCOUNTS ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 }] }, auth); P('DiscCreate', r, 201);
    const dd = r.body.id;
    r = await req('POST', base+'/orders/'+dd+'/discount', { discountType:'PERCENTAGE', value:10, reason:'10%' }, auth); P('%Disc', r, 200);
    C('Amt>0', Number(r.body.discountAmount)>0);
    r = await req('DELETE', base+'/orders/'+dd+'/discount', null, auth); P('RemDisc', r, 200);
    C('Amt=0', r.body.discountAmount==0||r.body.discountAmount=='0');
    r = await req('POST', base+'/orders/'+dd+'/discount', { discountType:'FIXED', value:5, reason:'$5' }, auth); P('FixDisc', r, 200);
    C('Fix>0', Number(r.body.discountAmount)>0);

    // ── PAYMENTS ──
    console.log('\n── PAYMENTS ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 }] }, auth); P('PayCreate', r, 201);
    const po = r.body.id;
    await req('POST', base+'/orders/'+po+'/status', { status:'PENDING' }, auth);
    await req('POST', base+'/orders/'+po+'/status', { status:'CONFIRMED' }, auth);
    r = await req('POST', base+'/orders/'+po+'/payments', { method:'CASH', amount:31.98 }, auth); P('AddPay', r, 201);
    C('PayRec', r.body.id&&Number(r.body.amount)===31.98);
    const pm = r.body.id;
    r = await req('POST', base+'/orders/'+po+'/payments/'+pm+'/refund', { reason:'Test' }, auth); P('Refund', r, 200);
    C('Refunded', r.body.status==='REFUNDED');

    // ── SERVICE CHARGE ──
    console.log('\n── SERVICE CHARGE ──');
    r = await req('POST', '/api/v1/restaurants/'+aid+'/service-charges', { name:'StdSC', type:'PERCENTAGE', value:10, isActive:true }, auth);
    if (r.status===201) {
      const sid = r.body.id;
      r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 }] }, auth);
      if (r.status===201) {
        const so = r.body.id;
        r = await req('POST', base+'/orders/'+so+'/service-charge', { serviceChargeId:sid }, auth); P('SC', r, 200); C('SC>0', Number(r.body.serviceChargeAmount)>0);
      }
    }

    // ── TAX ──
    r = await req('POST', '/api/v1/restaurants/'+aid+'/tax-rates', { name:'VAT', rate:0.15, type:'PERCENTAGE', isActive:true }, auth);
    if (r.status===201) {
      const tid = r.body.id;
      r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 }] }, auth);
      if (r.status===201) {
        r = await req('POST', base+'/orders/'+r.body.id+'/tax-rate', { taxRateId:tid }, auth); P('Tax', r, 200); C('Tax>0', Number(r.body.taxAmount)>0);
      }
    }

    // ── SPLIT ──
    console.log('\n── SPLIT ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 },{ productId:p2, productName:'P2', quantity:2, unitPrice:9.99 }] }, auth); P('SplitCreate', r, 201);
    const si = r.body.id, s1 = r.body.items[0].id;
    await req('POST', base+'/orders/'+si+'/status', { status:'PENDING' }, auth);
    r = await req('POST', base+'/orders/'+si+'/split', { items:[{ id:s1, quantity:1 }], newOrderNotes:'Split' }, auth);
    C('SplitOK', r.status===200);

    // ── MERGE ──
    console.log('\n── MERGE ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:1, unitPrice:15.99 }] }, auth); P('MergeA', r, 201);
    const ma = r.body.id;
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p2, productName:'P2', quantity:1, unitPrice:9.99 }] }, auth); P('MergeB', r, 201);
    const mb = r.body.id;
    r = await req('POST', base+'/orders/'+ma+'/merge', { sourceOrderId:mb }, auth); P('Merge', r, 200);
    r = await req('GET', base+'/orders/'+ma, null, auth); C('Items>=2', r.body.items?.length>=2);

    // ── DUPLICATE ──
    console.log('\n── DUPLICATE ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 }] }, auth); P('DupCreate', r, 201);
    const ds = r.body;
    r = await req('POST', base+'/orders/'+ds.id+'/duplicate', null, auth); P('Duplicate', r, 201);
    C('DRAFT', r.body.status==='DRAFT'); C('SameItems', r.body.items?.length===ds.items?.length);

    // ── KITCHEN ──
    console.log('\n── KITCHEN ──');
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 }] }, auth); P('KitCreate', r, 201);
    const ko = r.body.id, ki = r.body.items[0].id;
    await req('POST', base+'/orders/'+ko+'/status', { status:'PENDING' }, auth);
    r = await req('POST', base+'/orders/'+ko+'/status', { status:'CONFIRMED' }, auth); P('Confirm', r, 200);
    r = await req('GET', base+'/orders/'+ko+'/kitchen-tickets', null, auth); P('KTickets', r, 200);
    C('Tickets', Array.isArray(r.body)&&r.body.length>0);
    const tk = r.body[0]?.id;
    r = await req('POST', base+'/orders/'+ko+'/items/'+ki+'/kitchen-status', { kitchenStatus:'PREPARING' }, auth); P('KitStatus', r, 200);
    r = await req('GET', base+'/orders/'+ko, null, auth); C('KSync', r.body.items?.find(x=>x.id===ki)?.kitchenStatus==='PREPARING');
    if (tk) {
      r = await req('POST', base+'/orders/'+ko+'/kitchen-tickets/'+tk+'/status', { kitchenStatus:'PREPARING' }, auth); P('TicketStatus', r, 200);
      C('TSync', r.body.status==='PREPARING');
    }

    // ── AUTH ──
    console.log('\n── AUTH ──');
    r = await req('GET', base+'/orders'); P('NoAuth', r, 401);
    r = await req('GET', base+'/orders/'+oid); P('NoAuthGet', r, 401);

    // ── ISOLATION ──
    console.log('\n── ISOLATION ──');
    r = await req('POST','/api/v1/auth/register', { email:'ot-'+ts+'@t.com', password:'Other123!', firstName:'Oth', lastName:'Tst', tenantName:'OT2-'+ts });
    r = await req('POST','/api/v1/auth/login', { email:'ot-'+ts+'@t.com', password:'Other123!' });
    const oa = { Authorization:'Bearer '+(r.body.tokens?.accessToken) };
    r = await req('GET', base+'/orders', null, oa); C('Isolation', r.body.data?.length===0);

    // ── PAGINATION ──
    console.log('\n── PAGINATION ──');
    r = await req('GET', base+'/orders?page=1&limit=10', null, auth); P('Page', r, 200); C('Data', Array.isArray(r.body.data));

    // ── AUDIT ──
    console.log('\n── AUDIT ──');
    r = await req('GET','/api/v1/audit-logs', null, auth); P('Audit', r, 200);

    // ── HISTORY ──
    console.log('\n── HISTORY ──');
    r = await req('GET', base+'/orders/'+oid, null, auth); C('History', r.body.statusHistory?.length>0);

    // ── VALIDATION ──
    console.log('\n── VALIDATION ──');
    r = await req('POST', base+'/orders', {}, auth); P('Empty', r, 400);
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[] }, auth); P('NoItems', r, 400);
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:'bad', productName:'X', quantity:1, unitPrice:10 }] }, auth); P('BadUUID', r, 400);

    // ── SWAGGER ──
    console.log('\n── SWAGGER ──');
    r = await req('GET','/docs'); P('Swagger', r, 200);

    console.log('\n========== ORDER M1 ==========');
    console.log('Passed: ' + pass + ' | Failed: ' + fail + ' | Total: ' + total);
    console.log('Score:  ' + (total>0 ? Math.round(pass/total*100) : 0) + '%');
  } catch (e) {
    console.log('\n\x1b[31mFATAL\x1b[0m:', e.message);
  }

  srv.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,2000));
  process.exit(fail>0?1:0);
})();
