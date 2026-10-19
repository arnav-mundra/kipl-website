"use strict";

/**
 * Create the three starting admin accounts (owner, editor, hr).
 *
 * Passwords are read from environment variables so they never live in a file
 * that could be committed:
 *
 *   KIPL_OWNER_PASSWORD=… KIPL_EDITOR_PASSWORD=… KIPL_HR_PASSWORD=… npm run seed:users
 *
 * Existing accounts are left alone. To reset a forgotten password, pass the
 * username(s) after --reset, with the new password in the matching variable:
 *
 *   KIPL_OWNER_PASSWORD=… npm run seed:users -- --reset owner
 *
 * Accounts created here are flagged "initial password" so the admin panel
 * nudges the person to choose their own.
 */

const db = require("../src/db");
const auth = require("../src/auth");
const config = require("../src/config");

const { ACCOUNTS } = require("../src/bootstrap");

db.load();

const args = process.argv.slice(2);
const resetIdx = args.indexOf("--reset");
const toReset = new Set(resetIdx >= 0 ? args.slice(resetIdx + 1) : []);

let changed = 0;
for (const acct of ACCOUNTS) {
  const password = process.env[acct.env];
  const existing = auth.findUserByName(acct.username);

  if (existing && toReset.has(acct.username)) {
    if (!password) { console.error(`Set ${acct.env} to reset “${acct.username}”.`); process.exitCode = 1; continue; }
    existing.passwordHash = auth.hashPassword(password);
    existing.initialPassword = true;
    existing.disabled = false;
    auth.destroyUserSessions(existing.id);
    console.log(`Reset password for “${acct.username}”.`);
    changed++;
  } else if (existing) {
    console.log(`“${acct.username}” already exists — left unchanged.`);
  } else if (password) {
    auth.createUser({ username: acct.username, name: acct.name, role: acct.role, password, initialPassword: true });
    console.log(`Created ${acct.role} account “${acct.username}”.`);
    changed++;
  } else {
    console.log(`Skipped “${acct.username}” (${acct.env} not set).`);
  }
}

db.save();
console.log(changed ? `Done. Data file: ${config.DB_FILE}` : "Nothing to do.");
