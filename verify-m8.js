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
      email: `m8test-${Date.now()}@test.com`,
      password: 'M8Test123!',
      firstName: 'M8',
      lastName: 'User',
      tenantName: `M8Tenant-${Date.now()}`,
    });
    reg.status === 201 ? pass('Register user') : fail('Register', reg.body);
    const login = await request('POST', '/api/v1/auth/login', {
      email: reg.body.user.email,
      password: 'M8Test123!',
    });
    login.status === 200 ? pass('Login') : fail('Login', login.body);
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    // Create restaurant
    const rest = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'M8 Rest', slug: `m8-rest-${Date.now()}` },
      auth,
    );
    rest.status === 201 ? pass('Create restaurant') : fail('Create restaurant', rest.body);
    const restId = rest.body.id;

    // Create product
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
        basePrice: 15.0,
        menuCategoryId: cat.body.id,
        sku: `PIZ-${Date.now()}`,
      },
      auth,
    );
    const prodId = prod.body.id;

    // =============================================
    // INGREDIENTS TESTS
    // =============================================

    const ing = await request(
      'POST',
      '/api/v1/ingredients',
      {
        name: 'Mozzarella',
        description: 'Fresh mozzarella cheese',
        unit: 'kg',
        costPerUnit: 5.5,
        stockLevel: 50,
        minStock: 10,
      },
      auth,
    );
    ing.status === 201 ? pass('Create ingredient') : fail('Create ingredient', ing.body);
    const ingId = ing.body.id;

    const ing2 = await request(
      'POST',
      '/api/v1/ingredients',
      {
        name: 'Tomato Sauce',
        unit: 'L',
        costPerUnit: 2.0,
      },
      auth,
    );
    ing2.status === 201 ? pass('Create second ingredient') : fail('Create ingredient 2', ing2.body);

    const ings = await request('GET', '/api/v1/ingredients', null, auth);
    ings.status === 200 && ings.body.data.length === 2
      ? pass('List ingredients')
      : fail('List ingredients', ings.body);

    // Search
    const ingsSearch = await request('GET', '/api/v1/ingredients?search=Mozzarella', null, auth);
    ingsSearch.status === 200 && ingsSearch.body.data.length === 1
      ? pass('Search ingredients')
      : fail('Search ingredients', ingsSearch.body);

    const ingOne = await request('GET', `/api/v1/ingredients/${ingId}`, null, auth);
    ingOne.status === 200 && ingOne.body.name === 'Mozzarella'
      ? pass('Get ingredient by ID')
      : fail('Get ingredient', ingOne.body);

    const ingUpd = await request(
      'PUT',
      `/api/v1/ingredients/${ingId}`,
      {
        costPerUnit: 6.0,
        stockLevel: 45,
      },
      auth,
    );
    ingUpd.status === 200 ? pass('Update ingredient') : fail('Update ingredient', ingUpd.body);

    // Name conflict
    const ingDup = await request(
      'POST',
      '/api/v1/ingredients',
      {
        name: 'Tomato Sauce',
        unit: 'L',
      },
      auth,
    );
    ingDup.status === 409
      ? pass('Ingredient name conflict')
      : fail('Ingredient conflict', ingDup.status);

    // Validation
    const badIng = await request(
      'POST',
      '/api/v1/ingredients',
      {
        name: '',
        unit: '',
      },
      auth,
    );
    badIng.status === 400
      ? pass('Validation: bad ingredient')
      : fail('Validation ingredient', badIng.status);

    // Soft delete + restore
    const delIng = await request('DELETE', `/api/v1/ingredients/${ing2.body.id}`, null, auth);
    delIng.status === 200
      ? pass('Soft delete ingredient')
      : fail('Delete ingredient', delIng.status);

    const ingsAfterDel = await request('GET', '/api/v1/ingredients', null, auth);
    ingsAfterDel.body.data.length === 1
      ? pass('Deleted ingredient excluded')
      : fail('Ingredient after delete', ingsAfterDel.body);

    const resIng = await request('POST', `/api/v1/ingredients/${ing2.body.id}/restore`, null, auth);
    resIng.status === 200 ? pass('Restore ingredient') : fail('Restore ingredient', resIng.body);

    // =============================================
    // SUPPLIERS TESTS
    // =============================================

    const sup = await request(
      'POST',
      '/api/v1/suppliers',
      {
        name: 'Fresh Farms',
        contactName: 'John Smith',
        email: 'john@freshfarms.com',
        phone: '+1-555-0123',
      },
      auth,
    );
    sup.status === 201 ? pass('Create supplier') : fail('Create supplier', sup.body);
    const supId = sup.body.id;

    const sup2 = await request(
      'POST',
      '/api/v1/suppliers',
      {
        name: 'Dairy Direct',
        contactName: 'Jane Doe',
      },
      auth,
    );
    sup2.status === 201 ? pass('Create second supplier') : fail('Create supplier 2', sup2.body);

    const sups = await request('GET', '/api/v1/suppliers', null, auth);
    sups.status === 200 && sups.body.data.length === 2
      ? pass('List suppliers')
      : fail('List suppliers', sups.body);

    const supOne = await request('GET', `/api/v1/suppliers/${supId}`, null, auth);
    supOne.status === 200 && supOne.body.name === 'Fresh Farms'
      ? pass('Get supplier by ID')
      : fail('Get supplier', supOne.body);

    const supUpd = await request(
      'PUT',
      `/api/v1/suppliers/${supId}`,
      {
        phone: '+1-555-9999',
        metadata: { paymentTerms: 'Net 30' },
      },
      auth,
    );
    supUpd.status === 200 ? pass('Update supplier') : fail('Update supplier', supUpd.body);

    // Name conflict
    const supDup = await request(
      'POST',
      '/api/v1/suppliers',
      {
        name: 'Dairy Direct',
      },
      auth,
    );
    supDup.status === 409
      ? pass('Supplier name conflict')
      : fail('Supplier conflict', supDup.status);

    // Validation
    const badSup = await request(
      'POST',
      '/api/v1/suppliers',
      {
        name: '',
        email: 'not-an-email',
      },
      auth,
    );
    badSup.status === 400
      ? pass('Validation: bad supplier')
      : fail('Validation supplier', badSup.status);

    // Soft delete + restore
    const delSup = await request('DELETE', `/api/v1/suppliers/${sup2.body.id}`, null, auth);
    delSup.status === 200 ? pass('Soft delete supplier') : fail('Delete supplier', delSup.status);

    const supsAfterDel = await request('GET', '/api/v1/suppliers', null, auth);
    supsAfterDel.body.data.length === 1
      ? pass('Deleted supplier excluded')
      : fail('Supplier after delete', supsAfterDel.body);

    const resSup = await request('POST', `/api/v1/suppliers/${sup2.body.id}/restore`, null, auth);
    resSup.status === 200 ? pass('Restore supplier') : fail('Restore supplier', resSup.body);

    // =============================================
    // PRODUCT INGREDIENTS TESTS (COST TRACKING)
    // =============================================

    const pi = await request(
      'POST',
      `/api/v1/restaurants/${restId}/product-ingredients`,
      {
        productId: prodId,
        ingredientId: ingId,
        supplierId: supId,
        quantity: 0.5,
      },
      auth,
    );
    pi.status === 201 ? pass('Link ingredient to product') : fail('Create PI', pi.body);

    // Duplicate link
    const piDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/product-ingredients`,
      {
        productId: prodId,
        ingredientId: ingId,
        quantity: 0.3,
      },
      auth,
    );
    piDup.status === 409 ? pass('PI duplicate blocked') : fail('PI duplicate', piDup.status);

    // List product ingredients
    const piList = await request(
      'GET',
      `/api/v1/restaurants/${restId}/product-ingredients/product/${prodId}`,
      null,
      auth,
    );
    piList.status === 200 && piList.body.length === 1
      ? pass('List product ingredients')
      : fail('List PI', piList.body);

    // Get cost
    const cost = await request(
      'GET',
      `/api/v1/restaurants/${restId}/product-ingredients/product/${prodId}/cost`,
      null,
      auth,
    );
    cost.status === 200 && cost.body.totalCostPerUnit > 0
      ? pass('Get product cost')
      : fail('Get cost', cost.body);

    // Update PI
    const piUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/product-ingredients/${pi.body.id}`,
      {
        quantity: 0.75,
      },
      auth,
    );
    piUpd.status === 200 ? pass('Update product ingredient') : fail('Update PI', piUpd.body);

    // Delete PI
    const piDel = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/product-ingredients/${pi.body.id}`,
      null,
      auth,
    );
    piDel.status === 200 ? pass('Delete product ingredient') : fail('Delete PI', piDel.body);

    // =============================================
    // USAGE TRACKING TESTS
    // =============================================

    const orderCount = await request(
      'GET',
      `/api/v1/restaurants/${restId}/usage/orders/count`,
      null,
      auth,
    );
    orderCount.status === 200 ? pass('Get order count') : fail('Get order count', orderCount.body);

    const prodCount = await request(
      'GET',
      `/api/v1/restaurants/${restId}/usage/products/${prodId}/count`,
      null,
      auth,
    );
    prodCount.status === 200
      ? pass('Get product order count')
      : fail('Get product count', prodCount.body);

    const topProducts = await request(
      'GET',
      `/api/v1/restaurants/${restId}/usage/products/top`,
      null,
      auth,
    );
    topProducts.status === 200 ? pass('Get top products') : fail('Get top', topProducts.body);

    const daily = await request(
      'GET',
      `/api/v1/restaurants/${restId}/usage/orders/daily?days=7`,
      null,
      auth,
    );
    daily.status === 200 ? pass('Get daily orders') : fail('Get daily', daily.body);

    // =============================================
    // TENANT ISOLATION TESTS
    // =============================================

    const reg2 = await request('POST', '/api/v1/auth/register', {
      email: `m8test2-${Date.now()}@test.com`,
      password: 'M8Test123!',
      firstName: 'M8b',
      lastName: 'User',
      tenantName: `M8Tenant2-${Date.now()}`,
    });
    const login2 = await request('POST', '/api/v1/auth/login', {
      email: reg2.body.user.email,
      password: 'M8Test123!',
    });
    const auth2 = { Authorization: `Bearer ${login2.body.tokens.accessToken}` };

    const otherIng = await request('GET', '/api/v1/ingredients', null, auth2);
    otherIng.status === 200 && otherIng.body.data.length === 0
      ? pass('Tenant isolation: ingredients')
      : fail('Isolation ingredients', otherIng.body);

    const otherSup = await request('GET', '/api/v1/suppliers', null, auth2);
    otherSup.status === 200 && otherSup.body.data.length === 0
      ? pass('Tenant isolation: suppliers')
      : fail('Isolation suppliers', otherSup.body);

    const otherUsage = await request(
      'GET',
      `/api/v1/restaurants/${restId}/usage/orders/count`,
      null,
      auth2,
    );
    otherUsage.status === 404 || otherUsage.status === 403
      ? pass('Tenant isolation: usage')
      : fail('Isolation usage', otherUsage.status);
  } catch (e) {
    fail('Exception', e.message);
  }

  console.log('\n========== M8 VERIFICATION ==========\n');
  results.forEach((r) => console.log(r));
  const passed = results.filter((r) => r.startsWith('✅')).length;
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\nPassed: ${passed} | Failed: ${failed} | Total: ${results.length}`);
}

main().catch(console.error);
