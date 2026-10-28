# Jaundice Monitor – Test Plan & Test Cases

Scope: local dashboard server (`server/index.js`), renderer (`shared/dashboard.js`),
dashboard UI (`cloudflare/public/index.html`), firmware maths (`firmware/jaundice_monitor.ino`),
ML scripts (`ml/model/*.py`).

## 1. How to run

| Suite | Command (from project root) | Needs |
|---|---|---|
| White-box (unit) | `node --test "tests/whitebox/*.test.js"` | Node 18+ |
| White-box + coverage | `node --test --experimental-test-coverage "tests/whitebox/*.test.js"` | Node 20+ |
| Black-box (API) | `node --test "tests/blackbox/*.test.js"` | Node 18+ (server is started automatically on port 3101) |
| Selenium (UI) | `pip install -r tests/selenium/requirements.txt` then `pytest tests/selenium -v` | Python 3.9+, Chrome |
| Selenium, visible browser | `HEADED=1 pytest tests/selenium -v -s` (Windows PowerShell: `$env:HEADED=1; pytest tests/selenium -v -s`) | |

Selenium tests start and stop their own server on port 3100, so you do **not** need to run `node server/index.js` first.

## 2. White-box test cases (we read the code, then target its branches)

| ID | Unit / branch | Input | Expected |
|---|---|---|---|
| WB-01 | `renderTableBody` – empty branch | `[]` | One `<tr class="empty">`, `colspan=7` |
| WB-02 | `renderTableBody` – `reverse()` | 2 readings | Newest shown first |
| WB-03 | `slice(0,25)` boundary | 25 / 26 / 40 readings | 25 rows each |
| WB-04 | `slice(0,25)` below cap | 24 readings | 24 rows |
| WB-05 | `fmtNum(…, 4)` | `bgRatio = 0.5` | `0.5000` |
| WB-06 | `escapeHtml` all 4 replacements | `<b>&"x` | `&lt;b&gt;&amp;&quot;x` |
| WB-10 | `renderChartSvg` n = 0 | `[]` | No `<path>`, no hover columns |
| WB-11 | `xAt` when n ≤ 1 | 1 reading | Point at plot centre (x = 357), 5 series |
| WB-12 | `linePath` first/other points | 2 readings | Exactly one `M`, one `L` |
| WB-13 | `niceScale` `min === max` branch | Flat data | No `NaN` / `Infinity` in SVG |
| WB-14 | `niceScale` no finite numbers | All `NaN` | Fallback scale 0…1 (tick `0.25` present) |
| WB-15 | Tooltip flip `tipX + tipW > W-4` | 10 readings | First tip right of point, last tip left of point |
| WB-16 | X-label thinning (`minGap`) | 80 readings | 1 – 7 labels |
| WB-20 | `renderDashboard` – no device | `{readings:[]}` | "Waiting for device", `—` placeholders |
| WB-21 | `data.online === true` | device + online | "Device online", class `is-online` |
| WB-22 | `data.online === false` | device + offline | "Device offline", class `is-offline` |
| WB-23 | `device \|\| latest` short-circuit | latest only | Treated as has-device; device id from `latest` |
| WB-24 | `Array.isArray` guard | `readings:"oops"` | No exception |
| WB-25 | Token replacement loop | any | No `{{…}}` left |
| WB-26 | Count + RGB text | count 7 | `7` and `R 10 G 20 B 30` rendered |

**Measured coverage of `shared/dashboard.js`: 99.25 % lines, 92.16 % branches, 100 % functions.**

### 2.1 White-box cases for firmware (manual / on the bench – C++ cannot run in Node)

| ID | Code | Input | Expected |
|---|---|---|---|
| WB-F1 | `lastBG = (lastG > 0) ? B/G : 0` | G = 0, B = 500 | B/G = 0 (no divide-by-zero) |
| WB-F2 | `lastBR = (lastR > 0) ? B/R : 0` | R = 0 | B/R = 0 |
| WB-F3 | `OD = ln(G+1) − ln(B+1)` | G = 900, B = 650 | ≈ 0.325 |
| WB-F4 | `OD` when G = B | G = B = 800 | 0.000 |
| WB-F5 | `readFreq`: `pulseIn` timeout → `duration == 0` | sensor disconnected | Returns 0 (R = G = B = 0 on OLED) |
| WB-F6 | `SD.begin` fails | no SD card | OLED shows "SD: FAILED", measurement still shown |
| WB-F7 | `WiFi.status() != WL_CONNECTED` in `postReading` | Wi-Fi off | Returns false, "SD + OLED only" mode, no crash |
| WB-F8 | `millis() - lastBeatMs >= BEAT_MS` | idle 8 s | One heartbeat POST per 8 s, none while measuring |
| WB-F9 | Button edge detect `HIGH → LOW` | hold button | Only ONE measurement per press |

## 3. Black-box test cases (only the README contract is used)

| ID | Endpoint / feature | Input | Expected |
|---|---|---|---|
| BB-01 | POST /api/readings | valid body + key | 200, `ok:true` |
| BB-02 | same | no key | 401 |
| BB-03 | same | wrong key | 401 |
| BB-04 | POST /api/heartbeat | no key | 401 |
| BB-05 | POST /api/clear | no key | 401, data unchanged |
| BB-06 | POST /api/readings | malformed JSON | 400 |
| BB-07 | same | field `b` missing | 400 |
| BB-08 | same | `r:"abc"` | 400 |
| BB-09 | same | `r:"1200"` (numeric string) | 200, stored as number 1200 |
| BB-10 | same | `g:""` | 400 |
| BB-11 | same | `g:null` | 400 |
| BB-12 | same | `r:1e999` | 400 |
| BB-13 | same | r = g = b = 0 | 200 (boundary) |
| BB-14 | same | no `deviceId` | defaults to `esp32-probe-1` |
| BB-15 | same | `"  probe-9  "` / `"   "` | trimmed / default |
| BB-16 | same | `r:-5` | **200 – observation, see §5** |
| BB-20 | GET /api/readings | empty server | count 0, latest null, online false |
| BB-21 | same | 2 posts | latest = 2nd |
| BB-22 | history cap | 7 posts, cap 5 | only last 5 kept |
| BB-23 | `?limit=2` | 4 posts | newest 2 |
| BB-24 | `limit` = 0 / -5 / abc / 999999 | 4 posts | default / 1 / default / capped |
| BB-30 | heartbeat | empty body | 200, online true |
| BB-31 | heartbeat | bad JSON | 400 |
| BB-32 | online timeout | wait 1.8 s (timeout 1.5 s) | online false |
| BB-33 | clear | with key | count 0, device null |
| BB-40 | GET /api/health | – | 200 `ok:true` |
| BB-41 | GET /api/export.csv | 1 reading | CSV header + 1 row, attachment filename |
| BB-42 | CSV escaping | deviceId `a,"b"` | `"a,""b"""` |
| BB-43 | OPTIONS | – | 204, CORS `*` |
| BB-44 | unknown path | `/nope.txt` | 404 |
| BB-45 | `/styles.css` | – | 200 `text/css` |
| BB-46 | path traversal | `/..%2f..%2fserver/index.js` | not 200 |
| BB-47 | dashboard HTML | 1 reading | values in HTML, no `{{` |
| BB-48 | XSS | deviceId `<script>…` | escaped in HTML |

## 4. Selenium (UI, black-box through a real browser)

| ID | Scenario | Expected |
|---|---|---|
| SEL-01 | Open page | Title and H1 = "Jaundice Monitor" |
| SEL-02 | Footer | Contains "not a clinical diagnosis" |
| SEL-03 | Metric labels | OD Diff, B / G, B / R, Raw RGB |
| SEL-04 | Table header | Time, R, G, B, B/G, B/R, OD |
| SEL-05 | Empty server | "Waiting for device", `—`, samples 0, "No readings yet" |
| SEL-06 | POST a reading, wait | Page auto-updates within the 2 s poll; OD 0.3200, B/G 0.7200, B/R 0.5900 |
| SEL-07 | Click **Refresh** | Value updates immediately |
| SEL-08 | 3 readings | 3 table rows |
| SEL-09 | 5 readings posted | Sample counter shows 5; table has 5 rows (one per reading) |
| SEL-10 | 4 readings | 5 series paths, 4 hover columns in SVG |
| SEL-11 | Custom deviceId | Shown in Device panel |
| SEL-12 | Heartbeat | "Device online" + `is-online` class |
| SEL-13 | Heartbeat then wait 3 s+ | Flips to "Device offline" |
| SEL-14 | Click Dark / Light | `data-theme` toggles |
| SEL-15 | Dark, then reload | Still dark (localStorage) |
| SEL-16 | Dark, wait for poll | Theme survives the DOM refresh |
| SEL-17 | Compare body background | Light ≠ Dark |
| SEL-18 | Export CSV link | `href` ends with `/api/export.csv` |
| SEL-19 | XSS payload in deviceId | Shown as text, no alert, no `<img>` injected |
| SEL-20 | Kill server | "API unreachable" + `is-offline` |

## 5. Observations from reading the code (worth mentioning in your report)

1. **No range/consistency validation (BB-16).** Negative or absurd RGB values are accepted, and the server trusts
   `bgRatio`, `brRatio`, `odDiff` as sent instead of recomputing them from r, g, b.
2. **`server/store.js` (SQLite) is dead code.** `index.js` never imports it, so data is RAM-only, as the README says.
   It also needs Node 22.5+, while the README claims Node 18+.
3. **Read endpoints are unauthenticated.** `GET /api/readings`, `/api/export.csv` and the dashboard expose data to
   anyone on the LAN (server binds `0.0.0.0`). The API key travels over plain HTTP and the default key is public.
4. **Two copies of the dashboard HTML** (`public/index.html` and `cloudflare/public/index.html`) differ; the server only uses the `cloudflare/` copy.
5. **Doc drift.** README `SERVER_URL` is `10.23.4.54`, firmware has `10.81.5.110`; README says ESP8266 but default `DEVICE_ID` is `esp32-probe-1`.
6. **ML script note.** `logistic_regression.py` drops r, g, b but keeps `bg_ratio`, `br_ratio`, `od_diff`, which are
   derived from them, so the model still sees colour information (fine, but worth stating). The dataset is synthetic (200 rows) – accuracy is not clinical evidence.
