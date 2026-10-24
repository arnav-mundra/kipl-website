"use strict";

/**
 * Serverless mode (as hosted on Vercel): the database lives in Redis. A tiny
 * fake of Upstash's REST API stands in for it, so this checks the real
 * request flow — first-run setup, load/save per request, compare-and-set
 * conflicts, login throttling and backups kept in Redis.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { fakeGitHub } = require("./fake-github");

// Fake Upstash: { GET, SET, DEL, EVAL (only db.js's compare-and-set script) }.
const store = new Map();
function run([cmd, ...a]) {
  switch (cmd) {
    case "GET": return store.has(a[0]) ? store.get(a[0]) : null;
    case "SET": store.set(a[0], a[1]); return "OK";
    case "DEL": return store.delete(a[0]) ? 1 : 0;
    case "EVAL": {
      const [, , key, revKey, expected, json, next] = a;
      if ((store.get(revKey) || "") !== expected) return 0;
      store.set(key, json); store.set(revKey, next); return 1;
    }
    default: throw new Error("unsupported " + cmd);
  }
}
const redis = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer test-token") { res.statusCode = 401; return res.end('{"error":"unauthorized"}'); }
    try { res.end(JSON.stringify({ result: run(JSON.parse(body)) })); }
    catch (err) { res.statusCode = 400; res.end(JSON.stringify({ error: err.message })); }
  });
});

const gh = fakeGitHub({ "frontend/index.html": "page" });
let base, app, db;
const PW = "serverless-owner-pw-1";

before(async () => {
  await new Promise((r) => redis.listen(0, r));
  process.env.KV_REST_API_URL = `http://127.0.0.1:${redis.address().port}`;
  process.env.KV_REST_API_TOKEN = "test-token";
  process.env.KIPL_OWNER_PASSWORD = PW;
  process.env.KIPL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kipl-sls-")); // must stay unused
  // Image uploads are committed to GitHub: route its API to the in-memory fake.
  process.env.KIPL_GITHUB_TOKEN = "gh-token";
  process.env.KIPL_GITHUB_REPO = "owner/repo";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => (String(url).startsWith("https://api.github.com/") ? gh.fetchImpl(String(url), opts) : realFetch(url, opts));
  db = require("../src/db");
  app = require("../src/app").createApp().listen(0);
  await new Promise((r) => app.once("listening", r));
  base = `http://127.0.0.1:${app.address().port}`;
});
after(() => { app.close(); redis.close(); });

function client() {
  let cookie = "";
  return async function call(method, url, body) {
    const headers = { "X-Requested-With": "kipl-admin" };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : await res.text();
    return { status: res.status, data };
  };
}
const stored = () => JSON.parse(store.get("kipl:db"));

test("first request installs the live content and the owner account, stored in Redis", async () => {
  const owner = client();
  assert.equal((await owner("POST", "/api/admin/login", { username: "owner", password: PW })).status, 200);
  const data = stored();
  assert.ok(data.docs.length > 40, "content was seeded");
  assert.deepEqual(data.users.map((u) => u.username), ["owner"], "only accounts with a password in the environment");
  assert.equal(data.sessions.length, 1, "the session was saved before the response");
  assert.deepEqual(fs.readdirSync(process.env.KIPL_DATA_DIR), [], "nothing written to local disk");
});

test("a change made by another instance is picked up on the next request", async () => {
  const owner = client();
  await owner("POST", "/api/admin/login", { username: "owner", password: PW });
  const data = stored();
  data.docs.find((d) => d.type === "site").data.hero.headline = "Changed elsewhere.";
  store.set("kipl:db", JSON.stringify(data));
  store.set("kipl:db:rev", "other-instance");
  const site = await owner("GET", "/api/admin/content/site/site");
  assert.equal(site.data.item.data.hero.headline, "Changed elsewhere.");
});

test("a write that loses a race is refused, never silently overwriting", async () => {
  await db.refresh();
  store.set("kipl:db:rev", "someone-else");
  db.data.meta.touched = true;
  db.save();
  await assert.rejects(db.flush(), (err) => err.status === 409);
  assert.equal(stored().meta.touched, undefined);
  await db.refresh();
  assert.equal(db.rev, "someone-else");
});

test("failed sign-ins are counted in the database, so lockout works across instances", async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c("POST", "/api/admin/login", { username: "nobody", password: "wrong" })).status, 401);
  assert.ok(Object.values(stored().throttle).some((r) => r.count === 5));
  assert.equal((await c("POST", "/api/admin/login", { username: "nobody", password: "wrong" })).status, 429);
});

test("server backups are kept in Redis and can be downloaded", async () => {
  const owner = client();
  await owner("POST", "/api/admin/login", { username: "owner", password: PW });
  const made = await owner("POST", "/api/admin/backups");
  assert.equal(made.status, 201);
  assert.ok(store.has("kipl:backup:" + made.data.name));
  const list = await owner("GET", "/api/admin/backups");
  assert.ok(list.data.backups.some((b) => b.name === made.data.name));
  const dl = await owner("GET", "/api/admin/backups/" + encodeURIComponent(made.data.name));
  assert.equal(dl.status, 200);
  assert.equal(dl.data.format, "kipl-backup");
});

test("uploaded images are committed to the repo's media/ folder, served to the admin, and deleted", async () => {
  const login = await fetch(base + "/api/admin/login", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "kipl-admin" },
    body: JSON.stringify({ username: "owner", password: PW }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c33" } }).png().toBuffer();
  const fd = new FormData();
  fd.append("purpose", "photo");
  fd.append("files", new Blob([png], { type: "image/png" }), "Site Photo.png");
  const before = gh.commitCount();
  const up = await fetch(base + "/api/admin/media", { method: "POST", headers: { Cookie: cookie, "X-Requested-With": "kipl-admin" }, body: fd });
  assert.equal(up.status, 201);
  const item = (await up.json()).items[0];

  assert.equal(gh.commitCount(), before + 1, "image and thumbnail go into one commit");
  assert.ok(gh.file("media/" + item.path), "image stored in media/uploads/");
  assert.ok(gh.file("media/" + item.thumb), "thumbnail stored too");
  assert.ok(stored().media.some((m) => m.id === item.id), "record saved in Redis");

  const served = await fetch(base + "/" + item.thumb);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), gh.file("media/" + item.thumb));
  assert.equal((await fetch(base + "/uploads/2020/01/not-there.jpg")).status, 404);

  const del = await fetch(base + "/api/admin/media/" + item.id, { method: "DELETE", headers: { Cookie: cookie, "X-Requested-With": "kipl-admin" } });
  assert.equal(del.status, 200);
  assert.equal(gh.file("media/" + item.path), null);
  assert.equal(gh.file("media/" + item.thumb), null);
});

test("the cron endpoint needs the secret", async () => {
  process.env.CRON_SECRET = "cron-secret";
  assert.equal((await fetch(base + "/api/cron")).status, 401);
  const ok = await fetch(base + "/api/cron", { headers: { Authorization: "Bearer cron-secret" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});
