"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { boot, client, A, config } = require("./helpers");

let ctx, owner, hr, editor;
before(async () => {
  ctx = await boot();
  owner = client(ctx.base); await owner.login("owner");
  editor = client(ctx.base); await editor.login("editor");
  hr = client(ctx.base); await hr.login("hr");
});
after(() => ctx.server.close());

const PDF = Buffer.from("%PDF-1.4\n% test resume\n");
const fields = (over = {}) => Object.assign({
  name: "Asha Patel", email: "asha@example.com", phone: "98765 43210", location: "Jharsuguda, Odisha",
  position: "Engineer — Mechanical", qualification: "B.E. / B.Tech", experience: "4.5", passingYear: "2019",
  skills: "Conveyor maintenance", consent: "yes", website: "", ts: String(Date.now() - 60000),
}, over);

function form(over = {}, file = { data: PDF, name: "asha-cv.pdf" }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields(over))) if (v !== undefined) fd.append(k, v);
  if (file) fd.append("resume", new Blob([file.data]), file.name);
  return fd;
}
const send = (fd) => client(ctx.base).raw("POST", "/api/applications", fd);

test("an application with a resume reaches owner and HR, not editors", async () => {
  const res = await send(form());
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const list = (await hr.get(A + "/applications")).data;
  assert.equal(list.items.length, 1);
  const a = list.items[0];
  assert.equal(a.name, "Asha Patel");
  assert.equal(a.status, "new");
  assert.equal(a.resume.ext, "pdf");
  assert.equal(list.counts.new, 1);
  assert.equal((await owner.get(A + "/applications")).status, 200);
  assert.equal((await editor.get(A + "/applications")).status, 403);

  const dl = await fetch(ctx.base + A + `/applications/${a.id}/resume`, { headers: { Cookie: hr.cookie, "X-Requested-With": "kipl-admin" } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition"), /attachment; filename="Asha-Patel-resume\.pdf"/);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PDF);
  assert.equal((await client(ctx.base).get(A + `/applications/${a.id}/resume`)).status, 401);
});

test("missing fields, missing consent and missing resume are refused", async () => {
  const noName = await send(form({ name: "" }));
  assert.equal(noName.status, 422);
  assert.match(noName.data.error, /Full name/);
  assert.equal((await send(form({ consent: undefined }))).status, 422);
  assert.equal((await send(form({ experience: "lots" }))).status, 422);
  assert.match((await send(form({}, null))).data.error, /resume/i);
});

test("only PDF/Word files up to 2 MB are accepted, whatever the file name says", async () => {
  const fake = await send(form({}, { data: Buffer.from("<html>not a pdf</html>"), name: "cv.pdf" }));
  assert.equal(fake.status, 415);
  const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]);
  assert.equal((await send(form({}, { data: big, name: "cv.pdf" }))).status, 413);
  const docx = await send(form({ email: "docx@example.com" }, { data: Buffer.from("504b030414000600", "hex"), name: "cv.docx" }));
  assert.equal(docx.status, 200);
});

test("bots are filed as spam; deleting an application removes its resume", async () => {
  assert.equal((await send(form({ website: "http://spam.example" }))).status, 200);
  const spam = (await owner.get(A + "/applications?status=spam")).data.items;
  assert.equal(spam.length, 1);

  const file = path.join(config.DATA_DIR, "resumes", spam[0].id);
  assert.ok(fs.existsSync(file));
  assert.equal((await hr.del(A + `/applications/${spam[0].id}`)).status, 200);
  assert.ok(!fs.existsSync(file));
});

test("status and notes can be updated, and the CSV export lists applicants", async () => {
  const a = (await owner.get(A + "/applications")).data.items.find((x) => x.name === "Asha Patel");
  const r = await hr.patch(A + `/applications/${a.id}`, { status: "shortlisted", notes: "Call on Monday" });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.status, "shortlisted");
  assert.equal((await hr.patch(A + `/applications/${a.id}`, { status: "bogus" })).status, 422);

  const csv = await hr.get(A + "/export/applications.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.data, /Asha Patel/);
  assert.match(csv.data, /shortlisted/);
});
