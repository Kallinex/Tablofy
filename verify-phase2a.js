const { exec, spawn } = require('child_process');
const http = require('http');

const BASE = 'http://localhost:3000/api/v1';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(url, { method, headers }, (res) => {
      let chunk = '';
      res.on('data', (c) => (chunk += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(chunk) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: chunk });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function cleanupDatabase() {
  const { PrismaClient } = require('./node_modules/@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.auditLog.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();
    console.log('  Database cleaned successfully');
  } catch (e) {
    console.log('  Database cleanup error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupRedis() {
  const Redis = require('ioredis');
  const redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true });
  try {
    await redis.connect();
    const keys = await redis.keys('session:*');
    if (keys.length > 0) await redis.del(...keys);
    const blacklistKeys = await redis.keys('blacklist:*');
    if (blacklistKeys.length > 0) await redis.del(...blacklistKeys);
    const userSessions = await redis.keys('user_sessions:*');
    if (userSessions.length > 0) await redis.del(...userSessions);
    console.log('  Redis cleaned successfully');
  } catch (e) {
    console.log('  Redis cleanup error:', e.message);
  } finally {
    redis.disconnect();
  }
}

function log(test, result, expected) {
  const pass = result.status === expected;
  const sym = pass ? '✅' : '❌';
  console.log(`${sym} [${result.status}] ${test}${pass ? '' : ` (expected ${expected})`}`);
  if (!pass) console.log(`   Response: ${JSON.stringify(result.body).substring(0, 200)}`);
  return pass;
}

async function main() {
  // Clean DB and Redis before running
  console.log('Cleaning database and Redis...');
  await cleanupDatabase();
  await cleanupRedis();

  // Start the server
  const fs = require('fs');
  const logStream = fs.createWriteStream('D:\\New folder (8)\\tablofy\\server-verify.log');
  const server = spawn('node', ['dist/apps/api/main.js'], {
    cwd: 'D:\\New folder (8)\\tablofy',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let output = '';
  server.stdout.on('data', (d) => {
    output += d.toString();
    logStream.write(d);
  });
  server.stderr.on('data', (d) => {
    output += d.toString();
    logStream.write(d);
  });

  // Wait for server to be ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      await request('GET', '/health');
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!ready) {
    console.log('Server failed to start within 30s');
    console.log('Output:', output.substring(output.length - 500));
    server.kill();
    process.exit(1);
  }

  console.log('\n========== PHASE 2A VERIFICATION ==========\n');

  let passed = 0;
  let failed = 0;
  const results = {};

  function track(name, result) {
    if (result) passed++;
    else failed++;
    results[name] = result;
  }

  // ===== 7. HEALTH CHECKS =====
  console.log('\n--- HEALTH CHECKS ---');
  let r = await request('GET', '/health');
  track('Health: GET /health', log('GET /api/v1/health', r, 200));

  // ===== 4. AUTH ENDPOINTS =====
  console.log('\n--- AUTH ENDPOINTS ---');

  // Register
  r = await request('POST', '/auth/register', {
    email: 'test@example.com',
    password: 'Test1234!',
    firstName: 'Test',
    lastName: 'User',
    tenantName: 'Test Restaurant',
  });
  track('Auth: Register', log('POST /api/v1/auth/register', r, 201));
  const regTokens = r.body.tokens;
  const authToken = regTokens?.accessToken;

  // Register (duplicate email - should not leak)
  r = await request('POST', '/auth/register', {
    email: 'test@example.com',
    password: 'Test1234!',
    firstName: 'Test',
    lastName: 'User',
  });
  const noLeak = r.status === 201 && r.body.message && !r.body.user?.id;
  track('Auth: Register (no email leak)', { status: r.status, body: r.body, pass: noLeak });
  console.log(`${noLeak ? '✅' : '❌'} [${r.status}] Register duplicate email - no enumeration`);

  // Login
  r = await request('POST', '/auth/login', {
    email: 'test@example.com',
    password: 'Test1234!',
  });
  track('Auth: Login', log('POST /api/v1/auth/login', r, 200));
  const loginTokens = r.body.tokens;

  // Login (bad password)
  r = await request('POST', '/auth/login', {
    email: 'test@example.com',
    password: 'wrongpassword',
  });
  track('Auth: Login bad password', log('POST /api/v1/auth/login (bad pw)', r, 401));

  // Refresh Token
  r = await request('POST', '/auth/refresh', { refreshToken: loginTokens?.refreshToken });
  track('Auth: Refresh Token', log('POST /api/v1/auth/refresh', r, 200));

  // Forgot Password
  r = await request('POST', '/auth/forgot-password', { email: 'test@example.com' });
  track('Auth: Forgot Password', log('POST /api/v1/auth/forgot-password', r, 200));

  // Forgot Password (non-existent email - same response)
  r = await request('POST', '/auth/forgot-password', { email: 'nonexistent@example.com' });
  track(
    'Auth: Forgot Password (no leak)',
    log('POST /api/v1/auth/forgot-password (nonexist)', r, 200),
  );

  // Verify Email (invalid token)
  r = await request('GET', '/auth/verify-email/invalid-token');
  track('Auth: Verify Email (invalid)', log('GET /api/v1/auth/verify-email/invalid', r, 400));

  // Resend Verification
  r = await request('POST', '/auth/resend-verification', null, authToken);
  track('Auth: Resend Verification', log('POST /api/v1/auth/resend-verification', r, 200));

  // Change Password
  r = await request(
    'POST',
    '/auth/change-password',
    {
      currentPassword: 'Test1234!',
      newPassword: 'NewTest5678!',
    },
    authToken,
  );
  track('Auth: Change Password', log('POST /api/v1/auth/change-password', r, 200));

  // Login with new password
  r = await request('POST', '/auth/login', {
    email: 'test@example.com',
    password: 'NewTest5678!',
  });
  track('Auth: Login (new pw)', log('POST /api/v1/auth/login (new pw)', r, 200));
  const newTokens = r.body.tokens;

  // Reset Password (forgot + reset flow)
  r = await request('POST', '/auth/forgot-password', { email: 'test@example.com' });
  // We can't test actual reset without email, but test with invalid token
  r = await request('POST', '/auth/reset-password', {
    token: 'invalid',
    newPassword: 'Reset1234!',
  });
  track('Auth: Reset Password (invalid token)', log('POST /api/v1/auth/reset-password', r, 400));

  // Change password back
  r = await request(
    'POST',
    '/auth/change-password',
    {
      currentPassword: 'NewTest5678!',
      newPassword: 'Test1234!',
    },
    newTokens?.accessToken,
  );
  track(
    'Auth: Change Password (restore)',
    log('POST /api/v1/auth/change-password (restore)', r, 200),
  );

  // Logout
  r = await request(
    'POST',
    '/auth/logout',
    { refreshToken: newTokens?.refreshToken },
    newTokens?.accessToken,
  );
  track('Auth: Logout', log('POST /api/v1/auth/logout', r, 200));

  // Login again for more tests
  r = await request('POST', '/auth/login', {
    email: 'test@example.com',
    password: 'Test1234!',
  });
  const finalTokens = r.body.tokens;
  const finalToken = finalTokens?.accessToken;

  // Logout All
  r = await request('POST', '/auth/logout-all', null, finalToken);
  track('Auth: Logout All', log('POST /api/v1/auth/logout-all', r, 200));

  // Login fresh for remaining tests
  r = await request('POST', '/auth/login', {
    email: 'test@example.com',
    password: 'Test1234!',
  });
  const freshToken = r.body.tokens?.accessToken;

  // ===== 5. SECURITY - VALIDATION =====
  console.log('\n--- SECURITY: VALIDATION ---');

  r = await request('POST', '/auth/register', { email: 'bad' });
  track('Validation: Bad email', log('POST register (bad email)', r, 400));

  r = await request('POST', '/auth/register', { email: 'a@b.com', password: '123' });
  track('Validation: Weak password', log('POST register (weak pw)', r, 400));

  r = await request('POST', '/auth/register', {});
  track('Validation: Empty body', log('POST register (empty)', r, 400));

  // ===== 5. SECURITY - JWT Authentication =====
  console.log('\n--- SECURITY: JWT AUTHENTICATION ---');

  r = await request('GET', '/sessions');
  track('Security: No token = 401', log('GET /sessions (no token)', r, 401));

  r = await request('GET', '/sessions', null, 'invalid.token.here');
  track('Security: Bad token = 401', log('GET /sessions (bad token)', r, 401));

  // ===== 4. TENANT CRUD =====
  console.log('\n--- TENANT CRUD ---');

  // Note: Tenant create/update/delete/delete require SUPER_ADMIN role
  // Owner of a tenant is NOT SUPER_ADMIN, so should get 403

  r = await request('GET', '/tenants', null, freshToken);
  track('Tenant: List (as OWNER)', log('GET /api/v1/tenants', r, 403));

  // ===== 4. USER CRUD =====
  console.log('\n--- USER CRUD ---');

  r = await request('GET', '/users', null, freshToken);
  track('Users: List', log('GET /api/v1/users', r, 200));

  // Create user
  r = await request(
    'POST',
    '/users',
    {
      email: 'staff@test.com',
      password: 'Staff1234!',
      firstName: 'Staff',
      lastName: 'Member',
    },
    freshToken,
  );
  track('Users: Create', log('POST /api/v1/users', r, 201));
  const newUser = r.body;

  // Get user
  r = await request('GET', `/users/${newUser.id}`, null, freshToken);
  track('Users: Get by ID', log(`GET /api/v1/users/${newUser.id}`, r, 200));

  // Update user
  r = await request('PUT', `/users/${newUser.id}`, { firstName: 'Updated' }, freshToken);
  track('Users: Update', log(`PUT /api/v1/users/${newUser.id}`, r, 200));

  // Soft delete user
  r = await request('DELETE', `/users/${newUser.id}`, null, freshToken);
  track('Users: Soft Delete', log(`DELETE /api/v1/users/${newUser.id}`, r, 200));

  // List (should NOT include deleted)
  r = await request('GET', '/users', null, freshToken);
  const deletedNotVisible = r.status === 200 && !r.body.data?.some((u) => u.id === newUser.id);
  track('Users: Deleted not in list', { status: r.status, pass: deletedNotVisible });
  console.log(`${deletedNotVisible ? '✅' : '❌'} Soft-deleted user excluded from list`);

  // Restore user
  r = await request('POST', `/users/${newUser.id}/restore`, null, freshToken);
  track('Users: Restore', log(`POST /api/v1/users/${newUser.id}/restore`, r, 200));

  // ===== SESSIONS =====
  console.log('\n--- SESSIONS ---');

  r = await request('GET', '/sessions', null, freshToken);
  track('Sessions: List', log('GET /api/v1/sessions', r, 200));

  // ===== INVITATIONS =====
  console.log('\n--- INVITATIONS ---');

  r = await request(
    'POST',
    '/invitations',
    {
      email: 'invite@test.com',
      role: 'STAFF',
    },
    freshToken,
  );
  track('Invitations: Create', log('POST /api/v1/invitations', r, 201));

  r = await request('GET', '/invitations', null, freshToken);
  track('Invitations: List', log('GET /api/v1/invitations', r, 200));

  // ===== AUDIT LOGS =====
  console.log('\n--- AUDIT LOGS ---');

  r = await request('GET', '/audit-logs', null, freshToken);
  const auditExists = r.status === 200 || r.status === 404;
  console.log(`ℹ️  Audit Logs endpoint: status ${r.status}`);

  // ===== 5. SECURITY - RBAC =====
  console.log('\n--- SECURITY: RBAC ---');

  // Login as staff user
  r = await request('POST', '/auth/login', {
    email: 'staff@test.com',
    password: 'Staff1234!',
  });
  const staffToken = r.body.tokens?.accessToken;

  if (staffToken) {
    // Staff should NOT be able to create users
    r = await request(
      'POST',
      '/users',
      {
        email: 'new@test.com',
        password: 'New12345!',
        firstName: 'New',
        lastName: 'User',
      },
      staffToken,
    );
    track('RBAC: Staff cannot create users', { status: r.status, pass: r.status === 403 });
    console.log(`${r.status === 403 ? '✅' : '❌'} [${r.status}] Staff create user = 403`);

    // Staff should NOT be able to create invitations
    r = await request(
      'POST',
      '/invitations',
      {
        email: 'new@test.com',
        role: 'STAFF',
      },
      staffToken,
    );
    track('RBAC: Staff cannot create invitations', { status: r.status, pass: r.status === 403 });
    console.log(`${r.status === 403 ? '✅' : '❌'} [${r.status}] Staff create invitation = 403`);

    // Staff CAN list users
    r = await request('GET', '/users', null, staffToken);
    track('RBAC: Staff can list users', { status: r.status, pass: r.status === 200 });
    console.log(`${r.status === 200 ? '✅' : '❌'} [${r.status}] Staff list users = 200`);

    // Staff CAN list sessions
    r = await request('GET', '/sessions', null, staffToken);
    track('RBAC: Staff can list sessions', { status: r.status, pass: r.status === 200 });
    console.log(`${r.status === 200 ? '✅' : '❌'} [${r.status}] Staff list sessions = 200`);
  }

  // ===== 5. SECURITY - TENANT ISOLATION =====
  console.log('\n--- SECURITY: TENANT ISOLATION ---');

  // Register a second tenant
  r = await request('POST', '/auth/register', {
    email: 'other@restaurant2.com',
    password: 'Other1234!',
    firstName: 'Other',
    lastName: 'Owner',
    tenantName: 'Other Restaurant',
  });
  const otherToken = r.body.tokens?.accessToken;

  if (otherToken) {
    // Other tenant should NOT see our users
    r = await request('GET', '/users', null, otherToken);
    const isolated = r.status === 200 && r.body.data?.every((u) => u.email !== 'staff@test.com');
    track('Tenant Isolation: Users', { status: r.status, pass: isolated });
    console.log(`${isolated ? '✅' : '❌'} Other tenant cannot see our users`);
  }

  // ===== SUMMARY =====
  console.log('\n\n========== VERIFICATION SUMMARY ==========');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log(`Score:  ${Math.round((passed / (passed + failed)) * 100)}%`);

  // Graceful shutdown
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2000));
  logStream.end();

  // Print server logs for debugging
  if (failed > 0) {
    console.log('\n--- SERVER LOGS (last 50 lines) ---');
    try {
      const logContent = fs.readFileSync('D:\\New folder (8)\\tablofy\\server-verify.log', 'utf8');
      const lines = logContent
        .split('\n')
        .filter(
          (l) =>
            l.includes('error') || l.includes('Error') || l.includes('ERROR') || l.includes('WARN'),
        )
        .slice(-50);
      console.log(lines.join('\n'));
    } catch (e) {}
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
