/**
 * HTTP load / soak harness for the API container.
 *
 * No external dependencies (Node 18+ global fetch). It:
 *   1. logs in once to obtain a bearer token,
 *   2. probes a candidate endpoint list and keeps only the ones that work,
 *   3. drives N concurrent workers for a fixed duration,
 *   4. prints throughput, latency percentiles and a status-code breakdown.
 *
 * Usage:
 *   node scripts/load-test.js [--base http://127.0.0.1:3001] [--concurrency 32]
 *                             [--duration 60] [--email x] [--password y]
 *
 * Exit code is non-zero if any 5xx or network error occurred.
 */
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = opt('base', 'http://127.0.0.1:3001');
const PREFIX = opt('prefix', '/api/v1');
const CONCURRENCY = Number(opt('concurrency', '32'));
const DURATION_S = Number(opt('duration', '60'));
const EMAIL = opt('email', 'demo@tablofy.local');
const PASSWORD = opt('password', 'demo1234');
const WARMUP_MS = 3000;

const CANDIDATES = [
  // Unauthenticated: health machinery (Postgres + Redis + BullMQ + disk).
  { path: '/health', auth: false, weight: 4 },
  { path: '/health/live', auth: false, weight: 1 },
  { path: '/health/ready', auth: false, weight: 1 },
  // Authenticated read paths across the app.
  { path: '/restaurants', auth: true, weight: 3 },
  { path: '/subscriptions/plans', auth: true, weight: 2 },
  { path: '/subscriptions/current', auth: true, weight: 2 },
  { path: '/inventory/items', auth: true, weight: 3 },
  { path: '/inventory/categories', auth: true, weight: 2 },
  { path: '/inventory/low-stock', auth: true, weight: 2 },
  { path: '/customers', auth: true, weight: 3 },
  { path: '/customers/segments', auth: true, weight: 2 },
  { path: '/executive-dashboard/kpi', auth: true, weight: 2 },
  { path: '/sales-analytics/overview', auth: true, weight: 2 },
  { path: '/financial-analytics/overview', auth: true, weight: 2 },
  { path: '/warehouses', auth: true, weight: 2 },
  { path: '/suppliers', auth: true, weight: 2 },
  { path: '/forecasting-dashboard/trends', auth: true, weight: 1 },
  { path: '/crm/analytics', auth: true, weight: 1 },
  { path: '/schedules', auth: true, weight: 1 },
  { path: '/queues/cleanup/stats', auth: true, weight: 1 },
];

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
};

async function login() {
  const res = await fetch(`${BASE}${PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.tokens?.accessToken ?? body.accessToken;
}

async function probe(token) {
  const usable = [];
  for (const ep of CANDIDATES) {
    try {
      const res = await fetch(`${BASE}${PREFIX}${ep.path}`, {
        headers: ep.auth ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        usable.push(ep);
      } else {
        console.log(`  skip ${ep.path} -> ${res.status}`);
      }
    } catch (err) {
      console.log(`  skip ${ep.path} -> ${err.name}`);
    }
  }
  return usable;
}

function buildSchedule(usable) {
  const schedule = [];
  let total = 0;
  for (const ep of usable) total += ep.weight;
  for (const ep of usable) {
    const n = Math.max(1, Math.round((ep.weight / total) * 1000));
    for (let i = 0; i < n; i++) schedule.push(ep);
  }
  return schedule;
}

async function main() {
  console.log(`load-test base=${BASE} concurrency=${CONCURRENCY} duration=${DURATION_S}s`);
  const token = await login();
  console.log('logged in; probing endpoints...');
  const usable = await probe(token);
  if (!usable.length) throw new Error('no usable endpoints');
  const schedule = buildSchedule(usable);
  console.log(`using ${usable.length} endpoints: ${usable.map((e) => e.path).join(', ')}`);

  const latencies = [];
  const byStatus = new Map();
  const byEndpoint = new Map();
  let errors = 0;
  let aborted = false;
  let recording = false;

  const noteEndpoint = (path, status) => {
    if (!recording || status === 200) return;
    const key = status === undefined ? 'network-error' : `${path} -> ${status}`;
    byEndpoint.set(key, (byEndpoint.get(key) || 0) + 1);
  };

  const record = (ms, status) => {
    if (status === undefined) {
      if (recording) errors++;
      return;
    }
    if (!recording) return;
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    if (status >= 500) errors++;
    latencies.push(ms);
  };

  const worker = async (id) => {
    let i = id;
    while (!aborted) {
      const ep = schedule[i++ % schedule.length];
      const started = performance.now();
      try {
        const res = await fetch(`${BASE}${PREFIX}${ep.path}`, {
          headers: ep.auth ? { authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(30000),
        });
        await res.arrayBuffer();
        noteEndpoint(ep.path, res.status);
        record(performance.now() - started, res.status);
      } catch {
        noteEndpoint(ep.path, undefined);
        record(performance.now() - started, undefined);
      }
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));

  await new Promise((r) => setTimeout(r, WARMUP_MS));
  latencies.length = 0;
  byStatus.clear();
  byEndpoint.clear();
  errors = 0;
  recording = true;
  const stats = await fetch(`${BASE}${PREFIX}/health`).then((r) => r.json());
  const before = {
    rss: process.memoryUsage().rss,
    heapUsed: process.memoryUsage().heapUsed,
    queues: Object.keys(stats.info?.bullmq || {}).length,
  };

  const startedAt = Date.now();
  const wallStart = performance.now();
  await new Promise((r) => setTimeout(r, DURATION_S * 1000));
  aborted = true;
  await Promise.allSettled(workers);
  const elapsedS = (performance.now() - wallStart) / 1000;

  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.length;
  const statusReport = [...byStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${s}:${c} (${((c / (total + errors)) * 100).toFixed(1)}%)`)
    .join('  ');

  console.log('');
  console.log('=== load-test results ===');
  console.log(
    `window          : ${elapsedS.toFixed(1)}s (started ${new Date(startedAt).toISOString()})`,
  );
  console.log(`concurrency     : ${CONCURRENCY}`);
  console.log(`requests        : ${total} ok, ${errors} failed`);
  console.log(`throughput      : ${(total / elapsedS).toFixed(1)} req/s`);
  console.log(`latency p50     : ${percentile(sorted, 50).toFixed(1)} ms`);
  console.log(`latency p95     : ${percentile(sorted, 95).toFixed(1)} ms`);
  console.log(`latency p99     : ${percentile(sorted, 99).toFixed(1)} ms`);
  console.log(`latency max     : ${sorted.length ? sorted[sorted.length - 1].toFixed(1) : 0} ms`);
  console.log(`status codes    : ${statusReport || 'none'}`);
  if (byEndpoint.size) {
    console.log('non-200 detail  :');
    [...byEndpoint.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, c]) => console.log(`  ${String(c).padStart(6)}  ${k}`));
  }
  console.log(
    `heap delta      : ${((process.memoryUsage().heapUsed - before.heapUsed) / 1048576).toFixed(1)} MiB`,
  );

  if (errors > 0) {
    console.error(`\nFAILED: ${errors} error/5xx response(s)`);
    process.exitCode = 1;
  } else {
    console.log('\nOK: no errors or 5xx responses');
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
});
