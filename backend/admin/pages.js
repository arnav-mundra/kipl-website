import { api } from "./api.js";
import { h, clear, spinner, toast, modal, confirmDialog, promptDialog, statusBadge, fmtDate, ago, fmtBytes, debounce } from "./ui.js";
import { state, go, refreshPending, canMedia, canEnquiries, isOwner } from "./state.js";
import { mediaBrowser } from "./media.js";

const head = (title, sub, ...actions) =>
  h("div", { class: "page-head" }, h("div", null, h("h1", null, title), sub ? h("p", { class: "muted" }, sub) : null), actions.length ? h("div", { class: "row" }, actions) : null);

const errBox = (e) => h("div", { class: "empty" }, e.message || String(e));

const TYPE_LABEL = {
  projects: "Project", domains: "Domain", team: "Team member", clients: "Client", figures: "Company figures",
  people: "MD's desk & values", site: "Site-wide settings",
};
const hrefFor = (type, id) => (state.schemas[type] ? `#/c/${type}/${id}` : "#/dashboard");

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export async function dashboardView(root) {
  clear(root).append(spinner());
  let d;
  try { d = await api.get("/dashboard"); } catch (e) { clear(root).append(errBox(e)); return; }
  state.pending = d.pending;
  state.refreshChrome();

  const tiles = [];
  const c = d.counts;
  const tile = (value, label, href) => (href ? h("a", { class: "tile", href }, h("div", { class: "tile__value" }, value), h("div", { class: "tile__label" }, label)) : h("div", { class: "tile" }, h("div", { class: "tile__value" }, value), h("div", { class: "tile__label" }, label)));
  if (c.projects) {
    tiles.push(tile(c.projects.visible, `Projects on the website (${c.projects.total} total)`, "#/c/projects"));
    tiles.push(tile(c.projects.featured, "Featured projects", "#/c/projects"));
  }
  if (c.domains !== undefined) tiles.push(tile(c.domains, "Services / domains", "#/c/domains"));
  if (c.team !== undefined) tiles.push(tile(c.team, "Team members", "#/c/team"));
  if (c.clients !== undefined) tiles.push(tile(c.clients, "Client logos", "#/c/clients"));
  if (c.enquiries) tiles.push(tile(c.enquiries.new, `New enquiries (${c.enquiries.total} total)`, "#/enquiries"));
  if (c.media) tiles.push(tile(c.media.files, `Uploaded images · ${fmtBytes(c.media.bytes)}`, "#/media"));

  const pendingRows = d.pending.map((p) =>
    h("tr", null,
      h("td", null, h("a", { class: "cell-title", href: hrefFor(p.type, p.id) }, p.title)),
      h("td", { class: "muted" }, TYPE_LABEL[p.type] || p.type),
      h("td", null, statusBadge(p.status)),
      h("td", { class: "muted small" }, `${ago(p.updatedAt)} · ${p.updatedBy}`)
    )
  );

  clear(root).append(
    head(`Welcome, ${state.user.name}`, "Here's what's happening on the website."),
    h("div", { class: "stack" },
      d.usingInitialPassword
        ? h("div", { class: "banner banner--warn" }, "You're still using the initial password.", h("a", { class: "btn btn--small", href: "#/profile" }, "Choose your own password"))
        : null,
      h("div", { class: "tiles" }, tiles),
      h("div", { class: "card" },
        h("div", { class: "card__head" }, h("h2", null, `Waiting to be published (${d.pending.length})`),
          d.pending.length ? h("button", { class: "btn btn--primary btn--small", type: "button", onclick: () => publishAllDialog() }, "Review & publish all") : null),
        d.pending.length
          ? h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Item"), h("th", null, "Section"), h("th", null, "State"), h("th", null, "Edited"))), h("tbody", null, pendingRows)))
          : h("div", { class: "empty" }, "Everything you've edited is live.")
      ),
      d.scheduled.length
        ? h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, "Scheduled")),
            h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, d.scheduled.map((s) => h("tr", null,
              h("td", null, h("a", { class: "cell-title", href: hrefFor(s.type, s.id) }, s.title)),
              h("td", { class: "muted" }, TYPE_LABEL[s.type] || s.type),
              h("td", null, "Publishes ", fmtDate(s.publishAt))))))))
        : null,
      h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, isOwner() ? "Recent activity" : "Your recent activity"), isOwner() ? h("a", { href: "#/audit", class: "small" }, "View all") : null),
        d.recent.length
          ? h("div", { class: "table-wrap" }, h("table", null, h("tbody", null, d.recent.map((r) => h("tr", null,
              h("td", { class: "muted small", style: { whiteSpace: "nowrap" } }, ago(r.at)),
              h("td", null, h("strong", null, r.user), " ", r.summary))))))
          : h("div", { class: "empty" }, "No activity yet.")
      )
    )
  );
}

/* Review-and-publish dialog (also used by the top bar). */
export function publishAllDialog() {
  if (!state.pending.length) { toast("Nothing to publish."); return; }
  const body = h("div", { class: "stack" },
    h("p", null, "These changes will go live on the website:"),
    h("ul", { class: "diff-list" }, state.pending.map((p) => h("li", null, h("strong", null, p.title), " — ", (TYPE_LABEL[p.type] || p.type), " ", statusBadge(p.status))))
  );
  const m = modal(`Publish ${state.pending.length} change${state.pending.length > 1 ? "s" : ""}`, body, {
    footer: [
      h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel"),
      h("button", { class: "btn btn--primary", type: "button", onclick: async (ev) => {
        ev.target.disabled = true;
        try {
          const res = await api.post("/publish-all");
          m.close();
          if (res.published.length) toast(`Published ${res.published.length} change${res.published.length > 1 ? "s" : ""}.`, "ok");
          res.failed.forEach((f) => toast(`${f.title}: ${f.error}`, "error"));
          await refreshPending();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } catch (e) { toast(e.message, "error"); ev.target.disabled = false; }
      } }, "Publish all"),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

export function mediaView(root) {
  const browser = mediaBrowser({ mode: "manage", canUpload: canMedia() });
  clear(root).append(
    head("Media library", "Upload photos and logos here, then choose them from any image field. Images are resized and compressed automatically."),
    h("div", { class: "card" }, h("div", { class: "card__body" }, browser.el))
  );
}

/* ------------------------------------------------------------------ */
/* Enquiries                                                           */
/* ------------------------------------------------------------------ */

export async function enquiriesView(root) {
  if (!canEnquiries()) { clear(root).append(h("div", { class: "empty" }, "You don't have access to enquiries.")); return; }
  let status = "";
  const q = h("input", { type: "search", placeholder: "Search enquiries…", "aria-label": "Search" });
  const tabs = h("div", { class: "row" });
  const tbody = h("tbody");
  const body = h("div");
  let counts = {};

  async function load() {
    clear(body).append(spinner());
    try {
      const res = await api.get(`/enquiries?status=${status}&q=${encodeURIComponent(q.value)}`);
      counts = res.counts;
      paintTabs();
      clear(tbody);
      if (!res.items.length) tbody.append(h("tr", null, h("td", { colspan: 5, class: "empty" }, "No enquiries here.")));
      res.items.forEach((e) => tbody.append(h("tr", null,
        h("td", { class: "muted small", style: { whiteSpace: "nowrap" } }, ago(e.at)),
        h("td", null, h("a", { class: "cell-title", href: "#", onclick: (ev) => { ev.preventDefault(); detail(e); } }, e.name)),
        h("td", null, e.email),
        h("td", { class: "muted" }, e.message.length > 70 ? e.message.slice(0, 70) + "…" : e.message),
        h("td", null, h("span", { class: "badge " + (e.status === "new" ? "badge--orange" : "badge--grey") }, e.status))
      )));
      clear(body).append(h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, "Received"), h("th", null, "Name"), h("th", null, "Email"), h("th", null, "Message"), h("th", null, "Status"))), tbody)));
    } catch (e) { clear(body).append(errBox(e)); }
  }

  function paintTabs() {
    clear(tabs);
    [["", `Open (${(counts.new || 0) + (counts.contacted || 0)})`], ["new", `New (${counts.new || 0})`], ["closed", `Closed (${counts.closed || 0})`], ["spam", `Spam (${counts.spam || 0})`], ["all", "All"]].forEach(([v, label]) => {
      tabs.append(h("button", { class: "btn btn--small" + (status === v ? " btn--navy" : ""), type: "button", onclick: () => { status = v; load(); } }, label));
    });
  }

  function detail(e) {
    const sel = h("select", null, ["new", "contacted", "closed", "spam"].map((s) => h("option", { value: s, selected: s === e.status }, s)));
    const notes = h("textarea", { placeholder: "Internal notes (not visible to the sender)" });
    notes.value = e.notes || "";
    const m = modal(`Enquiry from ${e.name}`, h("div", { class: "stack" },
      h("dl", { class: "kv" },
        h("dt", null, "Received"), h("dd", null, fmtDate(e.at)),
        h("dt", null, "Email"), h("dd", null, h("a", { href: `mailto:${e.email}` }, e.email)),
        h("dt", null, "Phone"), h("dd", null, e.phone || "—")),
      h("div", null, h("div", { class: "field__label" }, "Message"), h("p", { style: { whiteSpace: "pre-wrap" } }, e.message)),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Status"), sel),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Notes"), notes)
    ), {
      wide: true,
      footer: [
        h("button", { class: "btn btn--danger", type: "button", onclick: async () => {
          if (!(await confirmDialog("Delete this enquiry permanently?", { confirmText: "Delete", danger: true }))) return;
          try { await api.del(`/enquiries/${e.id}`); m.close(); load(); } catch (er) { toast(er.message, "error"); }
        } }, "Delete"),
        h("span", { class: "grow" }),
        h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Close"),
        h("button", { class: "btn btn--primary", type: "button", onclick: async () => {
          try { await api.patch(`/enquiries/${e.id}`, { status: sel.value, notes: notes.value }); m.close(); toast("Saved.", "ok"); load(); } catch (er) { toast(er.message, "error"); }
        } }, "Save"),
      ],
    });
  }

  q.addEventListener("input", debounce(load, 250));
  clear(root).append(
    head("Enquiries", "Messages sent through the website's contact form.", h("a", { class: "btn", href: "/api/admin/export/enquiries.csv", download: "" }, "Export CSV")),
    h("div", { class: "card" }, h("div", { class: "card__head" }, tabs, h("div", { style: { minWidth: "220px" } }, q)), body)
  );
  load();
}

/* ------------------------------------------------------------------ */
/* Users (owner)                                                       */
/* ------------------------------------------------------------------ */

export async function usersView(root) {
  if (!isOwner()) { clear(root).append(h("div", { class: "empty" }, "Only the Owner can manage accounts.")); return; }
  clear(root).append(spinner());
  let users, roles;
  async function load() { const res = await api.get("/users"); users = res.users; roles = res.roles; }
  try { await load(); } catch (e) { clear(root).append(errBox(e)); return; }

  const roleSelect = (value) => h("select", null, Object.entries(roles).map(([k, r]) => h("option", { value: k, selected: k === value }, `${r.label} — ${r.description}`)));

  function newUser() {
    const f = { username: h("input", { type: "text", autocomplete: "off" }), name: h("input", { type: "text" }), role: roleSelect("editor"), password: h("input", { type: "password", autocomplete: "new-password" }) };
    const err = h("div", { class: "field__error", hidden: true });
    const m = modal("New account", h("div", { class: "stack" },
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Username"), f.username),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Display name"), f.name),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Role"), f.role),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Password"), f.password, h("div", { class: "field__help" }, "At least 8 characters. They can change it after signing in.")),
      err
    ), { footer: [
      h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel"),
      h("button", { class: "btn btn--primary", type: "button", onclick: async () => {
        try { await api.post("/users", { username: f.username.value, name: f.name.value, role: f.role.value, password: f.password.value }); m.close(); toast("Account created.", "ok"); await load(); paint(); }
        catch (e) { err.hidden = false; err.textContent = e.message; }
      } }, "Create account"),
    ] });
  }

  function edit(u) {
    const name = h("input", { type: "text", value: u.name });
    const role = roleSelect(u.role);
    const disabled = h("input", { type: "checkbox", checked: u.disabled });
    const err = h("div", { class: "field__error", hidden: true });
    const m = modal(`Edit ${u.username}`, h("div", { class: "stack" },
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Display name"), name),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Role"), role),
      h("label", { class: "checkbox" }, disabled, "Account disabled (can't sign in)"),
      err
    ), { footer: [
      h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel"),
      h("button", { class: "btn btn--primary", type: "button", onclick: async () => {
        try { await api.put(`/users/${u.id}`, { name: name.value, role: role.value, disabled: disabled.checked }); m.close(); toast("Saved.", "ok"); await load(); paint(); }
        catch (e) { err.hidden = false; err.textContent = e.message; }
      } }, "Save"),
    ] });
  }

  async function resetPassword(u) {
    const pw = await promptDialog(`New password for ${u.username}`, "New password", { type: "password", confirmText: "Set password", help: "At least 8 characters. They'll be signed out everywhere." });
    if (pw === null) return;
    try { await api.post(`/users/${u.id}/password`, { password: pw }); toast("Password updated.", "ok"); await load(); paint(); }
    catch (e) { toast(e.message, "error"); }
  }

  async function remove(u) {
    if (!(await confirmDialog(`Delete the account “${u.username}”? This can't be undone.`, { confirmText: "Delete", danger: true }))) return;
    try { await api.del(`/users/${u.id}`); toast("Account deleted.", "ok"); await load(); paint(); } catch (e) { toast(e.message, "error"); }
  }

  const tbody = h("tbody");
  function paint() {
    clear(tbody);
    users.forEach((u) => tbody.append(h("tr", null,
      h("td", null, h("strong", null, u.username), u.id === state.user.id ? h("span", { class: "muted" }, " (you)") : null, h("div", { class: "muted small" }, u.name)),
      h("td", null, h("span", { class: "badge badge--orange" }, (roles[u.role] || {}).label || u.role)),
      h("td", null, u.disabled ? h("span", { class: "badge badge--deleted" }, "Disabled") : u.usingInitialPassword ? h("span", { class: "badge badge--changed" }, "Initial password") : h("span", { class: "badge badge--live" }, "Active")),
      h("td", { class: "muted small" }, u.lastLoginAt ? ago(u.lastLoginAt) : "Never"),
      h("td", { class: "actions" },
        h("button", { class: "btn btn--small", type: "button", onclick: () => edit(u) }, "Edit"), " ",
        h("button", { class: "btn btn--small", type: "button", onclick: () => resetPassword(u) }, "Reset password"), " ",
        u.id === state.user.id ? null : h("button", { class: "btn btn--small btn--danger", type: "button", onclick: () => remove(u) }, "Delete")
      )
    )));
  }

  clear(root).append(
    head("Accounts", "Who can sign in to this admin panel, and what they can do.", h("button", { class: "btn btn--primary", type: "button", onclick: newUser }, "+ New account")),
    h("div", { class: "stack" },
      h("div", { class: "card" }, h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Account"), h("th", null, "Role"), h("th", null, "State"), h("th", null, "Last sign-in"), h("th", null, ""))), tbody))),
      h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, "What each role can do")),
        h("div", { class: "card__body" }, h("dl", { class: "kv" }, Object.values(roles).map((r) => [h("dt", null, r.label), h("dd", null, r.description)]))))
    )
  );
  paint();
}

/* ------------------------------------------------------------------ */
/* Audit log (owner)                                                   */
/* ------------------------------------------------------------------ */

export async function auditView(root) {
  if (!isOwner()) { clear(root).append(h("div", { class: "empty" }, "Only the Owner can view the audit log.")); return; }
  let offset = 0;
  const limit = 50;
  const q = h("input", { type: "search", placeholder: "Search the log…", "aria-label": "Search" });
  const action = h("select", { "aria-label": "Action" }, h("option", { value: "" }, "Any action"),
    ["login", "login-failed", "create", "update", "delete", "publish", "discard", "schedule", "restore", "reorder", "upload", "export", "backup", "password", "enquiry"].map((a) => h("option", { value: a }, a)));
  const tbody = h("tbody");
  const pager = h("div", { class: "row row--end", style: { padding: "12px 18px" } });

  async function load() {
    try {
      const params = new URLSearchParams({ limit, offset, q: q.value, action: action.value });
      const { rows, total } = await api.get(`/audit?${params}`);
      clear(tbody);
      if (!rows.length) tbody.append(h("tr", null, h("td", { colspan: 5, class: "empty" }, "No matching entries.")));
      rows.forEach((r) => tbody.append(h("tr", null,
        h("td", { class: "small", style: { whiteSpace: "nowrap" } }, fmtDate(r.at)),
        h("td", null, h("strong", null, r.user), h("div", { class: "muted small" }, r.role)),
        h("td", null, h("span", { class: "badge badge--grey" }, r.action)),
        h("td", null, r.summary),
        h("td", { class: "muted small" }, r.ip)
      )));
      clear(pager).append(
        h("span", { class: "muted small grow" }, `${total ? offset + 1 : 0}–${Math.min(offset + limit, total)} of ${total}`),
        h("button", { class: "btn btn--small", type: "button", disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - limit); load(); } }, "← Newer"),
        h("button", { class: "btn btn--small", type: "button", disabled: offset + limit >= total, onclick: () => { offset += limit; load(); } }, "Older →")
      );
    } catch (e) { clear(tbody).append(h("tr", null, h("td", { colspan: 5 }, errBox(e)))); }
  }
  const reload = debounce(() => { offset = 0; load(); }, 250);
  q.addEventListener("input", reload);
  action.addEventListener("change", reload);

  clear(root).append(
    head("Audit log", "Every sign-in, edit, publish and export, with who did it and when."),
    h("div", { class: "card" },
      h("div", { class: "card__head" }, h("div", { class: "row grow" }, h("div", { style: { minWidth: "220px", flex: 1 } }, q), h("div", { style: { minWidth: "150px" } }, action))),
      h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "When"), h("th", null, "Who"), h("th", null, "Action"), h("th", null, "What"), h("th", null, "IP"))), tbody)),
      pager
    )
  );
  load();
}

/* ------------------------------------------------------------------ */
/* Backups & export (owner)                                            */
/* ------------------------------------------------------------------ */

export async function backupsView(root) {
  if (!isOwner()) { clear(root).append(h("div", { class: "empty" }, "Only the Owner can manage backups.")); return; }
  const list = h("div");
  async function load() {
    clear(list).append(spinner());
    try {
      const { backups } = await api.get("/backups");
      clear(list).append(backups.length
        ? h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "File"), h("th", null, "Created"), h("th", null, "Size"), h("th", null, ""))),
            h("tbody", null, backups.map((b) => h("tr", null, h("td", null, b.name), h("td", { class: "small" }, fmtDate(b.at)), h("td", { class: "small" }, fmtBytes(b.bytes)),
              h("td", { class: "actions" }, h("a", { class: "btn btn--small", href: `/api/admin/backups/${encodeURIComponent(b.name)}`, download: "" }, "Download")))))))
        : h("div", { class: "empty" }, "No server backups yet."));
    } catch (e) { clear(list).append(errBox(e)); }
  }

  const file = h("input", { type: "file", accept: "application/json,.json", class: "sr-only", tabindex: "-1" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    let parsed;
    try { parsed = JSON.parse(await f.text()); } catch (_) { toast("That file isn't valid JSON.", "error"); return; }
    if (!(await confirmDialog(`Replace ALL website content (projects, team, services, figures, settings) with the contents of “${f.name}”? A safety backup of the current content is made first. Accounts are not affected.`, { confirmText: "Restore", danger: true, title: "Restore from backup" }))) return;
    try {
      const res = await api.post("/backup/restore", { backup: parsed });
      toast(`Restored ${res.docs} records. Safety copy saved as ${res.safetyBackup}.`, "ok");
      await refreshPending(); load();
    } catch (e) { toast(e.message, "error"); }
  });

  clear(root).append(
    head("Backups & export", "Download your content, keep automatic copies on the server, or restore an earlier state."),
    h("div", { class: "stack" },
      h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, "Full content backup")),
        h("div", { class: "card__body stack" },
          h("p", null, "A single JSON file with every project, service, team member, client, figure and setting (drafts and live copies, with version history), plus enquiries and image records. Uploaded image files themselves live in the server's ", h("code", null, "data/uploads"), " folder — back that up too."),
          h("div", { class: "row" },
            h("a", { class: "btn btn--primary", href: "/api/admin/backup", download: "" }, "Download backup"),
            h("button", { class: "btn", type: "button", onclick: async () => { try { await api.post("/backups"); toast("Backup saved on the server.", "ok"); load(); } catch (e) { toast(e.message, "error"); } } }, "Save a copy on the server"),
            h("button", { class: "btn btn--danger", type: "button", onclick: () => file.click() }, "Restore from a file…"), file
          ))),
      h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, "Spreadsheet exports")),
        h("div", { class: "card__body row" },
          h("a", { class: "btn", href: "/api/admin/export/projects.csv", download: "" }, "Projects (CSV)"),
          h("a", { class: "btn", href: "/api/admin/export/enquiries.csv", download: "" }, "Enquiries (CSV)"))),
      h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, "Backups on the server"), h("span", { class: "muted small" }, "A copy is taken automatically every day; the latest 14 are kept.")), list)
    )
  );
  load();
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function profileView(root) {
  const name = h("input", { type: "text", value: state.user.name });
  const cur = h("input", { type: "password", autocomplete: "current-password" });
  const next = h("input", { type: "password", autocomplete: "new-password" });
  const again = h("input", { type: "password", autocomplete: "new-password" });
  const err = h("div", { class: "field__error", hidden: true });

  clear(root).append(
    head("Your account", `Signed in as ${state.user.username} (${state.user.permissions.label}).`),
    h("div", { class: "stack", style: { maxWidth: "520px" } },
      state.user.usingInitialPassword ? h("div", { class: "banner banner--warn" }, "You're using the initial password. Please choose your own below.") : null,
      h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, "Display name")),
        h("div", { class: "card__body stack" }, h("label", { class: "field" }, name),
          h("button", { class: "btn btn--navy", type: "button", onclick: async () => {
            try { const res = await api.put("/me", { name: name.value }); state.user = res.user; state.refreshChrome(); toast("Saved.", "ok"); } catch (e) { toast(e.message, "error"); }
          } }, "Save name"))),
      h("div", { class: "card" }, h("div", { class: "card__head" }, h("h2", null, "Change password")),
        h("div", { class: "card__body" },
          h("label", { class: "field" }, h("span", { class: "field__label" }, "Current password"), cur),
          h("label", { class: "field" }, h("span", { class: "field__label" }, "New password"), next, h("div", { class: "field__help" }, "At least 8 characters. You'll be signed out of other devices.")),
          h("label", { class: "field" }, h("span", { class: "field__label" }, "Repeat new password"), again),
          err,
          h("div", { style: { marginTop: "14px" } }, h("button", { class: "btn btn--primary", type: "button", onclick: async () => {
            err.hidden = true;
            if (next.value !== again.value) { err.hidden = false; err.textContent = "The new passwords don't match."; return; }
            try {
              await api.post("/me/password", { current: cur.value, next: next.value });
              cur.value = next.value = again.value = "";
              state.user.usingInitialPassword = false;
              toast("Password changed.", "ok");
              profileView(root);
            } catch (e) { err.hidden = false; err.textContent = e.message; }
          } }, "Change password"))))
    )
  );
}
