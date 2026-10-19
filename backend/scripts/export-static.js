"use strict";

/**
 * Export the published website as plain static files (no server needed).
 *
 *   npm run export:static            -> backend/dist/
 *   npm run export:static -- ../out  -> a folder of your choice
 *
 * Use this if the public site is hosted somewhere static (e.g. Vercel,
 * Netlify, S3) while the admin runs elsewhere: re-export after publishing,
 * then deploy the folder. Only *published* content is exported — drafts
 * never leave the CMS. Note that on a static host the contact form falls back
 * to opening the visitor's email app, because there is no /api to post to.
 */

const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const db = require("../src/db");
const content = require("../src/content");
const { renderPage, PAGES } = require("../src/render");

const out = path.resolve(process.argv[2] || path.join(config.BACKEND_DIR, "dist"));

if (!fs.existsSync(config.DB_FILE)) {
  console.error("No CMS data found at " + config.DB_FILE + ". Start the server once (npm start) to create it.");
  process.exit(1);
}
db.load();
if (!db.data.docs.length) {
  console.error("The CMS has no content yet. Start the server once (npm start) to install the starting content.");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. Everything in frontend/ except the page sources (rendered below) and work-in-progress drafts.
fs.cpSync(config.FRONTEND_DIR, out, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(config.FRONTEND_DIR, src).replace(/\\/g, "/");
    if (!rel) return true;
    if (rel === "draft" || rel.startsWith("draft/")) return false;
    if (/^[^/]+\.html$/.test(rel)) return false;
    return true;
  },
});

// 2. The pages, with published content filled in.
const snapshot = content.snapshot("published");
for (const file of PAGES) {
  fs.writeFileSync(path.join(out, file), renderPage(file, snapshot, { origin: config.SITE_ORIGIN }));
}

// 3. Uploaded images (thumbnails are admin-only).
if (fs.existsSync(config.UPLOAD_DIR)) {
  fs.cpSync(config.UPLOAD_DIR, path.join(out, "uploads"), {
    recursive: true,
    filter: (src) => !path.relative(config.UPLOAD_DIR, src).replace(/\\/g, "/").startsWith("_thumbs"),
  });
}

console.log(`Exported ${PAGES.length} pages + assets to ${out}`);
