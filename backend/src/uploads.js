"use strict";

/**
 * Where uploaded image files are kept. Locally: data/uploads on disk. On
 * serverless hosting (db.remote) the function's disk doesn't survive between
 * requests, so they're committed to the site's GitHub repository under
 * media/uploads/ instead (see github.js) — publishing copies the ones in use
 * into site-content/, and vercel.json skips rebuilding the site for commits
 * that only touch media/. Paths are the same either way: "2026/10/name-id.jpg",
 * relative to uploads/.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const db = require("./db");
const github = require("./github");

const REPO_DIR = "media/uploads/";

const remote = () => !!db.remote;

function gh() {
  const cfg = github.settings();
  if (!cfg) {
    const err = new Error("Image uploads aren't set up yet (the GitHub settings are missing).");
    err.status = 503;
    throw err;
  }
  return github.client(cfg);
}

function localPath(rel) {
  const abs = path.resolve(config.UPLOAD_DIR, rel);
  if (!abs.startsWith(path.resolve(config.UPLOAD_DIR) + path.sep)) throw new Error("Bad upload path");
  return abs;
}

/** Store files: [{ rel, data }]. Hosted, they go into a single commit. */
async function put(files, message) {
  if (remote()) {
    const client = gh();
    const entries = [];
    for (const f of files) entries.push({ path: REPO_DIR + f.rel, mode: "100644", type: "blob", sha: await client.blob(f.data) });
    await client.commit(message, async () => entries);
    return;
  }
  for (const f of files) {
    const abs = localPath(f.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.data);
  }
}

/** A file's bytes, or null if it's gone. */
async function get(rel) {
  if (remote()) return gh().read(REPO_DIR + rel);
  try { return fs.readFileSync(localPath(rel)); } catch (_) { return null; }
}

/** Delete files (relative paths). Hosted, in a single commit. */
async function remove(rels, message) {
  if (remote()) {
    await gh().commit(message, async ({ folder }) => {
      const have = await folder("media");
      return rels.filter((r) => have.has("uploads/" + r)).map((r) => ({ path: REPO_DIR + r, mode: "100644", type: "blob", sha: null }));
    });
    return;
  }
  for (const rel of rels) {
    try { fs.unlinkSync(localPath(rel)); } catch (_) { /* already gone */ }
  }
}

module.exports = { remote, put, get, remove };
