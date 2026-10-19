"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const db = require("./db");
const config = require("./config");
const content = require("./content");

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const MAX_PIXELS = 60 * 1000 * 1000;

class MediaError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function slug(name) {
  return (
    String(name || "image")
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image"
  );
}

/**
 * Validate, auto-orient, resize and re-encode an uploaded image, then store
 * it with a thumbnail. Re-encoding through sharp also strips metadata (GPS
 * etc.) and guarantees the bytes really are the image type claimed.
 * `purpose`: "photo" (max 2400px wide) or "logo" (max 800px wide).
 */
async function saveUpload(buffer, originalName, purpose, user) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch (_) {
    throw new MediaError("That file isn't a readable image.", 415);
  }
  if (!ALLOWED_FORMATS.has(meta.format)) {
    throw new MediaError("Only JPG, PNG or WebP images can be uploaded.", 415);
  }

  const maxWidth = purpose === "logo" ? 800 : 2400;
  const id = db.id(5);
  const asPng = meta.format === "png" || (meta.hasAlpha && meta.format !== "webp");
  const ext = meta.format === "webp" ? "webp" : asPng ? "png" : "jpg";

  let pipeline = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: maxWidth, withoutEnlargement: true });
  if (ext === "png") pipeline = pipeline.png({ compressionLevel: 9 });
  else if (ext === "webp") pipeline = pipeline.webp({ quality: 82 });
  else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  const d = new Date();
  const rel = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${slug(originalName)}-${id}.${ext}`;
  const abs = path.join(config.UPLOAD_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);

  const thumbRel = `_thumbs/${id}.webp`;
  const thumbAbs = path.join(config.UPLOAD_DIR, thumbRel);
  fs.mkdirSync(path.dirname(thumbAbs), { recursive: true });
  await sharp(data).resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toFile(thumbAbs);

  const record = {
    id,
    path: "uploads/" + rel,
    thumb: "uploads/" + thumbRel,
    name: String(originalName || "image").slice(0, 120),
    width: info.width,
    height: info.height,
    bytes: data.length,
    purpose: purpose === "logo" ? "logo" : "photo",
    uploadedBy: user ? user.username : "system",
    uploadedAt: new Date().toISOString(),
  };
  db.data.media.push(record);
  db.save();
  return record;
}

let builtinCache = { at: 0, items: [] };

function scanBuiltin() {
  if (Date.now() - builtinCache.at < 30000) return builtinCache.items;
  const root = path.join(config.FRONTEND_DIR, "assets", "images");
  const items = [];
  (function walk(dir, rel) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), r);
      else if (/\.(jpe?g|png|webp)$/i.test(entry.name) && entry.name !== "og-image.jpg") {
        const full = "assets/images/" + r;
        items.push({
          id: "builtin:" + full,
          path: full,
          thumb: full,
          name: entry.name,
          folder: rel || "",
          builtin: true,
          bytes: fs.statSync(path.join(dir, entry.name)).size,
        });
      }
    }
  })(root, "");
  builtinCache = { at: Date.now(), items };
  return items;
}

function list({ q, source } = {}) {
  const uploads = db.data.media.slice().reverse().map((m) => Object.assign({ builtin: false }, m));
  const builtin = scanBuiltin();
  let rows = source === "uploads" ? uploads : source === "builtin" ? builtin : uploads.concat(builtin);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((m) => (m.name + " " + m.path).toLowerCase().includes(needle));
  }
  return rows;
}

function remove(id) {
  const rec = db.data.media.find((m) => m.id === id);
  if (!rec) throw new MediaError("Not found (built-in site images can't be deleted).", 404);
  const usage = content.findImageUsage(rec.path);
  if (usage.length) {
    throw new MediaError("This image is still in use: " + usage.map((u) => u.title).slice(0, 5).join(", "), 409, usage);
  }
  for (const rel of [rec.path, rec.thumb]) {
    const abs = path.join(config.UPLOAD_DIR, rel.replace(/^uploads\//, ""));
    try { fs.unlinkSync(abs); } catch (_) { /* already gone */ }
  }
  db.data.media.splice(db.data.media.indexOf(rec), 1);
  db.save();
  return rec;
}

function diskUsage() {
  return db.data.media.reduce((sum, m) => sum + (m.bytes || 0), 0);
}

module.exports = { MediaError, saveUpload, list, remove, diskUsage };
