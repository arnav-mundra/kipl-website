"use strict";

/**
 * Single source of truth for CMS content shapes. The same definitions drive:
 *   - server-side validation/sanitising (validate.js)
 *   - the admin panel's forms (served to the browser by /api/admin/schemas)
 *
 * Field types: string, text, number, boolean, select, ref, image, list, object.
 * A `list` has `of: "string" | "text" | "image"` (scalar items) or
 * `of: "object"` with `fields`. An `object` has nested `fields`.
 */

const s = (key, label, o = {}) => ({ key, label, type: "string", max: 200, ...o });
const t = (key, label, o = {}) => ({ key, label, type: "text", max: 4000, ...o });
const n = (key, label, o = {}) => ({ key, label, type: "number", ...o });
const b = (key, label, o = {}) => ({ key, label, type: "boolean", ...o });
const sel = (key, label, options, o = {}) => ({ key, label, type: "select", options, ...o });
const img = (key, label, o = {}) => ({ key, label, type: "image", ...o });
const ref = (key, label, to, o = {}) => ({ key, label, type: "ref", ref: to, ...o });
const list = (key, label, of, o = {}) => ({ key, label, type: "list", of, ...o });
const obj = (key, label, fields, o = {}) => ({ key, label, type: "object", fields, ...o });

const RESOURCES = {
  projects: {
    kind: "collection",
    label: "Projects",
    singular: "Project",
    titleTemplate: "{client} — {title}",
    listColumns: ["domain", "status", "valueCr", "yearStart", "visible"],
    help:
      "Each domain on the Projects page shows its visible projects, highest value first (then by priority), " +
      "up to the per-domain limit set under Site-wide. Tick Featured to put a project in the carousel and on Home.",
    fields: [
      s("client", "Client", { max: 80, placeholder: "e.g. Vedanta", help: "Optional — shown before the title as “Client — Title”." }),
      s("title", "Project title", { required: true, max: 120, placeholder: "e.g. Pot Room Operation" }),
      s("description", "Short description", { max: 200, help: "One line shown under the title in the list." }),
      ref("domain", "Domain", "domains", { required: true }),
      s("location", "Location", { required: true, max: 80, placeholder: "e.g. Jharsuguda, Odisha" }),
      sel("status", "Status", [
        { value: "active", label: "Active" },
        { value: "completed", label: "Completed" },
      ], { required: true, default: "active" }),
      n("valueCr", "Contract value (₹ Crore)", {
        min: 0, max: 100000, step: 0.01,
        help: "Leave blank if the value is variable. Values under 1 Cr display as Lakh automatically.",
      }),
      s("valueLabel", "Value text (when no value)", { max: 40, placeholder: "e.g. Variable", help: "Shown instead of a number when the value above is blank." }),
      n("yearStart", "Start year", { required: true, integer: true, min: 1990, max: 2100 }),
      n("yearEnd", "End year", { integer: true, min: 1990, max: 2100, help: "Leave blank for a single-year or open-ended contract." }),
      b("visible", "Show on website", { default: true }),
      n("priority", "Priority", { integer: true, min: -100, max: 100, default: 0, help: "Higher numbers list first within a domain (before value order)." }),
      b("featured", "Featured (carousel + Home)", { default: false }),
      n("featuredOrder", "Featured order", { integer: true, min: 0, max: 99, default: 0, help: "Lower numbers come first in the carousel." }),
      img("featuredImage", "Featured photo", { help: "Shown in the carousel and on Home when featured." }),
      t("featuredDescription", "Featured description", { max: 400 }),
    ],
    defaults: { status: "active", visible: true, priority: 0, featured: false, featuredOrder: 0 },
  },

  domains: {
    kind: "collection",
    label: "Services / domains",
    singular: "Domain",
    ordered: true,
    titleTemplate: "{name}",
    listColumns: ["showOnProjects"],
    help:
      "These power the Services page, the Home services tiles and the domain groups on the Projects page. " +
      "Order here sets the numbering (01, 02…) everywhere.",
    fields: [
      s("name", "Name", { required: true, max: 60 }),
      n("order", "Order", { integer: true, min: 0, max: 999, default: 0 }),
      t("lead", "Services page description", { required: true, max: 600, help: "The paragraph on the Services page card." }),
      list("bullets", "Services page bullet points", "string", { maxItems: 8, itemMax: 120 }),
      s("tileDescription", "Home tile description", { max: 220, help: "Short line on the Home page services grid." }),
      s("tagline", "Projects page tagline", { max: 80, help: "Shown beside the number on the Projects page, e.g. “Keeping critical operations running.”" }),
      img("servicesImage", "Services page photo"),
      img("tileImage", "Home tile photo"),
      img("bannerImage", "Projects page banner photo"),
      b("showOnProjects", "Show as a group on the Projects page", { default: true }),
    ],
    defaults: { order: 0, bullets: [], showOnProjects: true },
  },

  team: {
    kind: "collection",
    label: "Team members",
    singular: "Team member",
    ordered: true,
    titleTemplate: "{name}",
    listColumns: ["title", "tier", "visible"],
    help: "Leadership members appear as large cards with a bio; Heads of Department appear as smaller cards without a bio.",
    fields: [
      s("name", "Name", { required: true, max: 80 }),
      s("title", "Title / role", { required: true, max: 100 }),
      sel("tier", "Group", [
        { value: "leadership", label: "Leadership (large card with bio)" },
        { value: "hod", label: "Head of Department (small card)" },
      ], { required: true, default: "leadership" }),
      t("bio", "Bio", { max: 1200, help: "Shown on leadership cards only." }),
      img("photo", "Photo", { help: "Optional — without one a branded texture is shown." }),
      n("order", "Order", { integer: true, min: 0, max: 999, default: 0 }),
      b("visible", "Show on website", { default: true }),
    ],
    defaults: { tier: "leadership", order: 0, visible: true },
  },

  clients: {
    kind: "collection",
    label: "Client logos",
    singular: "Client",
    ordered: true,
    titleTemplate: "{name}",
    listColumns: ["visible"],
    help: "These are the logos in the scrolling marquee on the Home page.",
    fields: [
      s("name", "Client name", { required: true, max: 80, help: "Used as the logo's alt text." }),
      img("logo", "Logo", { required: true, purpose: "logo", help: "PNG with a transparent background works best." }),
      n("order", "Order", { integer: true, min: 0, max: 999, default: 0 }),
      b("visible", "Show on website", { default: true }),
    ],
    defaults: { order: 0, visible: true },
  },

  figures: {
    kind: "singleton",
    label: "Company figures",
    help:
      "Numbers used across Home, Services, Projects and About. The charts, the growth percentage, the workforce " +
      "and turnover callouts are all calculated from the year-by-year table below.",
    fields: [
      n("established", "Year established", { required: true, integer: true, min: 1900, max: 2100 }),
      n("yearsActive", "Years active (override)", { integer: true, min: 0, max: 200, help: "Leave blank to calculate automatically from the year established." }),
      n("fabricationCapacity", "Fabrication capacity (MT / month)", { required: true, integer: true, min: 0, max: 100000 }),
      n("totalProjects", "Total projects (active + completed)", { required: true, integer: true, min: 0, max: 100000, help: "Shown in the Projects and Services hero stats." }),
      list("series", "Year-by-year turnover & workforce", "object", {
        minItems: 2, maxItems: 8, itemLabel: "Year",
        help: "Oldest year first. The last row is treated as the current year.",
        fields: [
          s("label", "Financial year", { required: true, max: 12, placeholder: "FY25-26", pattern: "^FY\\d{2}-\\d{2}$", patternMsg: "Use the format FY25-26" }),
          n("turnover", "Turnover (₹ Cr)", { required: true, min: 0.01, max: 1000000, step: 0.01 }),
          n("workforce", "Workforce (people)", { required: true, integer: true, min: 1, max: 1000000 }),
        ],
      }),
    ],
  },

  people: {
    kind: "singleton",
    label: "MD's desk, mission & values",
    help: "The Managing Director's message, Mission & Vision text, and the four core values (shown on Home and About).",
    fields: [
      obj("md", "Managing Director", [
        s("name", "Name", { required: true, max: 80 }),
        s("title", "Title (About page)", { required: true, max: 100 }),
        s("teaserTitle", "Title (Home page)", { max: 100 }),
        img("photo", "Photo"),
        list("paragraphs", "Message paragraphs", "text", { minItems: 1, maxItems: 8, itemMax: 1500 }),
        s("signoff", "Sign-off line", { max: 160 }),
        t("teaserQuote", "Home page quote", { max: 400, help: "A short excerpt shown in the Home page leadership block." }),
      ]),
      t("vision", "Vision", { required: true, max: 600 }),
      t("mission", "Mission", { required: true, max: 600 }),
      list("coreValues", "Core values", "object", {
        minItems: 1, maxItems: 8, itemLabel: "Value",
        fields: [
          s("name", "Name", { required: true, max: 60 }),
          s("tagline", "Tagline", { required: true, max: 60, help: "e.g. “Integrity first”" }),
          s("lead", "Bold opening words", { required: true, max: 80, help: "e.g. “We believe”" }),
          t("text", "Rest of the sentence", { required: true, max: 500 }),
          img("image", "Photo"),
        ],
      }),
    ],
  },

  site: {
    kind: "singleton",
    label: "Site-wide settings",
    help: "Contact details and footer text appear on every page. Hero photos are shared by Home, About and Contact.",
    fields: [
      obj("contact", "Contact details", [
        list("addressLines", "Address (one line per row)", "string", { minItems: 1, maxItems: 5, itemMax: 100 }),
        s("phone", "Phone", { required: true, max: 30, placeholder: "+91 91784 70789" }),
        s("email", "Email", { required: true, max: 120, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", patternMsg: "Enter a valid email address" }),
        list("hoursLines", "Office hours (one line per row)", "string", { maxItems: 4, itemMax: 100 }),
        s("mapQuery", "Map search text", { max: 300, help: "What Google Maps should search for on the Contact page." }),
      ]),
      obj("footer", "Footer", [
        t("tagline", "Tagline", { required: true, max: 220 }),
        s("cin", "CIN", { max: 40 }),
        s("msme", "MSME / Udyam number", { max: 40 }),
      ]),
      obj("hero", "Hero", [
        s("eyebrow", "Home eyebrow", { max: 80 }),
        s("headline", "Home headline", { required: true, max: 200 }),
        t("lead", "Home intro text", { max: 400 }),
        list("images", "Slideshow photos", "image", { minItems: 1, maxItems: 10, help: "Shared by the Home, About and Contact hero slideshows." }),
      ]),
      obj("projectsPage", "Projects page", [
        n("maxPerDomain", "Projects shown per domain", { required: true, integer: true, min: 1, max: 12, default: 5 }),
      ]),
    ],
  },
};

const COLLECTIONS = Object.keys(RESOURCES).filter((k) => RESOURCES[k].kind === "collection");
const SINGLETONS = Object.keys(RESOURCES).filter((k) => RESOURCES[k].kind === "singleton");

module.exports = { RESOURCES, COLLECTIONS, SINGLETONS };
