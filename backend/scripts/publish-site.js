"use strict";

/**
 * Push your published admin content to the live website (Vercel).
 *
 *   npm run publish:site              # save, commit and push
 *   npm run publish:site -- --no-push # save and commit only
 *   npm run publish:site -- --no-git  # only write site-content/ (no commit)
 *
 * Workflow: edit + *Publish* in the admin on your PC, then run this. It writes
 * the published content (and the uploaded images it uses) into site-content/,
 * commits that folder and pushes it; Vercel then rebuilds the public site from
 * it (see vercel.json). Drafts are never included.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const config = require("../src/config");
const db = require("../src/db");
const content = require("../src/content");

const noPush = process.argv.includes("--no-push");
const noGit = process.argv.includes("--no-git");
const repoRoot = config.ROOT_DIR;
const outDir = path.join(repoRoot, "site-content");

if (!fs.existsSync(config.DB_FILE)) {
  console.error("No CMS data found at " + config.DB_FILE + ". Start the admin once (npm start) first.");
  process.exit(1);
}
db.load();
if (!db.data.docs.length) {
  console.error("The CMS has no content yet.");
  process.exit(1);
}

const snapshot = content.snapshot("published");
const json = JSON.stringify(snapshot, null, 2) + "\n";

// Only the uploaded images that published content actually references.
const used = new Set(json.match(/uploads\/[A-Za-z0-9_\-. /]+\.(?:jpe?g|png|webp)/gi) || []);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "content.json"), json);

const uploadsOut = path.join(outDir, "uploads");
fs.rmSync(uploadsOut, { recursive: true, force: true });
let copied = 0;
for (const rel of used) {
  const src = path.join(config.UPLOAD_DIR, rel.replace(/^uploads\//, ""));
  if (!fs.existsSync(src)) { console.warn("Missing upload (skipped): " + rel); continue; }
  const dest = path.join(uploadsOut, rel.replace(/^uploads\//, ""));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
}
console.log(`Saved published content + ${copied} uploaded image(s) to site-content/`);

if (noGit) { console.log("Skipped git (--no-git)."); process.exit(0); }

const git = (...a) => execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim();

try {
  git("add", "-A", "--", "site-content");
  if (!git("status", "--porcelain", "--", "site-content")) {
    console.log("Nothing has changed since the last publish — the live site is already up to date.");
    process.exit(0);
  }
  const email = (() => { try { return git("config", "user.email"); } catch (_) { return ""; } })();
  if (!email || /example\.com$/i.test(email)) {
    console.warn(`Note: git user.email is "${email || "unset"}". Set your GitHub email so Vercel accepts the commit:\n  git config user.email "you@example.com"`);
  }
  git("commit", "-m", "Publish content update from the admin panel");
  console.log("Committed.");
  if (noPush) { console.log("Skipped push (--no-push). Run `git push` when ready."); process.exit(0); }
  git("push");
  console.log("Pushed. Vercel will rebuild the site in a minute or two.");
} catch (err) {
  console.error("Git step failed:", (err.stderr || err.message || "").toString().trim());
  process.exit(1);
}
