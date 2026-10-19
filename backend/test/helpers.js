"use strict";

/**
 * Test harness: boots the real app against a throwaway data directory
 * (fresh seeded content + the three accounts) and gives each test a tiny
 * HTTP client that keeps a session cookie.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kipl-test-"));
process.env.KIPL_DATA_DIR = dataDir;
delete process.env.KIPL_DEV_FRAMING;

const config = require("../src/config");
const db = require("../src/db");
const content = require("../src/content");
const auth = require("../src/auth");
const { createApp } = require("../src/app");

// Throwaway fixtures for the test database only (never the real accounts' passwords).
const PASSWORDS = { owner: "test-owner-pw-1", editor: "test-editor-pw-1", hr: "test-hr-pw-1" };

async function boot() {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  db.load();
  content.seedIfEmpty();
  for (const [role, password] of Object.entries(PASSWORDS)) {
    auth.createUser({ username: role, name: role, role, password, initialPassword: true });
  }
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

function client(base) {
  let cookie = "";
  async function request(method, url, body, extra = {}) {
    const headers = Object.assign({ "X-Requested-With": "kipl-admin" }, extra.headers || {});
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].replace(/=$/, "=");
    if (set && /Max-Age=0/i.test(set)) cookie = "";
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (u, extra) => request("GET", u, undefined, extra),
    post: (u, b, extra) => request("POST", u, b === undefined ? {} : b, extra),
    put: (u, b) => request("PUT", u, b),
    patch: (u, b) => request("PATCH", u, b),
    del: (u) => request("DELETE", u),
    raw: request,
    async login(username) {
      const r = await request("POST", "/api/admin/login", { username, password: PASSWORDS[username] });
      if (r.status !== 200) throw new Error("login failed for " + username + ": " + JSON.stringify(r.data));
      return r;
    },
    get cookie() { return cookie; },
  };
}

const A = "/api/admin";

/** Valid payload for a new project (override pieces per test). */
function projectPayload(over = {}) {
  return Object.assign({
    client: "Test Client", title: "Test Project", description: "A test", domain: "operation-maintenance",
    location: "Jharsuguda, Odisha", status: "active", valueCr: 9.99, yearStart: 2025, yearEnd: 2027,
    visible: true, priority: 0, featured: false, featuredOrder: 0,
  }, over);
}

module.exports = { boot, client, A, db, content, auth, config, projectPayload, PASSWORDS, dataDir };
