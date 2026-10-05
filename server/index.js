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
const crypto = require("crypto");
const { networkInterfaces } = require("os");
const { renderDashboard } = require("../shared/dashboard");
const store = require("./store");

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PORT = positiveNumber(process.env.PORT, 3000);
const DEFAULT_API_KEY = "jaundice-demo-key-change-me";
const API_KEY = process.env.API_KEY || DEFAULT_API_KEY;
const DEVICE_TIMEOUT_MS = positiveNumber(process.env.DEVICE_TIMEOUT_MS, 30000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_DEVICE_ID = "esp32-probe-1";
const MAX_DEVICE_ID_LENGTH = 64;
/** Earliest accepted reading timestamp; also rejects junk like 1e300 that breaks date formatting. */
const MIN_READING_TS = Date.UTC(2020, 0, 1);
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** @type {{ deviceId: string, lastSeen: number } | null} */
let device = null;

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
      return reject(new HttpError(413, "Request body too large"));
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        return reject(new HttpError(413, "Request body too large"));
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/** Parses a JSON object body; empty body → {}. Throws HttpError(400) otherwise. */
function parseJsonObject(raw) {
  if (!raw.trim()) return {};
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected a JSON object");
  }
  return body;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function cleanDeviceId(value) {
  if (typeof value !== "string") return DEFAULT_DEVICE_ID;
  const id = value.trim().slice(0, MAX_DEVICE_ID_LENGTH);
  return id || DEFAULT_DEVICE_ID;
}

/** Constant-time string compare (hashing first so lengths always match). */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkApiKey(req) {
  return safeEqual(req.headers["x-api-key"] || "", API_KEY);
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
  if (Number.isNaN(dt.getTime())) return "";
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
  let from = parseDayBound(url.searchParams.get("from"), false);
  let to = parseDayBound(url.searchParams.get("to"), true);

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
    fromInput: from !== null ? toDateInputValue(from) : "",
    toInput: to !== null ? toDateInputValue(to) : "",
    limit,
  };
}

/** Serves CSS/images from public/. HTML files are templates and are only served through their routes. */
async function serveStatic(req, res, urlPath) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed");

  const abs = path.join(PUBLIC_DIR, path.normalize(urlPath));
  const ext = path.extname(abs).toLowerCase();
  if (!abs.startsWith(PUBLIC_DIR + path.sep) || !MIME[ext]) return sendText(res, 404, "Not found");

  let data;
  try {
    data = await fs.promises.readFile(abs);
  } catch {
    return sendText(res, 404, "Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[ext], "Content-Length": data.length });
  res.end(req.method === "HEAD" ? undefined : data);
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

  const body = parseJsonObject(await readBody(req));

  const r = toNumber(body.r);
  const g = toNumber(body.g);
  const b = toNumber(body.b);
  const bgRatio = toNumber(body.bgRatio);
  const brRatio = toNumber(body.brRatio);
  const odDiff = toNumber(body.odDiff);
  const ts = body.ts === undefined ? Date.now() : toNumber(body.ts);

  if ([r, g, b, bgRatio, brRatio, odDiff].some((v) => v === null)) {
    return sendJson(res, 400, {
      error: "Expected numeric fields: r, g, b, bgRatio, brRatio, odDiff",
    });
  }
  if (ts === null || ts < MIN_READING_TS || ts > Date.now() + MAX_FUTURE_SKEW_MS) {
    return sendJson(res, 400, { error: "ts must be epoch milliseconds between 2020 and now" });
  }

  const reading = store.insertReading({
    ts,
    deviceId: cleanDeviceId(body.deviceId),
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

  const body = parseJsonObject(await readBody(req));
  device = { deviceId: cleanDeviceId(body.deviceId), lastSeen: Date.now() };
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

async function handleDashboard(req, res, url) {
  const template = await fs.promises.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const html = renderDashboard(template, currentSnapshot(parseRange(url)));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Text cells starting with = + - @ are run as formulas by spreadsheet apps. */
function csvText(value) {
  const s = String(value ?? "");
  return csvEscape(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
}

function isoOrBlank(ms) {
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
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
        csvEscape(isoOrBlank(row.ts)),
        csvEscape(row.ts),
        csvText(row.deviceId),
        csvEscape(row.r),
        csvEscape(row.g),
        csvEscape(row.b),
        csvEscape(row.bgRatio),
        csvEscape(row.brRatio),
        csvEscape(row.odDiff),
      ].join(",")
    );
  }

  const body = lines.join("\n") + "\n";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="jaundice-readings-${stamp}.csv"`,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function handleClear(req, res) {
  if (!checkApiKey(req)) return sendJson(res, 401, { error: "Unauthorized" });
  store.clearReadings();
  device = null;
  return sendJson(res, 200, { ok: true });
}

async function route(req, res, url) {
  if (url.pathname === "/api/readings" && req.method === "POST") {
    return handlePostReading(req, res);
  }
  if (url.pathname === "/api/heartbeat" && req.method === "POST") {
    return handleHeartbeat(req, res);
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
    return handleClear(req, res);
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, service: "jaundice-monitor-local" });
  }
  if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
    return handleDashboard(req, res, url);
  }
  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "Not found" });
  }
  return serveStatic(req, res, url.pathname);
}

store.openStore();

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    // Fixed base: the Host header is client-controlled and an invalid one would make URL() throw.
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      throw new HttpError(400, "Bad request");
    }
    await route(req, res, url);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return res.end();
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Server error";
    res.setHeader("Connection", "close");
    return sendJson(res, status, { error: message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = lanIPv4();
  console.log("\n  Jaundice Monitor — local server");
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  Database:   ${store.getDbPath()}`);
  if (API_KEY === DEFAULT_API_KEY) {
    console.log("  WARNING:    default device API key — set API_KEY (and the same value in firmware)");
  }
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
