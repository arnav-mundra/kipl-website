"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { boot, client, A, config } = require("./helpers");

let ctx, owner, hr;
before(async () => {
  ctx = await boot();
  owner = client(ctx.base); await owner.login("owner");
  hr = client(ctx.base); await hr.login("hr");
});
after(() => ctx.server.close());

const png = (w, h, alpha = false) =>
  sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 255, g: 0, b: 0, alpha: 0.5 } : { r: 20, g: 90, b: 200 } } }).png().toBuffer();

function form(buffer, name, type, purpose) {
  const fd = new FormData();
  if (purpose) fd.append("purpose", purpose);
  fd.append("files", new Blob([buffer], { type }), name);
  return fd;
}

test("photos are resized, re-encoded and get a thumbnail", async () => {
  const big = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  const res = await owner.post(A + "/media", form(big, "Site Photo (final).JPG", "image/jpeg"));
  assert.equal(res.status, 201);
  const m = res.data.items[0];
  assert.equal(m.width, 2400, "capped at 2400px wide");
  assert.match(m.path, /^uploads\/\d{4}\/\d{2}\/site-photo-final-[0-9a-f]+\.jpg$/, "safe, slugged filename");
  assert.ok(fs.existsSync(path.join(config.UPLOAD_DIR, m.path.replace("uploads/", ""))));
  assert.ok(fs.existsSync(path.join(config.UPLOAD_DIR, m.thumb.replace("uploads/", ""))));

  const served = await fetch(ctx.base + "/" + m.path);
  assert.equal(served.status, 200);
  assert.match(served.headers.get("content-type"), /image\/jpeg/);
});

test("logos keep transparency and are capped smaller", async () => {
  const res = await owner.post(A + "/media", form(await png(1600, 400, true), "logo.png", "image/png", "logo"));
  const m = res.data.items[0];
  assert.equal(m.width, 800);
  assert.match(m.path, /\.png$/);
  const meta = await sharp(path.join(config.UPLOAD_DIR, m.path.replace("uploads/", ""))).metadata();
  assert.equal(meta.hasAlpha, true);
});

test("non-images and disguised files are refused", async () => {
  const text = await owner.post(A + "/media", form(Buffer.from("<script>alert(1)</script>"), "evil.png", "image/png"));
  assert.equal(text.status, 422);
  assert.match(text.data.errors[0].error, /readable image/);

  const svg = await owner.post(A + "/media", form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "x.svg", "image/svg+xml"));
  assert.equal(svg.status, 422, "SVG can carry scripts, so it isn't accepted");

  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).gif().toBuffer();
  assert.equal((await owner.post(A + "/media", form(gif, "a.gif", "image/gif"))).status, 422);

  const none = await owner.post(A + "/media", new FormData());
  assert.equal(none.status, 400);
});

test("oversize uploads are rejected", async () => {
  const huge = Buffer.alloc(config.MAX_UPLOAD_BYTES + 1024, 1);
  const res = await owner.post(A + "/media", form(huge, "huge.jpg", "image/jpeg"));
  assert.equal(res.status, 413);
});

test("HR can upload (for team photos) and sees uploads plus built-in site images", async () => {
  const up = await hr.post(A + "/media", form(await png(300, 300), "headshot.png", "image/png"));
  assert.equal(up.status, 201);
  const list = (await hr.get(A + "/media")).data.items;
  assert.ok(list.some((i) => !i.builtin && i.name === "headshot.png"));
  assert.ok(list.some((i) => i.builtin && i.path.startsWith("assets/images/")), "existing site images are browsable");
  assert.ok(!list.some((i) => i.path.includes("og-image")));
  const onlyBuiltin = (await hr.get(A + "/media?source=builtin")).data.items;
  assert.ok(onlyBuiltin.every((i) => i.builtin));
  const found = (await hr.get(A + "/media?q=headshot")).data.items;
  assert.equal(found.length, 1);
});

test("an uploaded image can be used in content, and can't be deleted while in use", async () => {
  const up = (await hr.post(A + "/media", form(await png(500, 500), "member.png", "image/png"))).data.items[0];
  const member = await hr.post(A + "/content/team", { name: "Photo Person", title: "Engineer", tier: "hod", photo: up.path, visible: true });
  assert.equal(member.status, 201);
  await hr.post(`${A}/content/team/${member.data.item.id}/publish`);

  const page = await (await fetch(ctx.base + "/about.html")).text();
  assert.ok(page.includes(`url('${up.path}')`), "photo is on the public page");

  const blocked = await hr.del(`${A}/media/${up.id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /Photo Person/);

  // Remove the person, then the file is free to delete.
  await hr.del(`${A}/content/team/${member.data.item.id}`);
  await hr.post(`${A}/content/team/${member.data.item.id}/publish`);
  assert.equal((await hr.del(`${A}/media/${up.id}`)).status, 200);
  assert.equal((await fetch(ctx.base + "/" + up.path)).status, 404);
});

test("built-in images can't be deleted from the library", async () => {
  const res = await owner.del(A + "/media/builtin:assets/images/kipl-logo.jpeg");
  assert.equal(res.status, 404);
  assert.ok(fs.existsSync(path.join(config.FRONTEND_DIR, "assets/images/kipl-logo.jpeg")));
});

test("only valid library paths are accepted as image fields", async () => {
  const bad = await hr.post(A + "/content/team", { name: "Sneaky", title: "T", tier: "hod", photo: "uploads/../../db.json", visible: true });
  assert.equal(bad.status, 422);
});
