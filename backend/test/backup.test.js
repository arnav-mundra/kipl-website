"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { boot, client, A, config, projectPayload } = require("./helpers");

let ctx, owner, editor;
before(async () => {
  ctx = await boot();
  owner = client(ctx.base); await owner.login("owner");
  editor = client(ctx.base); await editor.login("editor");
});
after(() => ctx.server.close());

const page = async (file) => (await fetch(ctx.base + "/" + file)).text();

test("a backup downloads as JSON without accounts or password hashes", async () => {
  const res = await owner.get(A + "/backup");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /kipl-backup-\d{4}-\d{2}-\d{2}\.json/);
  const data = res.data; // the client already parsed the JSON body
  assert.equal(data.format, "kipl-backup");
  assert.ok(data.docs.length > 40);
  assert.ok(!JSON.stringify(data).includes("passwordHash"));
  assert.equal(data.users, undefined);
  assert.equal((await editor.get(A + "/backup")).status, 403);
});

test("restore brings content back, and makes a safety copy first", async () => {
  const snap = (await owner.get(A + "/backup")).data;

  const p = await owner.post(A + "/content/projects", projectPayload({ client: "Temp", title: "Added After Backup", priority: 90 }));
  await owner.post(`${A}/content/projects/${p.data.item.id}/publish`);
  assert.match(await page("projects"), /Added After Backup/);

  const restored = await owner.post(A + "/backup/restore", { backup: snap });
  assert.equal(restored.status, 200);
  assert.match(restored.data.safetyBackup, /pre-restore/);
  assert.ok(fs.existsSync(path.join(config.BACKUP_DIR, restored.data.safetyBackup)));

  assert.doesNotMatch(await page("projects"), /Added After Backup/, "live site reflects the restore immediately");
  assert.equal((await owner.get(`${A}/content/projects/${p.data.item.id}`)).status, 404);

  // …and the safety copy lets you undo the restore.
  const safety = JSON.parse(fs.readFileSync(path.join(config.BACKUP_DIR, restored.data.safetyBackup), "utf8"));
  assert.equal((await owner.post(A + "/backup/restore", { backup: safety })).status, 200);
  assert.match(await page("projects"), /Added After Backup/);
});

test("invalid or tampered backups are refused and change nothing", async () => {
  const before = (await owner.get(A + "/content/projects")).data.items.length;
  for (const bad of [null, {}, { format: "other", docs: [] }, { format: "kipl-backup", docs: [{ id: "x", type: "nonsense", data: {} }] }]) {
    const r = await owner.post(A + "/backup/restore", { backup: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const snap = (await owner.get(A + "/backup")).data;
  const doc = snap.docs.find((d) => d.type === "projects");
  doc.data.yearStart = "not a year";
  const r = await owner.post(A + "/backup/restore", { backup: snap });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /invalid/i);
  assert.equal((await owner.get(A + "/content/projects")).data.items.length, before);
});

test("server-side backups can be created, listed and downloaded; names can't escape the folder", async () => {
  const made = await owner.post(A + "/backups");
  assert.equal(made.status, 201);
  const list = (await owner.get(A + "/backups")).data.backups;
  assert.ok(list.some((b) => b.name === made.data.name));
  const dl = await owner.raw("GET", `${A}/backups/${encodeURIComponent(made.data.name)}`);
  assert.equal(dl.status, 200);

  const evil = await owner.raw("GET", `${A}/backups/${encodeURIComponent("../../db.json")}`);
  assert.ok(evil.status === 400 || evil.status === 404);
  const evil2 = await owner.raw("GET", `${A}/backups/kipl-backup-..%2F..%2Fdb.json`);
  assert.ok(evil2.status === 400 || evil2.status === 404);
});

test("project CSV export", async () => {
  const csv = await owner.raw("GET", A + "/export/projects.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.data, /Client,Title,Domain/);
  assert.match(csv.data, /Pot Room Operation/);
  assert.equal((await editor.raw("GET", A + "/export/projects.csv")).status, 403);
});
