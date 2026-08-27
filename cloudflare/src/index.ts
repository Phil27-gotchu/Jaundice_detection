export interface Env {
  READINGS: KVNamespace;
  ASSETS: Fetcher;
  API_KEY: string;
  DEVICE_TIMEOUT_MS: string;
  MAX_READINGS: string;
}

export interface Reading {
  ts: number;
  deviceId: string;
  r: number;
  g: number;
  b: number;
  bgRatio: number;
  brRatio: number;
  odDiff: number;
}

const HISTORY_KEY = "history";
const LATEST_KEY = "latest";
const DEVICE_KEY = "device";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function checkApiKey(request: Request, env: Env): boolean {
  const key = request.headers.get("X-API-Key");
  return Boolean(key && key === env.API_KEY);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

async function getHistory(env: Env): Promise<Reading[]> {
  const raw = await env.READINGS.get(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Reading[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function handlePostReading(request: Request, env: Env): Promise<Response> {
  if (!checkApiKey(request, env)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const r = toNumber(body.r);
  const g = toNumber(body.g);
  const b = toNumber(body.b);
  const bgRatio = toNumber(body.bgRatio);
  const brRatio = toNumber(body.brRatio);
  const odDiff = toNumber(body.odDiff);

  if ([r, g, b, bgRatio, brRatio, odDiff].some((v) => v === null)) {
    return badRequest("Expected numeric fields: r, g, b, bgRatio, brRatio, odDiff");
  }

  const reading: Reading = {
    ts: Date.now(),
    deviceId: typeof body.deviceId === "string" && body.deviceId.trim()
      ? body.deviceId.trim()
      : "esp32-probe-1",
    r: r!,
    g: g!,
    b: b!,
    bgRatio: bgRatio!,
    brRatio: brRatio!,
    odDiff: odDiff!,
  };

  const max = Math.max(10, Number(env.MAX_READINGS) || 200);
  const history = await getHistory(env);
  history.push(reading);
  while (history.length > max) history.shift();

  await Promise.all([
    env.READINGS.put(HISTORY_KEY, JSON.stringify(history)),
    env.READINGS.put(LATEST_KEY, JSON.stringify(reading)),
    env.READINGS.put(
      DEVICE_KEY,
      JSON.stringify({
        deviceId: reading.deviceId,
        lastSeen: reading.ts,
      })
    ),
  ]);

  return json({ ok: true, reading });
}

async function handleGetReadings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") || "80") || 80)
  );

  const history = await getHistory(env);
  const readings = history.slice(-limit);
  const latest = readings.length ? readings[readings.length - 1] : null;

  const deviceRaw = await env.READINGS.get(DEVICE_KEY);
  let device: { deviceId: string; lastSeen: number } | null = null;
  if (deviceRaw) {
    try {
      device = JSON.parse(deviceRaw);
    } catch {
      device = null;
    }
  }

  const timeout = Number(env.DEVICE_TIMEOUT_MS) || 30000;
  const online = Boolean(device && Date.now() - device.lastSeen < timeout);

  return json({
    online,
    device,
    latest,
    count: readings.length,
    readings,
  });
}

async function handleClear(request: Request, env: Env): Promise<Response> {
  if (!checkApiKey(request, env)) return unauthorized();
  await Promise.all([
    env.READINGS.delete(HISTORY_KEY),
    env.READINGS.delete(LATEST_KEY),
    env.READINGS.delete(DEVICE_KEY),
  ]);
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/api/readings" && request.method === "POST") {
      return handlePostReading(request, env);
    }

    if (url.pathname === "/api/readings" && request.method === "GET") {
      return handleGetReadings(request, env);
    }

    if (url.pathname === "/api/clear" && request.method === "POST") {
      return handleClear(request, env);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "jaundice-monitor" });
    }

    // Serve dashboard / static assets from public/
    return env.ASSETS.fetch(request);
  },
};
