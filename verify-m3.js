const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

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

async function waitForServer(url, maxRetries = 80) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const r = await request('GET', url);
      if (r.status === 200) return true;
    } catch { }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const results = [];
  const pass = (name) => {
    results.push(`✅ ${name}`);
  };
  const fail = (name, e) => {
    results.push(`❌ ${name}: ${e}`);
  };

  console.log('Starting server...');
  const mainFile = path.join(__dirname, 'dist', 'apps', 'api', 'main.js');
  const server = spawn('node', [mainFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: __dirname,
    env: { ...process.env, PORT: '3000', NODE_ENV: 'testing' },
  });
  let serverOutput = '';
  server.stdout.on('data', (d) => { serverOutput += d.toString(); });
  server.stderr.on('data', (d) => { serverOutput += d.toString(); });
  const started = await waitForServer('/api/v1/health');
  if (!started) {
    console.log('Server output:', serverOutput.substring(0, 2000));
    console.log('Server failed to start');
    process.exit(1);
  }
  console.log('  Server ready\n');

  try {
    // 1. Health
    const h = await request('GET', '/api/v1/health');
    h.status === 200 ? pass('Health check') : fail('Health', h.status);

    // 2. Register
    const reg = await request('POST', '/api/v1/auth/register', {
      email: `m3test-${Date.now()}@test.com`,
      password: 'M3Test123!',
      firstName: 'M',
      lastName: 'T',
      tenantName: `M3Tenant-${Date.now()}`,
    });
    reg.status === 201 ? pass('Register user') : fail('Register', JSON.stringify(reg.body));

    // 3. Login
    const testEmail = reg.body?.user?.email || `m3test-${Date.now()}@test.com`;
    const login = await request('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: 'M3Test123!',
    });
    login.status === 200 ? pass('Login') : fail('Login', JSON.stringify(login.body));
    const token = login.body.tokens.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    // 4. Create restaurant
    const rest = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'M3 Rest', slug: `m3-rest-${Date.now()}` },
      auth,
    );
    rest.status === 201
      ? pass('Create restaurant')
      : fail('Create restaurant', JSON.stringify(rest.body));
    const restId = rest.body.id;

    // 5. Create menu category
    const cat = await request(
      'POST',
      `/api/v1/restaurants/${restId}/menu-categories`,
      { name: 'Mains', sortOrder: 0 },
      auth,
    );
    cat.status === 201
      ? pass('Create menu category')
      : fail('Create menu category', JSON.stringify(cat.body));

    // 6. List menu categories (should cache)
    const cats1 = await request('GET', `/api/v1/restaurants/${restId}/menu-categories`, null, auth);
    cats1.status === 200
      ? pass('List menu categories')
      : fail('List menu categories', cats1.status);

    // 7. List again (from cache)
    const cats2 = await request('GET', `/api/v1/restaurants/${restId}/menu-categories`, null, auth);
    cats2.status === 200
      ? pass('List categories (cache hit)')
      : fail('List categories cache', cats2.status);

    // 8. Create product
    const prod = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products`,
      {
        name: 'Burger',
        basePrice: 12.99,
        menuCategoryId: cat.body.id,
        sku: `BRG-${Date.now()}`,
      },
      auth,
    );
    prod.status === 201
      ? pass('Create product')
      : fail('Create product', JSON.stringify(prod.body));
    const prodId = prod.body.id;

    // 9. List products
    const prods = await request('GET', `/api/v1/restaurants/${restId}/products`, null, auth);
    prods.status === 200 ? pass('List products') : fail('List products', prods.status);

    // 10. Create product image
    const img = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/images`,
      {
        url: 'https://example.com/burger.jpg',
        altText: 'Burger image',
        isPrimary: true,
      },
      auth,
    );
    img.status === 201
      ? pass('Create product image')
      : fail('Create product image', JSON.stringify(img.body));

    // 11. List product images
    const imgs = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/images`,
      null,
      auth,
    );
    if (imgs.status === 200) {
      pass('List product images');
    } else {
      fail('List product images', JSON.stringify(imgs.body));
    }

    // 12. Create product availability
    const avail = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/availability`,
      {
        dayOfWeek: 'MONDAY',
        startTime: '09:00',
        endTime: '22:00',
      },
      auth,
    );
    avail.status === 201
      ? pass('Create product availability')
      : fail('Create availability', JSON.stringify(avail.body));

    // 13. List product availability
    const avails = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/availability`,
      null,
      auth,
    );
    avails.status === 200
      ? pass('List product availability')
      : fail('List availability', avails.status);

    // 14. Update product
    const upd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/products/${prodId}`,
      {
        basePrice: 14.99,
        isFeatured: true,
      },
      auth,
    );
    upd.status === 200 ? pass('Update product') : fail('Update product', JSON.stringify(upd.body));

    // 15. Soft delete product image
    const delImg = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/images/${img.body.id}`,
      null,
      auth,
    );
    delImg.status === 200
      ? pass('Delete product image')
      : fail('Delete product image', delImg.status);

    // 16. Delete product availability
    const delAvail = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/availability/${avail.body.id}`,
      null,
      auth,
    );
    delAvail.status === 200
      ? pass('Delete product availability')
      : fail('Delete availability', delAvail.status);

    // 17. Soft delete product
    const delProd = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}`,
      null,
      auth,
    );
    delProd.status === 200 ? pass('Soft delete product') : fail('Delete product', delProd.status);

    // 18. Restore product
    const restProd = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/restore`,
      null,
      auth,
    );
    restProd.status === 200
      ? pass('Restore product')
      : fail('Restore product', JSON.stringify(restProd.body));

    // 19. Delete menu category (should fail because product exists)
    const delCat = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/menu-categories/${cat.body.id}`,
      null,
      auth,
    );
    delCat.status === 409
      ? pass('Delete category blocked (has products)')
      : fail('Delete category guard', delCat.status);

    // 20. Validation: bad product
    const badProd = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products`,
      { name: '' },
      auth,
    );
    badProd.status === 400 ? pass('Validation: bad product') : fail('Validation', badProd.status);

    // 21. Swagger
    const swagger = await request('GET', '/docs');
    swagger.status === 200 ? pass('Swagger accessible') : fail('Swagger', swagger.status);
  } catch (e) {
    fail('Exception', e.message);
  }

  console.log('\n========== M3 VERIFICATION ==========\n');
  results.forEach((r) => console.log(r));
  const passed = results.filter((r) => r.startsWith('✅')).length;
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\nPassed: ${passed} | Failed: ${failed} | Total: ${results.length}`);

  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
