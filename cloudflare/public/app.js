const POLL_MS = 2000;
const HISTORY_LIMIT = 80;

const els = {
  onlineLabel: document.getElementById("onlineLabel"),
  lastSeen: document.getElementById("lastSeen"),
  odDiff: document.getElementById("odDiff"),
  bgRatio: document.getElementById("bgRatio"),
  brRatio: document.getElementById("brRatio"),
  rgbRaw: document.getElementById("rgbRaw"),
  deviceId: document.getElementById("deviceId"),
  sampleCount: document.getElementById("sampleCount"),
  readingsBody: document.getElementById("readingsBody"),
  refreshBtn: document.getElementById("refreshBtn"),
  exportBtn: document.getElementById("exportBtn"),
};

const gridColor = "#ecece8";
const tickColor = "#6b6b66";

const chart = new Chart(document.getElementById("signalChart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "R",
        data: [],
        borderColor: "#b54a4a",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        tension: 0.15,
        pointRadius: 0,
        yAxisID: "yRaw",
      },
      {
        label: "G",
        data: [],
        borderColor: "#3d7a52",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        tension: 0.15,
        pointRadius: 0,
        yAxisID: "yRaw",
      },
      {
        label: "B",
        data: [],
        borderColor: "#3d5f8a",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        tension: 0.15,
        pointRadius: 0,
        yAxisID: "yRaw",
      },
      {
        label: "B/G",
        data: [],
        borderColor: "#7a7a72",
        backgroundColor: "transparent",
        borderWidth: 1.5,
        borderDash: [4, 3],
        tension: 0.15,
        pointRadius: 0,
        yAxisID: "yRatio",
      },
      {
        label: "OD",
        data: [],
        borderColor: "#1f3a4c",
        backgroundColor: "transparent",
        borderWidth: 2,
        tension: 0.15,
        pointRadius: 0,
        yAxisID: "yRatio",
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1c1c1b",
        titleFont: { family: "IBM Plex Mono", size: 11 },
        bodyFont: { family: "IBM Plex Mono", size: 11 },
        padding: 8,
      },
    },
    scales: {
      x: {
        ticks: {
          color: tickColor,
          maxTicksLimit: 7,
          font: { family: "IBM Plex Mono", size: 10 },
        },
        grid: { color: gridColor },
        border: { color: gridColor },
      },
      yRaw: {
        position: "left",
        ticks: {
          color: tickColor,
          font: { family: "IBM Plex Mono", size: 10 },
        },
        grid: { color: gridColor },
        border: { color: gridColor },
        title: {
          display: true,
          text: "freq",
          color: tickColor,
          font: { family: "IBM Plex Sans", size: 11 },
        },
      },
      yRatio: {
        position: "right",
        ticks: {
          color: tickColor,
          font: { family: "IBM Plex Mono", size: 10 },
        },
        grid: { drawOnChartArea: false },
        border: { color: gridColor },
        title: {
          display: true,
          text: "ratio / OD",
          color: tickColor,
          font: { family: "IBM Plex Sans", size: 11 },
        },
      },
    },
  },
});

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtNum(n, digits = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits);
}

function setOnline(online, lastSeenTs) {
  els.onlineLabel.classList.toggle("is-online", online);
  els.onlineLabel.classList.toggle("is-offline", !online);
  els.onlineLabel.textContent = online ? "Device online" : "Device offline";
  els.lastSeen.textContent = lastSeenTs
    ? `Last sync ${fmtTime(lastSeenTs)}`
    : "";
}

function renderLatest(latest) {
  if (!latest) {
    els.odDiff.textContent = "—";
    els.bgRatio.textContent = "—";
    els.brRatio.textContent = "—";
    els.rgbRaw.textContent = "—";
    return;
  }

  els.odDiff.textContent = fmtNum(latest.odDiff, 4);
  els.bgRatio.textContent = fmtNum(latest.bgRatio, 4);
  els.brRatio.textContent = fmtNum(latest.brRatio, 4);
  els.rgbRaw.textContent = `R ${latest.r}   G ${latest.g}   B ${latest.b}`;
}

function renderTable(readings) {
  if (!readings.length) {
    els.readingsBody.innerHTML =
      `<tr class="empty"><td colspan="7">No readings yet. Start the ESP with SERVER_URL pointed at this machine.</td></tr>`;
    return;
  }

  const rows = [...readings].reverse().slice(0, 25);
  els.readingsBody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${fmtTime(r.ts)}</td>
        <td>${r.r}</td>
        <td>${r.g}</td>
        <td>${r.b}</td>
        <td>${fmtNum(r.bgRatio, 4)}</td>
        <td>${fmtNum(r.brRatio, 4)}</td>
        <td>${fmtNum(r.odDiff, 4)}</td>
      </tr>`
    )
    .join("");
}

function renderChart(readings) {
  chart.data.labels = readings.map((r) => fmtTime(r.ts));
  chart.data.datasets[0].data = readings.map((r) => r.r);
  chart.data.datasets[1].data = readings.map((r) => r.g);
  chart.data.datasets[2].data = readings.map((r) => r.b);
  chart.data.datasets[3].data = readings.map((r) => r.bgRatio);
  chart.data.datasets[4].data = readings.map((r) => r.odDiff);
  chart.update();
}

async function refresh() {
  try {
    const res = await fetch(`/api/readings?limit=${HISTORY_LIMIT}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    setOnline(Boolean(data.online), data.device?.lastSeen || data.latest?.ts);
    els.deviceId.textContent = data.device?.deviceId || data.latest?.deviceId || "—";
    els.sampleCount.textContent = String(data.count ?? 0);
    renderLatest(data.latest);
    renderTable(data.readings || []);
    renderChart(data.readings || []);
  } catch (err) {
    console.error(err);
    setOnline(false, null);
    els.onlineLabel.textContent = "API unreachable";
    els.onlineLabel.classList.add("is-offline");
    els.onlineLabel.classList.remove("is-online");
  }
}

els.refreshBtn.addEventListener("click", refresh);

els.exportBtn.addEventListener("click", () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = `/api/export.csv?t=${Date.now()}`;
  a.download = `jaundice-readings-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

refresh();
setInterval(refresh, POLL_MS);
