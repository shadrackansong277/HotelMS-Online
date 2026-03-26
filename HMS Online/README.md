# Grand Vista HMS — Web Edition
## Deploy & Host Worldwide in 3 Steps

---

## FOLDER STRUCTURE
```
hms-web/
├── server.js          ← Node.js backend (all API + DB logic)
├── package.json       ← Dependencies
├── public/
│   └── index.html     ← Full SPA frontend (no build step needed)
└── data/
    └── hms.db         ← SQLite database (auto-created on first run)
```

---

## OPTION 1 — Run on Your Own Computer (LAN / Office)

```bash
npm install
node server.js
```
Open browser → `http://localhost:3000`
For office access: use your machine's IP → `http://192.168.x.x:3000`

---

## OPTION 2 — Deploy on Render.com (FREE, worldwide access)

1. Push this folder to a GitHub repository
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Add environment variables:
   - `SESSION_SECRET` = any long random string (e.g. `my-hotel-secret-xyz-2024`)
   - `NODE_ENV` = `production`
6. Click Deploy — you get a free URL like `https://your-hotel.onrender.com`

> ⚠️ Free tier spins down after 15 min of inactivity. Upgrade to paid for 24/7 uptime.

---

## OPTION 3 — Deploy on Railway.app (Recommended, always-on)

1. Go to https://railway.app → New Project → Deploy from GitHub
2. Connect repo, Railway auto-detects Node.js
3. Add environment variables:
   - `SESSION_SECRET` = random secret string
   - `NODE_ENV` = `production`
   - `PORT` = `3000`
4. Deploy → get URL like `https://your-hotel.up.railway.app`

**Cost:** ~$5/month for always-on hosting

---

## OPTION 4 — VPS / Cloud Server (Full Control)

Works on any Ubuntu/Debian server (DigitalOcean, AWS EC2, etc.)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Upload your files, then:
cd /path/to/hms-web
npm install
SESSION_SECRET="your-secret" NODE_ENV=production node server.js

# Keep it running forever with PM2:
sudo npm install -g pm2
SESSION_SECRET="your-secret" NODE_ENV=production pm2 start server.js --name hms
pm2 save && pm2 startup
```

For HTTPS, put Nginx in front:
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    location / { proxy_pass http://localhost:3000; }
}
```

---

## ENVIRONMENT VARIABLES

| Variable          | Required | Description                                    |
|-------------------|----------|------------------------------------------------|
| `SESSION_SECRET`  | Yes      | Random string — keep this secret in production |
| `NODE_ENV`        | Yes      | Set to `production` for live deployment        |
| `PORT`            | No       | Port to listen on (default: 3000)              |
| `DATA_DIR`        | No       | Path to store the database (default: ./data)   |

---

## DEFAULT LOGIN CREDENTIALS

| Role          | Username       | Password      |
|---------------|----------------|---------------|
| Admin         | admin          | admin123      |
| Manager       | manager        | manager123    |
| Receptionist  | receptionist   | recept123     |

**Change these immediately after first login via Staff → Reset Password**

---

## MULTI-PROPERTY SETUP

All hotels share one database. After deploying:
1. Log in as admin
2. Go to Settings → "Add New Hotel Property"
3. Each property gets its own admin account and rooms
4. All staff at each property log in to the same URL
5. Super admins see all properties in "Multi-Hotel View"

---

## DATA BACKUP

The entire database is one file: `data/hms.db`

To backup: simply copy `data/hms.db` to safe storage.
To restore: replace `data/hms.db` and restart the server.

For automated backups on Linux:
```bash
# Daily backup cron job
0 2 * * * cp /path/to/hms-web/data/hms.db /backups/hms-$(date +%Y%m%d).db
```
