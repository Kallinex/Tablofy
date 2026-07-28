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
      email: `m4test-${Date.now()}@test.com`,
      password: 'M4Test123!',
      firstName: 'M4',
      lastName: 'User',
      tenantName: `M4Tenant-${Date.now()}`,
    });
    reg.status === 201 ? pass('Register user') : fail('Register', reg.body);
    const login = await request('POST', '/api/v1/auth/login', {
      email: reg.body.user.email,
      password: 'M4Test123!',
    });
    login.status === 200 ? pass('Login') : fail('Login', login.body);
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    // Create restaurant
    const rest = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'M4 Rest', slug: `m4-rest-${Date.now()}` },
      auth,
    );
    rest.status === 201 ? pass('Create restaurant') : fail('Create restaurant', rest.body);
    const restId = rest.body.id;

    // =============================================
    // VARIANT GROUP TESTS
    // =============================================

    // Create variant group
    const vg = await request(
      'POST',
      `/api/v1/restaurants/${restId}/variant-groups`,
      {
        name: 'Size',
        description: 'Choose your size',
        type: 'SINGLE',
        sortOrder: 0,
      },
      auth,
    );
    vg.status === 201 ? pass('Create variant group') : fail('Create variant group', vg.body);
    const vgId = vg.body.id;

    // List variant groups
    const vgs = await request('GET', `/api/v1/restaurants/${restId}/variant-groups`, null, auth);
    vgs.status === 200 && vgs.body.data.length === 1
      ? pass('List variant groups')
      : fail('List variant groups', vgs.body);

    // Get variant group by ID
    const vgOne = await request(
      'GET',
      `/api/v1/restaurants/${restId}/variant-groups/${vgId}`,
      null,
      auth,
    );
    vgOne.status === 200 && vgOne.body.name === 'Size'
      ? pass('Get variant group by ID')
      : fail('Get variant group', vgOne.body);

    // Update variant group
    const vgUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/variant-groups/${vgId}`,
      {
        name: 'Size (Updated)',
        description: 'Updated desc',
      },
      auth,
    );
    vgUpd.status === 200 && vgUpd.body.name === 'Size (Updated)'
      ? pass('Update variant group')
      : fail('Update variant group', vgUpd.body);

    // Duplicate name conflict
    const vg2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/variant-groups`,
      {
        name: 'Size (Updated)',
        type: 'SINGLE',
      },
      auth,
    );
    vg2.status === 409
      ? pass('Variant group name conflict')
      : fail('Variant group name conflict', vg2.status);

    // =============================================
    // PRODUCT VARIANT TESTS
    // =============================================

    // Create menu category + product for variants
    const cat = await request(
      'POST',
      `/api/v1/restaurants/${restId}/menu-categories`,
      { name: 'Food', sortOrder: 0 },
      auth,
    );
    const prod = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products`,
      {
        name: 'Pizza',
        basePrice: 10.0,
        menuCategoryId: cat.body.id,
        sku: `PZA-${Date.now()}`,
      },
      auth,
    );
    const prodId = prod.body.id;

    // Create product variant
    const pv = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants`,
      {
        name: 'Small',
        price: 10.0,
        variantGroupId: vgId,
        sku: 'PZA-S',
      },
      auth,
    );
    pv.status === 201 ? pass('Create product variant') : fail('Create product variant', pv.body);
    const pvId = pv.body.id;

    // Create another variant
    const pv2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants`,
      {
        name: 'Large',
        price: 15.0,
        variantGroupId: vgId,
        sku: 'PZA-L',
      },
      auth,
    );
    pv2.status === 201
      ? pass('Create second product variant')
      : fail('Create second product variant', pv2.body);

    // List product variants
    const pvs = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants`,
      null,
      auth,
    );
    pvs.status === 200 && pvs.body.data.length === 2
      ? pass('List product variants')
      : fail('List product variants', pvs.body);

    // Get product variant by ID
    const pvOne = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants/${pvId}`,
      null,
      auth,
    );
    pvOne.status === 200 && pvOne.body.name === 'Small'
      ? pass('Get product variant by ID')
      : fail('Get product variant', pvOne.body);

    // Update product variant
    const pvUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants/${pvId}`,
      {
        price: 11.0,
      },
      auth,
    );
    pvUpd.status === 200 && parseFloat(pvUpd.body.price) === 11
      ? pass('Update product variant price')
      : fail('Update product variant', pvUpd.body);

    // Duplicate variant name conflict
    const pvDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants`,
      {
        name: 'Large',
        price: 15.0,
        variantGroupId: vgId,
      },
      auth,
    );
    pvDup.status === 409
      ? pass('Product variant name conflict')
      : fail('Product variant name conflict', pvDup.status);

    // List by variant group filter
    const pvFilter = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants?variantGroupId=${vgId}`,
      null,
      auth,
    );
    pvFilter.status === 200 && pvFilter.body.data.length === 2
      ? pass('List variants filtered by group')
      : fail('List variants by group', pvFilter.body);

    // =============================================
    // MODIFIER GROUP TESTS
    // =============================================

    // Create modifier group
    const mg = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups`,
      {
        name: 'Toppings',
        description: 'Add toppings',
        minSelection: 0,
        maxSelection: 5,
        isRequired: false,
        sortOrder: 0,
      },
      auth,
    );
    mg.status === 201 ? pass('Create modifier group') : fail('Create modifier group', mg.body);
    const mgId = mg.body.id;

    // List modifier groups
    const mgs = await request('GET', `/api/v1/restaurants/${restId}/modifier-groups`, null, auth);
    mgs.status === 200 && mgs.body.data.length === 1
      ? pass('List modifier groups')
      : fail('List modifier groups', mgs.body);

    // Get modifier group by ID
    const mgOne = await request(
      'GET',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}`,
      null,
      auth,
    );
    mgOne.status === 200 && mgOne.body.name === 'Toppings'
      ? pass('Get modifier group by ID')
      : fail('Get modifier group', mgOne.body);

    // Update modifier group
    const mgUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}`,
      {
        maxSelection: 3,
        isRequired: true,
      },
      auth,
    );
    mgUpd.status === 200 && mgUpd.body.maxSelection === 3 && mgUpd.body.isRequired === true
      ? pass('Update modifier group')
      : fail('Update modifier group', mgUpd.body);

    // Duplicate name conflict
    const mgDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups`,
      {
        name: 'Toppings',
      },
      auth,
    );
    mgDup.status === 409
      ? pass('Modifier group name conflict')
      : fail('Modifier group name conflict', mgDup.status);

    // =============================================
    // MODIFIER TESTS
    // =============================================

    // Create modifier
    const m = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers`,
      {
        name: 'Extra Cheese',
        price: 1.5,
        sortOrder: 0,
      },
      auth,
    );
    m.status === 201 ? pass('Create modifier') : fail('Create modifier', m.body);
    const mId = m.body.id;

    // Create second modifier
    const m2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers`,
      {
        name: 'Bacon',
        price: 2.0,
        sortOrder: 1,
      },
      auth,
    );
    m2.status === 201 ? pass('Create second modifier') : fail('Create second modifier', m2.body);

    // List modifiers
    const ms = await request(
      'GET',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers`,
      null,
      auth,
    );
    ms.status === 200 && ms.body.data.length === 2
      ? pass('List modifiers')
      : fail('List modifiers', ms.body);

    // Get modifier by ID
    const mOne = await request(
      'GET',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers/${mId}`,
      null,
      auth,
    );
    mOne.status === 200 && mOne.body.name === 'Extra Cheese'
      ? pass('Get modifier by ID')
      : fail('Get modifier', mOne.body);

    // Update modifier
    const mUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers/${mId}`,
      {
        price: 1.75,
      },
      auth,
    );
    mUpd.status === 200 && parseFloat(mUpd.body.price) === 1.75
      ? pass('Update modifier price')
      : fail('Update modifier', mUpd.body);

    // Duplicate modifier name conflict
    const mDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers`,
      {
        name: 'Bacon',
        price: 2.0,
      },
      auth,
    );
    mDup.status === 409
      ? pass('Modifier name conflict')
      : fail('Modifier name conflict', mDup.status);

    // =============================================
    // SOFT DELETE + RESTORE TESTS
    // =============================================

    // Delete modifier
    const delM = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers/${mId}`,
      null,
      auth,
    );
    delM.status === 200 ? pass('Soft delete modifier') : fail('Soft delete modifier', delM.status);

    // Restore modifier
    const resM = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers/${mId}/restore`,
      null,
      auth,
    );
    resM.status === 200 ? pass('Restore modifier') : fail('Restore modifier', resM.body);

    // Delete product variant
    const delPV = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants/${pvId}`,
      null,
      auth,
    );
    delPV.status === 200
      ? pass('Soft delete product variant')
      : fail('Soft delete product variant', delPV.status);

    // Restore product variant
    const resPV = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants/${pvId}/restore`,
      null,
      auth,
    );
    resPV.status === 200
      ? pass('Restore product variant')
      : fail('Restore product variant', resPV.body);

    // Delete modifier group (should fail because modifiers exist)
    const delMG = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}`,
      null,
      auth,
    );
    delMG.status === 409
      ? pass('Delete modifier group blocked (has modifiers)')
      : fail('Delete modifier group guard', delMG.status);

    // Restore modifier group
    // First delete all modifiers, then delete group, then restore
    await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers/${mId}`,
      null,
      auth,
    );
    await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers/${m2.body.id}`,
      null,
      auth,
    );
    const delMG2 = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}`,
      null,
      auth,
    );
    delMG2.status === 200
      ? pass('Delete modifier group (empty)')
      : fail('Delete modifier group', delMG2.status);
    const resMG = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/restore`,
      null,
      auth,
    );
    resMG.status === 200
      ? pass('Restore modifier group')
      : fail('Restore modifier group', resMG.body);

    // Delete variant group (should fail because variants exist)
    const delVG = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/variant-groups/${vgId}`,
      null,
      auth,
    );
    delVG.status === 409
      ? pass('Delete variant group blocked (has variants)')
      : fail('Delete variant group guard', delVG.status);

    // Delete variant group after removing all variants
    await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants/${pvId}`,
      null,
      auth,
    );
    await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants/${pv2.body.id}`,
      null,
      auth,
    );
    const delVG2 = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/variant-groups/${vgId}`,
      null,
      auth,
    );
    delVG2.status === 200
      ? pass('Delete variant group (empty)')
      : fail('Delete variant group', delVG2.status);
    const resVG = await request(
      'POST',
      `/api/v1/restaurants/${restId}/variant-groups/${vgId}/restore`,
      null,
      auth,
    );
    resVG.status === 200
      ? pass('Restore variant group')
      : fail('Restore variant group', resVG.body);

    // Validation: bad input
    const badVG = await request(
      'POST',
      `/api/v1/restaurants/${restId}/variant-groups`,
      { name: '' },
      auth,
    );
    badVG.status === 400 ? pass('Validation: bad variant group') : fail('Validation', badVG.status);

    const badPV = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/variants`,
      { name: '' },
      auth,
    );
    badPV.status === 400
      ? pass('Validation: bad product variant')
      : fail('Validation', badPV.status);

    const badMG = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups`,
      { name: '' },
      auth,
    );
    badMG.status === 400
      ? pass('Validation: bad modifier group')
      : fail('Validation', badMG.status);

    const badM = await request(
      'POST',
      `/api/v1/restaurants/${restId}/modifier-groups/${mgId}/modifiers`,
      { name: '' },
      auth,
    );
    badM.status === 400 ? pass('Validation: bad modifier') : fail('Validation', badM.status);
  } catch (e) {
    fail('Exception', e.message);
  }

  console.log('\n========== M4 VERIFICATION ==========\n');
  results.forEach((r) => console.log(r));
  const passed = results.filter((r) => r.startsWith('✅')).length;
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\nPassed: ${passed} | Failed: ${failed} | Total: ${results.length}`);
}

main().catch(console.error);
