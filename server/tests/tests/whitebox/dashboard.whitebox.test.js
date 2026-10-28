/**
 * WHITE-BOX tests: written by reading shared/dashboard.js and targeting its
 * branches directly (statement / branch / boundary coverage).
 *
 * Run:  node --test tests/whitebox/
 * Coverage:  node --test --experimental-test-coverage tests/whitebox/
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderDashboard, renderChartSvg, renderTableBody } = require("../../shared/dashboard");

const TEMPLATE = fs.readFileSync(path.join(__dirname, "..", "..", "cloudflare", "public", "index.html"), "utf8");
const mk = (i, over = {}) => ({ ts: 1_700_000_000_000 + i * 1000, deviceId: "d", r: 1000 + i, g: 800 + i, b: 600 + i,
  bgRatio: 0.75, brRatio: 0.6, odDiff: 0.29, ...over });
const count = (s, re) => (s.match(re) || []).length;

describe("WB renderTableBody", () => {
  test("WB-01 empty list -> single placeholder row, colspan 7", () => {
    const h = renderTableBody([]);
    assert.match(h, /class="empty"/);
    assert.match(h, /colspan="7"/);
  });
  test("WB-02 newest reading is rendered first (reverse order)", () => {
    const h = renderTableBody([mk(1, { r: 111 }), mk(2, { r: 222 })]);
    assert.ok(h.indexOf("222") < h.indexOf("111"));
  });
  test("WB-03 boundary: 25 rows shown for 25, 26 and 40 inputs (slice(0,25))", () => {
    for (const n of [25, 26, 40]) {
      const rows = Array.from({ length: n }, (_, i) => mk(i));
      assert.equal(count(renderTableBody(rows), /<tr>/g), 25, `n=${n}`);
    }
  });
  test("WB-04 24 inputs -> 24 rows (below the cap)", () => {
    assert.equal(count(renderTableBody(Array.from({ length: 24 }, (_, i) => mk(i))), /<tr>/g), 24);
  });
  test("WB-05 ratios formatted to 4 decimals", () => {
    assert.match(renderTableBody([mk(1, { bgRatio: 0.5 })]), /0\.5000/);
  });
  test("WB-06 escapeHtml: &, <, >, \" in a value are neutralised", () => {
    const h = renderTableBody([mk(1, { r: '<b>&"x' })]);
    assert.ok(h.includes("&lt;b&gt;&amp;&quot;x"));
  });
});

describe("WB renderChartSvg", () => {
  test("WB-10 n = 0 -> axes only, no series paths, no hover columns", () => {
    const s = renderChartSvg([]);
    assert.equal(count(s, /<path /g), 0);
    assert.equal(count(s, /class="hover-col"/g), 0);
  });
  test("WB-11 n = 1 -> 5 series, 1 hover column, point centred on plot", () => {
    const s = renderChartSvg([mk(0)]);
    assert.equal(count(s, /<path class="series-/g), 5);
    assert.equal(count(s, /class="hover-col"/g), 1);
    assert.match(s, /d="M(\d+\.\d+) /);
    const x = Number(s.match(/class="series-r" d="M([\d.]+)/)[1]);
    assert.equal(x, 52 + (720 - 52 - 58) / 2);      // left + plotW/2
  });
  test("WB-12 n = 2 -> path has one M and one L command", () => {
    const d = renderChartSvg([mk(0), mk(1)]).match(/class="series-r" d="([^"]+)"/)[1];
    assert.equal(count(d, /M/g), 1);
    assert.equal(count(d, /L/g), 1);
  });
  test("WB-13 niceScale flat-data branch (min === max) does not crash or emit NaN", () => {
    const flat = [mk(0, { r: 500, g: 500, b: 500, bgRatio: 1, odDiff: 1 }), mk(1, { r: 500, g: 500, b: 500, bgRatio: 1, odDiff: 1 })];
    const s = renderChartSvg(flat);
    assert.ok(!s.includes("NaN"));
    assert.ok(!s.includes("Infinity"));
  });
  test("WB-14 non-finite values filtered by niceScale fallback (all NaN -> 0..1 scale)", () => {
    const s = renderChartSvg([mk(0, { bgRatio: NaN, odDiff: NaN })]);
    assert.match(s, />0\.25</);
  });
  test("WB-15 tooltip flips to the left near the right edge", () => {
    const rows = Array.from({ length: 10 }, (_, i) => mk(i));
    const tips = [...renderChartSvg(rows).matchAll(/class="tip-bg" x="([\d.]+)"/g)].map((m) => Number(m[1]));
    const xs = [...renderChartSvg(rows).matchAll(/<line class="guide" x1="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.ok(tips[0] > xs[0], "first tooltip is to the right of its point");
    assert.ok(tips[9] < xs[9], "last tooltip is to the left of its point");
  });
  test("WB-16 x-axis labels: at most 7", () => {
    const rows = Array.from({ length: 80 }, (_, i) => mk(i));
    const s = renderChartSvg(rows);
    const labels = count(s, /text-anchor="middle" font-family="IBM Plex Mono[^>]*>\d/g);
    assert.ok(labels >= 1 && labels <= 7, `labels=${labels}`);
  });
});

describe("WB renderDashboard status branches", () => {
  const html = (data) => renderDashboard(TEMPLATE, data);
  test("WB-20 no device, no latest -> 'Waiting for device', placeholders as em dash", () => {
    const h = html({ readings: [], count: 0 });
    assert.match(h, /Waiting for device/);
    assert.match(h, /id="odDiff">—</);
  });
  test("WB-21 online=true -> 'Device online' + is-online class", () => {
    const r = mk(1);
    const h = html({ readings: [r], latest: r, device: { deviceId: "d", lastSeen: r.ts }, online: true, count: 1 });
    assert.match(h, /status-line is-online"[^>]*>Device online/);
  });
  test("WB-22 online=false with a device -> 'Device offline' + is-offline class", () => {
    const r = mk(1);
    const h = html({ readings: [r], latest: r, device: { deviceId: "d", lastSeen: r.ts }, online: false, count: 1 });
    assert.match(h, /status-line is-offline"[^>]*>Device offline/);
  });
  test("WB-23 latest present but device null -> still treated as has-device (|| branch)", () => {
    const r = mk(1);
    const h = html({ readings: [r], latest: r, device: null, online: false, count: 1 });
    assert.match(h, /Device offline/);
    assert.match(h, /id="deviceId">d</);
  });
  test("WB-24 non-array readings is tolerated (Array.isArray guard)", () => {
    assert.doesNotThrow(() => html({ readings: "oops" }));
  });
  test("WB-25 every {{TOKEN}} is replaced", () => {
    const r = mk(1);
    assert.ok(!html({ readings: [r], latest: r, device: { deviceId: "d", lastSeen: r.ts }, online: true, count: 1 }).includes("{{"));
  });
  test("WB-26 sample count and RGB text rendered", () => {
    const r = mk(1, { r: 10, g: 20, b: 30 });
    const h = html({ readings: [r], latest: r, device: null, online: true, count: 7 });
    assert.match(h, /id="sampleCount">7</);
    assert.match(h, /R 10\s+G 20\s+B 30/);
  });
});
