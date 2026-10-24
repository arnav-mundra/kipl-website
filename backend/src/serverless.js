"use strict";

/**
 * Request plumbing for serverless hosting (db.remote — see db.js). The app
 * code stays synchronous over `db.data`; this middleware makes that safe:
 *
 *   1. requests are handled one at a time per instance (they share db.data),
 *   2. db.data is refreshed from Redis before the route runs,
 *   3. pending changes are written back before the response goes out, so the
 *      next request — on any instance — sees them. If that write loses a race
 *      the client gets a 409 instead of a false "saved".
 *
 * It also does the first-run setup and the work a long-running server would
 * do on timers (scheduled publishing), since there is no process between
 * requests.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const db = require("./db");
const content = require("./content");
const audit = require("./audit");
const sitePublish = require("./sitepublish");
const { createInitialAccounts } = require("./bootstrap");

/** Empty database: start from the live site's content and the accounts in the environment. */
function firstRun() {
  const live = path.join(config.SITE_CONTENT_DIR, "content.json");
  if (content.seedIfEmpty(fs.existsSync(live) ? live : undefined)) console.log("Installed the starting content.");
  const created = createInitialAccounts();
  if (created.length) console.log(`Created starting accounts: ${created.join(", ")}.`);
}

/** Publish anything whose scheduled time has passed, then update the live site. */
async function runScheduled() {
  const done = content.runScheduled();
  done.forEach((d) => audit.log(null, "publish", d.type, d.id, d.error ? `Scheduled publish failed: ${d.error}` : `Scheduled publish: “${d.title}”`));
  if (done.some((d) => !d.error)) await sitePublish.sync(null);
  return done;
}

function middleware() {
  let queue = Promise.resolve();

  return (req, res, next) => {
    let release;
    const turn = new Promise((r) => { release = r; });
    const prev = queue;
    queue = prev.then(() => turn);

    prev.then(async () => {
      let released = false;
      const done = () => { if (!released) { released = true; release(); } };
      res.on("finish", done);
      res.on("close", done);

      try {
        await db.refresh();
        if (!db.data.docs.length || !db.data.users.length) firstRun();
        if (db.data.docs.some((d) => d.publishAt && new Date(d.publishAt).getTime() <= Date.now())) await runScheduled();
      } catch (err) {
        console.error("[db]", err);
        done();
        return res.status(503).json({ error: "The database isn't reachable right now. Please try again in a moment." });
      }

      const end = res.end;
      res.end = function (...args) {
        if (!db.dirty) return end.apply(res, args);
        db.flush().then(
          () => end.apply(res, args),
          (err) => {
            console.error("[db flush]", err);
            if (res.headersSent) return end.apply(res, args);
            const body = JSON.stringify({ error: err.status === 409 ? err.message : "Couldn't save your change. Please try again." });
            res.statusCode = err.status === 409 ? 409 : 503;
            res.removeHeader("ETag");
            res.removeHeader("Content-Disposition");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Content-Length", Buffer.byteLength(body));
            end.call(res, body);
          }
        );
        return res;
      };
      next();
    });
  };
}

module.exports = { middleware, runScheduled, firstRun };
