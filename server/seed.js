#!/usr/bin/env node
/** Seed fake readings into the local server (spread across days for daily summaries). */

const API_URL = (process.env.API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const API_KEY = process.env.API_KEY || "jaundice-demo-key-change-me";
const COUNT = Number(process.env.COUNT || 24);
const DAYS = Math.max(1, Number(process.env.DAYS || 5));

async function postOne(i, ts) {
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
      ts,
      r,
      g,
      b,
      bgRatio,
      brRatio,
      odDiff,
    }),
  });

  console.log(`#${i + 1} ${res.status} ${new Date(ts).toISOString().slice(0, 10)} ${await res.text()}`);
  if (!res.ok) process.exitCode = 1;
}

(async () => {
  const now = Date.now();
  for (let i = 0; i < COUNT; i++) {
    const dayOffset = i % DAYS;
    const dayStart = new Date();
    dayStart.setHours(9, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - dayOffset);
    const ts = dayStart.getTime() + (Math.floor(i / DAYS) * 75 + Math.round(Math.random() * 40)) * 60 * 1000;
    await postOne(i, Math.min(ts, now));
    await new Promise((r) => setTimeout(r, 40));
  }
  console.log(`\nOpen ${API_URL}/`);
  console.log(`Try ${API_URL}/?from=${new Date(now - 6 * 86400000).toISOString().slice(0, 10)}&to=${new Date(now).toISOString().slice(0, 10)}`);
})();
