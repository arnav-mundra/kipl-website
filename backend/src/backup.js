"use strict";

const fs = require("fs");
const path = require("path");
const db = require("./db");
const config = require("./config");
const content = require("./content");
const { RESOURCES } = require("./schemas");
const { validateResource } = require("./validate");

const KEEP_AUTO = 14;

class BackupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Everything that is "the website" — not accounts, sessions or the audit trail. */
function snapshot() {
  return {
    format: "kipl-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    docs: db.data.docs,
    media: db.data.media,
    enquiries: db.data.enquiries,
    note: "Uploaded image files live in data/uploads and are not included in this JSON file — back that folder up too.",
  };
}

function ensureDir() {
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
}

function writeBackup(label) {
  ensureDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `kipl-backup-${label}-${stamp}.json`;
  fs.writeFileSync(path.join(config.BACKUP_DIR, name), JSON.stringify(snapshot()));
  prune();
  return name;
}

function prune() {
  const autos = list().filter((b) => b.name.includes("-auto-"));
  autos.slice(KEEP_AUTO).forEach((b) => {
    try { fs.unlinkSync(path.join(config.BACKUP_DIR, b.name)); } catch (_) { /* ignore */ }
  });
}

function list() {
  ensureDir();
  return fs
    .readdirSync(config.BACKUP_DIR)
    .filter((f) => /^kipl-backup-.*\.json$/.test(f))
    .map((name) => {
      const st = fs.statSync(path.join(config.BACKUP_DIR, name));
      return { name, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

function readBackup(name) {
  if (!/^kipl-backup-[A-Za-z0-9._-]+\.json$/.test(name)) throw new BackupError("Invalid backup name", 400);
  const file = path.join(config.BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw new BackupError("Backup not found", 404);
  return file;
}

/** Take an automatic backup if the newest one is older than a day. */
function autoBackup() {
  const newest = list().find((b) => b.name.includes("-auto-"));
  if (newest && Date.now() - new Date(newest.at).getTime() < 24 * 3600 * 1000) return null;
  return writeBackup("auto");
}

/**
 * Replace the website content with a backup. Everything is validated before
 * anything changes, and a safety backup of the current state is written first.
 */
function restore(input) {
  if (!input || input.format !== "kipl-backup" || !Array.isArray(input.docs)) {
    throw new BackupError("That doesn't look like a KIPL backup file.");
  }
  const problems = [];
  for (const d of input.docs) {
    if (!d || typeof d !== "object" || !RESOURCES[d.type] || typeof d.id !== "string") {
      problems.push("A record has an unknown type or missing id.");
      continue;
    }
    for (const part of ["data", "published"]) {
      if (d[part] == null) continue;
      // Validate with references off — restore is all-or-nothing, so order doesn't matter.
      const { errors } = validateResource(d.type, d[part], { refExists: () => true });
      if (errors.length) problems.push(`${d.type}/${d.id} (${part}): ${errors[0].message}`);
    }
  }
  if (problems.length) throw new BackupError("Backup is invalid: " + problems.slice(0, 5).join("; "));

  const safety = writeBackup("pre-restore");
  db.data.docs = input.docs;
  db.data.media = Array.isArray(input.media) ? input.media : [];
  db.data.enquiries = Array.isArray(input.enquiries) ? input.enquiries : [];
  db.save();
  content.hooks.onPublish();
  return { safetyBackup: safety, docs: input.docs.length };
}

module.exports = { BackupError, snapshot, writeBackup, list, readBackup, autoBackup, restore };
