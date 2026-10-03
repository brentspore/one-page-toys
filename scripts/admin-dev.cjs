#!/usr/bin/env node
/* Local dev server for the admin page: serves the site like `start` does, and
 * runs api/admin.js the way Vercel's Node runtime would (req.query, req.body,
 * res.status().json()).
 *
 *   ADMIN_DEMO=1 node scripts/admin-dev.cjs [port]   # fake numbers, fake sign-in
 *   node scripts/admin-dev.cjs [port]                # real Google, needs the env vars
 *
 * Then open http://localhost:<port>/admin/ (default 8125). Demo mode can never
 * switch on in a Vercel deployment; see api/_admin.js.
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), url = require("url");
const ROOT = path.join(__dirname, ".."), PORT = +process.argv[2] || 8125;
const handler = require(path.join(ROOT, "api", "admin.js"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === "/api/admin" || u.pathname === "/api/admin/") {   // the site redirects to the slashed form
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      req.query = u.query;
      try { req.body = raw && /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
      res.status = (s) => { res.statusCode = s; return res; };
      res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
      Promise.resolve(handler(req, res)).catch((e) => { res.statusCode = 500; res.end(String(e)); });
    });
    return;
  }
  let p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  fs.readFile(p, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", TYPES[path.extname(p)] || "application/octet-stream");
    res.end(buf);
  });
}).listen(PORT, () => console.log(`admin dev server on http://localhost:${PORT}/admin/ ${process.env.ADMIN_DEMO === "1" ? "(demo data)" : ""}`));
