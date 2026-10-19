"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { boot, client, A, PASSWORDS } = require("./helpers");

let ctx;
before(async () => { ctx = await boot(); });
after(() => ctx.server.close());

test("state-changing requests need the CSRF header and a same-origin Origin", async () => {
  const anon = client(ctx.base);
  const noHeader = await fetch(ctx.base + A + "/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "owner", password: PASSWORDS.owner }) });
  assert.equal(noHeader.status, 403);

  const crossSite = await fetch(ctx.base + A + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "kipl-admin", Origin: "https://evil.example" },
    body: JSON.stringify({ username: "owner", password: PASSWORDS.owner }),
  });
  assert.equal(crossSite.status, 403);
  assert.equal((await anon.get(A + "/me")).status, 200, "GETs don't need the header");
});

test("login: wrong password is rejected with a generic message; success sets a hardened cookie", async () => {
  const c = client(ctx.base);
  const bad = await c.post(A + "/login", { username: "owner", password: "nope" });
  assert.equal(bad.status, 401);
  const unknown = await c.post(A + "/login", { username: "ghost", password: "nope" });
  assert.equal(unknown.status, 401);
  assert.equal(bad.data.error, unknown.data.error, "no hint about whether the user exists");

  const ok = await c.post(A + "/login", { username: "OWNER", password: PASSWORDS.owner });
  assert.equal(ok.status, 200, "usernames are case-insensitive");
  const cookie = ok.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(ok.data.user.role, "owner");
  assert.equal(ok.data.user.passwordHash, undefined, "password hash never leaves the server");
  assert.equal((await c.get(A + "/me")).data.user.username, "owner");
});

test("nothing is reachable without signing in", async () => {
  const anon = client(ctx.base);
  for (const url of ["/dashboard", "/schemas", "/content/projects", "/media", "/users", "/audit", "/backup", "/enquiries", "/pending"]) {
    assert.equal((await anon.get(A + url)).status, 401, url);
  }
  assert.equal((await anon.post(A + "/publish-all")).status, 401);
});

test("role permissions: HR sees only team + media; editor edits content but not accounts", async () => {
  const hr = client(ctx.base); await hr.login("hr");
  const schemas = (await hr.get(A + "/schemas")).data.resources;
  assert.deepEqual(Object.keys(schemas), ["team"]);
  assert.equal((await hr.get(A + "/content/projects")).status, 403);
  assert.equal((await hr.post(A + "/content/projects", { title: "x" })).status, 403);
  assert.equal((await hr.get(A + "/content/site/site")).status, 403);
  assert.equal((await hr.get(A + "/content/team")).status, 200);
  assert.equal((await hr.get(A + "/media")).status, 200);
  for (const url of ["/users", "/audit", "/backup", "/backups", "/enquiries", "/export/projects.csv"]) {
    assert.equal((await hr.get(A + url)).status, 403, "hr: " + url);
  }
  const made = await hr.post(A + "/content/team", { name: "HR Person", title: "Analyst", tier: "hod", visible: true });
  assert.equal(made.status, 201);
  assert.equal((await hr.post(`${A}/content/team/${made.data.item.id}/publish`)).status, 200);
  const dash = (await hr.get(A + "/dashboard")).data;
  assert.deepEqual(Object.keys(dash.counts).sort(), ["media", "team"]);

  const editor = client(ctx.base); await editor.login("editor");
  assert.equal((await editor.get(A + "/content/projects")).status, 200);
  assert.equal((await editor.get(A + "/enquiries")).status, 200);
  for (const url of ["/users", "/audit", "/backup", "/backups"]) {
    assert.equal((await editor.get(A + url)).status, 403, "editor: " + url);
  }
  assert.equal((await editor.post(A + "/users", { username: "x", role: "owner", password: "longenough1" })).status, 403);
});

test("an HR user's publish-all only touches what they're allowed to edit", async () => {
  const owner = client(ctx.base); await owner.login("owner");
  const hr = client(ctx.base); await hr.login("hr");
  const proj = await owner.post(A + "/content/projects", { client: "X", title: "Owner Draft", domain: "operation-maintenance", location: "Y", status: "active", yearStart: 2025, valueCr: 1 });
  await hr.post(A + "/content/team", { name: "Another HR Draft", title: "Role", tier: "hod", visible: true });
  const res = (await hr.post(A + "/publish-all")).data;
  assert.deepEqual(res.published.map((p) => p.type), ["team"]);
  const still = (await owner.get(`${A}/content/projects/${proj.data.item.id}`)).data.item;
  assert.equal(still.status, "new", "the owner's project stays a draft");
});

test("changing your own password: verifies the old one, enforces length, ends other sessions", async () => {
  const a = client(ctx.base); await a.login("editor");
  const b = client(ctx.base); await b.login("editor");
  assert.equal((await a.post(A + "/me/password", { current: "wrong", next: "brand-new-pass" })).status, 403);
  assert.equal((await a.post(A + "/me/password", { current: PASSWORDS.editor, next: "short" })).status, 422);
  assert.equal((await a.post(A + "/me/password", { current: PASSWORDS.editor, next: "editor" })).status, 422, "can't equal the username");

  const ok = await a.post(A + "/me/password", { current: PASSWORDS.editor, next: "brand-new-pass" });
  assert.equal(ok.status, 200);
  assert.equal((await a.get(A + "/me")).data.user.usingInitialPassword, false);
  assert.equal((await b.get(A + "/dashboard")).status, 401, "other devices are signed out");
  assert.equal((await a.get(A + "/dashboard")).status, 200, "this one stays in");

  const again = client(ctx.base);
  assert.equal((await again.post(A + "/login", { username: "editor", password: PASSWORDS.editor })).status, 401);
  assert.equal((await again.post(A + "/login", { username: "editor", password: "brand-new-pass" })).status, 200);
});

test("logout really ends the session", async () => {
  const c = client(ctx.base); await c.login("hr");
  const cookie = c.cookie;
  assert.equal((await c.post(A + "/logout")).status, 200);
  const replay = client(ctx.base);
  const res = await fetch(ctx.base + A + "/dashboard", { headers: { Cookie: cookie } });
  assert.equal(res.status, 401, "the old cookie is dead server-side, not just cleared in the browser");
  assert.ok(replay);
});

test("account management: guards against locking everyone out", async () => {
  const owner = client(ctx.base); await owner.login("owner");
  const users = (await owner.get(A + "/users")).data.users;
  const me = users.find((u) => u.username === "owner");

  assert.equal((await owner.post(A + "/users", { username: "newbie", name: "N", role: "editor", password: "short" })).status, 422);
  assert.equal((await owner.post(A + "/users", { username: "owner", name: "N", role: "editor", password: "longenough1" })).status, 409);
  assert.equal((await owner.post(A + "/users", { username: "x y", name: "N", role: "editor", password: "longenough1" })).status, 422);
  assert.equal((await owner.post(A + "/users", { username: "newbie", name: "N", role: "wizard", password: "longenough1" })).status, 422);
  const made = await owner.post(A + "/users", { username: "newbie", name: "Newbie", role: "hr", password: "longenough1" });
  assert.equal(made.status, 201);
  assert.equal(made.data.user.usingInitialPassword, false);

  assert.equal((await owner.del(`${A}/users/${me.id}`)).status, 409, "can't delete yourself");
  assert.equal((await owner.put(`${A}/users/${me.id}`, { role: "editor" })).status, 409, "can't demote the only owner");
  assert.equal((await owner.put(`${A}/users/${me.id}`, { disabled: true })).status, 409);

  // Disabling a user kills their sessions immediately.
  const nb = client(ctx.base);
  assert.equal((await nb.post(A + "/login", { username: "newbie", password: "longenough1" })).status, 200);
  await owner.put(`${A}/users/${made.data.user.id}`, { disabled: true });
  assert.equal((await nb.get(A + "/dashboard")).status, 401);
  assert.equal((await client(ctx.base).post(A + "/login", { username: "newbie", password: "longenough1" })).status, 401);

  // Reset password re-enables sign-in with the new one.
  await owner.put(`${A}/users/${made.data.user.id}`, { disabled: false });
  assert.equal((await owner.post(`${A}/users/${made.data.user.id}/password`, { password: "another-pass-9" })).status, 200);
  assert.equal((await client(ctx.base).post(A + "/login", { username: "newbie", password: "another-pass-9" })).status, 200);

  assert.equal((await owner.del(`${A}/users/${made.data.user.id}`)).status, 200);
});

test("the audit log records who did what, and only the owner can read it", async () => {
  const owner = client(ctx.base); await owner.login("owner");
  const hr = client(ctx.base); await hr.login("hr");
  const t = await hr.post(A + "/content/team", { name: "Audited Person", title: "T", tier: "hod", visible: true });
  await hr.post(`${A}/content/team/${t.data.item.id}/publish`);

  const log = (await owner.get(A + "/audit?limit=200")).data.rows;
  const created = log.find((r) => r.action === "create" && /Audited Person/.test(r.summary));
  assert.ok(created, "create entry exists");
  assert.equal(created.user, "hr");
  assert.equal(created.role, "hr");
  assert.ok(log.some((r) => r.action === "publish" && r.user === "hr"));
  assert.ok(log.some((r) => r.action === "login-failed"), "failed sign-ins are recorded");
  assert.equal((await hr.get(A + "/audit")).status, 403);

  const filtered = (await owner.get(A + "/audit?user=hr&action=create")).data.rows;
  assert.ok(filtered.length && filtered.every((r) => r.user === "hr" && r.action === "create"));
});
