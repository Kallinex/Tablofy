const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function req(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const hdrs = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
    const opts = { hostname: u.hostname, port: parseInt(u.port) || 3000, path: u.pathname + u.search, method, headers: hdrs };
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
    const tbls = ['KitchenTicketItem','KitchenTicket','KitchenStation','AuditLog','OrderItemModifier','OrderItem','OrderNote','Payment','OrderStatusHistory','Order','ProductImage','ProductAvailability','ProductIngredient','ProductVariant','ProductAllergen','ProductTagAssignment','Product','MenuCategory','Modifier','ModifierGroup','VariantGroup','Tag','Allergen','NutritionalInfo','BusinessException','BusinessHour','BranchSetting','RestaurantSetting','Branch','Restaurant','VerificationToken','Invitation','Session','RefreshToken','Subscription','User','Tenant'];
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
    for (const pat of ['session:*','blacklist:*','user_sessions:*','order_cache:*','menu_category:*','product:*','station:*']) {
      const k = await r.keys(pat); if (k.length) await r.del(...k);
    }
    console.log('  Redis cleaned');
  } catch (e) { console.log('  Redis note:', e.message); }
  finally { r.disconnect(); }
}
async function waitSrv(tmo) {
  const s = Date.now();
  while (Date.now()-s < (tmo||45000)) {
    try { if ((await req('GET','http://localhost:3000/api/v1/health')).status===200) return true; } catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  return false;
}

(async () => {
  console.log('Cleaning...');
  await cleanDB(); await cleanRedis();
  const ROOT = 'D:\\New folder (8)\\tablofy';
  console.log('Starting server...');
  const ls = require('fs').createWriteStream(path.join(ROOT,'server-m2.log'));
  const srv = spawn('node',['dist/apps/api/main.js'],{cwd:ROOT,stdio:['pipe','pipe','pipe']});
  srv.stdout.on('data',d=>ls.write(d)); srv.stderr.on('data',d=>ls.write(d));
  if (!(await waitSrv())) { console.log('FAIL: server'); srv.kill(); process.exit(1); }
  console.log('Ready\n');

  let pass=0, fail=0, total=0;
  const P = (n,r,e) => { total++; (r.status===e ? (pass++, ok(n+' ['+r.status+']')) : (fail++, no(n, 'got '+r.status+' exp '+e+' | '+JSON.stringify(r.body).substring(0,200)))); };
  const C = (n,c) => { total++; (c ? (pass++, ok(n)) : (fail++, no(n,'false'))); };
  const R = (rid) => 'http://localhost:3000/api/v1/restaurants/' + rid + '/kds';
  let ts, aid, bid, tok, auth;

  try {
    ts = Date.now();
    console.log('── SETUP ──');
    let r = await req('POST','http://localhost:3000/api/v1/auth/register', { email:'m2-'+ts+'@t.com', password:'M2Test123!', firstName:'M2', lastName:'Tst', tenantName:'M2-'+ts });
    P('Register', r, 201); tok = r.body.tokens?.accessToken;
    r = await req('POST','http://localhost:3000/api/v1/auth/login', { email:'m2-'+ts+'@t.com', password:'M2Test123!' });
    P('Login', r, 200); auth = { Authorization:'Bearer '+(r.body.tokens?.accessToken||tok) };
    r = await req('POST','http://localhost:3000/api/v1/restaurants', { name:'M2R', slug:'m2r-'+ts }, auth);
    P('Restaurant', r, 201); aid = r.body.id;
    r = await req('POST','http://localhost:3000/api/v1/restaurants/'+aid+'/branches', { name:'Main', slug:'main-'+ts, address:'123' }, auth);
    P('Branch', r, 201); bid = r.body.id;
    r = await req('POST','http://localhost:3000/api/v1/restaurants/'+aid+'/menu-categories', { name:'Cat', sortOrder:1 }, auth);
    P('Category', r, 201); const catId = r.body.id;
    r = await req('POST','http://localhost:3000/api/v1/restaurants/'+aid+'/products', { name:'P1', basePrice:15.99, menuCategoryId:catId, sku:'MP1-'+ts }, auth);
    P('Product1', r, 201); const p1 = r.body.id;
    r = await req('POST','http://localhost:3000/api/v1/restaurants/'+aid+'/products', { name:'P2', basePrice:9.99, menuCategoryId:catId, sku:'MP2-'+ts }, auth);
    P('Product2', r, 201); const p2 = r.body.id;

    const kds = (rest) => 'http://localhost:3000/api/v1/restaurants/' + rest + '/kds';

    // ── KITCHEN STATION CRUD ──
    console.log('\n── KITCHEN STATION CRUD ──');
    r = await req('POST', kds(aid)+'/stations', { name:'Grill', slug:'grill', color:'#FF0000', displayOrder:1 }, auth);
    P('CreateStation', r, 201); C('Name', r.body.name==='Grill'); const st1 = r.body.id;

    r = await req('POST', kds(aid)+'/stations', { name:'Fryer', slug:'fryer', color:'#FFA500', displayOrder:2 }, auth);
    P('CreateStation2', r, 201); const st2 = r.body.id;

    r = await req('POST', kds(aid)+'/stations', { name:'Pizza', slug:'pizza', color:'#FFFF00', displayOrder:3 }, auth);
    P('CreateStation3', r, 201); const st3 = r.body.id;

    r = await req('GET', kds(aid)+'/stations', null, auth);
    P('ListStations', r, 200); C('Count>=3', r.body.data?.length>=3); C('Ordered', r.body.data?.[0]?.displayOrder===1);

    r = await req('GET', kds(aid)+'/stations/'+st1, null, auth);
    P('GetStation', r, 200); C('Name', r.body.name==='Grill'); C('Color', r.body.color==='#FF0000');

    r = await req('PUT', kds(aid)+'/stations/'+st1, { description:'For steaks', color:'#FF4500' }, auth);
    P('UpdateStation', r, 200); C('Desc', r.body.description==='For steaks'); C('Color', r.body.color==='#FF4500');

    r = await req('GET', kds(aid)+'/stations/'+st1, null, auth);
    C('UpdatedPersist', r.body.description==='For steaks');

    r = await req('DELETE', kds(aid)+'/stations/'+st3, null, auth);
    P('DeleteStation', r, 200);

    r = await req('GET', kds(aid)+'/stations/'+st3, null, auth);
    C('DeletedNotFound', r.status===404);

    // ── STATION VALIDATION ──
    console.log('\n── STATION VALIDATION ──');
    r = await req('POST', kds(aid)+'/stations', { name:'Grill', slug:'grill-dup' }, auth);
    P('DuplicateName', r, 409);

    r = await req('POST', kds(aid)+'/stations', { name:'DupSlug', slug:'grill' }, auth);
    P('DuplicateSlug', r, 409);

    r = await req('GET', kds(aid)+'/stations/'+'00000000-0000-0000-0000-000000000000', null, auth);
    C('NotFound', r.status===404);

    // ── PRODUCT-STATION ASSIGNMENT ──
    console.log('\n── PRODUCT-STATION ASSIGNMENT ──');
    r = await req('POST', kds(aid)+'/assign-product', { productId:p1, stationId:st1 }, auth);
    P('AssignProduct', r, 200); C('stationId', r.body.stationId===st1);

    r = await req('POST', kds(aid)+'/assign-product', { productId:p2, stationId:st2 }, auth);
    P('AssignProduct2', r, 200);

    r = await req('DELETE', kds(aid)+'/assign-product/'+p1, null, auth);
    P('UnassignProduct', r, 200); C('NullStation', r.body.stationId===null);

    r = await req('POST', kds(aid)+'/assign-product', { productId:p1, stationId:st1 }, auth);
    P('ReassignProduct', r, 200); C('Reassigned', r.body.stationId===st1);

    r = await req('POST', kds(aid)+'/assign-product', { productId:'00000000-0000-0000-0000-000000000000', stationId:st1 }, auth);
    P('AssignBadProduct', r, 404);

    r = await req('POST', kds(aid)+'/assign-product', { productId:p1, stationId:'00000000-0000-0000-0000-000000000000' }, auth);
    P('AssignBadStation', r, 404);

    // ── KDS DASHBOARD ──
    console.log('\n── KDS DASHBOARD ──');
    r = await req('GET', kds(aid)+'/dashboard', null, auth);
    P('Dashboard', r, 200); C('ActiveStations', r.body.totalActive>=2);

    r = await req('GET', kds(aid)+'/station-queue/'+st1, null, auth);
    P('StationQueue', r, 200); C('StationName', r.body.station?.name==='Grill');

    // ── ORDER CONFIRMED → KDS TICKETS ──
    console.log('\n── ORDER CONFIRMED → KDS TICKETS ──');
    const base = 'http://localhost:3000/api/v1/restaurants/'+aid;
    r = await req('POST', base+'/orders', { restaurantId:aid, branchId:bid, items:[{ productId:p1, productName:'P1', quantity:2, unitPrice:15.99 },{ productId:p2, productName:'P2', quantity:1, unitPrice:9.99 }] }, auth);
    P('CreateOrder', r, 201); const oid = r.body.id;

    r = await req('POST', base+'/orders/'+oid+'/status', { status:'PENDING' }, auth);
    P('Pending', r, 200);
    r = await req('POST', base+'/orders/'+oid+'/status', { status:'CONFIRMED' }, auth);
    P('Confirmed', r, 200);

    r = await req('GET', base+'/orders/'+oid+'/kitchen-tickets', null, auth);
    P('KDTicketsExist', r, 200); C('StationTickets', Array.isArray(r.body) && r.body.length>0);

    // KDS handler runs async via EventEmitter2; retry until items appear
    let items = [];
    for (let retry = 0; retry < 15; retry++) {
      r = await req('GET', kds(aid)+'/ticket-items', null, auth);
      items = Array.isArray(r.body) ? r.body : (r.body && r.body.data ? r.body.data : []);
      if (items.length >= 2) break;
      await new Promise(res => setTimeout(res, 600));
    }
    P('TicketItems', r, 200);
    C('ItemsCreated', items.length>=2);
    const stationTicketItems = items.filter((i) => i.station);
    C('StationAssigned', stationTicketItems.length>=1);

    // ── TICKET ITEM STATUS WORKFLOW ──
    console.log('\n── TICKET ITEM STATUS WORKFLOW ──');
    const firstItem = items && items.length > 0 ? items[0] : null;
    if (firstItem) {
      r = await req('PUT', kds(aid)+'/ticket-items/'+firstItem.id+'/status', { status:'PREPARING' }, auth);
      P('StartPrep', r, 200); C('PrepStatus', r.body.status==='PREPARING'); C('startedAt', !!r.body.startedAt);

      r = await req('PUT', kds(aid)+'/ticket-items/'+firstItem.id+'/status', { status:'READY' }, auth);
      P('MarkReady', r, 200); C('ReadyStatus', r.body.status==='READY'); C('completedAt', !!r.body.completedAt);

      r = await req('PUT', kds(aid)+'/ticket-items/'+firstItem.id+'/status', { status:'SERVED', notes:'Pickup' }, auth);
      P('MarkServed', r, 200); C('ServedStatus', r.body.status==='SERVED'); C('Notes', r.body.notes==='Pickup');
    }

    // ── TICKET ITEM FILTERS ──
    console.log('\n── TICKET ITEM FILTERS ──');
    for (let retry = 0; retry < 10; retry++) {
      r = await req('GET', kds(aid)+'/ticket-items?status=SERVED', null, auth);
      if (Array.isArray(r.body) && r.body.length >= 1) break;
      await new Promise(res => setTimeout(res, 300));
    }
    P('FilterByStatus', r, 200); C('ServedItems', Array.isArray(r.body) && r.body.length>=1);

    r = await req('GET', kds(aid)+'/ticket-items?stationId='+st1, null, auth);
    P('FilterByStation', r, 200);

    // ── KDS DASHBOARD AFTER FLOW ──
    console.log('\n── KDS DASHBOARD AFTER FLOW ──');
    r = await req('GET', kds(aid)+'/dashboard', null, auth);
    P('DashboardAfterFlow', r, 200);
    C('DashStations', r.body.totalActive>=1);

    // ── AUTH / RBAC ──
    console.log('\n── AUTH / RBAC ──');
    r = await req('GET', kds(aid)+'/stations');
    P('NoAuth', r, 401);

    r = await req('GET', kds(aid)+'/stations', null, {});
    P('NoToken', r, 401);

    // ── ISOLATION ──
    console.log('\n── ISOLATION ──');
    r = await req('POST','http://localhost:3000/api/v1/auth/register', { email:'m2b-'+ts+'@t.com', password:'M2Test123!', firstName:'M2B', lastName:'Tst', tenantName:'M2B-'+ts });
    r = await req('POST','http://localhost:3000/api/v1/auth/login', { email:'m2b-'+ts+'@t.com', password:'M2Test123!' });
    const oa = { Authorization:'Bearer '+(r.body.tokens?.accessToken) };
    r = await req('POST','http://localhost:3000/api/v1/restaurants', { name:'M2BR', slug:'m2br-'+ts }, oa);
    const bid2 = r.body.id;
    r = await req('GET', kds(bid2)+'/stations', null, oa);
    C('Isolation', r.body?.data?.length===0 || r.body?.length===0);

    // ── PAGINATION ──
    console.log('\n── PAGINATION ──');
    r = await req('GET', kds(aid)+'/stations?page=1&limit=2', null, auth);
    P('Pagination', r, 200); C('PageData', Array.isArray(r.body.data));

    // ── AUDIT ──
    console.log('\n── AUDIT ──');
    r = await req('GET','http://localhost:3000/api/v1/audit-logs', null, auth);
    P('AuditLogs', r, 200);

    // ── VALIDATION ──
    console.log('\n── VALIDATION ──');
    r = await req('POST', kds(aid)+'/stations', {}, auth);
    P('EmptyStation', r, 400);

    r = await req('POST', kds(aid)+'/stations', { name:'' }, auth);
    P('EmptyName', r, 400);

    r = await req('POST', kds(aid)+'/assign-product', {}, auth);
    P('EmptyAssign', r, 400);

    // ── SWAGGER ──
    console.log('\n── SWAGGER ──');
    r = await req('GET','http://localhost:3000/docs');
    P('Swagger', r, 200);

    console.log('\n========== PHASE 3 M2 ==========');
    console.log('Passed: ' + pass + ' | Failed: ' + fail + ' | Total: ' + total);
    console.log('Score:  ' + (total>0 ? Math.round(pass/total*100) : 0) + '%');
  } catch (e) {
    console.log('\n\x1b[31mFATAL\x1b[0m:', e.message);
  }

  srv.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,2000));
  process.exit(fail>0?1:0);
})();
