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
    note: "Uploaded image files are not included in this JSON file — they live in data/uploads (or the repository's media/ folder when hosted); back them up too.",
  };
}

/*
 * Server-side backups are files in data/backups — or, on serverless hosting
 * (db.remote), Redis keys: an index plus one key per backup. Same names and
 * listing either way.
 */
const INDEX_KEY = "kipl:backups";
const backupKey = (name) => "kipl:backup:" + name;

async function remoteIndex() {
  const json = await db.remote.command("GET", INDEX_KEY);
  return json ? JSON.parse(json) : [];
}

const store = {
  async write(name, json) {
    if (!db.remote) {
      fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
      fs.writeFileSync(path.join(config.BACKUP_DIR, name), json);
      return;
    }
    await db.remote.command("SET", backupKey(name), json);
    const index = await remoteIndex();
    index.push({ name, bytes: Buffer.byteLength(json), at: new Date().toISOString() });
    await db.remote.command("SET", INDEX_KEY, JSON.stringify(index));
  },
  async remove(name) {
    if (!db.remote) {
      try { fs.unlinkSync(path.join(config.BACKUP_DIR, name)); } catch (_) { /* ignore */ }
      return;
    }
    await db.remote.command("DEL", backupKey(name));
    const index = (await remoteIndex()).filter((b) => b.name !== name);
    await db.remote.command("SET", INDEX_KEY, JSON.stringify(index));
  },
  async list() {
    if (db.remote) return remoteIndex();
    fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
    return fs
      .readdirSync(config.BACKUP_DIR)
      .filter((f) => /^kipl-backup-.*\.json$/.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(config.BACKUP_DIR, name));
        return { name, bytes: st.size, at: st.mtime.toISOString() };
      });
  },
  async read(name) {
    if (db.remote) return db.remote.command("GET", backupKey(name));
    const file = path.join(config.BACKUP_DIR, name);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  },
};

async function writeBackup(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `kipl-backup-${label}-${stamp}.json`;
  await store.write(name, JSON.stringify(snapshot()));
  await prune();
  return name;
}

async function prune() {
  const autos = (await list()).filter((b) => b.name.includes("-auto-"));
  for (const b of autos.slice(KEEP_AUTO)) await store.remove(b.name);
}

async function list() {
  return (await store.list()).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** The backup's JSON text. */
async function readBackup(name) {
  if (!/^kipl-backup-[A-Za-z0-9._-]+\.json$/.test(name)) throw new BackupError("Invalid backup name", 400);
  const json = await store.read(name);
  if (json == null) throw new BackupError("Backup not found", 404);
  return json;
}

/** Take an automatic backup if the newest one is older than a day. */
async function autoBackup() {
  const newest = (await list()).find((b) => b.name.includes("-auto-"));
  if (newest && Date.now() - new Date(newest.at).getTime() < 24 * 3600 * 1000) return null;
  return writeBackup("auto");
}

/**
 * Replace the website content with a backup. Everything is validated before
 * anything changes, and a safety backup of the current state is written first.
 */
async function restore(input) {
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

  const safety = await writeBackup("pre-restore");
  db.data.docs = input.docs;
  db.data.media = Array.isArray(input.media) ? input.media : [];
  db.data.enquiries = Array.isArray(input.enquiries) ? input.enquiries : [];
  db.save();
  content.hooks.onPublish();
  return { safetyBackup: safety, docs: input.docs.length };
}

module.exports = { BackupError, snapshot, writeBackup, list, readBackup, autoBackup, restore };
