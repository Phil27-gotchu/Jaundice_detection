"use strict";

/**
 * Persistent readings store (Node built-in SQLite — no npm deps).
 * Requires Node.js 22.5+.
 */

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_DB_PATH = path.join(__dirname, "data", "readings.sqlite");

/** @type {DatabaseSync | null} */
let db = null;
/** @type {string | null} */
let dbPath = null;

function openStore(filePath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (db && dbPath === filePath) return db;

  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = new DatabaseSync(filePath);
  dbPath = filePath;
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      r REAL NOT NULL,
      g REAL NOT NULL,
      b REAL NOT NULL,
      bg_ratio REAL NOT NULL,
      br_ratio REAL NOT NULL,
      od_diff REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);
  `);
  return db;
}

function closeStore() {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* ignore */
  }
  db = null;
  dbPath = null;
}

function rowToReading(row) {
  return {
    id: row.id,
    ts: row.ts,
    deviceId: row.device_id,
    r: row.r,
    g: row.g,
    b: row.b,
    bgRatio: row.bg_ratio,
    brRatio: row.br_ratio,
    odDiff: row.od_diff,
  };
}

function insertReading(reading) {
  const database = openStore();
  const result = database
    .prepare(
      `INSERT INTO readings (ts, device_id, r, g, b, bg_ratio, br_ratio, od_diff)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      reading.ts,
      reading.deviceId,
      reading.r,
      reading.g,
      reading.b,
      reading.bgRatio,
      reading.brRatio,
      reading.odDiff
    );
  return { ...reading, id: Number(result.lastInsertRowid) };
}

/**
 * @param {{ from?: number | null, to?: number | null, limit?: number | null }} [opts]
 */
function getReadings(opts = {}) {
  const database = openStore();
  const from = Number.isFinite(opts.from) ? opts.from : null;
  const to = Number.isFinite(opts.to) ? opts.to : null;
  const limit =
    opts.limit === null || opts.limit === undefined
      ? null
      : Math.min(5000, Math.max(1, Number(opts.limit) || 80));

  const where = [];
  const params = [];
  if (from !== null) {
    where.push("ts >= ?");
    params.push(from);
  }
  if (to !== null) {
    where.push("ts <= ?");
    params.push(to);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRow = database.prepare(`SELECT COUNT(*) AS n FROM readings ${whereSql}`).get(...params);
  const totalMatching = Number(countRow?.n || 0);

  let readings;
  if (limit === null) {
    readings = database
      .prepare(`SELECT * FROM readings ${whereSql} ORDER BY ts ASC, id ASC`)
      .all(...params)
      .map(rowToReading);
  } else {
    // Latest N in range, returned oldest→newest for the chart.
    readings = database
      .prepare(
        `SELECT * FROM (
           SELECT * FROM readings ${whereSql}
           ORDER BY ts DESC, id DESC
           LIMIT ?
         ) AS recent
         ORDER BY ts ASC, id ASC`
      )
      .all(...params, limit)
      .map(rowToReading);
  }

  const latestRow = database
    .prepare(
      `SELECT * FROM readings ${whereSql} ORDER BY ts DESC, id DESC LIMIT 1`
    )
    .get(...params);

  return {
    readings,
    latest: latestRow ? rowToReading(latestRow) : null,
    count: totalMatching,
    shown: readings.length,
  };
}

/**
 * @param {{ from?: number | null, to?: number | null }} [opts]
 */
function getDailySummaries(opts = {}) {
  const database = openStore();
  const from = Number.isFinite(opts.from) ? opts.from : null;
  const to = Number.isFinite(opts.to) ? opts.to : null;

  const where = [];
  const params = [];
  if (from !== null) {
    where.push("ts >= ?");
    params.push(from);
  }
  if (to !== null) {
    where.push("ts <= ?");
    params.push(to);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = database
    .prepare(
      `SELECT
         date(ts / 1000, 'unixepoch', 'localtime') AS day,
         COUNT(*) AS samples,
         AVG(od_diff) AS avg_od,
         MIN(od_diff) AS min_od,
         MAX(od_diff) AS max_od,
         AVG(bg_ratio) AS avg_bg,
         AVG(br_ratio) AS avg_br
       FROM readings
       ${whereSql}
       GROUP BY day
       ORDER BY day DESC
       LIMIT 90`
    )
    .all(...params);

  return rows.map((row) => ({
    day: row.day,
    samples: Number(row.samples),
    avgOd: row.avg_od,
    minOd: row.min_od,
    maxOd: row.max_od,
    avgBg: row.avg_bg,
    avgBr: row.avg_br,
  }));
}

function clearReadings() {
  const database = openStore();
  database.exec("DELETE FROM readings");
}

function getDbPath() {
  return dbPath || process.env.DB_PATH || DEFAULT_DB_PATH;
}

module.exports = {
  openStore,
  closeStore,
  insertReading,
  getReadings,
  getDailySummaries,
  clearReadings,
  getDbPath,
  DEFAULT_DB_PATH,
};
