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

async function waitForServer(url, maxRetries = 40) {
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
  const pass = (name) => results.push(`✅ ${name}`);
  const fail = (name, e) =>
    results.push(`❌ ${name}: ${typeof e === 'object' ? JSON.stringify(e) : e}`);

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
    // Health
    const h = await request('GET', '/api/v1/health');
    h.status === 200 ? pass('Health check') : fail('Health', h.status);

    // Register + Login
    const reg = await request('POST', '/api/v1/auth/register', {
      email: `m5test-${Date.now()}@test.com`,
      password: 'M5Test123!',
      firstName: 'M5',
      lastName: 'User',
      tenantName: `M5Tenant-${Date.now()}`,
    });
    reg.status === 201 ? pass('Register user') : fail('Register', reg.body);
    const login = await request('POST', '/api/v1/auth/login', {
      email: reg.body.user.email,
      password: 'M5Test123!',
    });
    login.status === 200 ? pass('Login') : fail('Login', login.body);
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    // Create restaurant
    const rest = await request(
      'POST',
      '/api/v1/restaurants',
      { name: 'M5 Rest', slug: `m5-rest-${Date.now()}` },
      auth,
    );
    rest.status === 201 ? pass('Create restaurant') : fail('Create restaurant', rest.body);
    const restId = rest.body.id;

    // Create product for testing
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
        name: 'Burger',
        basePrice: 12.0,
        menuCategoryId: cat.body.id,
        sku: `BRG-${Date.now()}`,
      },
      auth,
    );
    const prodId = prod.body.id;

    // =============================================
    // PRODUCT TAG TESTS
    // =============================================

    const tag = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tags`,
      {
        name: 'Vegetarian',
        description: 'Plant-based options',
      },
      auth,
    );
    tag.status === 201 ? pass('Create product tag') : fail('Create product tag', tag.body);
    const tagId = tag.body.id;

    const tag2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tags`,
      {
        name: 'Spicy',
        slug: 'spicy',
      },
      auth,
    );
    tag2.status === 201 ? pass('Create second tag') : fail('Create second tag', tag2.body);

    const tags = await request('GET', `/api/v1/restaurants/${restId}/tags`, null, auth);
    tags.status === 200 && tags.body.data.length === 2
      ? pass('List product tags')
      : fail('List product tags', tags.body);

    const tagOne = await request('GET', `/api/v1/restaurants/${restId}/tags/${tagId}`, null, auth);
    tagOne.status === 200 && tagOne.body.name === 'Vegetarian'
      ? pass('Get tag by ID')
      : fail('Get tag', tagOne.body);

    const tagUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/tags/${tagId}`,
      {
        description: 'Updated desc',
      },
      auth,
    );
    tagUpd.status === 200 ? pass('Update product tag') : fail('Update product tag', tagUpd.body);

    // Duplicate slug conflict
    const tagDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tags`,
      {
        name: 'Spicy',
      },
      auth,
    );
    tagDup.status === 409 ? pass('Tag slug conflict') : fail('Tag slug conflict', tagDup.status);

    // Assign tags to product
    const assignTags = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/tags`,
      {
        tagIds: [tagId, tag2.body.id],
      },
      auth,
    );
    assignTags.status === 201
      ? pass('Assign tags to product')
      : fail('Assign tags', assignTags.body);

    // List product tags
    const prodTags = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/tags`,
      null,
      auth,
    );
    prodTags.status === 200 && prodTags.body.length === 2
      ? pass('List product tags (assigned)')
      : fail('List assigned tags', prodTags.body);

    // Remove tag from product
    const removeTag = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/tags/${tagId}`,
      null,
      auth,
    );
    removeTag.status === 200
      ? pass('Remove tag from product')
      : fail('Remove tag', removeTag.status);

    // Verify removal
    const prodTagsAfter = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/tags`,
      null,
      auth,
    );
    prodTagsAfter.status === 200 && prodTagsAfter.body.length === 1
      ? pass('Tag removal verified')
      : fail('Tag removal verify', prodTagsAfter.body);

    // Validation
    const badTag = await request('POST', `/api/v1/restaurants/${restId}/tags`, { name: '' }, auth);
    badTag.status === 400 ? pass('Validation: bad tag') : fail('Validation', badTag.status);

    // =============================================
    // ALLERGEN TESTS
    // =============================================

    const allergen = await request(
      'POST',
      `/api/v1/restaurants/${restId}/allergens`,
      {
        name: 'Peanuts',
        description: 'Peanut allergy',
      },
      auth,
    );
    allergen.status === 201 ? pass('Create allergen') : fail('Create allergen', allergen.body);
    const allergenId = allergen.body.id;

    const allergen2 = await request(
      'POST',
      `/api/v1/restaurants/${restId}/allergens`,
      {
        name: 'Gluten',
        slug: 'gluten',
      },
      auth,
    );
    allergen2.status === 201
      ? pass('Create second allergen')
      : fail('Create second allergen', allergen2.body);

    const allergens = await request('GET', `/api/v1/restaurants/${restId}/allergens`, null, auth);
    allergens.status === 200 && allergens.body.data.length === 2
      ? pass('List allergens')
      : fail('List allergens', allergens.body);

    const allergenOne = await request(
      'GET',
      `/api/v1/restaurants/${restId}/allergens/${allergenId}`,
      null,
      auth,
    );
    allergenOne.status === 200 && allergenOne.body.name === 'Peanuts'
      ? pass('Get allergen by ID')
      : fail('Get allergen', allergenOne.body);

    const allergenUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/allergens/${allergenId}`,
      {
        description: 'Updated allergen',
      },
      auth,
    );
    allergenUpd.status === 200
      ? pass('Update allergen')
      : fail('Update allergen', allergenUpd.body);

    // Duplicate slug conflict
    const allergenDup = await request(
      'POST',
      `/api/v1/restaurants/${restId}/allergens`,
      {
        name: 'Gluten',
      },
      auth,
    );
    allergenDup.status === 409
      ? pass('Allergen slug conflict')
      : fail('Allergen slug conflict', allergenDup.status);

    // Assign allergens to product
    const assignAllergens = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/allergens`,
      {
        allergenIds: [allergenId, allergen2.body.id],
      },
      auth,
    );
    assignAllergens.status === 201
      ? pass('Assign allergens to product')
      : fail('Assign allergens', assignAllergens.body);

    // List product allergens
    const prodAllergens = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/allergens`,
      null,
      auth,
    );
    prodAllergens.status === 200 && prodAllergens.body.length === 2
      ? pass('List product allergens (assigned)')
      : fail('List assigned allergens', prodAllergens.body);

    // Remove allergen from product
    const removeAllergen = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/allergens/${allergenId}`,
      null,
      auth,
    );
    removeAllergen.status === 200
      ? pass('Remove allergen from product')
      : fail('Remove allergen', removeAllergen.status);

    // Verify removal
    const prodAllergensAfter = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/allergens`,
      null,
      auth,
    );
    prodAllergensAfter.status === 200 && prodAllergensAfter.body.length === 1
      ? pass('Allergen removal verified')
      : fail('Allergen removal verify', prodAllergensAfter.body);

    // Validation
    const badAllergen = await request(
      'POST',
      `/api/v1/restaurants/${restId}/allergens`,
      { name: '' },
      auth,
    );
    badAllergen.status === 400
      ? pass('Validation: bad allergen')
      : fail('Validation', badAllergen.status);

    // =============================================
    // NUTRITIONAL INFO TESTS
    // =============================================

    const nutrition = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/nutrition`,
      {
        calories: 350,
        protein: 25.5,
        carbs: 30.0,
        fat: 12.5,
        fiber: 3.0,
        sugar: 5.0,
        sodium: 480.0,
      },
      auth,
    );
    nutrition.status === 201
      ? pass('Create nutritional info')
      : fail('Create nutrition', nutrition.body);

    // Get nutritional info
    const nutritionGet = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/nutrition`,
      null,
      auth,
    );
    nutritionGet.status === 200 && nutritionGet.body.calories === 350
      ? pass('Get nutritional info')
      : fail('Get nutrition', nutritionGet.body);

    // Update (upsert) nutritional info
    const nutritionUpd = await request(
      'PUT',
      `/api/v1/restaurants/${restId}/products/${prodId}/nutrition`,
      {
        calories: 400,
        protein: 30.0,
      },
      auth,
    );
    nutritionUpd.status === 200 && nutritionUpd.body.calories === 400
      ? pass('Update nutritional info (upsert)')
      : fail('Update nutrition', nutritionUpd.body);

    // Idempotent create (upsert)
    const nutritionIdempotent = await request(
      'POST',
      `/api/v1/restaurants/${restId}/products/${prodId}/nutrition`,
      {
        calories: 500,
      },
      auth,
    );
    nutritionIdempotent.status === 201
      ? pass('Idempotent create (upsert existing)')
      : fail('Idempotent upsert', nutritionIdempotent.body);

    // Delete nutritional info
    const delNutrition = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/products/${prodId}/nutrition`,
      null,
      auth,
    );
    delNutrition.status === 200
      ? pass('Delete nutritional info')
      : fail('Delete nutrition', delNutrition.status);

    // Verify deleted
    const nutritionDeleted = await request(
      'GET',
      `/api/v1/restaurants/${restId}/products/${prodId}/nutrition`,
      null,
      auth,
    );
    nutritionDeleted.status === 404
      ? pass('Deleted nutrition returns 404')
      : fail('Deleted nutrition check', nutritionDeleted.status);

    // =============================================
    // SOFT DELETE + RESTORE TESTS
    // =============================================

    // Soft delete tag
    const delTag = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/tags/${tagId}`,
      null,
      auth,
    );
    delTag.status === 200 ? pass('Soft delete tag') : fail('Soft delete tag', delTag.status);

    // Tag no longer in active list
    const tagsAfterDel = await request('GET', `/api/v1/restaurants/${restId}/tags`, null, auth);
    tagsAfterDel.body.data.length === 1
      ? pass('Deleted tag excluded from list')
      : fail('Tag list after delete', tagsAfterDel.body);

    // Restore tag
    const resTag = await request(
      'POST',
      `/api/v1/restaurants/${restId}/tags/${tagId}/restore`,
      null,
      auth,
    );
    resTag.status === 200 ? pass('Restore tag') : fail('Restore tag', resTag.body);

    // Soft delete allergen
    const delAllergen = await request(
      'DELETE',
      `/api/v1/restaurants/${restId}/allergens/${allergenId}`,
      null,
      auth,
    );
    delAllergen.status === 200
      ? pass('Soft delete allergen')
      : fail('Soft delete allergen', delAllergen.status);

    // Allergen no longer in active list
    const allergensAfterDel = await request(
      'GET',
      `/api/v1/restaurants/${restId}/allergens`,
      null,
      auth,
    );
    allergensAfterDel.body.data.length === 1
      ? pass('Deleted allergen excluded from list')
      : fail('Allergen list after delete', allergensAfterDel.body);

    // Restore allergen
    const resAllergen = await request(
      'POST',
      `/api/v1/restaurants/${restId}/allergens/${allergenId}/restore`,
      null,
      auth,
    );
    resAllergen.status === 200
      ? pass('Restore allergen')
      : fail('Restore allergen', resAllergen.body);
  } catch (e) {
    fail('Exception', e.message);
  }

  console.log('\n========== M5 VERIFICATION ==========\n');
  results.forEach((r) => console.log(r));
  const passed = results.filter((r) => r.startsWith('✅')).length;
  const failed = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\nPassed: ${passed} | Failed: ${failed} | Total: ${results.length}`);

  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
