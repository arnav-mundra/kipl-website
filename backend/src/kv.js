"use strict";

/**
 * Tiny client for Upstash Redis over its REST API (what Vercel's Marketplace
 * "Upstash for Redis" integration provides). No dependency: one HTTPS POST
 * per command. Only used when the admin runs on serverless hosting — see
 * db.js — so a local install never needs it.
 */

function fromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? createClient(url, token) : null;
}

function createClient(url, token, fetchImpl = (...a) => fetch(...a)) {
  const base = url.replace(/\/+$/, "");

  async function command(...args) {
    const res = await fetchImpl(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args.map(String)),
    });
    let body = null;
    try { body = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok || !body || body.error) {
      throw new Error(`Redis ${args[0]} failed: ${(body && body.error) || res.status}`);
    }
    return body.result;
  }

  return { command };
}

module.exports = { fromEnv, createClient };
