# Jaundice Monitor — local dashboard

ESP probe → your PC (`localhost:3000`) → live dashboard. Cloudflare is parked for later.

## Run the dashboard

```bash
cd /home/philipslinux/proj
node server/index.js
```

Open **http://localhost:3000**

Fake data (no ESP yet), in another terminal:

```bash
node server/seed.js
```

## Point the ESP at your PC

1. Run the server — it prints something like `ESP URL: http://192.168.x.x:3000`
2. In `firmware/jaundice_monitor.ino`, set `SERVER_URL` to that address (**not** `localhost` — the ESP is a different device)
3. Flash, same Wi‑Fi as the PC

## API

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/readings` | `X-API-Key` |
| `GET`  | `/api/readings?limit=80` | none |
| `GET`  | `/api/health` | none |

`cloudflare/` still has the Worker code if you want it later — unused for now.
