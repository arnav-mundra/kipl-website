"use strict";

const fs = require("fs");
const config = require("./src/config");
const db = require("./src/db");
const content = require("./src/content");
const audit = require("./src/audit");
const backup = require("./src/backup");
const { createInitialAccounts } = require("./src/bootstrap");
const { createApp } = require("./src/app");

function start() {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  db.load();

  if (content.seedIfEmpty()) console.log("Installed the starting content (a copy of the current website).");

  const created = createInitialAccounts();
  if (created.length) console.log(`Created starting accounts from environment variables: ${created.join(", ")}. Sign in and change the passwords.`);

  if (!db.data.users.length) {
    console.warn(
      "\nNo admin accounts exist yet. Create them with:\n" +
        "  KIPL_OWNER_PASSWORD=… KIPL_EDITOR_PASSWORD=… KIPL_HR_PASSWORD=… npm run seed:users\n"
    );
  }

  // Scheduled publishing: check every 30 seconds.
  setInterval(() => {
    try {
      const done = content.runScheduled();
      done.forEach((d) => audit.log(null, "publish", d.type, d.id, d.error ? `Scheduled publish failed: ${d.error}` : `Scheduled publish: “${d.title}”`));
    } catch (err) {
      console.error("[scheduler]", err);
    }
  }, 30000).unref();

  // Automatic daily backup (kept for 14 days).
  const tick = () => {
    try { backup.autoBackup(); } catch (err) { console.error("[backup]", err); }
  };
  tick();
  setInterval(tick, 3600 * 1000).unref();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`KIPL website:  http://localhost:${config.PORT}/`);
    console.log(`Admin panel:   http://localhost:${config.PORT}/admin/`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { start };
