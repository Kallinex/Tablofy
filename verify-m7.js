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
      email: `m7test-${Date.now()}@test.com`,
      password: 'M7Test123!',
      firstName: 'M7',
      lastName: 'User',
      tenantName: `M7Tenant-${Date.now()}`,
    });
    reg.status === 201 ? pass('Register user') : fail('Register', reg.body);
    const login = await request('POST', '/api/v1/auth/login', {
      email: reg.body.user.email,
      password: 'M7Test123!',
    });
    login.status === 200 ? pass('Login') : fail('Login', login.body);
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    // Create restaurant
    const rest = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'M7 Rest', slug: `m7-rest-${Date.now()}` },
      auth,
    );
    rest.status === 201 ? pass('Create restaurant') : fail('Create restaurant', rest.body);
    const restId = rest.body.id;

    // =============================================
    // TAX RATES TESTS
    // =============================================

    const tax = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tax-rates`,
      {
        name: 'VAT',
        rate: 0.15,
        isCompound: false,
      },
      auth,
    );
    tax.status === 201 ? pass('Create tax rate') : fail('Create tax', tax.body);
    const taxId = tax.body.id;

    const tax2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tax-rates`,
      {
        name: 'Service Tax',
        rate: 0.05,
        isCompound: true,
      },
      auth,
    );
    tax2.status === 201 ? pass('Create second tax rate') : fail('Create tax 2', tax2.body);

    const taxes = await request('GET', `/api/v1/restaurants/${restId}/tax-rates`, null, auth);
    taxes.status === 200 && taxes.body.data.length === 2
      ? pass('List tax rates')
      : fail('List taxes', taxes.body);

    const taxOne = await request(
      'GET',
      `/api/v1/restaurants/${restId}/tax-rates/${taxId}`,
      null,
      auth,
    );
    taxOne.status === 200 && taxOne.body.name === 'VAT'
      ? pass('Get tax rate by ID')
      : fail('Get tax', taxOne.body);

    const taxUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/tax-rates/${taxId}`,
      {
        rate: 0.18,
      },
      auth,
    );
    taxUpd.status === 200 ? pass('Update tax rate') : fail('Update tax', taxUpd.body);

    // Name conflict
    const taxDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tax-rates`,
      {
        name: 'Service Tax',
        rate: 0.1,
      },
      auth,
    );
    taxDup.status === 409 ? pass('Tax name conflict') : fail('Tax conflict', taxDup.status);

    // Validation
    const badTax = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tax-rates`,
      {
        name: '',
        rate: 0.1,
      },
      auth,
    );
    badTax.status === 400 ? pass('Validation: bad tax') : fail('Validation tax', badTax.status);

    // Soft delete + restore
    const delTax = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/tax-rates/${taxId}`,
      null,
      auth,
    );
    delTax.status === 200 ? pass('Soft delete tax rate') : fail('Delete tax', delTax.status);

    const taxesAfterDel = await request(
      'GET',
      `/api/v1/restaurants/${restId}/tax-rates`,
      null,
      auth,
    );
    taxesAfterDel.body.data.length === 1
      ? pass('Deleted tax excluded')
      : fail('Tax list after delete', taxesAfterDel.body);

    const resTax = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tax-rates/${taxId}/restore`,
      null,
      auth,
    );
    resTax.status === 200 ? pass('Restore tax rate') : fail('Restore tax', resTax.body);

    // =============================================
    // SERVICE CHARGES TESTS
    // =============================================

    const sc = await request(
      'POST',
      `/api/v1/restaurants/${restId}/service-charges`,
      {
        name: 'Service Charge',
        rate: 0.1,
        isPercentage: true,
      },
      auth,
    );
    sc.status === 201 ? pass('Create service charge') : fail('Create SC', sc.body);
    const scId = sc.body.id;

    const sc2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/service-charges`,
      {
        name: 'Gratuity',
        rate: 0.05,
      },
      auth,
    );
    sc2.status === 201 ? pass('Create second SC') : fail('Create SC 2', sc2.body);

    const scs = await request('GET', `/api/v1/restaurants/${restId}/service-charges`, null, auth);
    scs.status === 200 && scs.body.data.length === 2
      ? pass('List service charges')
      : fail('List SCs', scs.body);

    const scOne = await request(
      'GET',
      `/api/v1/restaurants/${restId}/service-charges/${scId}`,
      null,
      auth,
    );
    scOne.status === 200 && scOne.body.name === 'Service Charge'
      ? pass('Get SC by ID')
      : fail('Get SC', scOne.body);

    const scUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/service-charges/${scId}`,
      {
        rate: 0.12,
      },
      auth,
    );
    scUpd.status === 200 ? pass('Update service charge') : fail('Update SC', scUpd.body);

    // Name conflict
    const scDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/service-charges`,
      {
        name: 'Gratuity',
        rate: 0.08,
      },
      auth,
    );
    scDup.status === 409 ? pass('SC name conflict') : fail('SC conflict', scDup.status);

    // Validation
    const badSC = await request(
      'POST',
      `/api/v1/restaurants/${restId}/service-charges`,
      {
        name: '',
        rate: 0.1,
      },
      auth,
    );
    badSC.status === 400 ? pass('Validation: bad SC') : fail('Validation SC', badSC.status);

    // Soft delete + restore
    const delSC = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/service-charges/${scId}`,
      null,
      auth,
    );
    delSC.status === 200 ? pass('Soft delete SC') : fail('Delete SC', delSC.status);

    const scsAfterDel = await request(
      'GET',
      `/api/v1/restaurants/${restId}/service-charges`,
      null,
      auth,
    );
    scsAfterDel.body.data.length === 1
      ? pass('Deleted SC excluded')
      : fail('SC list after delete', scsAfterDel.body);

    const resSC = await request(
      'POST',
      `/api/v1/restaurants/${restId}/service-charges/${scId}/restore`,
      null,
      auth,
    );
    resSC.status === 200 ? pass('Restore SC') : fail('Restore SC', resSC.body);

    // =============================================
    // UNITS TESTS
    // =============================================

    const unit = await request(
      'POST',
      '/api/v1/units',
      {
        name: 'Kilogram',
        abbreviation: 'kg',
        type: 'WEIGHT',
      },
      auth,
    );
    unit.status === 201 ? pass('Create unit') : fail('Create unit', unit.body);
    const unitId = unit.body.id;

    const unit2 = await request(
      'POST',
      '/api/v1/units',
      {
        name: 'Liter',
        abbreviation: 'L',
        type: 'VOLUME',
      },
      auth,
    );
    unit2.status === 201 ? pass('Create second unit') : fail('Create unit 2', unit2.body);

    const unit3 = await request(
      'POST',
      '/api/v1/units',
      {
        name: 'Piece',
        abbreviation: 'pc',
        type: 'COUNT',
      },
      auth,
    );
    unit3.status === 201 ? pass('Create third unit') : fail('Create unit 3', unit3.body);

    const units = await request('GET', '/api/v1/units', null, auth);
    units.status === 200 && units.body.data.length === 3
      ? pass('List units')
      : fail('List units', units.body);

    // Filter by type
    const weightUnits = await request('GET', '/api/v1/units?type=WEIGHT', null, auth);
    weightUnits.status === 200 && weightUnits.body.data.length === 1
      ? pass('Filter units by type')
      : fail('Filter units', weightUnits.body);

    const unitOne = await request('GET', `/api/v1/units/${unitId}`, null, auth);
    unitOne.status === 200 && unitOne.body.name === 'Kilogram'
      ? pass('Get unit by ID')
      : fail('Get unit', unitOne.body);

    const unitUpd = await request(
      'PUT',
      `/api/v1/units/${unitId}`,
      {
        abbreviation: 'kg2',
      },
      auth,
    );
    unitUpd.status === 200 ? pass('Update unit') : fail('Update unit', unitUpd.body);

    // Name conflict
    const unitDup = await request(
      'POST',
      '/api/v1/units',
      {
        name: 'Liter',
        abbreviation: 'l',
        type: 'VOLUME',
      },
      auth,
    );
    unitDup.status === 409 ? pass('Unit name conflict') : fail('Unit conflict', unitDup.status);

    // Validation
    const badUnit = await request(
      'POST',
      '/api/v1/units',
      {
        name: '',
        abbreviation: '',
        type: 'INVALID',
      },
      auth,
    );
    badUnit.status === 400 ? pass('Validation: bad unit') : fail('Validation unit', badUnit.status);

    // Soft delete + restore
    const delUnit = await request('DELETE', `/api/v1/units/${unit3.body.id}`, null, auth);
    delUnit.status === 200 ? pass('Soft delete unit') : fail('Delete unit', delUnit.status);

    const unitsAfterDel = await request('GET', '/api/v1/units', null, auth);
    unitsAfterDel.body.data.length === 2
      ? pass('Deleted unit excluded')
      : fail('Unit list after delete', unitsAfterDel.body);

    const resUnit = await request('POST', `/api/v1/units/${unit3.body.id}/restore`, null, auth);
    resUnit.status === 200 ? pass('Restore unit') : fail('Restore unit', resUnit.body);

    // =============================================
    // QUEUE MONITORING TESTS
    // =============================================

    const emailStats = await request('GET', '/api/v1/queues/email/stats', null, auth);
    emailStats.status === 200
      ? pass('Email queue stats')
      : fail('Email queue stats', emailStats.body);

    const cleanupStats = await request('GET', '/api/v1/queues/cleanup/stats', null, auth);
    cleanupStats.status === 200
      ? pass('Cleanup queue stats')
      : fail('Cleanup queue stats', cleanupStats.body);

    const notifStats = await request('GET', '/api/v1/queues/notification/stats', null, auth);
    notifStats.status === 200
      ? pass('Notification queue stats')
      : fail('Notif queue stats', notifStats.body);

    // =============================================
    // TENANT ISOLATION TESTS
    // =============================================

    const reg2 = await request('POST', '/api/v1/auth/register', {
      email: `m7test2-${Date.now()}@test.com`,
      password: 'M7Test123!',
      firstName: 'M7b',
      lastName: 'User',
      tenantName: `M7Tenant2-${Date.now()}`,
    });
    const login2 = await request('POST', '/api/v1/auth/login', {
      email: reg2.body.user.email,
      password: 'M7Test123!',
    });
    const auth2 = { Authorization: `Bearer ${login2.body.tokens.accessToken}` };

    const otherTax = await request('GET', `/api/v1/restaurants/${restId}/tax-rates`, null, auth2);
    otherTax.status === 404 || otherTax.status === 403
      ? pass('Tenant isolation: tax')
      : fail('Isolation tax', otherTax.status);

    const otherSC = await request(
      'GET',
      `/api/v1/restaurants/${restId}/service-charges`,
      null,
      auth2,
    );
    otherSC.status === 404 || otherSC.status === 403
      ? pass('Tenant isolation: SC')
      : fail('Isolation SC', otherSC.status);
  } catch (e) {
    fail('Exception', e.message);
  }

  console.log('\n========== M7 VERIFICATION ==========\n');
  results.forEach((r) => console.log(r));
  const passed = results.filter((r) => r.startsWith('✅')).length;
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\nPassed: ${passed} | Failed: ${failed} | Total: ${results.length}`);
}

main().catch(console.error);
