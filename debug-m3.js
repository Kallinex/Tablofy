const http = require('http');
async function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000,
      path, method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Get token first
  const login = await request('POST', '/api/v1/auth/login', { email: 'test@test.com', password: 'Test123!' });
  const token = login.body?.data?.accessToken || login.body?.accessToken;
  const h = { authorization: `Bearer ${token}` };

  const endpoints = [
    'GET /api/v1/executive-dashboard/top-categories',
    'GET /api/v1/sales-analytics/by-category',
    'GET /api/v1/inventory-analytics/waste',
    'GET /api/v1/inventory-analytics/consumption',
    'GET /api/v1/customer-analytics/churn',
    'GET /api/v1/customer-analytics/rfm',
    'GET /api/v1/crm-analytics/promotions',
    'GET /api/v1/supplier-analytics/overview',
    'GET /api/v1/supplier-analytics/purchase-trends',
  ];

  for (const ep of endpoints) {
    const [method, p] = ep.split(' ');
    const r = await request(method, p, null, h);
    const bodyStr = typeof r.body === 'object' ? JSON.stringify(r.body).substring(0, 1000) : String(r.body).substring(0, 1000);
    console.log(`${ep} => ${r.status}`);
    console.log(`  ${bodyStr}`);
  }
}
main().catch(console.error);
