"use strict";

const express = require("express");
const multer = require("multer");
const config = require("../config");
const db = require("../db");
const auth = require("../auth");
const audit = require("../audit");
const content = require("../content");
const media = require("../media");
const enquiries = require("../enquiries");
const backup = require("../backup");
const sitePublish = require("../sitepublish");
const { RESOURCES } = require("../schemas");
const { ROLES, canContent, can, summary } = require("../permissions");
const { titleOf } = require("../validate");

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ip = (req) => req.ip || "";
/** When hosted, push what was just published to the live site and report how that went. */
async function withSite(req, result) {
  if (sitePublish.enabled()) result.site = await sitePublish.sync(req.user);
  return result;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 10 } });

// The restore endpoint carries a whole backup, so it brings its own larger parser.
const smallJson = express.json({ limit: "1mb" });
router.use((req, res, next) => (req.path === "/backup/restore" ? next() : smallJson(req, res, next)));
router.use(auth.attachUser);
router.use(auth.csrfGuard);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

function meShape(user) {
  return user ? Object.assign(auth.publicUser(user), { permissions: summary(user) }) : null;
}

router.get("/me", (req, res) => res.json({ user: meShape(req.user) }));

router.post("/login", wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await auth.login(username, password, ip(req));
  if (result.error) {
    audit.log(null, "login-failed", "auth", String(username || "").slice(0, 40), "Failed sign-in attempt", ip(req));
    return res.status(result.status).json({ error: result.error });
  }
  const { token } = auth.createSession(result.user, req);
  auth.setSessionCookie(res, req, token);
  audit.log(result.user, "login", "auth", result.user.username, "Signed in", ip(req));
  res.json({ user: meShape(result.user) });
}));

router.post("/logout", (req, res) => {
  if (req.user) audit.log(req.user, "logout", "auth", req.user.username, "Signed out", ip(req));
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res, req);
  res.json({ ok: true });
});

router.put("/me", auth.requireAuth, (req, res) => {
  const name = String((req.body || {}).name || "").trim().slice(0, 80);
  if (!name) return res.status(422).json({ error: "Name can't be empty." });
  req.user.name = name;
  db.save();
  res.json({ user: meShape(req.user) });
});

router.post("/me/password", auth.requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await auth.verifyPassword(current, req.user.passwordHash))) {
    return res.status(403).json({ error: "Your current password is incorrect." });
  }
  const problem = auth.validateNewPassword(next, req.user.username);
  if (problem) return res.status(422).json({ error: problem });
  req.user.passwordHash = auth.hashPassword(next);
  req.user.initialPassword = false;
  db.save();
  auth.destroyUserSessions(req.user.id, req.sessionToken); // sign out everywhere else
  audit.log(req.user, "password", "users", req.user.username, "Changed own password", ip(req));
  res.json({ ok: true });
}));

/* Everything below needs a signed-in user. */
router.use(auth.requireAuth);

router.get("/schemas", (req, res) => {
  const visible = {};
  for (const [key, spec] of Object.entries(RESOURCES)) if (canContent(req.user, key)) visible[key] = spec;
  res.json({ resources: visible, roles: ROLES });
});

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

router.get("/dashboard", (req, res) => {
  const u = req.user;
  const counts = {};
  if (canContent(u, "projects")) {
    const ps = content.docsOf("projects").filter((d) => !d.deleted).map((d) => d.data);
    counts.projects = {
      total: ps.length,
      visible: ps.filter((p) => p.visible).length,
      active: ps.filter((p) => p.status === "active").length,
      completed: ps.filter((p) => p.status === "completed").length,
      featured: ps.filter((p) => p.featured).length,
    };
  }
  for (const t of ["domains", "team", "clients"]) {
    if (canContent(u, t)) counts[t] = content.docsOf(t).filter((d) => !d.deleted).length;
  }
  if (can(u, "enquiries")) counts.enquiries = enquiries.counts();
  if (can(u, "media")) counts.media = { files: db.data.media.length, bytes: media.diskUsage() };

  const scheduled = db.data.docs
    .filter((d) => d.publishAt && canContent(u, d.type))
    .map((d) => ({ type: d.type, id: d.id, title: titleOf(d.type, d.data), publishAt: d.publishAt }));

  const recent = can(u, "admin")
    ? audit.query({ limit: 8 }).rows
    : audit.query({ limit: 8, user: u.username }).rows;

  res.json({
    counts,
    pending: content.pendingFor(u),
    scheduled,
    recent,
    usingInitialPassword: !!u.initialPassword,
  });
});

/* ------------------------------------------------------------------ */
/* Content (collections + singletons)                                  */
/* ------------------------------------------------------------------ */

function guardType(req, res, next) {
  const { type } = req.params;
  if (!RESOURCES[type]) return res.status(404).json({ error: "Unknown section." });
  if (!canContent(req.user, type)) return res.status(403).json({ error: "You don't have permission to edit this section." });
  next();
}

router.get("/pending", (req, res) => res.json({ pending: content.pendingFor(req.user) }));

router.post("/publish-all", wrap(async (req, res) => {
  const result = content.publishAll(req.user, (type) => canContent(req.user, type));
  if (result.published.length) {
    audit.log(req.user, "publish", "all", "", `Published ${result.published.length} change${result.published.length > 1 ? "s" : ""}`, ip(req));
    await withSite(req, result);
  }
  res.json(result);
}));

router.get("/content/:type", guardType, (req, res) => {
  const { type } = req.params;
  const out = { resource: RESOURCES[type], items: content.list(type) };
  if (type === "projects") {
    out.refs = { domains: content.docsOf("domains").filter((d) => !d.deleted).map((d) => ({ id: d.id, name: d.data.name })) };
  }
  res.json(out);
});

router.get("/content/:type/:id", guardType, (req, res) => {
  res.json({ item: content.get(req.params.type, req.params.id) });
});

router.post("/content/:type", guardType, (req, res) => {
  const { type } = req.params;
  const item = content.create(type, req.body, req.user);
  audit.log(req.user, "create", type, item.id, `Created ${RESOURCES[type].singular.toLowerCase()} “${item.title}”`, ip(req));
  res.status(201).json({ item });
});

router.put("/content/:type/:id", guardType, (req, res) => {
  const { type, id } = req.params;
  const { data, ifMatch } = req.body || {};
  const item = content.update(type, id, data, req.user, ifMatch);
  audit.log(req.user, "update", type, id, `Edited “${item.title}” (draft)`, ip(req));
  res.json({ item });
});

router.delete("/content/:type/:id", guardType, (req, res) => {
  const { type, id } = req.params;
  const before = content.get(type, id);
  const result = content.remove(type, id, req.user);
  audit.log(req.user, "delete", type, id, `Deleted “${before.title}”${result.immediate ? "" : " (takes effect on publish)"}`, ip(req));
  res.json(result);
});

router.post("/content/:type/:id/publish", guardType, wrap(async (req, res) => {
  const { type, id } = req.params;
  const before = content.get(type, id);
  const result = content.publish(type, id, req.user);
  audit.log(req.user, "publish", type, id, `Published “${before.title}”`, ip(req));
  res.json(await withSite(req, result));
}));

router.post("/content/:type/:id/discard", guardType, (req, res) => {
  const { type, id } = req.params;
  const before = content.get(type, id);
  const result = content.discard(type, id, req.user);
  audit.log(req.user, "discard", type, id, `Discarded draft changes to “${before.title}”`, ip(req));
  res.json(result);
});

router.post("/content/:type/:id/schedule", guardType, (req, res) => {
  const { type, id } = req.params;
  const at = (req.body || {}).at || null;
  const item = content.schedule(type, id, at, req.user);
  audit.log(req.user, "schedule", type, id, at ? `Scheduled “${item.title}” for ${at}` : `Cleared schedule for “${item.title}”`, ip(req));
  res.json({ item });
});

router.get("/content/:type/:id/versions", guardType, (req, res) => {
  res.json({ versions: content.versions(req.params.type, req.params.id) });
});

router.post("/content/:type/:id/restore", guardType, wrap(async (req, res) => {
  const { type, id } = req.params;
  const { index, publishNow } = req.body || {};
  const item = content.restoreVersion(type, id, Number(index), req.user, !!publishNow);
  audit.log(req.user, "restore", type, id, `Restored an earlier version of “${item.title}”${publishNow ? " and published it" : " to draft"}`, ip(req));
  res.json(publishNow ? await withSite(req, { item }) : { item });
}));

router.post("/content/:type/reorder", guardType, (req, res) => {
  const { type } = req.params;
  const items = content.reorder(type, (req.body || {}).ids, req.user);
  audit.log(req.user, "reorder", type, "", `Reordered ${RESOURCES[type].label.toLowerCase()}`, ip(req));
  res.json({ items });
});

/* ------------------------------------------------------------------ */
/* Media library                                                       */
/* ------------------------------------------------------------------ */

router.get("/media", auth.requireCapability("media"), (req, res) => {
  res.json({ items: media.list({ q: String(req.query.q || ""), source: String(req.query.source || "") }) });
});

router.post(
  "/media",
  auth.requireCapability("media"),
  (req, res, next) => {
    upload.array("files", 10)(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "That file is too large (15 MB maximum)." });
      return res.status(400).json({ error: "Upload failed: " + err.message });
    });
  },
  wrap(async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No file received." });
    const purpose = req.body && req.body.purpose === "logo" ? "logo" : "photo";
    const items = [];
    const errors = [];
    for (const f of files) {
      try {
        items.push(await media.saveUpload(f.buffer, f.originalname, purpose, req.user));
      } catch (err) {
        errors.push({ name: f.originalname, error: err.message });
      }
    }
    if (items.length) audit.log(req.user, "upload", "media", "", `Uploaded ${items.length} image${items.length > 1 ? "s" : ""}`, ip(req));
    res.status(items.length ? 201 : 422).json({ items, errors });
  })
);

router.delete("/media/:id", auth.requireCapability("media"), wrap(async (req, res) => {
  const rec = await media.remove(req.params.id);
  audit.log(req.user, "delete", "media", rec.id, `Deleted image ${rec.name}`, ip(req));
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Enquiries                                                           */
/* ------------------------------------------------------------------ */

router.get("/enquiries", auth.requireCapability("enquiries"), (req, res) => {
  res.json({ items: enquiries.list({ status: String(req.query.status || ""), q: String(req.query.q || "") }), counts: enquiries.counts() });
});

router.patch("/enquiries/:id", auth.requireCapability("enquiries"), (req, res) => {
  const e = enquiries.update(req.params.id, req.body || {});
  if (!e) return res.status(404).json({ error: "Not found" });
  audit.log(req.user, "update", "enquiries", e.id, `Marked enquiry from ${e.name} as ${e.status}`, ip(req));
  res.json({ item: e });
});

router.delete("/enquiries/:id", auth.requireCapability("enquiries"), (req, res) => {
  if (!enquiries.remove(req.params.id)) return res.status(404).json({ error: "Not found" });
  audit.log(req.user, "delete", "enquiries", req.params.id, "Deleted an enquiry", ip(req));
  res.json({ ok: true });
});

router.get("/export/enquiries.csv", auth.requireCapability("enquiries"), (req, res) => {
  audit.log(req.user, "export", "enquiries", "", "Exported enquiries (CSV)", ip(req));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="kipl-enquiries.csv"');
  res.send("﻿" + enquiries.exportCsv());
});

router.get("/export/projects.csv", auth.requireCapability("admin"), (req, res) => {
  const rows = content.docsOf("projects").filter((d) => !d.deleted).map((d) => d.data);
  const domainName = (id) => (content.find("domains", id) || { data: {} }).data.name || id;
  const csv = enquiries.toCsv(
    ["Client", "Title", "Domain", "Location", "Status", "Value (Cr)", "Value text", "Start year", "End year", "Visible", "Featured", "Description"],
    rows.map((p) => [p.client, p.title, domainName(p.domain), p.location, p.status, p.valueCr, p.valueLabel, p.yearStart, p.yearEnd, p.visible ? "yes" : "no", p.featured ? "yes" : "no", p.description])
  );
  audit.log(req.user, "export", "projects", "", "Exported projects (CSV)", ip(req));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="kipl-projects.csv"');
  res.send("﻿" + csv);
});

/* ------------------------------------------------------------------ */
/* Owner-only: users, audit log, backups                               */
/* ------------------------------------------------------------------ */

const adminOnly = auth.requireCapability("admin");

function activeOwners(exceptId) {
  return db.data.users.filter((u) => u.role === "owner" && !u.disabled && u.id !== exceptId).length;
}

router.get("/users", adminOnly, (req, res) => {
  res.json({ users: db.data.users.map(auth.publicUser), roles: ROLES });
});

router.post("/users", adminOnly, (req, res) => {
  const { username, name, role, password } = req.body || {};
  const problem = auth.validateNewPassword(password, username);
  if (problem) return res.status(422).json({ error: problem });
  const user = auth.createUser({ username, name, role, password });
  audit.log(req.user, "create", "users", user.id, `Created ${user.role} account “${user.username}”`, ip(req));
  res.status(201).json({ user: auth.publicUser(user) });
});

router.put("/users/:id", adminOnly, (req, res) => {
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  const { name, role, disabled } = req.body || {};
  if (role !== undefined && !ROLES[role]) return res.status(422).json({ error: "Unknown role." });

  const demoting = role !== undefined && role !== "owner" && user.role === "owner";
  const disabling = disabled === true && !user.disabled;
  if ((demoting || disabling) && activeOwners(user.id) < 1) {
    return res.status(409).json({ error: "There must always be at least one active Owner." });
  }
  if (user.id === req.user.id && (demoting || disabling)) {
    return res.status(409).json({ error: "You can't demote or disable your own account." });
  }
  if (name !== undefined) user.name = String(name).trim().slice(0, 80) || user.name;
  if (role !== undefined) user.role = role;
  if (disabled !== undefined) user.disabled = !!disabled;
  if (user.disabled) auth.destroyUserSessions(user.id);
  db.save();
  audit.log(req.user, "update", "users", user.id, `Updated account “${user.username}”`, ip(req));
  res.json({ user: auth.publicUser(user) });
});

router.post("/users/:id/password", adminOnly, (req, res) => {
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  const problem = auth.validateNewPassword((req.body || {}).password, user.username);
  if (problem) return res.status(422).json({ error: problem });
  user.passwordHash = auth.hashPassword(req.body.password);
  user.initialPassword = false;
  db.save();
  auth.destroyUserSessions(user.id, user.id === req.user.id ? req.sessionToken : null);
  audit.log(req.user, "password", "users", user.id, `Reset password for “${user.username}”`, ip(req));
  res.json({ ok: true });
});

router.delete("/users/:id", adminOnly, (req, res) => {
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  if (user.id === req.user.id) return res.status(409).json({ error: "You can't delete your own account." });
  if (user.role === "owner" && activeOwners(user.id) < 1) return res.status(409).json({ error: "There must always be at least one active Owner." });
  db.data.users.splice(db.data.users.indexOf(user), 1);
  auth.destroyUserSessions(user.id);
  db.save();
  audit.log(req.user, "delete", "users", user.id, `Deleted account “${user.username}”`, ip(req));
  res.json({ ok: true });
});

router.get("/audit", adminOnly, (req, res) => {
  const { limit, offset, user, action, resource, q } = req.query;
  res.json(audit.query({
    limit: Math.min(parseInt(limit, 10) || 100, 500),
    offset: parseInt(offset, 10) || 0,
    user: user || undefined, action: action || undefined, resource: resource || undefined, q: q || undefined,
  }));
});

router.get("/backup", adminOnly, (req, res) => {
  audit.log(req.user, "export", "backup", "", "Downloaded a full content backup", ip(req));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kipl-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(backup.snapshot(), null, 2));
});

router.get("/backups", adminOnly, wrap(async (req, res) => res.json({ backups: await backup.list() })));

router.post("/backups", adminOnly, wrap(async (req, res) => {
  const name = await backup.writeBackup("manual");
  audit.log(req.user, "backup", "backup", name, "Created a backup on the server", ip(req));
  res.status(201).json({ name, backups: await backup.list() });
}));

router.get("/backups/:name", adminOnly, wrap(async (req, res) => {
  const json = await backup.readBackup(req.params.name);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.name}"`);
  res.send(json);
}));

router.post("/backup/restore", adminOnly, express.json({ limit: "30mb" }), wrap(async (req, res) => {
  const result = await backup.restore((req.body || {}).backup);
  audit.log(req.user, "restore", "backup", "", `Restored content from a backup (${result.docs} records). Safety copy: ${result.safetyBackup}`, ip(req));
  res.json(await withSite(req, result));
}));

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, _next) => {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That request is too large." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed request." });
  console.error("[admin api]", err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

module.exports = router;
