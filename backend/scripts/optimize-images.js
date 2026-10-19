"use strict";

/**
 * Shrink the site's bundled images in place (same filenames and formats, so no
 * HTML/CSS/CMS reference changes). Sizes are chosen per folder from how large
 * each image is actually displayed, with headroom for high-density screens.
 *
 *   node scripts/optimize-images.js             # report only (nothing written)
 *   node scripts/optimize-images.js --write     # overwrite files that get smaller
 *   node scripts/optimize-images.js --out DIR   # write results to DIR instead
 *
 * Idempotent: a file that is already small enough is left alone, so re-running
 * after adding images only touches the new ones. Full-resolution originals live
 * in docs/source-images (and git history) if anything ever needs redoing.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const config = require("../src/config");

const root = path.join(config.FRONTEND_DIR, "assets", "images");
const args = process.argv.slice(2);
const write = args.includes("--write");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : null;

// First matching rule wins. `w`/`h` are maximum dimensions (never enlarges).
const RULES = [
  { match: /^hero\/.*\.jpe?g$/i, w: 1920, q: 70 },
  { match: /^domains\/.*\.jpe?g$/i, w: 960, q: 72 },
  { match: /^industries\/.*\.jpe?g$/i, w: 960, q: 72 },
  { match: /^core-values\/.*\.jpe?g$/i, w: 1400, q: 72 },
  { match: /^projects\/(operation|project|material|mining|mechanised).*\.jpe?g$/i, w: 1240, q: 72 }, // wide banners
  { match: /^projects\/.*\.jpe?g$/i, w: 1200, q: 74 },
  { match: /^team\/.*\.jpe?g$/i, w: 700, q: 80 },
  { match: /^logos\/.*\.png$/i, h: 96 }, // shown 48px tall -> 2x
  { match: /^kipl-logo\.jpe?g$/i, w: 480, q: 80 }, // shown at ~34px
  { match: /^og-image\.jpe?g$/i, w: 1200, q: 75 }, // social preview
];

function walk(dir, rel = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? rel + "/" + e.name : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), r) : [r];
  });
}

async function encode(file, rule) {
  // Read into memory first: on Windows sharp/libvips can otherwise keep the file
  // locked, which makes overwriting it in place fail.
  let img = sharp(fs.readFileSync(file)).rotate();
  if (rule.w || rule.h) img = img.resize({ width: rule.w, height: rule.h, fit: "inside", withoutEnlargement: true });
  if (/\.png$/i.test(file)) {
    return img.png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toBuffer();
  }
  return img.jpeg({ quality: rule.q, mozjpeg: true, progressive: true }).toBuffer();
}

(async () => {
  const rows = [];
  let before = 0;
  let after = 0;
  for (const rel of walk(root).sort()) {
    const rule = RULES.find((r) => r.match.test(rel));
    if (!rule) continue;
    const file = path.join(root, rel);
    const oldSize = fs.statSync(file).size;

    // Already-optimised PNGs (indexed colour, within the size cap) are skipped:
    // quantising a second time would only degrade them further.
    if (/\.png$/i.test(file)) {
      const meta = await sharp(fs.readFileSync(file)).metadata();
      if (meta.paletteBitDepth && (!rule.h || meta.height <= rule.h)) {
        before += oldSize; after += oldSize;
        rows.push({ rel, oldSize, newSize: oldSize, keep: true });
        continue;
      }
    }
    const buf = await encode(file, rule);
    const keep = buf.length >= oldSize * 0.95; // not worth re-encoding
    const newSize = keep ? oldSize : buf.length;
    before += oldSize;
    after += newSize;
    rows.push({ rel, oldSize, newSize, keep });

    if (!keep) {
      if (outDir) {
        const dest = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
      } else if (write) {
        fs.writeFileSync(file, buf);
      }
    }
  }

  const kb = (n) => (n / 1024).toFixed(0).padStart(6);
  const folders = {};
  for (const r of rows) {
    const f = r.rel.includes("/") ? r.rel.split("/")[0] : ".";
    folders[f] = folders[f] || { n: 0, a: 0, b: 0 };
    folders[f].n++; folders[f].a += r.oldSize; folders[f].b += r.newSize;
  }
  console.log("folder         files    before      after   saved");
  for (const [f, v] of Object.entries(folders)) {
    console.log(`${f.padEnd(14)} ${String(v.n).padStart(4)}  ${kb(v.a)} KB  ${kb(v.b)} KB  ${(100 - (v.b / v.a) * 100).toFixed(0).padStart(3)}%`);
  }
  console.log(`${"TOTAL".padEnd(14)} ${String(rows.length).padStart(4)}  ${kb(before)} KB  ${kb(after)} KB  ${(100 - (after / before) * 100).toFixed(0).padStart(3)}%`);
  console.log(write ? "\nWrote optimised files in place." : outDir ? `\nWrote optimised copies to ${outDir}` : "\nReport only — re-run with --write (in place) or --out DIR.");
})();
