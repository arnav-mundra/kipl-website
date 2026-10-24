"use strict";

/**
 * Keep the live website in step with published content when the admin is
 * hosted (Vercel). The public site is static: Vercel builds it from the
 * committed site-content/ folder (see vercel.json). So after every publish
 * this commits the new site-content/ to GitHub — content.json plus the
 * uploaded images published content uses — and Vercel redeploys. Only changed
 * files go into the commit; nothing happens when the live copy is current.
 *
 * Enabled by the GitHub settings in github.js. Without them — a local
 * install — publishing works as before and `npm run publish:site` does this
 * step from the command line.
 */

const db = require("./db");
const content = require("./content");
const github = require("./github");

const DIR = "site-content";

/** What the live site is built from: the published content and the uploads it references. */
function buildSiteContent() {
  const json = JSON.stringify(content.snapshot("published"), null, 2) + "\n";
  const uploads = new Set(json.match(/uploads\/[A-Za-z0-9_\-. /]+\.(?:jpe?g|png|webp)/gi) || []);
  return { json, uploads };
}

const enabled = () => !!github.settings();

/**
 * Commit site-content/ if it differs from what's on the branch.
 * Hosted uploads already live in the repo (media/uploads/…), so their git
 * blobs are reused; `readUpload(path)` is only asked for anything else.
 * Resolves to { changed, commit?, missing[] }.
 */
async function commitSiteContent({ cfg, readUpload, message, fetchImpl }) {
  const gh = github.client(cfg, fetchImpl);
  const { json, uploads } = buildSiteContent();
  let missing = [];

  const commit = await gh.commit(message, async ({ folder }) => {
    const existing = await folder(DIR);
    let media = null;
    missing = [];
    const entries = [];
    if (existing.get("content.json") !== github.gitBlobSha(Buffer.from(json, "utf8"))) {
      entries.push({ path: `${DIR}/content.json`, mode: "100644", type: "blob", content: json });
    }
    for (const p of uploads) {
      if (existing.has(p)) continue; // upload names are unique, so an existing file is the same image
      media = media || (await folder("media"));
      let sha = media.get(p);
      if (!sha) {
        const bytes = await readUpload(p);
        if (!bytes) { missing.push(p); continue; }
        sha = await gh.blob(bytes);
      }
      entries.push({ path: `${DIR}/${p}`, mode: "100644", type: "blob", sha });
    }
    for (const p of existing.keys()) {
      if (p.startsWith("uploads/") && !uploads.has(p)) entries.push({ path: `${DIR}/${p}`, mode: "100644", type: "blob", sha: null });
    }
    return entries;
  });
  return { changed: !!commit, commit, missing };
}

/**
 * Called after anything is published (when enabled). Never throws: the CMS
 * publish already succeeded, so the outcome is reported back to the admin
 * and remembered in db.data.meta.sitePublish.
 */
async function sync(user, deps = {}) {
  const cfg = deps.cfg || github.settings();
  if (!cfg) return null;
  const media = require("./media");
  let result;
  try {
    const out = await commitSiteContent({
      cfg,
      readUpload: deps.readUpload || media.read,
      message: `Publish content update from the admin panel${user ? ` (${user.username})` : ""}`,
      fetchImpl: deps.fetchImpl,
    });
    result = { ok: true, changed: out.changed, commit: out.commit || null, missing: out.missing };
  } catch (err) {
    console.error("[site publish]", err);
    result = { ok: false, error: err.message };
  }
  db.data.meta.sitePublish = Object.assign({ at: new Date().toISOString() }, result);
  db.save();
  return result;
}

module.exports = { buildSiteContent, enabled, commitSiteContent, sync };
