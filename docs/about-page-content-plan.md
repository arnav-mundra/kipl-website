# About Page — Content Plan (`frontend/about.html`)

Reference document only — no code written yet. Content is sourced from the
old kipl.co site, reconciled with the new site's facts and design system
(see `frontend/index.html`, `frontend/services.html`, `frontend/css/`).
Pull from this when you're ready to build the page.

Decisions locked in so far:
- Address: use the new site's existing footer address (Plot No. 100, Boxi
  Chowk, Beherapat, Jharsuguda, Odisha – 768202) — do not use the old
  site's "Beheramal, Pin-768203".
- No Partners (Hilti/TPS) section, no Group Companies (Samaleswari
  Traders) section — left out of About for now.
- Leadership: 3 people only, in this order:
  1. **Somnath Naik** — MD
  2. **Sushil Mundra** — CEO
  3. **Jyotirmoy Patel** — CFO
- The old site's 4th "MD & CEO" profile (HR-professional bio under a
  duplicated title) is dropped entirely.

---

## 1. Hero
Component: `.hero` (same full-bleed slideshow used on Home/Services —
`frontend/css/components.css`, same 6 photos in `assets/images/hero/`).

- Eyebrow: `Who we are`
- H1: **"Built on people, processes & performance since 2009."**
  (echoes the footer tagline already on Home/Services rather than
  repeating Home's own H1)
- Lead: **"KIPL is the flagship company of Kainsara Group, offering
  engineering support solutions to Odisha's aluminum, steel, coal, and
  power sectors — from mechanical maintenance to workforce and asset
  management."**

No hero actions/buttons needed here (Services' hero also omits them) —
this page's job is to inform, not convert.

## 2. Company story
New section type for this page — plain prose block on a light background
(`.section`, no `--dark`), not a component that exists yet elsewhere.

Draft copy (adapted from the old `/about-us/` intro, tightened, folding in
the founding detail from the old Our Team page):

> Kainsara Infraprojects Pvt Ltd (KIPL) was founded in 2009 by Somnath
> Naik with a vision to contribute to Odisha's industrial growth. Today
> KIPL is the flagship company of Kainsara Group, a multi-discipline
> engineering services company serving the aluminum, steel, coal, and
> power sectors. Our work spans mechanical maintenance, operational
> assistance, workforce management, and operating asset management —
> backed by our own fabrication workshop in Jharsuguda.

(Adjust length/tone freely — this is a starting draft, not final copy.)

## 3. Vision & Mission
New small two-column card component — light section, reuse existing
radius/shadow/color tokens from `variables.css` (`--radius-lg`,
`--color-blue-100`, etc. — similar treatment to `.cta__inner`).

- **Vision:** "Be the most admired Engineering Services company in Odisha
  by achieving extraordinary results for our customers and building
  satisfying careers for our people."
- **Mission:** "Achieve service leadership by building a customer-centric
  environment and generate a sense of belonging and respect in the mind
  of every customer." (cleaned up the old site's "customercentric" typo)

## 4. Core Values (condensed restate)
Home already owns the full `.mosaic-row-list` treatment for all 4 values
— repeating it here would be redundant. Use a condensed 4-up strip
instead (icon or index + name + one-line, no full description), just
enough for About to feel complete standalone without duplicating Home's
section verbatim: Ethics · Health & Safety · Quality · Sustainability.

## 5. Leadership
New card-grid component — not an existing block, but buildable from
existing card/radius/shadow tokens. Order and titles as corrected above:

1. **Somnath Naik** — MD — "Founded the organization in 2009 with a
   vision to contribute to Odisha's industrial growth."
2. **Sushil Mundra** — CEO — "25+ years in operations, finance, and MIS;
   MBA in Finance."
3. **Jyotirmoy Patel** — CFO — "25+ years of industry experience; MBA."

## 6. CTA band
Reuse `.cta__inner` exactly as Home/Services do.

- H2: "Want to know more about how we work? Let's talk."
- Button: "Start a conversation" → `contact.html`

---

## Open item
Not yet confirmed: whether Naik/Mundra/Patel's titles above are their
exact *current* titles (the old site listed Naik as "MD & CEO" and
Mundra separately as "CEO", which was the source of the ordering
question) — worth a final check before this content goes live.
