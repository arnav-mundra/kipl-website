"use strict";

/**
 * Turns the static pages in frontend/ into dynamic ones: each page is loaded
 * as-is and its content regions are filled from the CMS snapshot. The static
 * HTML stays the single source of truth for markup, classes, icons and
 * animation hooks — the CMS only supplies words, numbers and images.
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const config = require("../config");
const { patchFooter, patchHeroImages, patchJsonLd } = require("./common");
const { patchHome } = require("./home");
const { patchServices } = require("./services");
const { patchProjects } = require("./projects");
const { patchAbout } = require("./about");
const { patchContact } = require("./contact");

const PAGES = {
  "index.html": patchHome,
  "services.html": patchServices,
  "projects.html": patchProjects,
  "about.html": patchAbout,
  "contact.html": patchContact,
};

const source = new Map(); // file -> { mtimeMs, html }

function readSource(file) {
  const abs = path.join(config.FRONTEND_DIR, file);
  const { mtimeMs } = fs.statSync(abs);
  const hit = source.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.html;
  const html = fs.readFileSync(abs, "utf8");
  source.set(file, { mtimeMs, html });
  return html;
}

function isPage(file) {
  return Object.prototype.hasOwnProperty.call(PAGES, file);
}

const PREVIEW_BADGE =
  '<div style="position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:8px 14px;border-radius:999px;' +
  'background:#14213d;color:#fff;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);' +
  'pointer-events:none">Draft preview — not live</div>';

/**
 * @param {string} file     e.g. "projects.html"
 * @param {object} content  snapshot from content.snapshot()
 * @param {{preview?: boolean, origin?: string}} opts
 */
function renderPage(file, content, opts = {}) {
  if (!isPage(file)) throw new Error("Not a CMS page: " + file);
  const $ = cheerio.load(readSource(file));

  patchFooter($, content);
  patchHeroImages($, content);
  PAGES[file]($, content);
  if (file === "index.html") patchJsonLd($, content, opts.origin || config.SITE_ORIGIN);

  if (opts.preview) {
    $("head").prepend('<base href="/" /><meta name="robots" content="noindex,nofollow" />');
    $("body").append(PREVIEW_BADGE);
  }
  return $.html();
}

module.exports = { renderPage, isPage, PAGES: Object.keys(PAGES) };
