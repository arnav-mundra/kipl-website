"use strict";

const db = require("./db");
const audit = require("./audit");

const STATUSES = ["new", "contacted", "closed", "spam"];
const MAX_SPAM_KEPT = 200;

/* --------- spam defences for the public contact form ---------
 * 1. Honeypot: a field real visitors never see/fill; bots fill everything.
 * 2. Time trap: the page stamps the moment it loaded; humans take > a few
 *    seconds to write a message, scripts post instantly (or never stamp it).
 * 3. Link stuffing: several URLs in a message is almost always spam.
 * 4. Rate limit per IP.
 * Detected spam is stored as "spam" (so a false positive isn't lost) but the
 * visitor, human or bot, always sees the same success response.
 */

const MIN_FILL_MS = 2500;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;
const hits = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  return false;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);

/** Returns { ok: true } or { error, status }. */
function submit(body, meta) {
  if (!body || typeof body !== "object") return { error: "Invalid request.", status: 400 };

  const name = clean(body.name, 100);
  const email = clean(body.email, 120);
  const phone = clean(body.phone, 30);
  const message = clean(body.message, 4000);

  const problems = [];
  if (!name) problems.push("Please enter your name.");
  if (!EMAIL.test(email)) problems.push("Please enter a valid email address.");
  if (message.length < 5) problems.push("Please enter a message.");
  if (problems.length) return { error: problems.join(" "), status: 422 };

  if (rateLimited(meta.ip)) {
    return { error: "You've sent several messages recently. Please try again later or email us directly.", status: 429 };
  }

  let spam = false;
  if (clean(body.website, 200)) spam = true; // honeypot
  const stamp = Number(body.ts);
  if (!stamp || !Number.isFinite(stamp) || Date.now() - stamp < MIN_FILL_MS || stamp > Date.now() + 5000) spam = true;
  if ((message.match(/https?:\/\//gi) || []).length >= 3) spam = true;

  const entry = {
    id: db.id(5),
    at: new Date().toISOString(),
    name, email, phone, message,
    status: spam ? "spam" : "new",
    notes: "",
    ip: meta.ip || "",
    ua: clean(meta.ua, 200),
  };
  db.data.enquiries.push(entry);

  // Keep the spam bin bounded.
  const spamRows = db.data.enquiries.filter((e) => e.status === "spam");
  if (spamRows.length > MAX_SPAM_KEPT) {
    const drop = new Set(spamRows.slice(0, spamRows.length - MAX_SPAM_KEPT).map((e) => e.id));
    db.data.enquiries = db.data.enquiries.filter((e) => !drop.has(e.id));
  }
  db.save();
  if (!spam) audit.log(null, "enquiry", "enquiries", entry.id, `New enquiry from ${name}`, meta.ip);
  return { ok: true };
}

function list({ status, q } = {}) {
  let rows = db.data.enquiries.slice().reverse();
  if (status && status !== "all") rows = rows.filter((e) => e.status === status);
  else rows = rows.filter((e) => e.status !== "spam");
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((e) => (e.name + " " + e.email + " " + e.message).toLowerCase().includes(needle));
  }
  return rows;
}

function update(id, patch) {
  const e = db.data.enquiries.find((x) => x.id === id);
  if (!e) return null;
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw Object.assign(new Error("Invalid status"), { status: 422 });
    e.status = patch.status;
  }
  if (patch.notes !== undefined) e.notes = clean(patch.notes, 2000);
  db.save();
  return e;
}

function remove(id) {
  const i = db.data.enquiries.findIndex((x) => x.id === id);
  if (i < 0) return false;
  db.data.enquiries.splice(i, 1);
  db.save();
  return true;
}

function counts() {
  const out = { new: 0, contacted: 0, closed: 0, spam: 0, total: 0 };
  for (const e of db.data.enquiries) { out[e.status] = (out[e.status] || 0) + 1; if (e.status !== "spam") out.total++; }
  return out;
}

/* CSV helpers (RFC 4180, with a guard against spreadsheet formula injection) */
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (header, rows) => [header.map(csvCell).join(",")].concat(rows.map((r) => r.map(csvCell).join(","))).join("\r\n") + "\r\n";

function exportCsv() {
  return toCsv(
    ["Received", "Name", "Email", "Phone", "Status", "Message", "Notes"],
    db.data.enquiries.filter((e) => e.status !== "spam").map((e) => [e.at, e.name, e.email, e.phone, e.status, e.message, e.notes])
  );
}

module.exports = { submit, list, update, remove, counts, exportCsv, toCsv, STATUSES };
