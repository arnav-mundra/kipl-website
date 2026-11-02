"use strict";

const { RESOURCES } = require("./schemas");

const ALL_CONTENT = Object.keys(RESOURCES);

/**
 * Role → what it may do.
 *   content: content resources it may edit and publish
 *   media:   upload / browse the media library
 *   enquiries: read and manage contact-form enquiries
 *   applications: read and manage job applications from the Careers page
 *   admin:   users, audit log, backups/restore
 */
const ROLES = {
  owner: {
    label: "Owner",
    description: "Full access, including users, audit log and backups.",
    content: ALL_CONTENT,
    media: true,
    enquiries: true,
    applications: true,
    admin: true,
  },
  editor: {
    label: "Editor",
    description: "Edits and publishes all website content, manages media and enquiries.",
    content: ALL_CONTENT,
    media: true,
    enquiries: true,
    applications: false,
    admin: false,
  },
  hr: {
    label: "HR",
    description: "Manages team members, uploads photos and handles job applications.",
    content: ["team"],
    media: true,
    enquiries: false,
    applications: true,
    admin: false,
  },
};

function roleOf(user) {
  return user && ROLES[user.role] ? ROLES[user.role] : null;
}

function canContent(user, type) {
  const r = roleOf(user);
  return !!r && r.content.includes(type);
}

function can(user, capability) {
  const r = roleOf(user);
  return !!r && !!r[capability];
}

function summary(user) {
  const r = roleOf(user);
  if (!r) return null;
  return { role: user.role, label: r.label, content: r.content, media: r.media, enquiries: r.enquiries, applications: r.applications, admin: r.admin };
}

module.exports = { ROLES, canContent, can, summary };
