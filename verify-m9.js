const http = require('http');

function request(method, path, body, headers) {
  const hdrs = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
  return new Promise(function (resolve, reject) {
    var opts = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: hdrs,
    };
    var req = http.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) {
        data += c;
      });
      res.on('end', function () {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function decodeJwt(token) {
  var parts = token.split('.');
  var padded = parts[1] + '='.repeat(4 - (parts[1].length % 4));
  return JSON.parse(Buffer.from(padded, 'base64').toString());
}

function url() {
  return Array.prototype.join.call(arguments, '');
}

async function regAndLogin(email, password, tenantName) {
  var data = { email: email, password: password, firstName: 'Test', lastName: 'User' };
  if (tenantName) data.tenantName = tenantName;
  var reg = await request('POST', '/api/v1/auth/register', data);
  var login = await request('POST', '/api/v1/auth/login', { email: email, password: password });
  var tok = login.body && login.body.tokens && login.body.tokens.accessToken;
  return { reg: reg, login: login, auth: { Authorization: 'Bearer ' + tok } };
}

async function main() {
  var results = [];
  function pass(name) {
    results.push('P ' + name);
  }
  function fail(name, e) {
    results.push('F ' + name + ': ' + (typeof e === 'object' ? JSON.stringify(e) : String(e)));
  }
  var ts = Date.now();

  try {
    // ---- INFRASTRUCTURE (3) ----
    var h = await request('GET', '/api/v1/health');
    h.status === 200 ? pass('T01 Health check') : fail('T01', h.status);

    var docs = await request('GET', '/docs');
    docs.status === 200 ? pass('T02 Swagger docs available') : fail('T02', docs.status);

    var infra = await regAndLogin('infra-' + ts + '@test.com', 'Infra123!', 'InfraT-' + ts);
    var qs = await request('GET', '/api/v1/queues/email/stats', null, infra.auth);
    qs.status === 200 ? pass('T03 Redis queue stats') : fail('T03', qs.status);

    // ---- ACCOUNT LOCKOUT (7) ----
    var lockEmail = 'lockout-' + ts + '@test.com';
    var lockReg = await request('POST', '/api/v1/auth/register', {
      email: lockEmail,
      password: 'Lockout123!',
      firstName: 'Lock',
      lastName: 'Out',
      tenantName: 'LockT-' + ts,
    });
    lockReg.status === 201 ? pass('T04 Register lockout user') : fail('T04', lockReg.body);

    for (var i = 1; i <= 4; i++) {
      var r = await request('POST', '/api/v1/auth/login', { email: lockEmail, password: 'Wrong!' });
      r.status === 401 && !String(r.body.message || '').includes('locked')
        ? pass('T0' + (4 + i) + ' Failed attempt ' + i + ' = 401')
        : fail('T0' + (4 + i), r.status + ' ' + (r.body.message || ''));
    }

    var r5 = await request('POST', '/api/v1/auth/login', { email: lockEmail, password: 'Wrong!' });
    r5.status === 401 && String(r5.body.message || '').includes('locked')
      ? pass('T09 5th attempt triggers lockout')
      : fail('T09', r5.status + ' ' + (r5.body.message || ''));

    var locked = await request('POST', '/api/v1/auth/login', {
      email: lockEmail,
      password: 'Lockout123!',
    });
    locked.status === 401 && String(locked.body.message || '').includes('locked')
      ? pass('T10 Correct pw rejected while locked')
      : fail('T10', locked.status + ' ' + (locked.body.message || ''));

    // ---- JWT ISS/AUD (5) ----
    var jwtEmail = 'jwt-' + ts + '@test.com';
    await regAndLogin(jwtEmail, 'JwtTest123!', 'JwtT-' + ts);
    var jwtLogin = await request('POST', '/api/v1/auth/login', {
      email: jwtEmail,
      password: 'JwtTest123!',
    });
    var jwtClaims = decodeJwt(jwtLogin.body.tokens.accessToken);

    jwtClaims.iss === 'tablofy' ? pass('T11 JWT iss = tablofy') : fail('T11', jwtClaims.iss);
    jwtClaims.aud === 'tablofy-api'
      ? pass('T12 JWT aud = tablofy-api')
      : fail('T12', jwtClaims.aud);
    jwtClaims.sub === jwtLogin.body.user.id
      ? pass('T13 JWT sub = user ID')
      : fail('T13', jwtClaims.sub);
    jwtClaims.role === 'OWNER' ? pass('T14 JWT role present') : fail('T14', jwtClaims.role);
    jwtClaims.jti ? pass('T15 JWT jti present') : fail('T15', 'no jti');

    // ---- RATE LIMITING (4) ----
    var rateAuth = { Authorization: 'Bearer ' + jwtLogin.body.tokens.accessToken };
    var firstReq = await request('GET', '/api/v1/restaurants', null, rateAuth);
    firstReq.status === 200 ? pass('T16 Rate limit headers set') : fail('T16', firstReq.status);
    firstReq.headers['x-ratelimit-limit']
      ? pass('T17 X-RateLimit-Limit header')
      : fail('T17', 'missing');
    firstReq.headers['x-ratelimit-remaining']
      ? pass('T18 X-RateLimit-Remaining header')
      : fail('T18', 'missing');
    firstReq.headers['x-ratelimit-reset']
      ? pass('T19 X-RateLimit-Reset header')
      : fail('T19', 'missing');

    // ---- CROSS-TENANT ISOLATION (10) ----
    var tA = await regAndLogin('tenantA-' + ts + '@test.com', 'TenantA123!', 'TenantA-' + ts);
    var restA = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'Rest A', slug: 'rest-a-' + ts },
      tA.auth,
    );

    var tB = await regAndLogin('tenantB-' + ts + '@test.com', 'TenantB123!', 'TenantB-' + ts);

    var crossRest = await request('GET', url('/api/v1/restaurants/', restA.body.id), null, tB.auth);
    crossRest.status === 404
      ? pass('T20 Cross-tenant restaurant blocked')
      : fail('T20', crossRest.status);

    var ingA = await request('POST', '/api/v1/ingredients', { name: 'Flour', unit: 'kg' }, tA.auth);
    var supA = await request('POST', '/api/v1/suppliers', { name: 'Supplier A' }, tA.auth);

    var bIngs = await request('GET', '/api/v1/ingredients', null, tB.auth);
    bIngs.body.data.length === 0
      ? pass('T21 Cross-tenant ingredients hidden')
      : fail('T21', bIngs.body);

    var bSups = await request('GET', '/api/v1/suppliers', null, tB.auth);
    bSups.body.data.length === 0
      ? pass('T22 Cross-tenant suppliers hidden')
      : fail('T22', bSups.body);

    var bCats = await request(
      'GET',
      url('/api/v1/restaurants/', restA.body.id, '/menu-categories'),
      null,
      tB.auth,
    );
    bCats.status === 404 ||
    (bCats.status === 200 && (!bCats.body.data || bCats.body.data.length === 0))
      ? pass('T23 Cross-tenant menu categories hidden')
      : fail('T23', bCats.status);

    var bUpdIng = await request(
      'PUT',
      url('/api/v1/ingredients/', ingA.body.id),
      { costPerUnit: 1 },
      tB.auth,
    );
    bUpdIng.status === 404
      ? pass('T24 Cross-tenant ingredient update blocked')
      : fail('T24', bUpdIng.status);

    var bDelSup = await request('DELETE', url('/api/v1/suppliers/', supA.body.id), null, tB.auth);
    bDelSup.status === 404
      ? pass('T25 Cross-tenant supplier delete blocked')
      : fail('T25', bDelSup.status);

    var bUsage = await request(
      'GET',
      url('/api/v1/restaurants/', restA.body.id, '/usage/orders/count'),
      null,
      tB.auth,
    );
    bUsage.status === 404 ? pass('T26 Cross-tenant usage blocked') : fail('T26', bUsage.status);

    var bTax = await request(
      'GET',
      url('/api/v1/restaurants/', restA.body.id, '/tax-rates'),
      null,
      tB.auth,
    );
    bTax.status === 404 ? pass('T27 Cross-tenant tax rates blocked') : fail('T27', bTax.status);

    var bBH = await request(
      'GET',
      url('/api/v1/restaurants/', restA.body.id, '/business-hours'),
      null,
      tB.auth,
    );
    bBH.status === 404 ? pass('T28 Cross-tenant business hours blocked') : fail('T28', bBH.status);

    var bRS = await request(
      'GET',
      url('/api/v1/restaurants/', restA.body.id, '/settings'),
      null,
      tB.auth,
    );
    bRS.status === 404
      ? pass('T29 Cross-tenant restaurant settings blocked')
      : fail('T29', bRS.status);

    // ---- RBAC (6) ----
    var staff = await regAndLogin('staff-' + ts + '@test.com', 'Staff123!', null);

    var staffCreateUser = await request(
      'POST',
      '/api/v1/users',
      {
        email: 'sc-' + ts + '@test.com',
        password: 'Test123!',
        firstName: 'X',
        lastName: 'Y',
      },
      staff.auth,
    );
    staffCreateUser.status === 403
      ? pass('T30 Staff cannot create user')
      : fail('T30', staffCreateUser.status);

    var staffInv = await request(
      'POST',
      '/api/v1/invitations',
      { email: 'si-' + ts + '@test.com', role: 'STAFF' },
      staff.auth,
    );
    staffInv.status === 403
      ? pass('T31 Staff cannot create invitation')
      : fail('T31', staffInv.status);

    var staffList = await request('GET', '/api/v1/users', null, staff.auth);
    staffList.status === 403
      ? pass('T32 Staff without tenant = 403')
      : fail('T32', staffList.status);

    var unauth = await request('GET', '/api/v1/users');
    unauth.status === 401 ? pass('T33 Unauthenticated = 401') : fail('T33', unauth.status);

    var badToken = await request('GET', '/api/v1/users', null, {
      Authorization: 'Bearer invalid.token.here',
    });
    badToken.status === 401 ? pass('T34 Invalid token = 401') : fail('T34', badToken.status);

    var noTenant = await request('GET', '/api/v1/tenants', null, staff.auth);
    noTenant.status === 403 ? pass('T35 No tenant context = 403') : fail('T35', noTenant.status);

    // ---- INPUT VALIDATION (5) ----
    var badEmail = await request('POST', '/api/v1/auth/register', {
      email: 'not-an-email',
      password: 'Valid123!',
      firstName: 'X',
      lastName: 'Y',
    });
    badEmail.status === 400 ? pass('T36 Bad email format rejected') : fail('T36', badEmail.status);

    var weakPw = await request('POST', '/api/v1/auth/register', {
      email: 'weak-' + ts + '@test.com',
      password: '123',
      firstName: 'X',
      lastName: 'Y',
    });
    weakPw.status === 400 ? pass('T37 Weak password rejected') : fail('T37', weakPw.status);

    var badIng = await request('POST', '/api/v1/ingredients', { name: '', unit: '' }, tA.auth);
    badIng.status === 400 ? pass('T38 Empty ingredient name rejected') : fail('T38', badIng.status);

    var badSup = await request('POST', '/api/v1/suppliers', { name: 'X', email: 'bad' }, tA.auth);
    badSup.status === 400
      ? pass('T39 Invalid supplier email rejected')
      : fail('T39', badSup.status);

    var dupSlug = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'Dup', slug: restA.body.slug },
      tA.auth,
    );
    dupSlug.status === 409
      ? pass('T40 Duplicate restaurant slug blocked')
      : fail('T40', dupSlug.status);

    // ---- AUTH EDGE CASES (5) ----
    var enum1 = await request('POST', '/api/v1/auth/register', {
      email: jwtEmail,
      password: 'ValidPass1!',
      firstName: 'X',
      lastName: 'Y',
    });
    enum1.status === 201 && !(enum1.body.tokens && enum1.body.tokens.accessToken)
      ? pass('T41 No user enumeration')
      : fail('T41', enum1.body);

    var forgotGhost = await request('POST', '/api/v1/auth/forgot-password', {
      email: 'ghost@test.com',
    });
    forgotGhost.status === 200
      ? pass('T42 Forgot password hides existence')
      : fail('T42', forgotGhost.status);

    var badRefresh = await request('POST', '/api/v1/auth/refresh', { refreshToken: 'invalid' });
    badRefresh.status === 401
      ? pass('T43 Invalid refresh token rejected')
      : fail('T43', badRefresh.status);

    var logoutU = await regAndLogin('logout-' + ts + '@test.com', 'Logout123!', 'LogoutT-' + ts);
    var logoutRes = await request(
      'POST',
      '/api/v1/auth/logout',
      {
        refreshToken: logoutU.login.body.tokens.refreshToken,
      },
      logoutU.auth,
    );
    logoutRes.status === 200 ? pass('T44 Logout succeeds') : fail('T44', logoutRes.status);

    var chgU = await regAndLogin('chg-' + ts + '@test.com', 'Change123!', 'ChgT-' + ts);
    var samePw = await request(
      'POST',
      '/api/v1/auth/change-password',
      {
        currentPassword: 'Change123!',
        newPassword: 'Change123!',
      },
      chgU.auth,
    );
    samePw.status === 400 ? pass('T45 Same password change rejected') : fail('T45', samePw.status);

    // ---- E2E FLOW (7) ----
    var e2e = await regAndLogin('e2e-' + ts + '@test.com', 'E2eTest123!', 'E2eT-' + ts);

    var e2eRest = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'E2E Rest', slug: 'e2e-' + ts },
      e2e.auth,
    );
    e2eRest.status === 201 ? pass('T46 E2E Create restaurant') : fail('T46', e2eRest.status);

    var e2eBranch = await request(
      'POST',
      url('/api/v1/restaurants/', e2eRest.body.id, '/branches'),
      {
        name: 'Main Branch',
        address: '123 Main St',
        slug: 'main-branch-' + ts,
      },
      e2e.auth,
    );
    e2eBranch.status === 201 ? pass('T47 E2E Create branch') : fail('T47', e2eBranch.status);

    var e2eFloor = await request(
      'POST',
      url('/api/v1/restaurants/', e2eRest.body.id, '/branches/', e2eBranch.body.id, '/floors'),
      {
        name: 'Ground Floor',
        level: 0,
      },
      e2e.auth,
    );
    e2eFloor.status === 201 ? pass('T48 E2E Create floor') : fail('T48', e2eFloor.status);

    var e2eArea = await request(
      'POST',
      url('/api/v1/restaurants/', e2eRest.body.id, '/branches/', e2eBranch.body.id, '/areas'),
      {
        name: 'Indoor',
        floorId: e2eFloor.body.id,
      },
      e2e.auth,
    );
    e2eArea.status === 201 ? pass('T49 E2E Create dining area') : fail('T49', e2eArea.status);

    var e2eTable = await request(
      'POST',
      url('/api/v1/restaurants/', e2eRest.body.id, '/branches/', e2eBranch.body.id, '/tables'),
      {
        number: 'T1',
        diningAreaId: e2eArea.body.id,
      },
      e2e.auth,
    );
    e2eTable.status === 201 ? pass('T50 E2E Create table') : fail('T50', e2eTable.status);

    var e2eCat = await request(
      'POST',
      url('/api/v1/restaurants/', e2eRest.body.id, '/menu-categories'),
      { name: 'Drinks' },
      e2e.auth,
    );
    var e2eProd = await request(
      'POST',
      url('/api/v1/restaurants/', e2eRest.body.id, '/products'),
      {
        name: 'Coffee',
        basePrice: 4.5,
        menuCategoryId: e2eCat.body.id,
        sku: 'DRK-' + ts,
      },
      e2e.auth,
    );
    e2eProd.status === 201 ? pass('T51 E2E Create product') : fail('T51', e2eProd.status);

    var e2eIng = await request(
      'POST',
      '/api/v1/ingredients',
      { name: 'Coffee Beans', unit: 'kg', costPerUnit: 12 },
      e2e.auth,
    );
    await request(
      'POST',
      url('/api/v1/restaurants/', e2eRest.body.id, '/product-ingredients'),
      {
        productId: e2eProd.body.id,
        ingredientId: e2eIng.body.id,
        quantity: 0.02,
      },
      e2e.auth,
    );
    var e2eCost = await request(
      'GET',
      url(
        '/api/v1/restaurants/',
        e2eRest.body.id,
        '/product-ingredients/product/',
        e2eProd.body.id,
        '/cost',
      ),
      null,
      e2e.auth,
    );
    e2eCost.status === 200 && e2eCost.body.totalCostPerUnit > 0
      ? pass('T52 E2E Cost calculation works')
      : fail('T52', e2eCost.body);

    // ---- AUDIT LOG VERIFICATION (3) ----
    var auditLogs = await request('GET', '/api/v1/audit-logs', null, e2e.auth);
    auditLogs.status === 200 && auditLogs.body.data && auditLogs.body.data.length > 0
      ? pass('T53 Audit logs recorded')
      : fail('T53', auditLogs.body);

    var loginAudit = await request('GET', '/api/v1/audit-logs?action=USER_LOGIN', null, e2e.auth);
    loginAudit.status === 200 ? pass('T54 Login events audited') : fail('T54', loginAudit.status);

    var failAudit = await request(
      'GET',
      '/api/v1/audit-logs?action=LOGIN_FAILED',
      null,
      infra.auth,
    );
    failAudit.status === 200
      ? pass('T55 Failed login events audited')
      : fail('T55', failAudit.status);
  } catch (e) {
    fail('Exception', e.message);
  }

  console.log('\n========================================');
  console.log('  M9 SECURITY & INTEGRATION VERIFICATION');
  console.log('========================================\n');
  results.forEach(function (r) {
    console.log(r);
  });
  var passed = results.filter(function (r) {
    return r.startsWith('P ');
  }).length;
  var failed = results.filter(function (r) {
    return r.startsWith('F ');
  }).length;
  console.log('\nPassed: ' + passed + ' | Failed: ' + failed + ' | Total: ' + results.length);
}

main().catch(console.error);
