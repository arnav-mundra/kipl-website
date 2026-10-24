"use strict";

/**
 * Render the website as plain static files (no server needed).
 *
 *   npm run export:static                      # from the local CMS database -> backend/dist/
 *   npm run export:static -- ../out            # ...to a folder of your choice
 *   node scripts/export-static.js --snapshot ../site-content ../dist-site
 *
 * With --snapshot DIR it renders from DIR/content.json (+ DIR/uploads) — the
 * committed copy of the published content that `npm run publish:site` writes —
 * instead of the local database. That is what the Vercel build uses, so it
 * needs no database. If DIR has no content.json the pages are exported exactly
 * as they are in frontend/ (the starting content).
 *
 * Only *published* content is exported; drafts never leave the CMS. On a
 * static host the contact form falls back to opening the visitor's email app.
 */

const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const { renderPage, PAGES } = require("../src/render");

const args = process.argv.slice(2);
const snapIdx = args.indexOf("--snapshot");
const snapshotDir = snapIdx >= 0 ? path.resolve(args[snapIdx + 1]) : null;
const positional = args.filter((a, i) => !a.startsWith("--") && i !== snapIdx + 1);
const out = path.resolve(positional[0] || path.join(config.BACKEND_DIR, "dist"));

let snapshot = null;
let uploadsDir = config.UPLOAD_DIR;

if (snapshotDir) {
  const file = path.join(snapshotDir, "content.json");
  if (fs.existsSync(file)) snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  uploadsDir = path.join(snapshotDir, "uploads");
} else {
  const db = require("../src/db");
  const content = require("../src/content");
  if (!fs.existsSync(config.DB_FILE)) {
    console.error("No CMS data found at " + config.DB_FILE + ". Start the server once (npm start) to create it.");
    process.exit(1);
  }
  db.load();
  if (!db.data.docs.length) {
    console.error("The CMS has no content yet. Start the server once (npm start) to install the starting content.");
    process.exit(1);
  }
  snapshot = content.snapshot("published");
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. Everything in frontend/ except the page sources (handled below) and work-in-progress drafts.
fs.cpSync(config.FRONTEND_DIR, out, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(config.FRONTEND_DIR, src).replace(/\\/g, "/");
    if (!rel) return true;
    if (rel === "draft" || rel.startsWith("draft/")) return false;
    if (snapshot && /^[^/]+\.html$/.test(rel)) return false; // rendered below
    return true;
  },
});

// 2. The pages, with published content filled in (or left as authored).
if (snapshot) {
  for (const file of PAGES) {
    fs.writeFileSync(path.join(out, file), renderPage(file, snapshot, { origin: config.SITE_ORIGIN }));
  }
}

// 3. Uploaded images (thumbnails are admin-only).
if (fs.existsSync(uploadsDir)) {
  fs.cpSync(uploadsDir, path.join(out, "uploads"), {
    recursive: true,
    filter: (src) => !path.relative(uploadsDir, src).replace(/\\/g, "/").startsWith("_thumbs"),
  });
}

console.log(
  `Exported ${snapshot ? PAGES.length + " rendered pages" : "the static pages (no snapshot yet)"} + assets to ${out}`
);
