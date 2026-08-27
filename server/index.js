#!/usr/bin/env node
/**
 * Local dashboard + ingest API for the jaundice ESP probe.
 * No Cloudflare — runs entirely on your machine.
 *
 *   node server/index.js
 *   → http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { networkInterfaces } = require("os");

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || "jaundice-demo-key-change-me";
const DEVICE_TIMEOUT_MS = Number(process.env.DEVICE_TIMEOUT_MS || 30000);
const MAX_READINGS = Number(process.env.MAX_READINGS || 200);
const PUBLIC_DIR = path.join(__dirname, "..", "cloudflare", "public");

/** @type {Array<object>} */
const history = [];
let device = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
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

  if ([r, g, b, bgRatio, brRatio, odDiff].some((v) => v === null)) {
    return sendJson(res, 400, {
      error: "Expected numeric fields: r, g, b, bgRatio, brRatio, odDiff",
    });
  }

  const reading = {
    ts: Date.now(),
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
  };

  history.push(reading);
  while (history.length > MAX_READINGS) history.shift();

  device = { deviceId: reading.deviceId, lastSeen: reading.ts };
  return sendJson(res, 200, { ok: true, reading });
}

function handleGetReadings(req, res, url) {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 80) || 80));
  const readings = history.slice(-limit);
  const latest = readings.length ? readings[readings.length - 1] : null;
  const online = Boolean(device && Date.now() - device.lastSeen < DEVICE_TIMEOUT_MS);

  return sendJson(res, 200, {
    online,
    device,
    latest,
    count: readings.length,
    readings,
  });
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function handleExportCsv(req, res) {
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
  for (const row of history) {
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
  history.length = 0;
  device = null;
  return sendJson(res, 200, { ok: true });
}

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
    if (url.pathname === "/api/readings" && req.method === "GET") {
      return handleGetReadings(req, res, url);
    }
    if (url.pathname === "/api/export.csv" && req.method === "GET") {
      return handleExportCsv(req, res);
    }
    if (url.pathname === "/api/clear" && req.method === "POST") {
      return await handleClear(req, res);
    }
    if (url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, service: "jaundice-monitor-local" });
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
  if (lan) {
    console.log(`  ESP URL:    http://${lan}:${PORT}`);
    console.log(`  (put that in firmware SERVER_URL — not localhost)\n`);
  } else {
    console.log("  (could not detect LAN IP — use your PC's Wi‑Fi IP in firmware)\n");
  }
});
