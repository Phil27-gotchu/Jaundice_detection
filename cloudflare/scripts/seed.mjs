/**
 * Seed fake ESP readings into a local or deployed Worker.
 *
 * Usage:
 *   npm run seed
 *   API_URL=https://jaundice-monitor.xxx.workers.dev API_KEY=your-key npm run seed
 */

const API_URL = (process.env.API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const API_KEY = process.env.API_KEY || "jaundice-demo-key-change-me";
const COUNT = Number(process.env.COUNT || 12);

async function postOne(i) {
  const r = 900 + Math.round(Math.random() * 500);
  const g = 700 + Math.round(Math.random() * 400);
  const b = 500 + Math.round(Math.random() * 350);
  const bgRatio = b / Math.max(g, 1);
  const brRatio = b / Math.max(r, 1);
  const odDiff = Math.log(g + 1) - Math.log(b + 1);

  const res = await fetch(`${API_URL}/api/readings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify({
      deviceId: "esp32-probe-1",
      r,
      g,
      b,
      bgRatio,
      brRatio,
      odDiff,
    }),
  });

  const text = await res.text();
  console.log(`#${i + 1} ${res.status} ${text}`);
  if (!res.ok) process.exitCode = 1;
}

for (let i = 0; i < COUNT; i++) {
  await postOne(i);
  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\nOpen ${API_URL}/`);
