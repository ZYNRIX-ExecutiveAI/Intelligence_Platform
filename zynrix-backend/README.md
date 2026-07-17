# ZYNRIX Admin Backend

The real server behind the ZYNRIX Administration Console and the optional
"share your results" feature on the public Foundation Edition platform.

Node.js + Express + SQLite (via `better-sqlite3`). One process, one database
file, files stored on disk. No external services required to run it.

## What this replaces

Previously the admin console stored everything in the browser's local
storage, seeded with realistic sample data. This backend makes it real:
actual visitors who opt in to sharing their results, actual admin-managed
Executive Hub resources, actual file storage, actual login.

## 1. Local setup

```
cd zynrix-backend
npm install
cp .env.example .env
```

Open `.env` and set:
- `JWT_SECRET` — a long random string. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `FIRST_ADMIN_EMAIL` / `FIRST_ADMIN_PASSWORD` — created automatically the
  first time the server starts with an empty database. **Change the password
  immediately after your first login** (there's no in-app "change password"
  screen yet — update it directly in the database or re-seed with a new
  `.env` value before first boot).
- `CORS_ORIGIN` — leave as `*` while testing; tighten later if you want.

Start it:
```
npm start
```
You should see `ZYNRIX admin backend listening on port 4000`. Visit
`http://localhost:4000/health` to confirm it's alive.

Run `node integration_test.js` any time to exercise the whole API end to end
(auth, uploads, publishing, collections, notifications, settings, RBAC).

## 2. Hosting notes — read this before deploying

This uses SQLite (`data/zynrix.db`) and stores uploaded files on disk
(`uploads/`). **Both must live on a persistent volume/disk that survives
restarts and redeploys.** Some hosts wipe the filesystem on every deploy or
restart — if you use one of those without attaching a persistent volume,
you will silently lose all data.

Known-good options:
- **Railway** (railway.app) — attach a Volume to the service, mount it at
  e.g. `/data`, set `DATA_DIR=/data/db` and `UPLOAD_DIR=/data/uploads`.
- **Fly.io** — create a Volume (`fly volumes create`), mount it, same idea.
- **A basic VPS** (DigitalOcean, Linode, etc.) — just run it with `pm2` or a
  systemd service; the local disk is already persistent.

Avoid: serverless/edge platforms (Vercel, Cloudflare Workers, Netlify
Functions) — they don't offer a writable persistent filesystem, so SQLite
and file uploads won't survive between requests.

Whichever you choose, set these environment variables on the host:
`JWT_SECRET`, `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_PASSWORD`, `CORS_ORIGIN`,
`DATA_DIR`, `UPLOAD_DIR`, `PORT` (most hosts set `PORT` for you).

## 3. Connect the two HTML files

Once deployed, you'll have a URL like `https://zynrix-api.up.railway.app`.

**In `ZYNRIX_Executive_Intelligence_Platform.html`** (the public platform),
find and replace every occurrence of `REPLACE_WITH_YOUR_BACKEND_URL` with
your real backend URL (no trailing slash) in the `<head>`:
- the `zx-api-base` meta tag's `content` value
- the `connect-src` entry in the Content-Security-Policy meta tag

**In `ZYNRIX_Administration_Console.html`**, do the same — replace every
`REPLACE_WITH_YOUR_BACKEND_URL` with the same backend URL:
- the `zx-admin-api-base` meta tag
- both the `img-src` and `connect-src` entries in the CSP meta tag

Because both files use hash-pinned `script-src` (no `unsafe-inline`), editing
these `<meta>` tags never invalidates anything — the hash covers only the
`<script>` contents, which you're not touching. Don't edit anything inside
the `<script>` tags in either file; that will break the CSP hash and the
page will refuse to run its own code until the hash is recomputed.

That's it — no other changes needed. Re-upload both files wherever they're
hosted (or just open them locally to confirm they connect).

## 4. What the platform now sends (only if a visitor opts in)

On the Privacy step of onboarding there's now an unchecked-by-default box:
"share your results with ZYNRIX." If left unchecked, the platform behaves
exactly as before — fully local, nothing transmitted, matching its existing
privacy promise. If checked, the platform sends:
- an anonymous visit ping (always, regardless of consent — just a daily
  count, no personal data)
- organization profile + readiness score (only with consent)
- a thumbs up/down reaction, optionally with a 1–5 rating (own widget on
  the results dashboard, not gated behind the sharing checkbox since it
  carries no identifying information)

## 5. API surface

- `POST /api/public/visit`, `/api/public/assessment/start`,
  `/api/public/assessment/:id/complete`, `/api/public/assessment/:id/report-generated`,
  `/api/public/reaction` — called by the platform.
- `POST /api/session/login`, `GET /api/session/me` — admin auth.
- `GET/POST/PATCH/DELETE /api/admin/...` — everything the console uses,
  gated by the Bearer token from login and by role (`super_admin`,
  `publisher`, `content_editor`, `analyst` — see `src/auth.js`).
- `GET /api/admin/live?token=...` — Server-Sent Events stream the console
  uses for real-time updates on the Overview and Resources views.

## 6. Backing up

The whole dataset is `data/zynrix.db` plus the `uploads/` folder. Copy both
to back up or migrate. `better-sqlite3` databases are just files — safe to
copy while the server is stopped, or use SQLite's own backup tooling while
it's running.
