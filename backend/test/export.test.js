"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const backend = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kipl-export-"));
const seed = require("../seed/content.json");
const run = (...args) => execFileSync("node", ["scripts/export-static.js", ...args], { cwd: backend, encoding: "utf8" });

test("snapshot export renders the committed content and copies its uploads", () => {
  const snap = path.join(tmp, "site-content");
  const content = JSON.parse(JSON.stringify(seed));
  content.site.hero.headline = "Headline from the snapshot.";
  fs.mkdirSync(path.join(snap, "uploads", "2026", "10"), { recursive: true });
  fs.writeFileSync(path.join(snap, "content.json"), JSON.stringify(content));
  fs.writeFileSync(path.join(snap, "uploads", "2026", "10", "pic.png"), "png-bytes");

  const out = path.join(tmp, "out");
  run("--snapshot", snap, out);

  assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /Headline from the snapshot\./);
  assert.ok(fs.existsSync(path.join(out, "uploads", "2026", "10", "pic.png")));
  assert.ok(fs.existsSync(path.join(out, "css", "base.css")), "assets are copied");
  assert.ok(!fs.existsSync(path.join(out, "draft")), "work-in-progress drafts are never exported");
});

test("with no snapshot yet, the pages are exported exactly as authored", () => {
  const out = path.join(tmp, "out-plain");
  run("--snapshot", path.join(tmp, "does-not-exist"), out);
  const authored = fs.readFileSync(path.resolve(backend, "..", "frontend", "index.html"), "utf8");
  assert.equal(fs.readFileSync(path.join(out, "index.html"), "utf8"), authored);
});
