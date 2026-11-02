"use strict";

/**
 * Job applications from the Careers page. The record lives in the database
 * next to enquiries; the resume file is kept apart from it — on disk in
 * data/resumes locally, or one Redis key per file when hosted (db.remote).
 * Resumes are personal data, so they never go into the public GitHub repo
 * the way uploaded images do, and they're only served to signed-in staff.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const db = require("./db");
const audit = require("./audit");
const { clean, rateLimited, EMAIL, MIN_FILL_MS, toCsv } = require("./enquiries");

const STATUSES = ["new", "shortlisted", "interviewed", "hired", "rejected", "spam"];
const MAX_RESUME_BYTES = 2 * 1024 * 1024;
const RESUME_DIR = path.join(config.DATA_DIR, "resumes");
const resumeKey = (id) => "kipl:resume:" + id;

/** The form's fields: [name, label, max length, required]. Order = admin/CSV order. */
const FIELDS = [
  ["name", "Full name", 100, true],
  ["email", "Email", 120, true],
  ["phone", "Phone", 30, true],
  ["location", "Current location", 100, true],
  ["position", "Position applied for", 100, true],
  ["qualification", "Highest qualification", 100, true],
  ["specialisation", "Specialisation / stream", 100, false],
  ["passingYear", "Year of passing", 4, false],
  ["experience", "Total experience (years)", 5, true],
  ["employer", "Current / last employer", 120, false],
  ["designation", "Current / last designation", 100, false],
  ["currentCtc", "Current CTC (₹ LPA)", 20, false],
  ["expectedCtc", "Expected CTC (₹ LPA)", 20, false],
  ["noticePeriod", "Notice period", 40, false],
  ["relocate", "Willing to work at any site", 10, false],
  ["skills", "Key skills & certifications", 1000, false],
  ["message", "Cover note", 3000, false],
];

/** What the file really is, from its first bytes (the browser's MIME type can't be trusted). */
function resumeType(buf) {
  if (buf.slice(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", mime: "application/pdf" };
  if (buf.slice(0, 4).toString("hex") === "504b0304") {
    return { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  if (buf.slice(0, 8).toString("hex") === "d0cf11e0a1b11ae1") return { ext: "doc", mime: "application/msword" };
  return null;
}

async function putResume(id, data) {
  if (db.remote) return db.remote.command("SET", resumeKey(id), data.toString("base64"));
  fs.mkdirSync(RESUME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESUME_DIR, id), data);
}

async function getResume(id) {
  if (db.remote) {
    const b64 = await db.remote.command("GET", resumeKey(id));
    return b64 ? Buffer.from(b64, "base64") : null;
  }
  try { return fs.readFileSync(path.join(RESUME_DIR, id)); } catch (_) { return null; }
}

async function dropResume(id) {
  if (db.remote) return db.remote.command("DEL", resumeKey(id));
  try { fs.unlinkSync(path.join(RESUME_DIR, id)); } catch (_) { /* already gone */ }
}

/** body: the form fields; file: { buffer, originalname } or undefined. Returns { ok } or { error, status }. */
async function submit(body, file, meta) {
  if (!body || typeof body !== "object") return { error: "Invalid request.", status: 400 };

  const entry = {};
  for (const [key, , max] of FIELDS) entry[key] = clean(body[key], max);

  const problems = [];
  for (const [key, label, , required] of FIELDS) if (required && !entry[key]) problems.push(`Please fill in “${label}”.`);
  if (entry.email && !EMAIL.test(entry.email)) problems.push("Please enter a valid email address.");
  if (entry.experience && !/^\d{1,2}(\.\d)?$/.test(entry.experience)) problems.push("Please enter your experience in years, e.g. 3 or 4.5.");
  if (entry.passingYear && !/^(19|20)\d\d$/.test(entry.passingYear)) problems.push("Please enter the year of passing as four digits.");
  if (!file || !file.buffer || !file.buffer.length) problems.push("Please attach your resume.");
  if (body.consent !== "yes") problems.push("Please agree to us keeping your details for recruitment.");
  if (problems.length) return { error: problems.join(" "), status: 422 };

  if (file.buffer.length > MAX_RESUME_BYTES) return { error: "Your resume must be 2 MB or smaller.", status: 413 };
  const type = resumeType(file.buffer);
  if (!type) return { error: "Please upload your resume as a PDF or Word file (.pdf, .doc, .docx).", status: 415 };

  if (rateLimited("apply:" + (meta.ip || ""))) {
    return { error: "You've sent several applications recently. Please try again later.", status: 429 };
  }

  let spam = false;
  if (clean(body.website, 200)) spam = true; // honeypot
  const stamp = Number(body.ts);
  if (!stamp || !Number.isFinite(stamp) || Date.now() - stamp < MIN_FILL_MS || stamp > Date.now() + 5000) spam = true;

  const id = db.id(6);
  await putResume(id, file.buffer);
  db.data.applications.push(Object.assign({ id, at: new Date().toISOString() }, entry, {
    resume: {
      name: clean(file.originalname, 120).replace(/[^\w.\- ]+/g, "_") || "resume." + type.ext,
      ext: type.ext,
      mime: type.mime,
      bytes: file.buffer.length,
    },
    status: spam ? "spam" : "new",
    notes: "",
    ip: meta.ip || "",
  }));
  db.save();
  if (!spam) audit.log(null, "application", "applications", id, `New job application from ${entry.name} (${entry.position})`, meta.ip);
  return { ok: true };
}

function list({ status, q } = {}) {
  let rows = db.data.applications.slice().reverse();
  if (status && status !== "all") rows = rows.filter((a) => a.status === status);
  else rows = rows.filter((a) => a.status !== "spam");
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((a) => [a.name, a.email, a.position, a.qualification, a.location, a.employer, a.skills].join(" ").toLowerCase().includes(needle));
  }
  return rows;
}

const find = (id) => db.data.applications.find((a) => a.id === id) || null;

function update(id, patch) {
  const a = find(id);
  if (!a) return null;
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw Object.assign(new Error("Invalid status"), { status: 422 });
    a.status = patch.status;
  }
  if (patch.notes !== undefined) a.notes = clean(patch.notes, 2000);
  db.save();
  return a;
}

async function remove(id) {
  const i = db.data.applications.findIndex((a) => a.id === id);
  if (i < 0) return false;
  db.data.applications.splice(i, 1);
  db.save();
  await dropResume(id);
  return true;
}

function counts() {
  const out = { total: 0 };
  STATUSES.forEach((s) => { out[s] = 0; });
  for (const a of db.data.applications) { out[a.status]++; if (a.status !== "spam") out.total++; }
  return out;
}

function exportCsv() {
  return toCsv(
    ["Received"].concat(FIELDS.map((f) => f[1]), ["Status", "Notes"]),
    db.data.applications.filter((a) => a.status !== "spam").map((a) => [a.at].concat(FIELDS.map((f) => a[f[0]]), [a.status, a.notes]))
  );
}

module.exports = { submit, list, find, update, remove, counts, exportCsv, getResume, FIELDS, STATUSES, MAX_RESUME_BYTES };
