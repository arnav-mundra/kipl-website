"use strict";

/**
 * Minimal JSON-file store. The whole database is one document held in memory
 * and flushed (atomically: temp file + rename) after every mutation. That is
 * plenty for a CMS with hundreds of records and a single server process, and
 * it makes backup/restore trivial (one file). If this ever outgrows a single
 * process, swap this module for a real database — everything else talks to
 * it through `db.data` and `db.save()`.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

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
