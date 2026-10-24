"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");
const config = require("./config");
const { ROLES, canContent, can } = require("./permissions");

const COOKIE = "kipl_admin";
const BCRYPT_COST = 11;
const MIN_PASSWORD_LENGTH = 8;

/* ---------------- passwords & users ---------------- */

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), BCRYPT_COST);
}

/** Async so a slow hash comparison never blocks the event loop. */
function verifyPassword(plain, hash) {
  return bcrypt.compare(String(plain == null ? "" : plain), hash);
}

// A throwaway hash so a login for a non-existent user costs the same as a real one.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

function findUserByName(username) {
  const name = String(username || "").trim().toLowerCase();
  return db.data.users.find((u) => u.username.toLowerCase() === name) || null;
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    disabled: !!u.disabled,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
    usingInitialPassword: !!u.initialPassword,
  };
}

function validateNewPassword(pw, username) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > 200) return "Password is too long.";
  if (username && pw.toLowerCase() === String(username).toLowerCase()) return "Password can't be the same as the username.";
  return null;
}

function createUser({ username, name, role, password, initialPassword = false }) {
  if (!ROLES[role]) throw Object.assign(new Error("Unknown role"), { status: 422 });
  if (!/^[a-z0-9._-]{2,32}$/i.test(username || "")) {
    throw Object.assign(new Error("Username must be 2–32 characters (letters, numbers, . _ -)."), { status: 422 });
  }
  if (findUserByName(username)) throw Object.assign(new Error("That username is already taken."), { status: 409 });
  const user = {
    id: db.id(5),
    username: username.trim(),
    name: (name || username).trim().slice(0, 80),
    role,
    passwordHash: hashPassword(password),
    initialPassword: !!initialPassword,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    disabled: false,
  };
  db.data.users.push(user);
  db.save();
  return user;
}

/* ---------------- login throttling ---------------- */

// key -> { count, first }. Kept in memory on a normal server; on serverless
// hosting (db.remote) each request may land on a fresh instance, so the
// counters live in the database instead.
const memoryAttempts = new Map();
const attempts = {
  table() { return db.remote ? (db.data.throttle = db.data.throttle || {}) : null; },
  get(k) { const t = this.table(); return t ? t[k] : memoryAttempts.get(k); },
  set(k, v) { const t = this.table(); if (!t) return memoryAttempts.set(k, v); t[k] = v; db.save(); },
  delete(k) {
    const t = this.table();
    if (!t) return memoryAttempts.delete(k);
    if (k in t) { delete t[k]; db.save(); }
  },
};
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER = 5;
const MAX_PER_IP = 25;

function throttleKey(kind, v) {
  return kind + "|" + v;
}

function recent(key) {
  const rec = attempts.get(key);
  if (!rec) return 0;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return 0; }
  return rec.count;
}

function bump(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else { rec.count++; attempts.set(key, rec); }
}

function lockedOut(ip, username) {
  return recent(throttleKey("u", ip + "|" + String(username).toLowerCase())) >= MAX_PER_USER || recent(throttleKey("ip", ip)) >= MAX_PER_IP;
}

function recordFailure(ip, username) {
  bump(throttleKey("u", ip + "|" + String(username).toLowerCase()));
  bump(throttleKey("ip", ip));
}

function clearFailures(ip, username) {
  attempts.delete(throttleKey("u", ip + "|" + String(username).toLowerCase()));
}

/**
 * Verify credentials. Returns { user } or { error, status }. The bcrypt
 * comparison is asynchronous so a burst of sign-in attempts can't stall the
 * whole server (including the public website) while hashes are computed.
 */
async function login(username, password, ip) {
  if (lockedOut(ip, username)) {
    return { error: "Too many failed attempts. Try again in 15 minutes.", status: 429 };
  }
  const user = findUserByName(username);
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok || user.disabled) {
    recordFailure(ip, username || "");
    return { error: "Incorrect username or password.", status: 401 };
  }
  clearFailures(ip, username);
  user.lastLoginAt = new Date().toISOString();
  db.save();
  return { user };
}

/* ---------------- sessions ---------------- */

const sha = (token) => crypto.createHash("sha256").update(token).digest("hex");

function createSession(user, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_HOURS * 3600 * 1000).toISOString();
  db.data.sessions = db.data.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
  db.data.sessions.push({
    id: sha(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt,
    ip: req.ip || "",
    ua: String(req.headers["user-agent"] || "").slice(0, 200),
  });
  db.save();
  return { token, expiresAt };
}

function destroySession(token) {
  if (!token) return;
  const id = sha(token);
  const before = db.data.sessions.length;
  db.data.sessions = db.data.sessions.filter((s) => s.id !== id);
  if (db.data.sessions.length !== before) db.save();
}

function destroyUserSessions(userId, exceptToken) {
  const keep = exceptToken ? sha(exceptToken) : null;
  db.data.sessions = db.data.sessions.filter((s) => s.userId !== userId || s.id === keep);
  db.save();
}

function sessionUser(token) {
  if (!token) return null;
  const id = sha(token);
  const s = db.data.sessions.find((x) => x.id === id);
  if (!s || new Date(s.expiresAt).getTime() <= Date.now()) return null;
  const user = db.data.users.find((u) => u.id === s.userId);
  return user && !user.disabled ? user : null;
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isSecure(req) {
  return req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function setSessionCookie(res, req, token) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/", "HttpOnly", "SameSite=Strict",
    `Max-Age=${config.SESSION_HOURS * 3600}`,
  ];
  if (isSecure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res, req) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isSecure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/* ---------------- middleware ---------------- */

function tokenOf(req) {
  return parseCookies(req.headers.cookie)[COOKIE] || null;
}

/** Attach req.user (or null) without rejecting. */
function attachUser(req, _res, next) {
  req.sessionToken = tokenOf(req);
  req.user = sessionUser(req.sessionToken);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please sign in." });
  next();
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Strict). */
function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.headers["x-requested-with"] !== "kipl-admin") {
    return res.status(403).json({ error: "Missing request header." });
  }
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch (_) { host = null; }
    if (host !== req.headers.host) return res.status(403).json({ error: "Cross-site request blocked." });
  }
  next();
}

function requireCapability(cap) {
  return (req, res, next) => (can(req.user, cap) ? next() : res.status(403).json({ error: "You don't have permission to do that." }));
}

function requireContent(typeParam = "type") {
  return (req, res, next) => (canContent(req.user, req.params[typeParam]) ? next() : res.status(403).json({ error: "You don't have permission to edit this section." }));
}

module.exports = {
  COOKIE, MIN_PASSWORD_LENGTH,
  hashPassword, verifyPassword, findUserByName, publicUser, validateNewPassword, createUser,
  login, createSession, destroySession, destroyUserSessions, sessionUser,
  setSessionCookie, clearSessionCookie, attachUser, requireAuth, csrfGuard, requireCapability, requireContent,
};
