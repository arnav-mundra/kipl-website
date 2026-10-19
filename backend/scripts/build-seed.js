"use strict";

/**
 * One-off generator for backend/seed/content.json.
 *
 * It reads the static pages in frontend/ and extracts today's content (domains,
 * team, clients, figures, projects, contact details…) so the CMS starts out
 * showing exactly what the site shows now. The output is committed, so a
 * normal install never needs to run this — only re-run it if you want to
 * regenerate the starting content from the static pages.
 *
 *   node scripts/build-seed.js
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const config = require("../src/config");
const { validateResource } = require("../src/validate");

const read = (f) => cheerio.load(fs.readFileSync(path.join(config.FRONTEND_DIR, f), "utf8"));
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const bgImage = (style) => {
  const m = /url\(['"]?([^'")]+)['"]?\)/.exec(style || "");
  return m ? m[1] : "";
};
const linesOf = ($el) =>
  ($el.html() || "")
    .split(/<br\s*\/?>/i)
    .map((h) => norm(cheerio.load("<p>" + h + "</p>")("p").text()))
    .filter(Boolean);

const home = read("index.html");
const services = read("services.html");
const projectsPage = read("projects.html");
const about = read("about.html");
const contact = read("contact.html");

/* ---------------- domains ---------------- */

const DOMAIN_KEY = {
  om: "operation-maintenance",
  execution: "project-execution",
  handling: "material-handling",
  mining: "mining-logistics",
  cleaning: "mechanised-cleaning",
};

const domains = [];
services(".service-card").each((i, el) => {
  const $c = services(el);
  const id = $c.attr("id");
  const $tile = home(`.service-tile a[href="services.html#${id}"]`);
  const groupKey = Object.keys(DOMAIN_KEY).find((k) => DOMAIN_KEY[k] === id);
  const $group = groupKey ? projectsPage(`.domain-group[data-domain="${groupKey}"]`) : null;
  domains.push({
    id,
    name: norm($c.find(".service-card__title").text()),
    order: (i + 1) * 10,
    lead: norm($c.find(".service-card__lead").text()),
    bullets: $c.find(".service-card__list li").map((_, li) => norm(services(li).text())).get(),
    tileDescription: norm($tile.find(".service-tile__desc").text()),
    tagline: $group && $group.length ? norm($group.find(".domain-group__heading p").text()) : "",
    servicesImage: bgImage($c.find(".service-card__media").attr("style")),
    tileImage: bgImage($tile.find(".service-tile__media").attr("style")),
    bannerImage: $group && $group.length ? $group.find(".domain-group__banner img").attr("src") : "",
    showOnProjects: !!($group && $group.length),
  });
});

/* ---------------- projects ---------------- */

function parseValue(text) {
  const t = norm(text).replace("₹", "");
  if (/lakh/i.test(t)) return { valueCr: Math.round(parseFloat(t) ) / 100, valueLabel: "" };
  const m = /([\d.,]+)\s*Cr/i.exec(t);
  if (m) return { valueCr: parseFloat(m[1].replace(/,/g, "")), valueLabel: "" };
  return { valueCr: null, valueLabel: norm(t) };
}

function parseYears(text) {
  const t = norm(text).replace(/[–—-]/g, "-");
  const m = /^(\d{4})(?:-(\d{2,4}))?$/.exec(t);
  if (!m) return { yearStart: new Date().getFullYear(), yearEnd: null };
  const start = parseInt(m[1], 10);
  let end = null;
  if (m[2]) end = m[2].length === 2 ? Math.floor(start / 100) * 100 + parseInt(m[2], 10) : parseInt(m[2], 10);
  return { yearStart: start, yearEnd: end };
}

function splitTitle(full) {
  const i = full.indexOf(" — ");
  return i < 0 ? { client: "", title: full } : { client: full.slice(0, i), title: full.slice(i + 3) };
}

const projects = [];
const addProject = (p) => {
  projects.push(Object.assign({
    id: "p" + String(projects.length + 1).padStart(2, "0"),
    client: "", title: "", description: "", domain: "", location: "", status: "active",
    valueCr: null, valueLabel: "", yearStart: 2025, yearEnd: null,
    visible: true, priority: 0, featured: false, featuredOrder: 0, featuredImage: "", featuredDescription: "",
  }, p));
};

projectsPage(".domain-row").each((_, el) => {
  const $r = projectsPage(el);
  const key = $r.closest(".domain-group").attr("data-domain");
  const { client, title } = splitTitle($r.attr("data-title"));
  addProject(Object.assign({
    client, title,
    description: norm($r.find(".domain-row__desc").text()),
    domain: DOMAIN_KEY[key],
    location: norm($r.find(".domain-row__location").text()),
    status: $r.attr("data-status") || "active",
  }, parseValue($r.find(".domain-row__value").text()), parseYears($r.find(".domain-row__year").text())));
});

// Projects that exist but don't currently show on the page (outside the
// top-5-per-domain cap, or completed). Imported hidden so nothing on the live
// page changes; switch "Show on website" on in the admin to bring them back.
[
  { client: "Balco", title: "Pot Room Operation Support", domain: "operation-maintenance", location: "Korba, Chhattisgarh", status: "active", valueCr: 4.48, yearStart: 2025, yearEnd: 2028 },
  { client: "Balco", title: "Green Anode Plant Operation", domain: "operation-maintenance", location: "Korba, Chhattisgarh", status: "active", valueCr: 2.34, yearStart: 2023, yearEnd: 2027 },
  { client: "Vedanta", title: "Carbon Area Operations", domain: "operation-maintenance", location: "Jharsuguda, Odisha", status: "completed", valueCr: 42.8, yearStart: 2019, yearEnd: 2022 },
  { client: "Balco", title: "Carbon Area Operation", domain: "operation-maintenance", location: "Korba, Chhattisgarh", status: "completed", valueCr: 4.24, yearStart: 2021, yearEnd: 2024 },
  { client: "Balco", title: "Potline 1 & 2 Operation", domain: "operation-maintenance", location: "Korba, Chhattisgarh", status: "completed", valueCr: 4.24, yearStart: 2021, yearEnd: 2024 },
  { client: "Tata Steel", title: "Mechanised Housekeeping", domain: "mechanised-cleaning", location: "Angul, Odisha", status: "completed", valueCr: 30.2, yearStart: 2021, yearEnd: 2024 },
  { client: "Dilip Buildcon", title: "Admin Building Construction", domain: "project-execution", location: "Sundargarh, Odisha", status: "completed", valueCr: 1.12, yearStart: 2024, yearEnd: 2025 },
  { client: "Simar Infra", title: "FGD Fabrication & Erection", domain: "project-execution", location: "Belpahar, Odisha", status: "completed", valueCr: 0.9, yearStart: 2022, yearEnd: 2023 },
  { client: "McNally Bharat", title: "Hopper Fabrication (CHP)", domain: "project-execution", location: "Sundargarh, Odisha", status: "completed", valueCr: 0.85, yearStart: 2019, yearEnd: 2021 },
].forEach((p) => addProject(Object.assign({ visible: false }, p)));

// Featured carousel slides: match each slide to its project by client + title.
projectsPage("[data-featured-slide]").each((i, el) => {
  const $s = projectsPage(el);
  const full = norm($s.find("h2").text());
  const { client, title } = splitTitle(full);
  const proj = projects.find((p) => p.client === client && p.title === title);
  if (!proj) throw new Error("Featured project not found in list: " + full);
  proj.featured = true;
  proj.featuredOrder = i + 1;
  proj.featuredDescription = norm($s.find(".featured__desc").text());
  proj.featuredImage = bgImage($s.find(".featured__media").attr("style"));
});

/* ---------------- team ---------------- */

const team = [];
about(".team-card").each((i, el) => {
  const $c = about(el);
  team.push({
    id: "t" + String(team.length + 1).padStart(2, "0"),
    name: norm($c.find(".team-card__name").text()),
    title: norm($c.find(".team-card__title").text()),
    tier: "leadership",
    bio: norm($c.find(".team-card__bio").text()),
    photo: bgImage($c.find(".team-card__photo").attr("style")),
    order: (team.length + 1) * 10,
    visible: true,
  });
});
about(".hod-card").each((i, el) => {
  const $c = about(el);
  team.push({
    id: "t" + String(team.length + 1).padStart(2, "0"),
    name: norm($c.find(".hod-card__name").text()),
    title: norm($c.find(".hod-card__title").text()),
    tier: "hod",
    bio: "",
    photo: bgImage($c.find(".hod-card__photo").attr("style")),
    order: (team.length + 1) * 10,
    visible: true,
  });
});

/* ---------------- clients ---------------- */

const clients = [];
home("#marqueeTrack img.marquee__logo:not([aria-hidden])").each((i, el) => {
  const $i = home(el);
  clients.push({
    id: "c" + String(i + 1).padStart(2, "0"),
    name: norm($i.attr("alt")),
    logo: $i.attr("src"),
    order: (i + 1) * 10,
    visible: true,
  });
});

/* ---------------- figures ---------------- */

const series = about(".milestone-bar__hit")
  .map((_, el) => {
    const $h = about(el);
    return {
      label: $h.attr("data-year"),
      turnover: parseFloat(norm($h.attr("data-turnover")).replace(/[^\d.]/g, "")),
      workforce: parseInt($h.attr("data-manpower").replace(/,/g, ""), 10),
    };
  })
  .get();

const figures = {
  established: 2009,
  yearsActive: null,
  fabricationCapacity: parseInt(home('[data-counter-to="200"]').attr("data-counter-to"), 10) || 200,
  totalProjects: parseInt(norm(projectsPage(".projects-hero__stat").last().find(".projects-hero__stat-value").text()), 10) || 22,
  series,
};

/* ---------------- people ---------------- */

const mdParas = about(".md-desk__bio p:not(.md-desk__signoff)").map((_, el) => norm(about(el).text())).get();
const coreValues = [];
home(".values .mosaic-row").each((_, el) => {
  const $r = home(el);
  const lead = norm($r.find(".mosaic-row__desc strong").text());
  const full = norm($r.find(".mosaic-row__desc").text());
  coreValues.push({
    name: norm($r.find(".mosaic-row__name").text()),
    tagline: norm($r.find(".mosaic-row__detail .eyebrow").text()),
    lead,
    text: full.startsWith(lead) ? full.slice(lead.length).trim() : full,
    image: bgImage($r.find(".mosaic-row__panel").attr("style")),
  });
});

const people = {
  md: {
    name: norm(about(".md-desk__name").text()),
    title: norm(about(".md-desk__title").text()),
    teaserTitle: norm(home(".leadership-teaser__title").text()),
    photo: bgImage(about(".md-desk__portrait").attr("style")),
    paragraphs: mdParas,
    signoff: norm(about(".md-desk__signoff").text()),
    teaserQuote: norm(home(".leadership-teaser__quote").text()),
  },
  vision: norm(about(".mission-card").eq(0).find("p").text()),
  mission: norm(about(".mission-card").eq(1).find("p").text()),
  coreValues,
};

/* ---------------- site ---------------- */

const mapSrc = contact(".contact-map iframe").attr("src") || "";
const mapQuery = decodeURIComponent((/[?&]q=([^&]+)/.exec(mapSrc) || [, ""])[1]).replace(/\+/g, " ");
const bottom = norm(home(".footer__bottom span").last().text());

const site = {
  contact: {
    addressLines: linesOf(home(".footer__contact li").eq(0)),
    phone: norm(home(".footer__contact li").eq(1).text()),
    email: norm(home(".footer__contact li").eq(2).text()),
    hoursLines: linesOf(contact(".contact-info__item").eq(3).find(".contact-info__value")),
    mapQuery,
  },
  footer: {
    tagline: norm(home(".footer__tagline").text()),
    cin: ((/CIN:\s*([A-Z0-9]+)/.exec(bottom)) || [, ""])[1],
    msme: ((/MSME:\s*([A-Z0-9-]+)/.exec(bottom)) || [, ""])[1],
  },
  hero: {
    eyebrow: norm(home(".hero--home .eyebrow").text()),
    headline: norm(home(".hero--home h1").text()),
    lead: norm(home(".hero--home .hero__lead").text()),
    images: (home("[data-hero-slideshow]").attr("data-hero-images") || "").split(",").map((s) => s.trim()).filter(Boolean),
  },
  projectsPage: { maxPerDomain: 5 },
};

/* ---------------- validate + write ---------------- */

const seed = { site, figures, people, domains, projects, team, clients };

const known = { domains: new Set(domains.map((d) => d.id)) };
const ctx = { refExists: (type, id) => (type === "domains" ? known.domains.has(id) : true) };

let bad = 0;
for (const type of ["site", "figures", "people"]) {
  const { errors } = validateResource(type, seed[type], ctx);
  errors.forEach((e) => { bad++; console.error(`[${type}] ${e.path}: ${e.message}`); });
}
for (const type of ["domains", "projects", "team", "clients"]) {
  seed[type].forEach((item) => {
    const { id, ...data } = item;
    const { errors } = validateResource(type, data, ctx);
    errors.forEach((e) => { bad++; console.error(`[${type}/${id}] ${e.path}: ${e.message}`); });
  });
}
if (bad) { console.error(`\n${bad} validation problem(s) — not writing seed.`); process.exit(1); }

fs.mkdirSync(config.SEED_DIR, { recursive: true });
fs.writeFileSync(path.join(config.SEED_DIR, "content.json"), JSON.stringify(seed, null, 2) + "\n");
console.log(
  `Wrote seed/content.json — ${domains.length} domains, ${projects.length} projects ` +
  `(${projects.filter((p) => p.visible).length} visible, ${projects.filter((p) => p.featured).length} featured), ` +
  `${team.length} team, ${clients.length} clients, ${series.length} years of figures.`
);
