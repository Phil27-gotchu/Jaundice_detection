// tests/blackbox/blackbox.test.js
// Exactly 20 black-box tests (BB-01 to BB-20). Only the README contract is used.
// Run from project root:  API_KEY=yourkey node --test "tests/blackbox/blackbox.test.js"
//
// >>> Adjust the CONFIG block if your setup differs <<<

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

// ---------- CONFIG ----------
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const API_KEY = process.env.API_KEY || 'CHANGE_ME';
const SERVER_CMD = ['server/index.js'];
// ----------------------------

let proc;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reading = (over = {}) => ({
  deviceId: 'probe-1',
  r: 120, g: 150, b: 100,
  bgRatio: 0.6667, brRatio: 0.8333, odDiff: 0.4,
  ...over,
});

const post = (path, body, key = API_KEY) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-API-Key': key } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const list = async (qs = '') => {
  const res = await fetch(`${BASE}/api/readings${qs}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.readings ?? data.data ?? []);
};

const clear = () => post('/api/clear', {});

before(async () => {
  proc = spawn('node', SERVER_CMD, {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('Server did not start');
});

after(() => proc && proc.kill());

// ---------- Authentication ----------

test('BB-01 valid API key accepted on POST /api/readings', async () => {
  const res = await post('/api/readings', reading());
  assert.equal(res.status, 200);
});

test('BB-02 missing API key gives 401 on POST /api/readings', async () => {
  const res = await post('/api/readings', reading(), null);
  assert.equal(res.status, 401);
});

test('BB-03 wrong API key gives 401 on POST /api/heartbeat', async () => {
  const res = await post('/api/heartbeat', { deviceId: 'probe-1' }, 'wrong-key');
  assert.equal(res.status, 401);
});

test('BB-04 wrong API key gives 401 on POST /api/clear', async () => {
  await clear();
  await post('/api/readings', reading());
  const res = await post('/api/clear', {}, 'wrong-key');
  assert.equal(res.status, 401);
  assert.equal((await list()).length, 1, 'data must survive an unauthorised clear');
});

// ---------- Input validation ----------

test('BB-05 malformed JSON gives 400', async () => {
  const res = await post('/api/readings', '{bad json');
  assert.equal(res.status, 400);
});

test('BB-06 empty body gives 400', async () => {
  const res = await post('/api/readings', '');
  assert.equal(res.status, 400);
});

test('BB-07 missing required fields give 400', async () => {
  const res = await post('/api/readings', { deviceId: 'probe-1' });
  assert.equal(res.status, 400);
});

test('BB-08 non-numeric value gives 400', async () => {
  const res = await post('/api/readings', reading({ r: 'abc' }));
  assert.equal(res.status, 400);
});

test('BB-09 numeric string is accepted', async () => {
  const res = await post('/api/readings', reading({ r: '120', g: '150', b: '100' }));
  assert.equal(res.status, 200);
});

// ---------- Reading data ----------

test('BB-10 empty store returns an empty list', async () => {
  await clear();
  assert.equal((await list()).length, 0);
});

test('BB-11 posted reading is returned by GET /api/readings', async () => {
  await clear();
  await post('/api/readings', reading({ deviceId: 'probe-xyz', r: 77 }));
  const all = await list();
  assert.equal(all.length, 1);
  assert.equal(all[0].deviceId, 'probe-xyz');
  assert.equal(Number(all[0].r), 77);
});

test('BB-12 history is capped at 200 readings (oldest evicted)', async () => {
  await clear();
  for (let i = 1; i <= 201; i++) await post('/api/readings', reading({ r: i }));
  const all = await list('?limit=1000');
  assert.ok(all.length <= 200, `got ${all.length}`);
  const rs = all.map((x) => Number(x.r));
  assert.ok(!rs.includes(1), 'oldest should be evicted');
  assert.ok(rs.includes(201), 'newest should be kept');
});

test('BB-13 limit=1 returns exactly one reading', async () => {
  await clear();
  for (let i = 0; i < 3; i++) await post('/api/readings', reading({ r: 10 + i }));
  assert.equal((await list('?limit=1')).length, 1);
});

test('BB-14 invalid limit values (0, -5, abc) never cause a server error', async () => {
  for (const v of ['0', '-5', 'abc', '99999999999']) {
    const res = await fetch(`${BASE}/api/readings?limit=${v}`);
    assert.ok(res.status < 500, `limit=${v} -> ${res.status}`);
  }
});

// ---------- Device status ----------

test('BB-15 valid heartbeat is accepted and adds no reading', async () => {
  await clear();
  const res = await post('/api/heartbeat', { deviceId: 'probe-1' });
  assert.equal(res.status, 200);
  assert.equal((await list()).length, 0);
});

test('BB-16 POST /api/clear removes all readings', async () => {
  await post('/api/readings', reading());
  const res = await clear();
  assert.equal(res.status, 200);
  assert.equal((await list()).length, 0);
});

// ---------- Misc endpoints ----------

test('BB-17 GET /api/health returns 200 JSON without a key', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
});

test('BB-18 CSV export has a header plus one line per reading', async () => {
  await clear();
  for (let i = 0; i < 4; i++) await post('/api/readings', reading({ r: i }));
  const res = await fetch(`${BASE}/api/export.csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const lines = (await res.text()).trim().split(/\r?\n/);
  assert.equal(lines.length, 5);
});

test('BB-19 unknown route returns 404', async () => {
  const res = await fetch(`${BASE}/api/does-not-exist`);
  assert.equal(res.status, 404);
});

test('BB-20 XSS payload in deviceId is escaped in the dashboard HTML', async () => {
  await clear();
  const payload = '<script>alert(1)</script>';
  await post('/api/readings', reading({ deviceId: payload }));
  const html = await (await fetch(`${BASE}/`)).text();
  assert.ok(!html.includes(payload), 'raw script tag found in HTML');
});
