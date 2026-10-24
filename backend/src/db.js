"use strict";

/**
 * Minimal JSON-file store. The whole database is one document held in memory
 * and flushed (atomically: temp file + rename) after every mutation. That is
 * plenty for a CMS with hundreds of records and a single server process, and
 * it makes backup/restore trivial (one file). If this ever outgrows a single
 * process, swap this module for a real database — everything else talks to
 * it through `db.data` and `db.save()`.
 *
 * Serverless mode (`db.remote`, when Upstash Redis credentials are set): the
 * same document lives in one Redis key instead of a file. Each request calls
 * `refresh()` first (cheap when nothing changed — only a revision id is read)
 * and `flush()` before responding; `save()` just marks the data dirty. Writes
 * are compare-and-set on the revision, so two instances can never silently
 * overwrite each other's changes.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const kv = require("./kv");

const KEY = "kipl:db";
const REV_KEY = "kipl:db:rev";
// Write the document only if the revision is still the one we read.
const CAS_SCRIPT =
  "local cur = redis.call('GET', KEYS[2]) or '' " +
  "if cur ~= ARGV[1] then return 0 end " +
  "redis.call('SET', KEYS[1], ARGV[2]) redis.call('SET', KEYS[2], ARGV[3]) return 1";

class ConflictError extends Error {
  constructor() {
    super("Someone else saved a change at the same moment. Please try again.");
    this.status = 409;
  }
}

function emptyData() {
  return {
    version: 1,
    users: [],
    sessions: [],
    docs: [],
    media: [],
    audit: [],
    enquiries: [],
    meta: {},
  };
}

const db = {
  data: null,
  file: config.DB_FILE,
  remote: kv.fromEnv(),
  rev: null, // remote: revision of db.data ("" = nothing stored yet, null = not loaded)
  dirty: false,

  /** Remote mode: make db.data current. Skips the download when nothing changed. */
  async refresh() {
    const rev = (await this.remote.command("GET", REV_KEY)) || "";
    if (this.data && !this.dirty && rev === this.rev) return this;
    const json = rev ? await this.remote.command("GET", KEY) : null;
    this.data = Object.assign(emptyData(), json ? JSON.parse(json) : {});
    this.rev = rev;
    this.dirty = false;
    return this;
  },

  /** Remote mode: write pending changes. Throws ConflictError if another instance wrote first. */
  async flush() {
    if (!this.dirty) return;
    const next = crypto.randomBytes(9).toString("hex");
    const ok = await this.remote.command("EVAL", CAS_SCRIPT, 2, KEY, REV_KEY, this.rev || "", JSON.stringify(this.data), next);
    if (Number(ok) !== 1) {
      this.data = null; // force a fresh read next time
      this.rev = null;
      this.dirty = false;
      throw new ConflictError();
    }
    this.rev = next;
    this.dirty = false;
  },

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      this.data = Object.assign(emptyData(), JSON.parse(fs.readFileSync(this.file, "utf8")));
    } else {
      this.data = emptyData();
      this.save();
    }
    return this;
  },

  save() {
    if (this.remote) { this.dirty = true; return; }
    const tmp = this.file + "." + process.pid + ".tmp";
    const json = JSON.stringify(this.data);
    fs.writeFileSync(tmp, json);
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (err) {
        // Windows can briefly lock the target (AV/indexer); retry, then fall back.
        if (attempt >= 4) {
          fs.writeFileSync(this.file, json);
          try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
          return;
        }
      }
    }
  },

  /** Replace the whole dataset (used by restore + tests). */
  replace(data) {
    this.data = Object.assign(emptyData(), data);
    this.save();
  },

  id(bytes = 6) {
    return crypto.randomBytes(bytes).toString("hex");
  },
};

module.exports = db;
module.exports.emptyData = emptyData;
module.exports.ConflictError = ConflictError;
