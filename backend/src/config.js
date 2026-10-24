"use strict";

const fs = require("fs");
const path = require("path");

const BACKEND_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(BACKEND_DIR, "..");

// Tiny .env loader — avoids a dependency for a handful of settings.
// Values already present in the real environment win.
(function loadEnv() {
  const file = path.join(BACKEND_DIR, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const DATA_DIR = process.env.KIPL_DATA_DIR ? path.resolve(process.env.KIPL_DATA_DIR) : path.join(BACKEND_DIR, "data");

module.exports = {
  BACKEND_DIR,
  ROOT_DIR,
  FRONTEND_DIR: process.env.KIPL_FRONTEND_DIR ? path.resolve(process.env.KIPL_FRONTEND_DIR) : path.join(ROOT_DIR, "frontend"),
  ADMIN_DIR: path.join(BACKEND_DIR, "admin"),
  SEED_DIR: path.join(BACKEND_DIR, "seed"),
  SITE_CONTENT_DIR: path.join(ROOT_DIR, "site-content"),
  DATA_DIR,
  UPLOAD_DIR: path.join(DATA_DIR, "uploads"),
  BACKUP_DIR: path.join(DATA_DIR, "backups"),
  DB_FILE: path.join(DATA_DIR, "db.json"),
  PORT: parseInt(process.env.PORT, 10) || 4000,
  // Public origin used in the static export / canonical URLs when needed.
  SITE_ORIGIN: process.env.SITE_ORIGIN || "https://kipl.co",
  IS_PROD: process.env.NODE_ENV === "production",
  SESSION_HOURS: 12,
  MAX_UPLOAD_BYTES: 15 * 1024 * 1024,
};
