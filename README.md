# KIPL Website

Marketing site for Kainsara Infraprojects Pvt Ltd (KIPL).

## Structure

```
site/
├── frontend/          static site — HTML/CSS/JS, no build step, no dependencies
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── assets/images/
├── backend/           (not created yet — see below)
└── docs/              reference material, not served to visitors
    ├── kipl-profile.pdf
    ├── brand/         original brand assets (logo)
    └── source-images/ full-resolution originals behind frontend/assets/images/,
                        kept for future re-processing (recrop, higher-res export, etc.)
```

**`frontend/`** is the entire current website — plain HTML/CSS/JS, no bundler,
no npm dependencies. It's a complete, self-contained static site: point any
static file server or CDN at this folder and it works as-is.

**`docs/`** holds source material that isn't part of the served site: the
company profile PDF, the original brand logo file, and full-resolution
originals of every processed image in `frontend/assets/images/` (hero
photography, client logos, team headshots) — each named to match its
processed counterpart (e.g. `docs/source-images/hero/hero-01-original.png`
→ `frontend/assets/images/hero/hero-01.jpg`,
`docs/source-images/team/somnath-naik-original.jpeg` →
`frontend/assets/images/team/somnath-naik.jpg`) so it's obvious which
source produced which asset if it ever needs reprocessing at a different
size or quality. To reprocess a headshot after swapping in a new source
photo: drop the new original at its `docs/source-images/team/<slug>-
original.*` path, then resize/flatten/export it to
`frontend/assets/images/team/<slug>.jpg` (JPEG, quality 85, capped at
700px wide) — see recent commit history for the one-off Pillow script
used so far, there's no standing build step for this.

**`backend/`** doesn't exist yet. When there's a reason for one (a contact
form handler, a CMS-backed Projects/News page, an admin panel, etc.), it
belongs as a sibling of `frontend/` right here — keeping frontend and
backend cleanly separated from the start avoids the reshuffle that comes
from bolting a backend onto a folder that was never structured for one.
Whatever stack it ends up using (Node/Express, Python, etc.) should serve
`frontend/` as its static assets rather than the two being merged together.

## Deployment (Vercel)

The site is a plain static build with no build command, but the actual
files live in `frontend/`, not the repo root — so `vercel.json` sets
`outputDirectory: "frontend"` to tell Vercel where to serve from. Without
this, Vercel serves the repo root by default, finds no `index.html` there,
and every route 404s. `.vercelignore` excludes `docs/` (~50MB of
full-resolution source images that are reference material, never meant to
be deployed) to keep uploads fast.

## Local preview

No build step — just serve `frontend/` as static files:

```bash
cd frontend
python -m http.server 8791
```

Then open `http://localhost:8791`.

**Cache-busting while developing:** every `<link rel="stylesheet">` and
`<script src>` pointing at `css/` or `js/` carries a shared `?v=N` query
string (e.g. `css/base.css?v=1`). `python -m http.server` sends no
cache-control headers at all, which lets browsers silently serve a stale
copy of a CSS/JS file after you've edited it — a plain refresh (even
Ctrl+Shift+R, sometimes) isn't reliable, only a cache-cleared/private
window is, and that's easy to forget mid-session and chase a "fix" for
what's actually just a stale tab. **Bump `?v=N` by one, across all five
HTML pages, every time you edit any file in `css/` or `js/`** — that
forces every browser to treat it as a new URL and fetch it fresh, no
private window needed. It's one shared number for all assets on all
pages (not per-file), so bumping is a single find-and-replace. Google
Fonts/CDN `<link>`/`<script>` tags don't need this — only local
`css/`/`js/` files.

## Adding pages

`index.html`, `services.html`, `about.html`, `projects.html`, and
`contact.html` are all built. A future new page goes directly in
`frontend/`, next to the others, reusing
`css/` and `js/` as-is: shared styling lives in `css/components.css`
(nav, hero, footer, buttons, the mosaic-reveal effect, the page
transition), page-specific layout gets its own `css/<page>.css` (see
`home.css`/`services.css`/`about.css` for the pattern). Every page also
needs the same inline `<head>` script (scroll-restoration +
nav-transition-cover handoff — copy it from `services.html` or
`about.html`, *not* `index.html`, which has no nav-transition-cover
concerns of its own but does carry the Home-only preloader markup), the
`.page-transition` div right after `<body>`, and the same `?v=N` on its
own `css/`/`js/` links (see "Cache-busting while developing" above).

About's dropdown (Mission & Vision / MD's Desk / Our Team) is a
reference pattern worth reusing if a future page needs the same
"single page, multiple sections, jump to one from anywhere on the site"
structure — see `css/components.css`'s `.nav__item--dropdown` and
`js/main.js#initNavDropdowns`.
