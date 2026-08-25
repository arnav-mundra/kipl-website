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
photography, client logos) — each named to match its processed counterpart
(e.g. `docs/source-images/hero/hero-01-original.png` →
`frontend/assets/images/hero/hero-01.jpg`) so it's obvious which source
produced which asset if it ever needs reprocessing at a different size or
quality.

**`backend/`** doesn't exist yet. When there's a reason for one (a contact
form handler, a CMS-backed Projects/News page, an admin panel, etc.), it
belongs as a sibling of `frontend/` right here — keeping frontend and
backend cleanly separated from the start avoids the reshuffle that comes
from bolting a backend onto a folder that was never structured for one.
Whatever stack it ends up using (Node/Express, Python, etc.) should serve
`frontend/` as its static assets rather than the two being merged together.

## Local preview

No build step — just serve `frontend/` as static files:

```bash
cd frontend
python -m http.server 8791
```

Then open `http://localhost:8791`.

## Adding pages

New top-level pages (`services.html`, `projects.html`, `about.html`,
`contact.html` — linked from the nav already, not yet built) go directly in
`frontend/`, next to `index.html`, reusing `css/` and `js/` as-is.
