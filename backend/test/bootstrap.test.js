"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.KIPL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kipl-bootstrap-"));

const db = require("../src/db");
const auth = require("../src/auth");
const { createInitialAccounts } = require("../src/bootstrap");

test("first start creates only the accounts whose password is provided", async () => {
  db.load();
  const made = createInitialAccounts({ KIPL_OWNER_PASSWORD: "first-owner-pw", KIPL_HR_PASSWORD: "first-hr-pw" });
  assert.deepEqual(made, ["owner", "hr"]);
  assert.equal(auth.findUserByName("editor"), null);
  const owner = auth.findUserByName("owner");
  assert.equal(owner.role, "owner");
  assert.equal(owner.initialPassword, true, "flagged so the panel nudges a password change");
  assert.notEqual(owner.passwordHash, "first-owner-pw", "stored as a hash");
  assert.ok(await auth.verifyPassword("first-owner-pw", owner.passwordHash));
});

test("it never touches an install that already has accounts", () => {
  const before = JSON.stringify(db.data.users);
  const made = createInitialAccounts({ KIPL_OWNER_PASSWORD: "changed", KIPL_EDITOR_PASSWORD: "new-editor-pw", KIPL_HR_PASSWORD: "x" });
  assert.deepEqual(made, []);
  assert.equal(JSON.stringify(db.data.users), before, "no resets, no new accounts");
});

test("with no variables set and no accounts, nothing is created", () => {
  db.replace(Object.assign({}, db.data, { users: [] }));
  assert.deepEqual(createInitialAccounts({}), []);
  assert.equal(db.data.users.length, 0);
});
