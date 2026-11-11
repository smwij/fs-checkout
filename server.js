// FS Equipment Checkout — static UI + small proxy to the Notion API.
// Run:  NOTION_TOKEN=ntn_xxx node server.js   (Node 18+, no npm packages needed)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.NOTION_TOKEN;
const APP_KEY = process.env.APP_KEY || "";   // optional shared team password for the public internet
const STOCK_DB = "415ba2f49658800fba2ecdd33f3de830";   // FS DB (Cap.Dev equipment)
const LOG_DB = "6c16dd5dc1224b63921e32ef267329a1";     // FS Borrow Log
const NOTION = "https://api.notion.com/v1";

if (!TOKEN) {
  console.error("Set NOTION_TOKEN to your Notion internal-integration secret (see README.md).");
  process.exit(1);
}

const headers = {
  "Authorization": "Bearer " + TOKEN,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json"
};

async function notion(method, pathname, body) {
  const res = await fetch(NOTION + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || ("Notion API " + res.status));
  return data;
}

async function queryAll(dbId) {
  const pages = [];
  let cursor;
  do {
    const data = await notion("POST", "/databases/" + dbId + "/query",
      cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 });
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

const text = p => { const t = (p && (p.title || p.rich_text)) || []; const s = t.map(x => x.plain_text).join(""); return s || null; };
const sel = p => (p && p.select && p.select.name) || null;
const num = p => (p && typeof p.number === "number") ? p.number : null;
const date = p => (p && p.date && p.date.start) || null;
const appUrl = id => "https://app.notion.com/" + id.replace(/-/g, "");
const rich = s => ({ rich_text: [{ text: { content: s } }] });
const today = () => new Date().toISOString().slice(0, 10);

function mapItem(pg) {
  const p = pg.properties;
  return {
    id: pg.id, url: appUrl(pg.id),
    name: text(p["Name"]), no: num(p["No."]), desc: text(p["Descriptions"]),
    serial: text(p["Serial Number"]), remarks: text(p["Remarks"]),
    group: sel(p["Group"]) || "Ungrouped", location: sel(p["Location"]), status: sel(p["Status"])
  };
}

function mapRecord(pg) {
  const p = pg.properties;
  const rel = p["Item"] && p["Item"].relation && p["Item"].relation[0];
  return {
    id: pg.id, url: appUrl(pg.id), created: pg.created_time,
    item: rel ? rel.id : null,
    group: text(p["Group"]), batch: text(p["Batch"]),
    borrower: text(p["Borrower"]), project: text(p["Project"]), dest: text(p["Destination"]),
    note: text(p["Note"]), status: sel(p["Status"]),
    bon: date(p["Borrowed On"]), due: date(p["Due Back"]), ron: date(p["Returned On"])
  };
}

async function handleApi(req, body) {
  if (req.method === "GET" && req.url === "/api/data") {
    const [stock, log] = await Promise.all([queryAll(STOCK_DB), queryAll(LOG_DB)]);
    const items = stock.map(mapItem).sort((a, b) => (a.no || 9e9) - (b.no || 9e9));
    const records = log.map(mapRecord).sort((a, b) => b.created.localeCompare(a.created));
    return { items, records };
  }
  if (req.method === "POST" && req.url === "/api/borrow") {
    // body.items: [{id, name, group}] — one log record per item, tied by a batch id.
    if (!Array.isArray(body.items) || !body.items.length) throw new Error("items are required");
    if (!body.borrower) throw new Error("borrower is required");
    const batch = today().replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    for (const it of body.items) {
      if (!it.id) throw new Error("item id missing");
      const props = {
        "Record": { title: [{ text: { content: (it.name || "Item") + " · " + body.borrower + " · " + today() } }] },
        "Item": { relation: [{ id: it.id }] },
        "Item Link": { url: appUrl(it.id) },
        "Borrower": rich(body.borrower),
        "Batch": rich(batch),
        "Status": { select: { name: "Borrowed" } },
        "Borrowed On": { date: { start: today() } }
      };
      if (it.group) props["Group"] = rich(it.group);
      if (body.due) props["Due Back"] = { date: { start: body.due } };
      if (body.project) props["Project"] = rich(body.project);
      if (body.dest) props["Destination"] = rich(body.dest);
      if (body.note) props["Note"] = rich(body.note);
      await notion("POST", "/pages", { parent: { database_id: LOG_DB }, properties: props });
    }
    return { ok: true, batch, count: body.items.length };
  }
  if (req.method === "POST" && req.url === "/api/return") {
    // body.recordIds: one or many open log records to close.
    const ids = Array.isArray(body.recordIds) ? body.recordIds : (body.recordId ? [body.recordId] : []);
    if (!ids.length || !body.borrower) throw new Error("recordIds and borrower are required");
    for (const id of ids) {
      await notion("PATCH", "/pages/" + id, { properties: {
        "Status": { select: { name: "Returned" } },
        "Returned On": { date: { start: today() } },
        "Borrower": rich(body.borrower)
      }});
    }
    return { ok: true, count: ids.length };
  }
  return null;
}

const INDEX = path.join(__dirname, "public", "index.html");

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    try {
      if (req.url.startsWith("/api/")) {
        if (APP_KEY && req.headers["x-team-key"] !== APP_KEY) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end('{"error":"unauthorized"}');
        }
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const out = await handleApi(req, body);
        if (out === null) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"not found"}'); }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(out));
      }
      fs.readFile(INDEX, (err, data) => {
        if (err) { res.writeHead(500); return res.end("public/index.html missing"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
  });
}).listen(PORT, () => console.log("FS Equipment Checkout running at http://localhost:" + PORT));
