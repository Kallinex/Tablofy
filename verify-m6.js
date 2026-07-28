const http = require('http');

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const results = [];
  const pass = (name) => results.push(`✅ ${name}`);
  const fail = (name, e) =>
    results.push(`❌ ${name}: ${typeof e === 'object' ? JSON.stringify(e) : e}`);

  try {
    // Health
    const h = await request('GET', '/api/v1/health');
    h.status === 200 ? pass('Health check') : fail('Health', h.status);

    // Register + Login
    const reg = await request('POST', '/api/v1/auth/register', {
      email: `m6test-${Date.now()}@test.com`,
      password: 'M6Test123!',
      firstName: 'M6',
      lastName: 'User',
      tenantName: `M6Tenant-${Date.now()}`,
    });
    reg.status === 201 ? pass('Register user') : fail('Register', reg.body);
    const login = await request('POST', '/api/v1/auth/login', {
      email: reg.body.user.email,
      password: 'M6Test123!',
    });
    login.status === 200 ? pass('Login') : fail('Login', login.body);
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    // Create restaurant
    const rest = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'M6 Rest', slug: `m6-rest-${Date.now()}` },
      auth,
    );
    rest.status === 201 ? pass('Create restaurant') : fail('Create restaurant', rest.body);
    const restId = rest.body.id;

    // Create branch
    const branch = await request(
      'POST',
      `/api/v1/restaurants/${restId}/branches`,
      {
        name: 'Main Branch',
        slug: `main-${Date.now()}`,
        type: 'BRANCH',
      },
      auth,
    );
    branch.status === 201 ? pass('Create branch') : fail('Create branch', branch.body);
    const branchId = branch.body.id;

    // =============================================
    // BUSINESS HOURS TESTS
    // =============================================

    // Set hours for Monday
    const mon = await request(
      'POST',
      `/api/v1/restaurants/${restId}/business-hours`,
      {
        dayOfWeek: 'MONDAY',
        openTime: '09:00',
        closeTime: '22:00',
        isClosed: false,
      },
      auth,
    );
    mon.status === 201 ? pass('Set business hours (Monday)') : fail('Set BH', mon.body);

    // Set hours for Saturday (closed)
    const sat = await request(
      'POST',
      `/api/v1/restaurants/${restId}/business-hours`,
      {
        dayOfWeek: 'SATURDAY',
        openTime: '00:00',
        closeTime: '00:00',
        isClosed: true,
      },
      auth,
    );
    sat.status === 201
      ? pass('Set business hours (Saturday closed)')
      : fail('Set BH sat', sat.body);

    // Upsert (update existing day)
    const monUpd = await request(
      'POST',
      `/api/v1/restaurants/${restId}/business-hours`,
      {
        dayOfWeek: 'MONDAY',
        openTime: '08:00',
        closeTime: '23:00',
        isClosed: false,
      },
      auth,
    );
    monUpd.status === 201 && monUpd.body.openTime === '08:00'
      ? pass('Upsert Monday hours')
      : fail('Upsert BH', monUpd.body);

    // List all hours
    const allHours = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-hours`,
      null,
      auth,
    );
    allHours.status === 200 && allHours.body.length === 2
      ? pass('List business hours')
      : fail('List BH', allHours.body);

    // Get one
    const oneHour = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-hours/${monUpd.body.id}`,
      null,
      auth,
    );
    oneHour.status === 200 && oneHour.body.openTime === '08:00'
      ? pass('Get business hours by ID')
      : fail('Get BH', oneHour.body);

    // Update
    const updHour = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/business-hours/${monUpd.body.id}`,
      {
        closeTime: '21:00',
      },
      auth,
    );
    updHour.status === 200 && updHour.body.closeTime === '21:00'
      ? pass('Update business hours')
      : fail('Update BH', updHour.body);

    // Validation
    const badHour = await request(
      'POST',
      `/api/v1/restaurants/${restId}/business-hours`,
      {
        dayOfWeek: 'MONDAY',
        openTime: 'bad',
        closeTime: '22:00',
      },
      auth,
    );
    badHour.status === 400
      ? pass('Validation: bad time format')
      : fail('Validation BH', badHour.status);

    // Delete
    const delHour = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/business-hours/${sat.body.id}`,
      null,
      auth,
    );
    delHour.status === 200 ? pass('Delete business hours') : fail('Delete BH', delHour.status);

    // Verify deleted
    const hoursAfterDel = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-hours`,
      null,
      auth,
    );
    hoursAfterDel.body.length === 1
      ? pass('Delete verified')
      : fail('Delete verify', hoursAfterDel.body);

    // =============================================
    // BUSINESS EXCEPTIONS TESTS
    // =============================================

    // Create exception
    const ex1 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/business-exceptions`,
      {
        date: '2026-12-25',
        isClosed: true,
        reason: 'Christmas Day',
      },
      auth,
    );
    ex1.status === 201 ? pass('Create business exception') : fail('Create BE', ex1.body);

    // Create second exception
    const ex2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/business-exceptions`,
      {
        date: '2026-01-01',
        openTime: '10:00',
        closeTime: '15:00',
        isClosed: false,
        reason: 'New Year (short hours)',
      },
      auth,
    );
    ex2.status === 201 ? pass('Create second exception') : fail('Create BE 2', ex2.body);

    // List all
    const allEx = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-exceptions`,
      null,
      auth,
    );
    allEx.status === 200 && allEx.body.length === 2
      ? pass('List business exceptions')
      : fail('List BE', allEx.body);

    // List with date filter
    const filteredEx = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-exceptions?from=2026-12-01&to=2026-12-31`,
      null,
      auth,
    );
    filteredEx.status === 200 && filteredEx.body.length === 1
      ? pass('List exceptions with date filter')
      : fail('Filter BE', filteredEx.body);

    // Get one
    const oneEx = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-exceptions/${ex1.body.id}`,
      null,
      auth,
    );
    oneEx.status === 200 && oneEx.body.reason === 'Christmas Day'
      ? pass('Get exception by ID')
      : fail('Get BE', oneEx.body);

    // Update
    const updEx = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/business-exceptions/${ex1.body.id}`,
      {
        reason: 'Christmas Day - Updated',
      },
      auth,
    );
    updEx.status === 200 ? pass('Update business exception') : fail('Update BE', updEx.body);

    // Delete
    const delEx = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/business-exceptions/${ex2.body.id}`,
      null,
      auth,
    );
    delEx.status === 200 ? pass('Delete business exception') : fail('Delete BE', delEx.status);

    // Verify deleted
    const exAfterDel = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-exceptions`,
      null,
      auth,
    );
    exAfterDel.body.length === 1
      ? pass('BE delete verified')
      : fail('BE delete verify', exAfterDel.body);

    // =============================================
    // RESTAURANT SETTINGS TESTS
    // =============================================

    // Get settings
    const restSettings = await request('GET', `/api/v1/restaurants/${restId}/settings`, null, auth);
    restSettings.status === 200
      ? pass('Get restaurant settings')
      : fail('Get RS', restSettings.body);

    // Update settings (tax)
    const updTax = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/settings`,
      {
        tax: { taxRate: 8.5, taxInclusive: false },
      },
      auth,
    );
    updTax.status === 200
      ? pass('Update restaurant settings (tax)')
      : fail('Update RS tax', updTax.body);

    // Update settings (receipt)
    const updReceipt = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/settings`,
      {
        receipt: { footer: 'Thank you!', printAuto: true },
      },
      auth,
    );
    updReceipt.status === 200
      ? pass('Update restaurant settings (receipt)')
      : fail('Update RS receipt', updReceipt.body);

    // Verify merged metadata
    const restMeta = await request('GET', `/api/v1/restaurants/${restId}/settings`, null, auth);
    const meta = restMeta.body.metadata;
    meta?.tax?.taxRate === 8.5 && meta?.receipt?.footer === 'Thank you!'
      ? pass('Settings merge verified')
      : fail('Settings merge', meta);

    // =============================================
    // BRANCH SETTINGS TESTS
    // =============================================

    // Get branch settings
    const brSettings = await request(
      'GET',
      `/api/v1/restaurants/${restId}/branches/${branchId}/settings`,
      null,
      auth,
    );
    brSettings.status === 200 ? pass('Get branch settings') : fail('Get BS', brSettings.body);

    // Update branch settings
    const updBrTax = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/branches/${branchId}/settings`,
      {
        tax: { taxRate: 9.0 },
      },
      auth,
    );
    updBrTax.status === 200
      ? pass('Update branch settings (tax)')
      : fail('Update BS tax', updBrTax.body);

    // Verify
    const brMeta = await request(
      'GET',
      `/api/v1/restaurants/${restId}/branches/${branchId}/settings`,
      null,
      auth,
    );
    brMeta.body.metadata?.tax?.taxRate === 9.0
      ? pass('Branch settings merge verified')
      : fail('BS merge', brMeta.body.metadata);

    // =============================================
    // TENANT ISOLATION TESTS
    // =============================================

    // Register second user (different tenant)
    const reg2 = await request('POST', '/api/v1/auth/register', {
      email: `m6test2-${Date.now()}@test.com`,
      password: 'M6Test123!',
      firstName: 'M6b',
      lastName: 'User',
      tenantName: `M6Tenant2-${Date.now()}`,
    });
    const login2 = await request('POST', '/api/v1/auth/login', {
      email: reg2.body.user.email,
      password: 'M6Test123!',
    });
    const auth2 = { Authorization: `Bearer ${login2.body.tokens.accessToken}` };

    // Other tenant can't see our business hours
    const otherBH = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-hours`,
      null,
      auth2,
    );
    otherBH.status === 404 || otherBH.status === 403
      ? pass('Tenant isolation: BH')
      : fail('Isolation BH', otherBH.status);

    // Other tenant can't see our exceptions
    const otherBE = await request(
      'GET',
      `/api/v1/restaurants/${restId}/business-exceptions`,
      null,
      auth2,
    );
    otherBE.status === 404 || otherBE.status === 403
      ? pass('Tenant isolation: BE')
      : fail('Isolation BE', otherBE.status);

    // Other tenant can't see our settings
    const otherRS = await request('GET', `/api/v1/restaurants/${restId}/settings`, null, auth2);
    otherRS.status === 404 || otherRS.status === 403
      ? pass('Tenant isolation: RS')
      : fail('Isolation RS', otherRS.status);
  } catch (e) {
    fail('Exception', e.message);
  }

  console.log('\n========== M6 VERIFICATION ==========\n');
  results.forEach((r) => console.log(r));
  const passed = results.filter((r) => r.startsWith('✅')).length;
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\nPassed: ${passed} | Failed: ${failed} | Total: ${results.length}`);
}

main().catch(console.error);
