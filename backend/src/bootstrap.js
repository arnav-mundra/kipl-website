"use strict";

const db = require("./db");
const auth = require("./auth");

/** The three starting accounts and the environment variable holding each password. */
const ACCOUNTS = [
  { username: "owner", name: "Owner", role: "owner", env: "KIPL_OWNER_PASSWORD" },
  { username: "editor", name: "Editor", role: "editor", env: "KIPL_EDITOR_PASSWORD" },
  { username: "hr", name: "HR", role: "hr", env: "KIPL_HR_PASSWORD" },
];

/**
 * First-start convenience for hosts without a shell (e.g. Render's blueprint):
 * when the database has NO accounts at all, create the ones whose password is
 * set in the environment. It never touches an existing install — once any
 * account exists this does nothing, so changing or removing the variables
 * later can't reset or recreate anyone.
 * Returns the usernames it created.
 */
function createInitialAccounts(env = process.env) {
  if (db.data.users.length) return [];
  const created = [];
  for (const acct of ACCOUNTS) {
    const password = env[acct.env];
    if (!password) continue;
    auth.createUser({ username: acct.username, name: acct.name, role: acct.role, password, initialPassword: true });
    created.push(acct.username);
  }
  return created;
}

module.exports = { ACCOUNTS, createInitialAccounts };
