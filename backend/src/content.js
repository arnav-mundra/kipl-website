"use strict";

/**
 * Content store with a draft / publish workflow.
 *
 * Every record ("doc") carries:
 *   data       the working draft (what editors change)
 *   published  the live copy the public site renders (null until first publish)
 *   deleted    true when the record is queued for removal on next publish
 *   publishAt  optional ISO time for scheduled publishing
 *   versions   the last published snapshots, for rollback
 *
 * The public site only ever reads `published`, so nothing an editor does is
 * visible until they (or a scheduled job) publish it.
 */

const fs = require("fs");
const path = require("path");
const db = require("./db");
const config = require("./config");
const { RESOURCES, COLLECTIONS, SINGLETONS } = require("./schemas");
const { validateResource, titleOf } = require("./validate");
const { canContent } = require("./permissions");

const MAX_VERSIONS = 20;
// Publish order matters: projects reference domains.
const PUBLISH_ORDER = ["domains", "clients", "team", "projects", "figures", "people", "site"];

class ContentError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const hooks = { onPublish: () => {} };

const now = () => new Date().toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function docsOf(type) {
  return db.data.docs.filter((d) => d.type === type);
}

function find(type, id) {
  return db.data.docs.find((d) => d.type === type && d.id === id) || null;
}

function mustFind(type, id) {
  const doc = find(type, id);
  if (!doc) throw new ContentError("Not found", 404);
  return doc;
}

function statusOf(doc) {
  if (doc.deleted) return "deleted";
  if (doc.publishAt) return "scheduled";
  if (!doc.published) return "new";
  return same(doc.data, doc.published) ? "live" : "changed";
}

function isPending(doc) {
  return statusOf(doc) !== "live";
}

function refExists(type, id) {
  return docsOf(type).some((d) => d.id === id && !d.deleted);
}

function ctx() {
  return { refExists };
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function nextOrder(type) {
  const orders = docsOf(type).filter((d) => !d.deleted).map((d) => Number(d.data.order) || 0);
  return orders.length ? Math.max(...orders) + 10 : 10;
}

function publicShape(doc, type) {
  return {
    id: doc.id,
    type: doc.type,
    title: titleOf(type, doc.data),
    status: statusOf(doc),
    data: doc.data,
    published: doc.published,
    publishAt: doc.publishAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
    publishedAt: doc.publishedAt || null,
    publishedBy: doc.publishedBy || null,
    versionCount: (doc.versions || []).length,
  };
}

function list(type) {
  if (!RESOURCES[type]) throw new ContentError("Unknown resource", 404);
  return docsOf(type).map((d) => publicShape(d, type));
}

function get(type, id) {
  if (!RESOURCES[type]) throw new ContentError("Unknown resource", 404);
  return publicShape(mustFind(type, id), type);
}

function validated(type, input) {
  const { value, errors } = validateResource(type, input, ctx());
  if (errors.length) throw new ContentError("Please fix the highlighted fields.", 422, errors);
  return value;
}

function create(type, input, user) {
  const spec = RESOURCES[type];
  if (!spec || spec.kind !== "collection") throw new ContentError("Unknown collection", 404);
  const merged = Object.assign({}, spec.defaults || {}, input || {});
  if (spec.ordered && (merged.order === undefined || merged.order === null || merged.order === "")) merged.order = nextOrder(type);
  const data = validated(type, merged);

  let id;
  if (type === "domains") {
    const base = slugify(data.name);
    id = base;
    let i = 2;
    while (find(type, id)) id = `${base}-${i++}`;
  } else {
    do { id = db.id(5); } while (find(type, id));
  }

  const doc = {
    id, type, data, published: null, deleted: false, publishAt: null,
    createdAt: now(), updatedAt: now(), updatedBy: user ? user.username : "system",
    versions: [],
  };
  db.data.docs.push(doc);
  db.save();
  return publicShape(doc, type);
}

function update(type, id, input, user, ifMatch) {
  const doc = mustFind(type, id);
  if (doc.deleted) throw new ContentError("This item is queued for deletion. Discard the deletion first.", 409);
  if (ifMatch && ifMatch !== doc.updatedAt) {
    throw new ContentError(
      `This ${RESOURCES[type].singular || "item"} was changed by ${doc.updatedBy} while you were editing. Reload to see their changes.`,
      409
    );
  }
  doc.data = validated(type, input);
  doc.updatedAt = now();
  doc.updatedBy = user ? user.username : "system";
  db.save();
  return publicShape(doc, type);
}

function referencesTo(type, id) {
  if (type !== "domains") return [];
  return docsOf("projects").filter((p) => !p.deleted && p.data.domain === id);
}

function remove(type, id, user) {
  const spec = RESOURCES[type];
  if (!spec || spec.kind !== "collection") throw new ContentError("Cannot delete this item", 400);
  const doc = mustFind(type, id);
  const refs = referencesTo(type, id);
  if (refs.length) {
    throw new ContentError(
      `${refs.length} project${refs.length > 1 ? "s use" : " uses"} this domain. Move or delete ${refs.length > 1 ? "them" : "it"} first.`,
      409
    );
  }
  if (!doc.published) {
    db.data.docs.splice(db.data.docs.indexOf(doc), 1);
    db.save();
    return { removed: true, immediate: true };
  }
  doc.deleted = true;
  doc.publishAt = null;
  doc.updatedAt = now();
  doc.updatedBy = user ? user.username : "system";
  db.save();
  return { removed: true, immediate: false, item: publicShape(doc, type) };
}

function discard(type, id, user) {
  const doc = mustFind(type, id);
  if (!doc.published) {
    db.data.docs.splice(db.data.docs.indexOf(doc), 1);
    db.save();
    return { removed: true };
  }
  doc.data = clone(doc.published);
  doc.deleted = false;
  doc.publishAt = null;
  doc.updatedAt = now();
  doc.updatedBy = user ? user.username : "system";
  db.save();
  return { item: publicShape(doc, type) };
}

function publishDoc(doc, user) {
  const type = doc.type;
  if (doc.deleted) {
    db.data.docs.splice(db.data.docs.indexOf(doc), 1);
    return { removed: true };
  }
  // Re-validate so a bad draft can never reach the live site.
  const data = validated(type, doc.data);
  if (type === "projects" && data.domain) {
    const dom = find("domains", data.domain);
    if (!dom || !dom.published) {
      throw new ContentError(`Publish the domain “${dom ? titleOf("domains", dom.data) : data.domain}” first — this project belongs to it.`, 409);
    }
  }
  doc.data = data;
  doc.published = clone(data);
  doc.publishedAt = now();
  doc.publishedBy = user ? user.username : "system";
  doc.publishAt = null;
  doc.versions = doc.versions || [];
  doc.versions.push({ at: doc.publishedAt, by: doc.publishedBy, data: clone(data) });
  if (doc.versions.length > MAX_VERSIONS) doc.versions.splice(0, doc.versions.length - MAX_VERSIONS);
  return { item: publicShape(doc, type) };
}

function publish(type, id, user) {
  const doc = mustFind(type, id);
  const result = publishDoc(doc, user);
  db.save();
  hooks.onPublish();
  return result;
}

function publishAll(user, allowedFilter) {
  const allow = allowedFilter || (() => true);
  const published = [];
  const failed = [];
  const pendingDocs = db.data.docs
    .filter((d) => isPending(d) && allow(d.type))
    .sort((a, b) => PUBLISH_ORDER.indexOf(a.type) - PUBLISH_ORDER.indexOf(b.type));
  for (const doc of pendingDocs) {
    try {
      const title = titleOf(doc.type, doc.data);
      publishDoc(doc, user);
      published.push({ type: doc.type, id: doc.id, title });
    } catch (err) {
      failed.push({ type: doc.type, id: doc.id, title: titleOf(doc.type, doc.data), error: err.message });
    }
  }
  db.save();
  if (published.length) hooks.onPublish();
  return { published, failed };
}

function schedule(type, id, iso, user) {
  const doc = mustFind(type, id);
  if (doc.deleted) throw new ContentError("Deletions can't be scheduled.", 400);
  if (iso) {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) throw new ContentError("Invalid date", 422);
    if (when.getTime() < Date.now() - 60000) throw new ContentError("Pick a time in the future.", 422);
    doc.publishAt = when.toISOString();
  } else {
    doc.publishAt = null;
  }
  doc.updatedAt = now();
  doc.updatedBy = user ? user.username : "system";
  db.save();
  return publicShape(doc, type);
}

/** Publish anything whose scheduled time has arrived. Returns how many. */
function runScheduled() {
  const due = db.data.docs.filter((d) => d.publishAt && new Date(d.publishAt).getTime() <= Date.now() && !d.deleted);
  const done = [];
  for (const doc of due.sort((a, b) => PUBLISH_ORDER.indexOf(a.type) - PUBLISH_ORDER.indexOf(b.type))) {
    try {
      publishDoc(doc, null);
      done.push({ type: doc.type, id: doc.id, title: titleOf(doc.type, doc.data) });
    } catch (err) {
      doc.publishAt = null; // don't retry a failing schedule forever
      done.push({ type: doc.type, id: doc.id, error: err.message });
    }
  }
  if (done.length) {
    db.save();
    hooks.onPublish();
  }
  return done;
}

function versions(type, id) {
  const doc = mustFind(type, id);
  return (doc.versions || []).map((v, index) => ({ index, at: v.at, by: v.by, data: v.data })).reverse();
}

function restoreVersion(type, id, index, user, publishNow) {
  const doc = mustFind(type, id);
  const v = (doc.versions || [])[index];
  if (!v) throw new ContentError("Version not found", 404);
  doc.data = validated(type, clone(v.data));
  doc.deleted = false;
  doc.updatedAt = now();
  doc.updatedBy = user ? user.username : "system";
  if (publishNow) {
    publishDoc(doc, user);
    db.save();
    hooks.onPublish();
  } else {
    db.save();
  }
  return publicShape(doc, type);
}

function reorder(type, ids, user) {
  const spec = RESOURCES[type];
  if (!spec || !spec.ordered) throw new ContentError("This collection isn't ordered.", 400);
  if (!Array.isArray(ids)) throw new ContentError("ids must be a list", 422);
  let position = 10;
  for (const id of ids) {
    const doc = find(type, id);
    if (!doc || doc.deleted) continue;
    if (doc.data.order !== position) {
      doc.data.order = position;
      doc.updatedAt = now();
      doc.updatedBy = user ? user.username : "system";
    }
    position += 10;
  }
  db.save();
  return list(type);
}

/* ------------------------------------------------------------------ */
/* Public/preview snapshots                                            */
/* ------------------------------------------------------------------ */

function byOrder(a, b) {
  return (Number(a.order) || 0) - (Number(b.order) || 0);
}

/**
 * Assemble everything the renderer needs. mode "published" is the live site;
 * mode "draft" is what the admin preview shows (drafts, minus queued deletes).
 */
function snapshot(mode = "published") {
  const draft = mode === "draft";
  const pick = (doc) => (draft ? (doc.deleted ? null : doc.data) : doc.published);

  const out = {};
  for (const type of SINGLETONS) {
    const doc = find(type, type);
    out[type] = doc ? pick(doc) || doc.data : null;
  }
  for (const type of COLLECTIONS) {
    const items = [];
    for (const doc of docsOf(type)) {
      const d = pick(doc);
      if (d) items.push(Object.assign({ id: doc.id }, clone(d)));
    }
    if (RESOURCES[type].ordered) items.sort(byOrder);
    out[type] = items;
  }
  return out;
}

function pendingFor(user) {
  return db.data.docs
    .filter((d) => isPending(d) && canContent(user, d.type))
    .map((d) => ({ type: d.type, id: d.id, title: titleOf(d.type, d.data), status: statusOf(d), updatedAt: d.updatedAt, updatedBy: d.updatedBy, publishAt: d.publishAt || null }));
}

/** Where an image path is used (draft or live). */
function findImageUsage(imagePath) {
  const hits = [];
  for (const d of db.data.docs) {
    const inData = JSON.stringify(d.data).includes(JSON.stringify(imagePath));
    const inLive = d.published && JSON.stringify(d.published).includes(JSON.stringify(imagePath));
    if (inData || inLive) hits.push({ type: d.type, id: d.id, title: titleOf(d.type, d.data) });
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

function seedFile() {
  return path.join(config.SEED_DIR, "content.json");
}

/**
 * Install the bundled starting content (a copy of what the static site shows),
 * or another file in the same shape — e.g. site-content/content.json, the
 * published snapshot, which is how a hosted admin starts from the live site.
 */
function seedIfEmpty(file = seedFile()) {
  if (db.data.docs.length) return false;
  if (!fs.existsSync(file)) return false;
  const seed = JSON.parse(fs.readFileSync(file, "utf8"));
  const stamp = now();
  const add = (type, id, data) => {
    db.data.docs.push({
      id, type, data: clone(data), published: clone(data), deleted: false, publishAt: null,
      createdAt: stamp, updatedAt: stamp, updatedBy: "system", publishedAt: stamp, publishedBy: "system",
      versions: [{ at: stamp, by: "system", data: clone(data) }],
    });
  };
  for (const type of SINGLETONS) if (seed[type]) add(type, type, seed[type]);
  for (const type of COLLECTIONS) for (const item of seed[type] || []) {
    const { id, ...data } = item;
    add(type, id, data);
  }
  db.data.meta.seededAt = stamp;
  db.save();
  return true;
}

module.exports = {
  ContentError, hooks, list, get, create, update, remove, discard, publish, publishAll, schedule,
  runScheduled, versions, restoreVersion, reorder, snapshot, pendingFor, findImageUsage, seedIfEmpty,
  statusOf, isPending, find, docsOf, clone, same,
};
