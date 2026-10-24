"use strict";

/**
 * In-memory fake of the bits of GitHub's API the hosted admin uses (git data
 * API + raw file reads), for repo "owner/repo", branch main. A commit points
 * at a flat { path: blobSha } map.
 */

const { gitBlobSha } = require("../src/github");

function fakeGitHub(initialFiles = {}) {
  const blobs = new Map(); // sha -> Buffer
  const trees = new Map();
  const commits = new Map();
  const calls = [];
  let n = 0;

  const putTree = (files) => { const sha = "tree" + n++; trees.set(sha, files); return sha; };
  const putCommit = (tree, parents, message) => { const sha = "commit" + n++; commits.set(sha, { tree, parents, message }); return sha; };
  const files0 = {};
  for (const [p, text] of Object.entries(initialFiles)) {
    const buf = Buffer.from(text);
    blobs.set(gitBlobSha(buf), buf);
    files0[p] = gitBlobSha(buf);
  }
  let head = putCommit(putTree(files0), [], "initial");

  async function fetchImpl(url, opts = {}) {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname.replace(/^\/repos\/owner\/repo/, ""));
    const method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push(`${method} ${p}`);
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    let m;
    if (method === "GET" && p === "/git/ref/heads/main") return ok({ object: { sha: head } });
    if (method === "GET" && (m = p.match(/^\/git\/commits\/(.+)$/))) return ok({ tree: { sha: commits.get(m[1]).tree } });
    if (method === "GET" && (m = p.match(/^\/git\/trees\/(.+)$/))) {
      const [sha, dir] = m[1].split(":");
      const files = trees.get(sha);
      if (!dir) {
        const top = new Set(Object.keys(files).map((f) => f.split("/")[0]));
        return ok({ tree: [...top].map((t) => ({ path: t, type: Object.keys(files).some((f) => f.startsWith(t + "/")) ? "tree" : "blob", sha: `${sha}:${t}` })) });
      }
      return ok({ tree: Object.entries(files).filter(([f]) => f.startsWith(dir + "/")).map(([f, s]) => ({ path: f.slice(dir.length + 1), type: "blob", sha: s })) });
    }
    if (method === "GET" && (m = p.match(/^\/contents\/(.+)$/))) {
      const sha = trees.get(commits.get(head).tree)[m[1]];
      if (!sha) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      const buf = blobs.get(sha);
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
    }
    if (method === "POST" && p === "/git/blobs") {
      const buf = Buffer.from(body.content, "base64");
      blobs.set(gitBlobSha(buf), buf);
      return ok({ sha: gitBlobSha(buf) });
    }
    if (method === "POST" && p === "/git/trees") {
      const files = Object.assign({}, trees.get(body.base_tree));
      for (const e of body.tree) {
        if (e.sha === null) { delete files[e.path]; continue; }
        if (e.content !== undefined) { const buf = Buffer.from(e.content, "utf8"); blobs.set(gitBlobSha(buf), buf); files[e.path] = gitBlobSha(buf); }
        else files[e.path] = e.sha;
      }
      return ok({ sha: putTree(files) });
    }
    if (method === "POST" && p === "/git/commits") return ok({ sha: putCommit(body.tree, body.parents, body.message) });
    if (method === "PATCH" && p === "/git/refs/heads/main") { head = body.sha; return ok({}); }
    return { ok: false, status: 404, json: async () => ({ message: "not faked: " + p }) };
  }

  return {
    fetchImpl,
    calls,
    files: () => trees.get(commits.get(head).tree),
    file: (p) => { const sha = trees.get(commits.get(head).tree)[p]; return sha ? blobs.get(sha) : null; },
    commitCount: () => commits.size,
    lastMessage: () => commits.get(head).message,
  };
}

module.exports = { fakeGitHub };
