"use strict";

/**
 * Vercel Function running the admin API, draft previews, upload previews and
 * the daily cron job (vercel.json rewrites those paths here). The public site
 * itself is static files and never reaches this function.
 *
 * Each rewrite also passes the original path as ?__original=…, so routing
 * works whether or not the platform hands the function the rewritten URL.
 */

const { createApp } = require("../backend/src/app");
const db = require("../backend/src/db");

const app = createApp();

module.exports = (req, res) => {
  if (!db.remote) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "The admin's database isn't connected yet (add the Upstash Redis integration in Vercel)." }));
  }
  const url = new URL(req.url, "http://localhost");
  const original = url.searchParams.get("__original");
  if (original !== null) {
    url.searchParams.delete("__original");
    const pathname = url.pathname === "/api/server" ? original : url.pathname;
    req.url = pathname + (url.searchParams.size ? "?" + url.searchParams : "");
  }
  return app(req, res);
};
