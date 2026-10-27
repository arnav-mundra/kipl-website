"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { boot, client, A, content, projectPayload } = require("./helpers");

let ctx;
let owner;
let site; // anonymous visitor

before(async () => {
  ctx = await boot();
  owner = client(ctx.base);
  await owner.login("owner");
  site = client(ctx.base);
});
after(() => ctx.server.close());

const page = async (file) => (await site.raw("GET", "/" + file)).data;

// Page-level assertions that report the pattern, not 40 KB of HTML, on failure.
const has = (html, re, msg) => assert.ok(re.test(html), `${msg || "expected page to match"}: ${re}`);
const lacks = (html, re, msg) => assert.ok(!re.test(html), `${msg || "expected page NOT to match"}: ${re}`);

test("public pages render from the seeded content", async () => {
  const projects = await page("projects");
  has(projects, /Vedanta — Pot Room Operation/);
  has(projects, /₹34\.40 Cr/);
  has(projects, /data-domain="operation-maintenance"/);
  lacks(projects, /Carbon Area Operations/, "hidden projects must not appear");

  const home = await page("");
  has(home, /Engineering reliability into every shift/);
  has(home, /data-counter-to="178"/, "growth percentage is computed from the series");

  const services = await page("services");
  has(services, /id="mechanised-cleaning"/);
  has(await page("about"), /Jyotirmoy Patel/);
  has(await page("contact"), /info@kipl\.co/);
});

test("pages live at clean addresses; old .html links redirect there", async () => {
  for (const [from, to] of [["/projects.html", "/projects"], ["/index.html", "/"], ["/about.html?x=1", "/about?x=1"]]) {
    const r = await site.raw("GET", from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get("location"), to, from);
  }
  assert.equal((await site.raw("GET", "/index")).status, 404, "home only lives at /");
  has(await page(""), /href="\/services"/, "nav links use clean addresses");
  assert.equal((await owner.raw("GET", "/preview/projects")).status, 200, "preview accepts clean names too");
});

test("raw page sources and drafts folders are never served as files", async () => {
  assert.equal((await site.raw("GET", "/draft/kipl-homepage-concept-v1.html")).status, 404);
  assert.equal((await site.raw("GET", "/INDEX.HTML")).status, 404);
  assert.equal((await site.raw("GET", "/db.json")).status, 404);
});

test("an edit is a draft until published, and the preview shows it", async () => {
  const { data } = await owner.post(`${A}/content/projects`, projectPayload({ client: "Acme", title: "Draft Only", priority: 90 }));
  const id = data.item.id;
  assert.equal(data.item.status, "new");

  lacks(await page("projects"), /Draft Only/);
  const preview = await owner.raw("GET", "/preview/projects.html");
  has(preview.data, /Draft Only/);
  has(preview.data, /Draft preview — not live/);
  has(preview.data, /<base href="\/">/);

  const pub = await owner.post(`${A}/content/projects/${id}/publish`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.item.status, "live");
  has(await page("projects"), /Acme — Draft Only/);

  // Editing again leaves the live copy alone.
  const edit = await owner.put(`${A}/content/projects/${id}`, { data: projectPayload({ client: "Acme", title: "Renamed", priority: 90 }) });
  assert.equal(edit.data.item.status, "changed");
  has(await page("projects"), /Draft Only/);
  lacks(await page("projects"), /Renamed/);

  // Discard returns the draft to what's live.
  const discard = await owner.post(`${A}/content/projects/${id}/discard`);
  assert.equal(discard.data.item.data.title, "Draft Only");
});

test("preview requires a signed-in user", async () => {
  const anon = await site.raw("GET", "/preview/index.html");
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get("location"), "/admin/");
});

test("deleting a live item takes effect only on publish", async () => {
  const { data } = await owner.post(`${A}/content/projects`, projectPayload({ title: "Short Lived", priority: 90 }));
  const id = data.item.id;
  await owner.post(`${A}/content/projects/${id}/publish`);
  const del = await owner.del(`${A}/content/projects/${id}`);
  assert.equal(del.data.immediate, false);
  has(await page("projects"), /Short Lived/, "still live until published");
  const pub = await owner.post(`${A}/content/projects/${id}/publish`);
  assert.equal(pub.data.removed, true);
  lacks(await page("projects"), /Short Lived/);
  assert.equal((await owner.get(`${A}/content/projects/${id}`)).status, 404);

  // An unpublished draft is simply removed.
  const d2 = await owner.post(`${A}/content/projects`, projectPayload({ title: "Never Live" }));
  const del2 = await owner.del(`${A}/content/projects/${d2.data.item.id}`);
  assert.equal(del2.data.immediate, true);
});

test("validation errors are reported per field path", async () => {
  const bad = await owner.post(`${A}/content/projects`, { title: "", domain: "nope", yearStart: 1800, status: "weird" });
  assert.equal(bad.status, 422);
  const paths = bad.data.details.map((d) => d.path);
  for (const p of ["title", "domain", "yearStart", "status", "location"]) assert.ok(paths.includes(p), `expected an error for ${p}`);

  const figures = (await owner.get(`${A}/content/figures/figures`)).data.item;
  const broken = JSON.parse(JSON.stringify(figures.data));
  broken.series[1].turnover = "abc";
  broken.series[2].label = "2024";
  const res = await owner.put(`${A}/content/figures/figures`, { data: broken });
  assert.equal(res.status, 422);
  const fp = res.data.details.map((d) => d.path);
  assert.ok(fp.includes("series[1].turnover"));
  assert.ok(fp.includes("series[2].label"));
});

test("images must be library paths (no traversal, no remote URLs)", async () => {
  for (const evil of ["../../etc/passwd.png", "https://evil.example/x.png", "assets/../secrets.jpg", "javascript:alert(1)"]) {
    const res = await owner.post(`${A}/content/projects`, projectPayload({ featured: true, featuredImage: evil }));
    assert.equal(res.status, 422, evil);
  }
});

test("a domain can't be deleted while projects use it, and projects need a published domain", async () => {
  const blocked = await owner.del(`${A}/content/domains/operation-maintenance`);
  assert.equal(blocked.status, 409);

  const dom = await owner.post(`${A}/content/domains`, { name: "Test Domain", lead: "Lead text", bullets: ["One"] });
  assert.equal(dom.data.item.id, "test-domain");
  const proj = await owner.post(`${A}/content/projects`, projectPayload({ domain: "test-domain", title: "In New Domain" }));
  const early = await owner.post(`${A}/content/projects/${proj.data.item.id}/publish`);
  assert.equal(early.status, 409, "project can't go live before its domain does");

  const all = await owner.post(`${A}/publish-all`);
  assert.deepEqual(all.data.failed, []);
  const services = await page("services");
  has(services, /id="test-domain"/);
  has(services, /<li>One<\/li>/);
  has(await page("projects"), /data-domain="test-domain"/);
  has(await page(""), /\/services#test-domain/);
});

test("projects: sorted by priority then value, capped per domain, featured drives the carousel", async () => {
  const ids = [];
  for (const [title, valueCr, priority] of [["Cap A", 1, 0], ["Cap B", 5, 0], ["Cap C", 3, 0], ["Cap D", 0.5, 50]]) {
    const r = await owner.post(`${A}/content/projects`, projectPayload({ domain: "material-handling", client: "Cap", title, valueCr, priority }));
    ids.push(r.data.item.id);
  }
  const siteDoc = (await owner.get(`${A}/content/site/site`)).data.item.data;
  siteDoc.projectsPage.maxPerDomain = 3;
  await owner.put(`${A}/content/site/site`, { data: siteDoc });
  await owner.post(`${A}/publish-all`);

  const html = await page("projects");
  const group = html.split('data-domain="material-handling"')[1].split('data-domain="')[0];
  const order = [...group.matchAll(/domain-row__title">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ["Cap — Cap D", "Tata Steel — Crane Hire", "Cap — Cap B"], "priority first, then value; capped at 3");
  has(html, /data-project-count/);

  // Feature one project: it joins the carousel and the Home teaser.
  const feat = await owner.put(`${A}/content/projects/${ids[1]}`, { data: projectPayload({ domain: "material-handling", client: "Cap", title: "Cap B", valueCr: 5, featured: true, featuredOrder: 0, featuredDescription: "Carousel text", featuredImage: "assets/images/projects/vedanta-pot-room.jpg" }) });
  assert.equal(feat.status, 200);
  await owner.post(`${A}/publish-all`);
  const html2 = await page("projects");
  assert.equal((html2.match(/data-featured-slide/g) || []).length, 3);
  has(html2, /Carousel text/);
  has(html2, /<span data-featured-counter="">1<\/span> \/ 3/);
  has(await page(""), /project-teaser__title">Cap B</);
});

test("with no featured projects the carousel and home teasers disappear", async () => {
  const list = (await owner.get(`${A}/content/projects`)).data.items;
  for (const it of list.filter((i) => i.data.featured)) {
    await owner.put(`${A}/content/projects/${it.id}`, { data: Object.assign({}, it.data, { featured: false }) });
  }
  await owner.post(`${A}/publish-all`);
  lacks(await page("projects"), /data-featured-carousel/);
  lacks(await page(""), /project-teasers/);
});

test("company figures drive every chart and headline number", async () => {
  const fig = (await owner.get(`${A}/content/figures/figures`)).data.item.data;
  fig.series[fig.series.length - 1].turnover = 200;
  fig.series[fig.series.length - 1].workforce = 2000;
  fig.totalProjects = 30;
  fig.fabricationCapacity = 250;
  await owner.put(`${A}/content/figures/figures`, { data: fig });
  await owner.post(`${A}/publish-all`);

  const home = await page("");
  has(home, /data-counter-to="451"/, "(200-36.27)/36.27 ≈ 451.4 → 451%");
  has(home, /₹200 Cr/);
  has(home, /data-counter-to="250"/);
  const about = await page("about");
  has(about, /2,000 today/);
  has(about, /data-turnover="₹200 Cr"/);
  const projects = await page("projects");
  has(projects, />30</, "total projects stat");
  has(projects, /more than doubled|more than tripled|grown by/);
  const services = await page("services");
  has(services, /30 active and completed/);
  has(services, /~250 MT\/month/);
});

test("people: MD message, mission/vision and core values", async () => {
  const people = (await owner.get(`${A}/content/people/people`)).data.item.data;
  people.vision = "A brand new vision statement.";
  people.md.paragraphs = ["First paragraph.", "Second paragraph."];
  people.coreValues.push({ name: "Innovation", tagline: "Always improving", lead: "We invest", text: "in better ways of working.", image: "" });
  const r = await owner.put(`${A}/content/people/people`, { data: people });
  assert.equal(r.status, 200);
  await owner.post(`${A}/publish-all`);
  const about = await page("about");
  has(about, /A brand new vision statement\./);
  has(about, /<p>First paragraph\.<\/p>/);
  has(about, /Always improving\./);
  const home = await page("");
  has(home, /<strong>We invest<\/strong> in better ways of working\./);
  assert.equal((home.match(/class="mosaic-row"/g) || []).length, 5);
});

test("team and client logos: visibility and ordering", async () => {
  const t = await owner.post(`${A}/content/team`, { name: "Zed Newhire", title: "Chief Tester", tier: "leadership", bio: "Tests things.", visible: true });
  const hidden = await owner.post(`${A}/content/team`, { name: "Hidden Person", title: "Ghost", tier: "hod", visible: false });
  await owner.post(`${A}/publish-all`);
  let about = await page("about");
  has(about, /Zed Newhire/);
  lacks(about, /Hidden Person/);

  const items = (await owner.get(`${A}/content/team`)).data.items;
  const ids = items.map((i) => i.id);
  await owner.post(`${A}/content/team/reorder`, { ids: [t.data.item.id, ...ids.filter((x) => x !== t.data.item.id)] });
  await owner.post(`${A}/publish-all`);
  about = await page("about");
  assert.ok(about.indexOf('team-card__name">Zed Newhire') < about.indexOf('team-card__name">Somnath Naik'), "reordered to the front");
  assert.ok(hidden.data.item.id);

  const c = await owner.post(`${A}/content/clients`, { name: "Brand New Client", logo: "assets/images/logos/jsw.png", visible: true });
  await owner.post(`${A}/publish-all`);
  const home = await page("");
  has(home, /alt="Brand New Client"/);
  assert.equal((home.match(/alt="Brand New Client"/g) || []).length, 1, "duplicate loop copy has an empty alt");
  assert.ok(c.data.item.id);
});

test("site-wide settings update the footer on every page, the contact page and JSON-LD", async () => {
  const s = (await owner.get(`${A}/content/site/site`)).data.item.data;
  s.contact.phone = "+91 99999 11111";
  s.contact.email = "hello@kipl.co";
  s.contact.addressLines = ["1 New Road", "Jharsuguda", "Odisha – 768203"];
  s.contact.hoursLines = ["Mon–Fri: 10 – 5"];
  s.contact.mapQuery = "KIPL New Office";
  s.footer.cin = "CIN-TEST-1";
  s.hero.headline = "A fresh headline for the home page.";
  s.hero.images = ["assets/images/hero/hero-03.jpg", "assets/images/hero/hero-04.jpg"];
  const r = await owner.put(`${A}/content/site/site`, { data: s });
  assert.equal(r.status, 200);
  await owner.post(`${A}/publish-all`);

  for (const f of ["", "services", "projects", "about", "contact"]) {
    const html = await page(f);
    assert.match(html, /tel:\+919999911111/, f);
    assert.match(html, /mailto:hello@kipl\.co/, f);
    assert.match(html, /1 New Road/, f);
    assert.match(html, /CIN: CIN-TEST-1/, f);
  }
  const contact = await page("contact");
  has(contact, /Mon–Fri: 10 – 5/);
  has(contact, /q=KIPL%20New%20Office/);
  has(contact, /data-mailto="hello@kipl\.co"/);
  has(contact, /data-hero-images="assets\/images\/hero\/hero-03\.jpg,assets\/images\/hero\/hero-04\.jpg"/);

  const home = await page("");
  has(home, /A fresh headline for the home page\./);
  const ld = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.email, "hello@kipl.co");
  assert.equal(ld.telephone, "+91-99999-11111");
  assert.equal(ld.address.postalCode, "768203");
});

test("content with markup characters is escaped, never injected", async () => {
  const s = (await owner.get(`${A}/content/site/site`)).data.item.data;
  s.hero.headline = `<script>alert("x")</script> & "quotes"`;
  await owner.put(`${A}/content/site/site`, { data: s });
  await owner.post(`${A}/publish-all`);
  const home = await page("");
  lacks(home, /<script>alert\("x"\)<\/script>/);
  has(home, /&lt;script&gt;alert\("x"\)&lt;\/script&gt; &amp; "quotes"/);
});

test("version history and one-click restore", async () => {
  const s = (await owner.get(`${A}/content/people/people`)).data.item;
  const original = s.data.vision;
  const edited = JSON.parse(JSON.stringify(s.data));
  edited.vision = "Version two of the vision.";
  await owner.put(`${A}/content/people/people`, { data: edited });
  await owner.post(`${A}/content/people/people/publish`);
  const versions = (await owner.get(`${A}/content/people/people/versions`)).data.versions;
  assert.ok(versions.length >= 2);
  const prior = versions.find((v) => v.data.vision === original || v.data.vision !== "Version two of the vision.");
  const restored = await owner.post(`${A}/content/people/people/restore`, { index: prior.index, publishNow: true });
  assert.equal(restored.status, 200);
  lacks(await page("about"), /Version two of the vision\./);
});

test("scheduled publishing goes live when the time arrives", async () => {
  const r = await owner.post(`${A}/content/clients`, { name: "Scheduled Client", logo: "assets/images/logos/balco.png", visible: true });
  const id = r.data.item.id;
  const when = new Date(Date.now() + 3600 * 1000).toISOString();
  const sch = await owner.post(`${A}/content/clients/${id}/schedule`, { at: when });
  assert.equal(sch.data.item.status, "scheduled");
  lacks(await page(""), /Scheduled Client/);

  assert.equal((await owner.post(`${A}/content/clients/${id}/schedule`, { at: "2001-01-01T00:00:00Z" })).status, 422, "past times rejected");

  content.find("clients", id).publishAt = new Date(Date.now() - 1000).toISOString(); // time passes…
  const done = content.runScheduled();
  assert.equal(done.length, 1);
  has(await page(""), /Scheduled Client/);
});

test("optimistic locking: a stale edit is refused", async () => {
  const item = (await owner.get(`${A}/content/domains/mining-logistics`)).data.item;
  const ok = await owner.put(`${A}/content/domains/mining-logistics`, { data: item.data, ifMatch: item.updatedAt });
  assert.equal(ok.status, 200);
  const stale = await owner.put(`${A}/content/domains/mining-logistics`, { data: item.data, ifMatch: item.updatedAt });
  assert.equal(stale.status, 409);
});

test("rendering survives deleting everything optional", async () => {
  const hod = (await owner.get(`${A}/content/team`)).data.items.filter((i) => i.data.tier === "hod");
  for (const it of hod) await owner.put(`${A}/content/team/${it.id}`, { data: Object.assign({}, it.data, { visible: false }) });
  await owner.post(`${A}/publish-all`);
  const about = await page("about");
  lacks(about, /hod-grid/);
  lacks(about, /Heads of Department/);
});
