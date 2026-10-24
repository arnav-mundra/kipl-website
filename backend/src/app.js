"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const config = require("./config");
const auth = require("./auth");
const content = require("./content");
const enquiries = require("./enquiries");
const { renderPage, isPage } = require("./render");
const adminRouter = require("./routes/admin");
const db = require("./db");
const backup = require("./backup");
const media = require("./media");
const uploads = require("./uploads");
const serverless = require("./serverless");

/** Rendered-page cache for the public site; cleared whenever anything is published. */
const pageCache = new Map(); // file -> { html, etag }
content.hooks.onPublish = () => pageCache.clear();

function renderPublished(file) {
  // Also invalidate when the page's own HTML file changes (e.g. after a deploy
  // or a local edit), not just when content is published.
  const mtime = fs.statSync(path.join(config.FRONTEND_DIR, file)).mtimeMs;
  const hit = pageCache.get(file);
  if (hit && hit.mtime === mtime) return hit;
  const html = renderPage(file, content.snapshot("published"));
  const entry = { html, mtime, etag: '"' + crypto.createHash("sha1").update(html).digest("base64url") + '"' };
  pageCache.set(file, entry);
  return entry;
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Serverless hosting: load/save the database around each request (see serverless.js).
  if (db.remote) app.use(serverless.middleware());

  /* ---- daily job when hosted (Vercel Cron): backup + any due scheduled publishing ---- */
  app.get("/api/cron", async (req, res) => {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const published = await serverless.runScheduled();
      const backupName = await backup.autoBackup();
      res.json({ ok: true, published: published.length, backup: backupName });
    } catch (err) {
      console.error("[cron]", err);
      res.status(500).json({ error: "Cron run failed" });
    }
  });

  /* ---- public contact form ---- */
  app.post("/api/enquiries", express.json({ limit: "50kb" }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const result = enquiries.submit(req.body, { ip: req.ip || "", ua: req.headers["user-agent"] });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  });

  /* ---- admin API ---- */
  app.use("/api/admin", adminRouter);

  /* ---- admin panel (static SPA) ---- */
  // (express.static redirects /admin -> /admin/ itself.)
  app.use(
    "/admin",
    (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      // Anti-clickjacking. KIPL_DEV_FRAMING=1 (local .env only) lifts it so the
      // panel can be shown inside an embedded preview browser during development.
      const frame = process.env.KIPL_DEV_FRAMING === "1" ? "" : "; frame-ancestors 'none'";
      if (frame) res.setHeader("X-Frame-Options", "DENY");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'" + frame
      );
      next();
    },
    express.static(config.ADMIN_DIR, { index: "index.html", dotfiles: "ignore" })
  );

  /* ---- draft preview (signed-in users only) ---- */
  app.get("/preview/:file", auth.attachUser, (req, res) => {
    if (!req.user) return res.redirect("/admin/");
    const file = req.params.file;
    if (!isPage(file)) return res.status(404).send("Not found");
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.type("html").send(renderPage(file, content.snapshot("draft"), { preview: true }));
    } catch (err) {
      console.error("[preview]", err);
      res.status(500).send("Couldn't render the preview.");
    }
  });

  /* ---- the public site: static pages with CMS content filled in ---- */
  app.get("/:page?", (req, res, next) => {
    const file = req.params.page || "index.html";
    if (!isPage(file)) return next();
    try {
      const { html, etag } = renderPublished(file);
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) return res.status(304).end();
      res.type("html").send(html);
    } catch (err) {
      // Never take the public site down because of a CMS problem: serve the static page.
      console.error("[render]", file, err);
      res.sendFile(path.join(config.FRONTEND_DIR, file));
    }
  });

  /* ---- uploaded images ---- */
  // Hosted, the files live in the GitHub repo (uploads.js); the live site has
  // its published copies as static files, so this only serves drafts' images
  // and thumbnails.
  if (uploads.remote()) {
    app.get("/uploads/*", async (req, res, next) => {
      try {
        const p = "uploads/" + req.params[0];
        const bytes = media.findByPath(p) ? await media.read(p) : null;
        if (!bytes) return next();
        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
        res.type(path.extname(p)).send(bytes);
      } catch (err) { next(err); }
    });
  } else {
    app.use("/uploads", express.static(config.UPLOAD_DIR, { maxAge: "7d", dotfiles: "ignore", index: false, fallthrough: true }));
  }

  /* ---- everything else in frontend/ (css, js, images, robots, sitemap…) ---- */
  // Raw page sources and work-in-progress concepts are never served as files
  // (case-insensitive, since Windows file systems ignore case).
  app.use((req, res, next) => (/\.html?$/i.test(req.path) || /^\/draft(\/|$)/i.test(req.path) ? res.status(404).send("Not found") : next()));
  // Images/CSS/JS are cached for a day (css/js carry ?v= cache-busters); HTML is never served from here.
  app.use(express.static(config.FRONTEND_DIR, { index: false, dotfiles: "ignore", extensions: false, maxAge: "1d" }));

  app.use((_req, res) => res.status(404).type("text").send("Not found"));
  return app;
}

module.exports = { createApp, pageCache };
