"use strict";

/**
 * Commits to the site's GitHub repository through the git data API — no git
 * binary or checkout needed, so it works from a Vercel Function. Used by the
 * hosted admin to store uploaded images (media/uploads/…) and to publish
 * site-content/ (see sitepublish.js).
 *
 * Settings: KIPL_GITHUB_TOKEN (fine-grained token with "Contents: read and
 * write" on the repository) and KIPL_GITHUB_REPO ("owner/name"). Optional:
 * KIPL_GITHUB_BRANCH (default main), KIPL_GITHUB_AUTHOR_NAME / _EMAIL
 * (default: the token's owner).
 */

const crypto = require("crypto");

function settings(env = process.env) {
  if (!env.KIPL_GITHUB_TOKEN || !env.KIPL_GITHUB_REPO) return null;
  return {
    token: env.KIPL_GITHUB_TOKEN,
    repo: env.KIPL_GITHUB_REPO,
    branch: env.KIPL_GITHUB_BRANCH || "main",
    author: env.KIPL_GITHUB_AUTHOR_EMAIL ? { name: env.KIPL_GITHUB_AUTHOR_NAME || "KIPL admin", email: env.KIPL_GITHUB_AUTHOR_EMAIL } : null,
  };
}

/** The SHA git gives a file's contents, to tell whether it changed without downloading it. */
function gitBlobSha(buf) {
  return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

function client(cfg, fetchImpl = (...a) => fetch(...a)) {
  async function call(method, url, body, accept = "application/vnd.github+json") {
    const res = await fetchImpl(`https://api.github.com/repos/${cfg.repo}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "kipl-admin",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async function json(method, url, body) {
    const res = await call(method, url, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${url}: ${res.status} ${data.message || ""}`.trim());
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** A folder's files on the branch tip: Map of path (relative to the folder) -> blob sha. */
  async function folder(baseTree, dir) {
    const files = new Map();
    const root = await json("GET", `/git/trees/${baseTree}`);
    const entry = root.tree.find((e) => e.path === dir && e.type === "tree");
    if (!entry) return files;
    const sub = await json("GET", `/git/trees/${entry.sha}?recursive=1`);
    for (const e of sub.tree) if (e.type === "blob") files.set(e.path, e.sha);
    return files;
  }

  /**
   * Make one commit on the branch. `build({ baseTree, folder })` returns the
   * tree entries to change ([] = nothing to commit). Retries once on top of
   * the new tip if someone pushed in between.
   */
  async function commit(message, build) {
    for (let attempt = 0; ; attempt++) {
      const head = (await json("GET", `/git/ref/heads/${encodeURIComponent(cfg.branch)}`)).object.sha;
      const baseTree = (await json("GET", `/git/commits/${head}`)).tree.sha;
      const entries = await build({ baseTree, folder: (dir) => folder(baseTree, dir) });
      if (!entries.length) return null;
      const tree = await json("POST", "/git/trees", { base_tree: baseTree, tree: entries });
      const made = await json("POST", "/git/commits", {
        message, tree: tree.sha, parents: [head],
        ...(cfg.author ? { author: cfg.author, committer: cfg.author } : {}),
      });
      try {
        await json("PATCH", `/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { sha: made.sha });
        return made.sha;
      } catch (err) {
        if (err.status !== 422 || attempt >= 1) throw err; // 422: not a fast-forward
      }
    }
  }

  /** Upload bytes as a git blob; returns its sha. */
  async function blob(bytes) {
    return (await json("POST", "/git/blobs", { content: bytes.toString("base64"), encoding: "base64" })).sha;
  }

  /** A file's bytes on the branch, or null if it doesn't exist. */
  async function read(filePath) {
    const res = await call("GET", `/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(cfg.branch)}`, null, "application/vnd.github.raw");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read ${filePath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  return { json, folder, commit, blob, read };
}

module.exports = { settings, gitBlobSha, client };
