# FS Equipment Checkout

Group-based borrow/return web app for the Cap.Dev FS equipment. It reads
the **FS DB** database in Notion (read-only) and writes checkouts to the
**FS Borrow Log**.

The flow is set-based: the home screen shows one card per equipment
group (KU Radar C24, DRS Radar, Laser, …). Tap a group, tick or untick
the individual items you're taking (borrowed and Spoil items are locked
out), and borrow them in one go. Each item gets its own log record, tied
together by a shared **Batch** id, so partial returns work — return one
item or the whole batch.

Plain Node.js (18+), no npm packages. Teammates just open the URL — they
don't need Notion or Claude accounts; the "Your name" field identifies
the borrower.

## 1. Notion setup (one time)

1. Go to https://www.notion.so/profile/integrations → *New integration*
   (internal) → copy the secret (`ntn_…`). You can reuse the drone-checkout
   integration.
2. In Notion, open the **FS Database** page (it contains both FS DB and
   FS Borrow Log), click `⋯` (top right) → *Connections* → add your
   integration. Child databases inherit the connection.

## 2. Environment variables

| Variable       | Required | What it is                                            |
|----------------|----------|-------------------------------------------------------|
| `NOTION_TOKEN` | yes      | The integration secret from step 1                    |
| `APP_KEY`      | for public hosting | Shared team password; visitors must enter it once |
| `PORT`         | no       | Defaults to 3000 (most hosts set this themselves)     |

Always set `APP_KEY` when the app is reachable from the internet.

## 3. Run locally / on the LAN

```bash
NOTION_TOKEN=ntn_xxx APP_KEY=yourteampassword node server.js
```

Open http://localhost:3000 (teammates: `http://<your-ip>:3000`).

## 4. Host it on Render (free)

1. Push this folder to a GitHub repository.
2. At https://render.com → *New → Web Service* → connect the repo.
3. Runtime **Node**, start command `npm start` (auto-detected).
4. Add environment variables `NOTION_TOKEN` and `APP_KEY`.
5. Deploy — you get a public `https://…onrender.com` URL to share.
   (Free instances sleep when idle; first visit after a pause takes ~30 s.)

## Files

- `server.js` — serves the page and proxies the Notion API
  (`GET /api/data`, `POST /api/borrow`, `POST /api/return`). The Notion
  token stays on the server; browsers only ever see the team key they
  typed themselves.
- `public/index.html` — the UI (iOS liquid-glass style, same look as
  drone-checkout).
- `Dockerfile`, `package.json` — deployment support.

## Notes

- Database IDs are hard-coded at the top of `server.js`
  (`STOCK_DB` = FS DB, `LOG_DB` = FS Borrow Log).
- Borrow creates one FS Borrow Log record per selected item with a
  shared `Batch` id. Return stamps `Returned On` and closes records.
  Nothing in FS DB is ever modified.
- Items with Status **Spoil** in FS DB can't be borrowed.
