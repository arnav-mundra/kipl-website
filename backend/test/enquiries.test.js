"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { boot, client, A } = require("./helpers");

let ctx, owner, hr, editor;
before(async () => {
  ctx = await boot();
  owner = client(ctx.base); await owner.login("owner");
  editor = client(ctx.base); await editor.login("editor");
  hr = client(ctx.base); await hr.login("hr");
});
after(() => ctx.server.close());

const visitor = () => client(ctx.base);
const good = (over = {}) => Object.assign({ name: "Real Person", email: "real@example.com", phone: "99999 00000", message: "Hello, we need a quote for a shutdown.", website: "", ts: String(Date.now() - 20000) }, over);
const send = (body) => visitor().raw("POST", "/api/enquiries", body);

test("a genuine enquiry is stored and visible to owner and editor, not HR", async () => {
  const res = await send(good());
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);

  const list = (await owner.get(A + "/enquiries")).data;
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].name, "Real Person");
  assert.equal(list.items[0].status, "new");
  assert.equal(list.counts.new, 1);
  assert.equal((await editor.get(A + "/enquiries")).status, 200);
  assert.equal((await hr.get(A + "/enquiries")).status, 403);
});

test("validation: missing or malformed fields are refused with a message", async () => {
  const noName = await send(good({ name: " " }));
  assert.equal(noName.status, 422);
  assert.match(noName.data.error, /name/i);
  assert.equal((await send(good({ email: "not-an-email" }))).status, 422);
  assert.equal((await send(good({ message: "hi" }))).status, 422);
  assert.equal((await send(null)).status, 400);
});

test("honeypot, instant submissions and link stuffing are stored as spam but look successful", async () => {
  const before = (await owner.get(A + "/enquiries")).data.items.length;
  for (const bad of [
    good({ website: "http://spam.example" }),
    good({ ts: String(Date.now() - 300) }),
    good({ ts: "" }),
    good({ message: "Buy now http://a.example http://b.example http://c.example" }),
  ]) {
    const r = await send(bad);
    assert.equal(r.status, 200, "bots get the same answer as people");
    assert.equal(r.data.ok, true);
  }
  assert.equal((await owner.get(A + "/enquiries")).data.items.length, before, "spam is hidden from the inbox");
  const spam = (await owner.get(A + "/enquiries?status=spam")).data;
  assert.equal(spam.items.length, 4);
  assert.equal(spam.counts.spam, 4);
});

test("per-IP rate limit stops floods", async () => {
  let blocked = 0;
  for (let i = 0; i < 8; i++) {
    const r = await send(good({ message: "Message number " + i + " about a project" }));
    if (r.status === 429) blocked++;
  }
  assert.ok(blocked >= 1, "later submissions are throttled");
});

test("owner can triage, annotate, export and delete", async () => {
  const [first] = (await owner.get(A + "/enquiries")).data.items;
  const upd = await owner.patch(`${A}/enquiries/${first.id}`, { status: "contacted", notes: "Called them back." });
  assert.equal(upd.data.item.status, "contacted");
  assert.equal((await owner.patch(`${A}/enquiries/${first.id}`, { status: "bogus" })).status, 422);

  const csv = await owner.raw("GET", A + "/export/enquiries.csv");
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.data, /Real Person/);
  assert.match(csv.data, /Called them back\./);

  assert.equal((await owner.del(`${A}/enquiries/${first.id}`)).status, 200);
  assert.equal((await owner.del(`${A}/enquiries/${first.id}`)).status, 404);
});

test("CSV export neutralises spreadsheet formulas", async () => {
  const { toCsv } = require("../src/enquiries");
  const csv = toCsv(["a"], [["=HYPERLINK(\"http://x\")"], ["+1+1"], ["@SUM(A1)"], ["plain, with comma"]]);
  const lines = csv.trim().split("\r\n").slice(1);
  assert.ok(lines[0].startsWith("\"'=") || lines[0].startsWith("'="));
  assert.ok(lines[1].startsWith("'+"));
  assert.ok(lines[2].startsWith("'@"));
  assert.equal(lines[3], '"plain, with comma"');
});
