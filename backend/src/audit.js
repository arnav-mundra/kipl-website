"use strict";

const db = require("./db");

const MAX_ENTRIES = 5000;

/**
 * Append an audit entry. `actor` is the user object (or null for system/public
 * actions such as scheduled publishing or contact-form submissions).
 */
function log(actor, action, resource, target, summary, ip) {
  const entry = {
    id: db.id(5),
    at: new Date().toISOString(),
    user: actor ? actor.username : "system",
    role: actor ? actor.role : "system",
    action,
    resource: resource || "",
    target: target || "",
    summary: summary || "",
    ip: ip || "",
  };
  db.data.audit.push(entry);
  if (db.data.audit.length > MAX_ENTRIES) db.data.audit.splice(0, db.data.audit.length - MAX_ENTRIES);
  db.save();
  return entry;
}

function query({ limit = 100, offset = 0, user, action, resource, q } = {}) {
  let rows = db.data.audit.slice().reverse();
  if (user) rows = rows.filter((r) => r.user === user);
  if (action) rows = rows.filter((r) => r.action === action);
  if (resource) rows = rows.filter((r) => r.resource === resource);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => (r.summary + " " + r.target + " " + r.user).toLowerCase().includes(needle));
  }
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

module.exports = { log, query };
