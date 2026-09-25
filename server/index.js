#!/usr/bin/env node
/**
 * Local dashboard + ingest API for the jaundice ESP probe.
 * Readings persist in SQLite (server/data/readings.sqlite).
 *
 *   node server/index.js
 *   → http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { networkInterfaces } = require("os");
const { renderDashboard } = require("../shared/dashboard");
const store = require("./store");

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || "jaundice-demo-key-change-me";
const DEVICE_TIMEOUT_MS = Number(process.env.DEVICE_TIMEOUT_MS || 30000);
const PUBLIC_DIR = path.join(__dirname, "..", "cloudflare", "public");

/** @type {{ deviceId: string, lastSeen: number } | null} */
let device = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
}

function sendJson(res, status, data) {
  cors(res);
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function checkApiKey(req) {
  return req.headers["x-api-key"] === API_KEY;
}

/** Parse YYYY-MM-DD as local calendar day start/end (ms). */
function parseDayBound(value, endOfDay) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (endOfDay) return new Date(y, mo, d, 23, 59, 59, 999).getTime();
  return new Date(y, mo, d, 0, 0, 0, 0).getTime();
}

function toDateInputValue(ms) {
  if (!Number.isFinite(ms)) return "";
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/**
 * @param {URL} url
 * @returns {{ from: number | null, to: number | null, fromInput: string, toInput: string, limit: number }}
 */
function parseRange(url) {
  const fromInput = url.searchParams.get("from") || "";
  const toInput = url.searchParams.get("to") || "";
  let from = parseDayBound(fromInput, false);
  let to = parseDayBound(toInput, true);

  // Also accept raw epoch ms (API clients).
  const fromMs = toNumber(url.searchParams.get("fromMs"));
  const toMs = toNumber(url.searchParams.get("toMs"));
  if (fromMs !== null) from = fromMs;
  if (toMs !== null) to = toMs;

  if (from !== null && to !== null && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(500, Math.max(1, Number(limitRaw) || 80));

  return {
    from,
    to,
    fromInput: fromInput || (from !== null ? toDateInputValue(from) : ""),
    toInput: toInput || (to !== null ? toDateInputValue(to) : ""),
    limit,
  };
}

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === "/" ? "/index.html" : urlPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(PUBLIC_DIR, filePath);

  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function lanIPv4() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function currentSnapshot(range) {
  const { readings, latest, count, shown } = store.getReadings({
    from: range.from,
    to: range.to,
    limit: range.limit,
  });
  const daily = store.getDailySummaries({ from: range.from, to: range.to });
  const online = Boolean(device && Date.now() - device.lastSeen < DEVICE_TIMEOUT_MS);
  return {
    online,
    device,
    latest,
    count,
    shown,
    readings,
    daily,
    filter: {
      from: range.fromInput,
      to: range.toInput,
    },
  };
}

async function handlePostReading(req, res) {
  if (!checkApiKey(req)) return sendJson(res, 401, { error: "Unauthorized" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const r = toNumber(body.r);
  const g = toNumber(body.g);
  const b = toNumber(body.b);
  const bgRatio = toNumber(body.bgRatio);
  const brRatio = toNumber(body.brRatio);
  const odDiff = toNumber(body.odDiff);
  const ts = toNumber(body.ts) ?? Date.now();

  if ([r, g, b, bgRatio, brRatio, odDiff].some((v) => v === null)) {
    return sendJson(res, 400, {
      error: "Expected numeric fields: r, g, b, bgRatio, brRatio, odDiff",
    });
  }

  const reading = store.insertReading({
    ts,
    deviceId:
      typeof body.deviceId === "string" && body.deviceId.trim()
        ? body.deviceId.trim()
        : "esp32-probe-1",
    r,
    g,
    b,
    bgRatio,
    brRatio,
    odDiff,
  });

  device = { deviceId: reading.deviceId, lastSeen: Date.now() };
  return sendJson(res, 200, { ok: true, reading });
}

async function handleHeartbeat(req, res) {
  if (!checkApiKey(req)) return sendJson(res, 401, { error: "Unauthorized" });

  let body = {};
  try {
    const raw = await readBody(req);
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.trim()
      ? body.deviceId.trim()
      : "esp32-probe-1";

  device = { deviceId, lastSeen: Date.now() };
  return sendJson(res, 200, { ok: true, device });
}

function handleGetReadings(req, res, url) {
  const range = parseRange(url);
  return sendJson(res, 200, currentSnapshot(range));
}

function handleGetDaily(req, res, url) {
  const range = parseRange(url);
  const daily = store.getDailySummaries({ from: range.from, to: range.to });
  return sendJson(res, 200, { daily, filter: { from: range.fromInput, to: range.toInput } });
}

function handleDashboard(req, res, url) {
  const templatePath = path.join(PUBLIC_DIR, "index.html");
  fs.readFile(templatePath, "utf8", (err, template) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Dashboard template missing");
    }
    const html = renderDashboard(template, currentSnapshot(parseRange(url)));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function handleExportCsv(req, res, url) {
  const range = parseRange(url);
  const { readings } = store.getReadings({
    from: range.from,
    to: range.to,
    limit: null,
  });

  const header = [
    "timestamp_iso",
    "timestamp_ms",
    "device_id",
    "r",
    "g",
    "b",
    "bg_ratio",
    "br_ratio",
    "od_diff",
  ];

  const lines = [header.join(",")];
  for (const row of readings) {
    lines.push(
      [
        new Date(row.ts).toISOString(),
        row.ts,
        row.deviceId,
        row.r,
        row.g,
        row.b,
        row.bgRatio,
        row.brRatio,
        row.odDiff,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const body = lines.join("\n") + "\n";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  cors(res);
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="jaundice-readings-${stamp}.csv"`,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleClear(req, res) {
  if (!checkApiKey(req)) return sendJson(res, 401, { error: "Unauthorized" });
  store.clearReadings();
  device = null;
  return sendJson(res, 200, { ok: true });
}

store.openStore();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  try {
    if (url.pathname === "/api/readings" && req.method === "POST") {
      return await handlePostReading(req, res);
    }
    if (url.pathname === "/api/heartbeat" && req.method === "POST") {
      return await handleHeartbeat(req, res);
    }
    if (url.pathname === "/api/readings" && req.method === "GET") {
      return handleGetReadings(req, res, url);
    }
    if (url.pathname === "/api/daily" && req.method === "GET") {
      return handleGetDaily(req, res, url);
    }
    if (url.pathname === "/api/export.csv" && req.method === "GET") {
      return handleExportCsv(req, res, url);
    }
    if (url.pathname === "/api/clear" && req.method === "POST") {
      return await handleClear(req, res);
    }
    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "jaundice-monitor-local",
        db: store.getDbPath(),
      });
    }
    if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
      return handleDashboard(req, res, url);
    }

    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = lanIPv4();
  console.log("\n  Jaundice Monitor — local server");
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  Database:   ${store.getDbPath()}`);
  if (lan) {
    console.log(`  ESP URL:    http://${lan}:${PORT}`);
    console.log(`  (put that in firmware SERVER_URL — not localhost)\n`);
  } else {
    console.log("  (could not detect LAN IP — use your PC's Wi‑Fi IP in firmware)\n");
  }
});

function shutdown() {
  store.closeStore();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
