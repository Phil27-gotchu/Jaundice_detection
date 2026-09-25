"use strict";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDayLabel(day) {
  if (!day) return "—";
  const parts = String(day).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return String(day);
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return dt.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtNum(n, digits = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

function niceNum(range, round) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf;
  if (round) {
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
  } else if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * 10 ** exp;
}

function niceScale(values, tickCount = 5) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };

  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const range = niceNum(max - min, false);
  const step = niceNum(range / (tickCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  const last = niceMax + step / 2;
  for (let v = niceMin; v <= last; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return { min: niceMin, max: ticks[ticks.length - 1], ticks };
}

function fmtTick(v, isRaw) {
  const abs = Math.abs(v);
  if (isRaw && abs >= 10) return String(Math.round(v));
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(2);
}

function yPos(value, scale, top, height) {
  const span = scale.max - scale.min || 1;
  return top + height - ((value - scale.min) / span) * height;
}

function linePath(readings, key, xAt, scale, top, height) {
  return readings
    .map((r, i) => {
      const x = xAt(i);
      const y = yPos(r[key], scale, top, height);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderChartSvg(readings) {
  const W = 720;
  const H = 260;
  const left = 52;
  const right = 58;
  const top = 12;
  const bottom = 30;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const n = readings.length;
  const xAt = (i) => (n <= 1 ? left + plotW / 2 : left + (i / (n - 1)) * plotW);

  const rawScale = niceScale(readings.flatMap((r) => [r.r, r.g, r.b]));
  const ratioScale = niceScale(readings.flatMap((r) => [r.bgRatio, r.odDiff]));

  const grid = [];
  for (const tick of rawScale.ticks) {
    const y = yPos(tick, rawScale, top, plotH);
    grid.push(
      `<line class="chart-grid" x1="${left}" y1="${y.toFixed(2)}" x2="${left + plotW}" y2="${y.toFixed(2)}"/>`
    );
    grid.push(
      `<text class="chart-tick" x="${left - 8}" y="${y.toFixed(2)}" text-anchor="end" dominant-baseline="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10">${escapeHtml(fmtTick(tick, true))}</text>`
    );
  }

  for (const tick of ratioScale.ticks) {
    const y = yPos(tick, ratioScale, top, plotH);
    grid.push(
      `<text class="chart-tick" x="${left + plotW + 8}" y="${y.toFixed(2)}" text-anchor="start" dominant-baseline="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10">${escapeHtml(fmtTick(tick, false))}</text>`
    );
  }

  const xLabels = [];
  if (n > 0) {
    const labelCount = Math.min(7, n);
    const minGap = 88;
    const chosen = [];
    for (let k = 0; k < labelCount; k++) {
      const i = labelCount === 1 ? 0 : Math.round((k * (n - 1)) / (labelCount - 1));
      const x = xAt(i);
      const prev = chosen[chosen.length - 1];
      if (prev && x - prev.x < minGap) {
        if (k === labelCount - 1) prev.skip = true;
        else continue;
      }
      chosen.push({ i, x, skip: false });
    }
    for (const item of chosen) {
      if (item.skip) continue;
      xLabels.push(
        `<text class="chart-tick" x="${item.x.toFixed(2)}" y="${H - 10}" text-anchor="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10">${escapeHtml(fmtTime(readings[item.i].ts))}</text>`
      );
    }
  }

  const series = n
    ? [
        `<path class="series-r" d="${linePath(readings, "r", xAt, rawScale, top, plotH)}" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
        `<path class="series-g" d="${linePath(readings, "g", xAt, rawScale, top, plotH)}" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
        `<path class="series-b" d="${linePath(readings, "b", xAt, rawScale, top, plotH)}" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
        `<path class="series-ratio" d="${linePath(readings, "bgRatio", xAt, ratioScale, top, plotH)}" fill="none" stroke-width="1.5" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round"/>`,
        `<path class="series-od" d="${linePath(readings, "odDiff", xAt, ratioScale, top, plotH)}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
      ]
    : [];

  const hovers = [];
  if (n > 0) {
    const colW = n === 1 ? plotW : plotW / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = xAt(i);
      const bandX = Math.max(left, x - colW / 2);
      const bandW = Math.min(left + plotW, x + colW / 2) - bandX;
      const r = readings[i];
      const tipW = 132;
      const tipH = 108;
      let tipX = x + 10;
      if (tipX + tipW > W - 4) tipX = x - tipW - 10;
      const tipY = top + 8;
      const lines = [
        fmtTime(r.ts),
        `R  ${r.r}`,
        `G  ${r.g}`,
        `B  ${r.b}`,
        `B/G  ${fmtNum(r.bgRatio, 4)}`,
        `OD  ${fmtNum(r.odDiff, 4)}`,
      ];
      const text = lines
        .map(
          (line, li) =>
            `<text class="tip-text" x="${(tipX + 8).toFixed(2)}" y="${tipY + 16 + li * 15}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11">${escapeHtml(line)}</text>`
        )
        .join("");
      hovers.push(`<g class="hover-col">
        <rect class="band" x="${bandX.toFixed(2)}" y="${top}" width="${Math.max(bandW, 2).toFixed(2)}" height="${plotH}" fill="transparent"/>
        <line class="guide" x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${top + plotH}" stroke-width="1" opacity="0"/>
        <g class="tip">
          <rect class="tip-bg" x="${tipX.toFixed(2)}" y="${tipY}" width="${tipW}" height="${tipH}" rx="2"/>
          ${text}
        </g>
      </g>`);
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="Signal trends">
    <line class="chart-grid" x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}"/>
    <line class="chart-grid" x1="${left + plotW}" y1="${top}" x2="${left + plotW}" y2="${top + plotH}"/>
    <line class="chart-grid" x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}"/>
    ${grid.join("")}
    ${xLabels.join("")}
    <text class="chart-tick" x="${18}" y="${top + plotH / 2}" font-family="IBM Plex Sans, system-ui, sans-serif" font-size="11" text-anchor="middle" transform="rotate(-90 18 ${top + plotH / 2})">freq</text>
    <text class="chart-tick" x="${W - 14}" y="${top + plotH / 2}" font-family="IBM Plex Sans, system-ui, sans-serif" font-size="11" text-anchor="middle" transform="rotate(90 ${W - 14} ${top + plotH / 2})">ratio / OD</text>
    ${series.join("")}
    ${hovers.join("")}
  </svg>`;
}

function renderTableBody(readings) {
  if (!readings.length) {
    return `<tr class="empty"><td colspan="7">No readings in this range. Adjust the dates or take a new sample.</td></tr>`;
  }

  const spanMs =
    readings.length > 1 ? readings[readings.length - 1].ts - readings[0].ts : 0;
  const multiDay = spanMs > 20 * 60 * 60 * 1000;
  const rows = [...readings].reverse().slice(0, 40);
  return rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(multiDay ? fmtDateTime(r.ts) : fmtTime(r.ts))}</td>
        <td>${escapeHtml(r.r)}</td>
        <td>${escapeHtml(r.g)}</td>
        <td>${escapeHtml(r.b)}</td>
        <td>${escapeHtml(fmtNum(r.bgRatio, 4))}</td>
        <td>${escapeHtml(fmtNum(r.brRatio, 4))}</td>
        <td>${escapeHtml(fmtNum(r.odDiff, 4))}</td>
      </tr>`
    )
    .join("");
}

function renderDailyBody(daily) {
  if (!Array.isArray(daily) || !daily.length) {
    return `<tr class="empty"><td colspan="6">No daily totals yet for this range.</td></tr>`;
  }
  return daily
    .map(
      (d) => `<tr>
        <td>${escapeHtml(fmtDayLabel(d.day))}</td>
        <td>${escapeHtml(d.samples)}</td>
        <td>${escapeHtml(fmtNum(d.avgOd, 4))}</td>
        <td>${escapeHtml(fmtNum(d.minOd, 4))}</td>
        <td>${escapeHtml(fmtNum(d.maxOd, 4))}</td>
        <td>${escapeHtml(fmtNum(d.avgBg, 4))}</td>
      </tr>`
    )
    .join("");
}

function exportHref(filter) {
  const params = new URLSearchParams();
  if (filter?.from) params.set("from", filter.from);
  if (filter?.to) params.set("to", filter.to);
  const q = params.toString();
  return q ? `/api/export.csv?${q}` : "/api/export.csv";
}

function renderDashboard(template, data) {
  const readings = Array.isArray(data.readings) ? data.readings : [];
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const latest = data.latest || null;
  const device = data.device || null;
  const filter = data.filter || { from: "", to: "" };
  const hasDevice = Boolean(device || latest);
  const shown = data.shown ?? readings.length;
  const count = data.count ?? shown;
  const sampleLabel =
    count === shown ? String(count) : `${shown} of ${count}`;

  let onlineLabel = "Waiting for device";
  let onlineClass = "";
  if (hasDevice) {
    if (data.online) {
      onlineLabel = "Device online";
      onlineClass = " is-online";
    } else {
      onlineLabel = "Device offline";
      onlineClass = " is-offline";
    }
  }

  const lastSeenTs = device?.lastSeen || latest?.ts;
  const lastSeen = lastSeenTs ? `Last sync ${fmtTime(lastSeenTs)}` : "";

  const replacements = {
    "{{ONLINE_CLASS}}": onlineClass,
    "{{ONLINE_LABEL}}": escapeHtml(onlineLabel),
    "{{LAST_SEEN}}": escapeHtml(lastSeen),
    "{{OD_DIFF}}": escapeHtml(latest ? fmtNum(latest.odDiff, 4) : "—"),
    "{{BG_RATIO}}": escapeHtml(latest ? fmtNum(latest.bgRatio, 4) : "—"),
    "{{BR_RATIO}}": escapeHtml(latest ? fmtNum(latest.brRatio, 4) : "—"),
    "{{RGB_RAW}}": escapeHtml(latest ? `R ${latest.r}   G ${latest.g}   B ${latest.b}` : "—"),
    "{{DEVICE_ID}}": escapeHtml(device?.deviceId || latest?.deviceId || "—"),
    "{{SAMPLE_COUNT}}": escapeHtml(sampleLabel),
    "{{FILTER_FROM}}": escapeHtml(filter.from || ""),
    "{{FILTER_TO}}": escapeHtml(filter.to || ""),
    "{{EXPORT_HREF}}": escapeHtml(exportHref(filter)),
    "{{CHART}}": renderChartSvg(readings),
    "{{TABLE_BODY}}": renderTableBody(readings),
    "{{DAILY_BODY}}": renderDailyBody(daily),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return html;
}

module.exports = { renderDashboard, renderChartSvg, renderTableBody, renderDailyBody };
