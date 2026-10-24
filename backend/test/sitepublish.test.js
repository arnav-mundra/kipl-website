"use strict";

/**
 * Hosted publishing: after a publish the admin commits site-content/ to
 * GitHub (Vercel then rebuilds the site). A small in-memory fake of GitHub's
 * git data API checks what gets committed.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { boot, db, content } = require("./helpers");
const sitePublish = require("../src/sitepublish");
const github = require("../src/github");
const { fakeGitHub } = require("./fake-github");

const cfg = { token: "t", repo: "owner/repo", branch: "main", author: null };
let images;
const readUpload = async (p) => images[p] || null;

let ctx;
before(async () => { ctx = await boot(); });
after(() => ctx.server.close());

test("publishing commits content.json and the images published content uses", async () => {
  const gh = fakeGitHub({ "frontend/index.html": "page", "site-content/content.json": "old" });
  images = { "uploads/2026/10/hero-ab12.jpg": Buffer.from("jpeg-bytes") };
  const site = content.find("site", "site");
  site.published.hero.image = "uploads/2026/10/hero-ab12.jpg";
  db.save();

  const r = await sitePublish.sync(null, { cfg, readUpload, fetchImpl: gh.fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(gh.file("site-content/content.json").toString(), sitePublish.buildSiteContent().json);
  assert.equal(gh.file("site-content/uploads/2026/10/hero-ab12.jpg").toString(), "jpeg-bytes");
  assert.equal(gh.file("frontend/index.html").toString(), "page", "the rest of the repo is untouched");
  assert.equal(db.data.meta.sitePublish.ok, true);

  // Nothing changed since: no new commit.
  const before = gh.commitCount();
  const again = await sitePublish.sync(null, { cfg, readUpload, fetchImpl: gh.fetchImpl });
  assert.equal(again.changed, false);
  assert.equal(gh.commitCount(), before);

  // Image no longer used: removed from the live site's files.
  site.published.hero.image = "assets/images/hero.jpg";
  db.save();
  await sitePublish.sync(null, { cfg, readUpload, fetchImpl: gh.fetchImpl });
  assert.equal(gh.files()["site-content/uploads/2026/10/hero-ab12.jpg"], undefined);
});

test("images already stored in media/ are reused, not downloaded and re-uploaded", async () => {
  const gh = fakeGitHub({ "media/uploads/2026/10/team-cd34.jpg": "team-photo" });
  const site = content.find("site", "site");
  site.published.hero.image = "uploads/2026/10/team-cd34.jpg";
  db.save();
  const r = await sitePublish.sync(null, { cfg, readUpload: async () => { throw new Error("should not read"); }, fetchImpl: gh.fetchImpl });
  assert.equal(r.ok, true, r.error);
  assert.equal(gh.file("site-content/uploads/2026/10/team-cd34.jpg").toString(), "team-photo");
  assert.ok(!gh.calls.includes("POST /git/blobs"));
});

test("a GitHub failure is reported, not thrown", async () => {
  const r = await sitePublish.sync(null, {
    cfg, readUpload,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /401 Bad credentials/);
  assert.equal(db.data.meta.sitePublish.ok, false);
});

test("without GitHub settings nothing is attempted", async () => {
  assert.equal(github.settings({}), null);
  assert.equal(await sitePublish.sync(null, {}), null);
});
