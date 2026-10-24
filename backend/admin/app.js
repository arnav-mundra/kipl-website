import { api } from "./api.js";
import { h, clear, spinner, toast } from "./ui.js";
import { state, refreshPending, canMedia, canEnquiries, isOwner } from "./state.js";
import { collectionView } from "./collection.js";
import { editorView } from "./editor.js";
import { dashboardView, mediaView, enquiriesView, usersView, auditView, backupsView, profileView, publishAllDialog } from "./pages.js";

const app = document.getElementById("app");
const CONTENT_ORDER = ["projects", "domains", "team", "people", "clients", "figures", "site"];
const PREVIEW_PAGES = [["Home", "index.html"], ["Services", "services.html"], ["Projects", "projects.html"], ["About", "about.html"], ["Contact", "contact.html"]];

let contentEl = null;
let lastHash = location.hash;

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

function renderLogin(message) {
  state.user = null;
  const user = h("input", { type: "text", name: "username", autocomplete: "username", required: true, autofocus: true });
  const pass = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const err = h("div", { class: "field__error", role: "alert", hidden: !message }, message || "");
  const btn = h("button", { class: "btn btn--primary", type: "submit" }, "Sign in");

  const form = h("form", { class: "login__card", novalidate: true },
    h("div", { class: "login__brand" }, h("img", { src: "/assets/images/kipl-logo.jpeg", alt: "" }), h("div", null, h("strong", null, "KIPL Admin"), h("span", null, "Website content management"))),
    h("label", { class: "field" }, h("span", { class: "field__label" }, "Username"), user),
    h("label", { class: "field" }, h("span", { class: "field__label" }, "Password"), pass),
    err,
    btn
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    try {
      const { user: u } = await api.post("/login", { username: user.value, password: pass.value });
      await enterApp(u);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
      btn.disabled = false;
      pass.value = "";
      pass.focus();
    }
  });
  clear(app).append(h("div", { class: "login" }, form));
  user.focus();
}

window.addEventListener("auth:expired", () => {
  if (state.user) renderLogin("Your session has ended. Please sign in again.");
});

// Hosted admin: after a publish the server pushes the content to the live site (api.js relays it).
window.addEventListener("site:publish", (e) => {
  const site = e.detail;
  if (!site.ok) toast(`Saved, but the live website couldn't be updated: ${site.error}. Try publishing again in a minute.`, "error");
  else if (site.changed) toast("The live website is updating — changes appear on kipl.co in about a minute.", "ok");
});

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

async function enterApp(user) {
  state.user = user;
  const { resources, roles } = await api.get("/schemas");
  state.schemas = resources;
  state.roles = roles;
  state.dirty = false;
  renderShell();
  refreshPending();
  if (!location.hash || location.hash === "#/") location.hash = "#/dashboard";
  else route();
}

function navLink(href, label, extra) {
  return h("a", { class: "nav-link", href, "data-href": href }, h("span", null, label), extra || null);
}

function renderShell() {
  const sidebar = h("aside", { class: "sidebar", id: "sidebar", "aria-label": "Main navigation" },
    h("a", { class: "sidebar__brand", href: "#/dashboard" }, h("img", { src: "/assets/images/kipl-logo.jpeg", alt: "" }), h("div", null, h("strong", null, "KIPL"), h("span", null, "Website admin"))),
    navLink("#/dashboard", "Dashboard")
  );

  const contentLinks = CONTENT_ORDER.filter((k) => state.schemas[k]).map((k) => {
    const s = state.schemas[k];
    return navLink(s.kind === "singleton" ? `#/c/${k}/${k}` : `#/c/${k}`, s.label);
  });
  if (contentLinks.length) sidebar.append(h("div", { class: "nav-group" }, h("div", { class: "nav-group__label" }, "Website content"), contentLinks));

  const lib = [];
  if (canMedia()) lib.push(navLink("#/media", "Media library"));
  if (canEnquiries()) lib.push(navLink("#/enquiries", "Enquiries"));
  if (lib.length) sidebar.append(h("div", { class: "nav-group" }, h("div", { class: "nav-group__label" }, "Library & inbox"), lib));

  if (isOwner()) {
    sidebar.append(h("div", { class: "nav-group" }, h("div", { class: "nav-group__label" }, "Administration"),
      navLink("#/users", "Accounts"), navLink("#/audit", "Audit log"), navLink("#/backups", "Backups & export")));
  }

  /* top bar */
  const publishBtn = h("button", { class: "btn btn--primary", type: "button", onclick: publishAllDialog }, "Publish");
  const userBtn = h("button", { class: "btn", type: "button", "aria-haspopup": "true" });
  const userMenu = h("div", { class: "menu" }, userBtn);
  const previewBtn = h("button", { class: "btn", type: "button", "aria-haspopup": "true" }, "Preview ▾");
  const previewMenu = h("div", { class: "menu" }, previewBtn);

  function toggleMenu(host, btn, items) {
    const open = host.querySelector(".menu__panel");
    document.querySelectorAll(".menu__panel").forEach((p) => p.remove());
    if (open) return;
    const panel = h("div", { class: "menu__panel", role: "menu" }, items);
    host.append(panel);
    const close = (ev) => { if (!host.contains(ev.target)) { panel.remove(); document.removeEventListener("click", close, true); } };
    setTimeout(() => document.addEventListener("click", close, true));
    panel.addEventListener("click", () => { panel.remove(); document.removeEventListener("click", close, true); });
  }
  previewBtn.addEventListener("click", () => toggleMenu(previewMenu, previewBtn, [
    h("div", { class: "menu__sep", style: { display: "none" } }),
    ...PREVIEW_PAGES.map(([label, file]) => h("a", { href: `/preview/${file}`, target: "_blank", rel: "noopener" }, `Draft: ${label}`)),
    h("div", { class: "menu__sep" }),
    h("a", { href: "/", target: "_blank", rel: "noopener" }, "Open live site"),
  ]));
  userBtn.addEventListener("click", () => toggleMenu(userMenu, userBtn, [
    h("a", { href: "#/profile" }, "Your account"),
    h("div", { class: "menu__sep" }),
    h("button", { type: "button", onclick: signOut }, "Sign out"),
  ]));

  const menuBtn = h("button", { class: "btn btn--icon menu-btn", type: "button", "aria-label": "Menu", onclick: () => sidebar.classList.toggle("is-open") }, "☰");
  contentEl = h("main", { class: "content", id: "main", tabindex: "-1" });
  const topbar = h("header", { class: "topbar" }, menuBtn, h("div", { class: "topbar__title muted small" }, "Changes are saved as drafts until you publish them."), previewMenu, publishBtn, userMenu);

  clear(app).append(h("div", { class: "shell" }, sidebar, h("div", { class: "main" }, topbar, contentEl)));

  state.refreshChrome = () => {
    const n = state.pending.length;
    publishBtn.textContent = n ? `Publish (${n})` : "Publish";
    publishBtn.disabled = !n;
    userBtn.textContent = `${state.user.name} ▾`;
  };
  state.refreshChrome();

  sidebar.addEventListener("click", (e) => { if (e.target.closest("a")) sidebar.classList.remove("is-open"); });
}

async function signOut() {
  if (state.dirty && !confirm("You have unsaved changes. Sign out anyway?")) return;
  try { await api.post("/logout"); } catch (_) { /* cookie cleared server-side or already expired */ }
  state.dirty = false;
  renderLogin();
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function highlightNav(parts) {
  let target;
  if (parts[0] === "c") {
    const spec = state.schemas[parts[1]];
    target = spec && spec.kind === "singleton" ? `#/c/${parts[1]}/${parts[1]}` : `#/c/${parts[1]}`;
  } else target = `#/${parts[0] || "dashboard"}`;
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("is-active", a.dataset.href === target));
}

async function route() {
  if (!state.user || !contentEl) return;
  const hash = location.hash || "#/dashboard";
  const parts = hash.replace(/^#\/?/, "").split("/");
  highlightNav(parts);
  window.scrollTo(0, 0);
  contentEl.focus({ preventScroll: true });

  try {
    switch (parts[0]) {
      case "":
      case "dashboard": await dashboardView(contentEl); break;
      case "c":
        if (parts[2]) await editorView(contentEl, parts[1], parts[2]);
        else await collectionView(contentEl, parts[1]);
        break;
      case "media": mediaView(contentEl); break;
      case "enquiries": await enquiriesView(contentEl); break;
      case "users": await usersView(contentEl); break;
      case "audit": await auditView(contentEl); break;
      case "backups": await backupsView(contentEl); break;
      case "profile": profileView(contentEl); break;
      default: clear(contentEl).append(h("div", { class: "empty" }, "Page not found."));
    }
  } catch (e) {
    console.error(e);
    clear(contentEl).append(h("div", { class: "empty" }, e.message || "Something went wrong."));
  }
}

window.addEventListener("hashchange", () => {
  if (state.dirty && location.hash !== lastHash) {
    if (!confirm("You have unsaved changes. Leave this page and lose them?")) {
      const back = lastHash;
      history.replaceState(null, "", back || "#/dashboard");
      return;
    }
    state.dirty = false;
  }
  lastHash = location.hash;
  route();
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

(async function boot() {
  clear(app).append(spinner());
  try {
    const { user } = await api.get("/me");
    if (user) await enterApp(user);
    else renderLogin();
  } catch (e) {
    clear(app).append(h("div", { class: "empty" }, e.message));
  }
})();
