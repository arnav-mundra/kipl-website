import { api } from "./api.js";
import { h, clear, spinner, toast, confirmDialog, modal, statusBadge, fmtDate } from "./ui.js";
import { createForm, blankValue } from "./forms.js";
import { state, go, refreshPending, canMedia, PREVIEW_PAGE } from "./state.js";

const listHash = (type) => (state.schemas[type].kind === "singleton" ? "#/dashboard" : `#/c/${type}`);

function localInputValue(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Edit one record (a collection item, or a singleton like "Company figures").
 * `id` is "new" to create. Resolves once rendered.
 */
export async function editorView(root, type, id) {
  const spec = state.schemas[type];
  if (!spec) { clear(root).append(h("div", { class: "empty" }, "You don't have access to this section.")); return; }

  const isSingleton = spec.kind === "singleton";
  const isNew = id === "new";
  clear(root).append(spinner());

  let item = null;
  let refs = {};
  try {
    if (type === "projects") refs = (await api.get("/content/projects")).refs || {};
    if (!isNew) item = (await api.get(`/content/${type}/${id}`)).item;
  } catch (e) {
    clear(root).append(h("div", { class: "empty" }, e.message, h("p", null, h("a", { href: listHash(type) }, "← Back"))));
    return;
  }

  const initial = isNew
    ? Object.assign(Object.fromEntries(spec.fields.map((f) => [f.key, blankValue(f)])), spec.defaults || {})
    : item.data;

  state.dirty = false;
  const markDirty = () => { if (!state.dirty) { state.dirty = true; saveBtn.disabled = false; dirtyNote.hidden = false; } };
  const form = createForm(spec.fields, initial, { refs, onChange: markDirty, canUpload: canMedia() });

  /* ---------- status banner ---------- */
  const banner = h("div");
  function paintBanner() {
    clear(banner);
    if (isNew && !item) {
      banner.append(h("div", { class: "banner banner--info" }, "This will be saved as a draft. It won't appear on the website until you publish it."));
      return;
    }
    const s = item.status;
    if (s === "live") banner.append(h("div", { class: "banner banner--ok" }, statusBadge("live"), `Live on the website. Published ${fmtDate(item.publishedAt)} by ${item.publishedBy || "—"}.`));
    else if (s === "changed") banner.append(h("div", { class: "banner banner--warn" }, statusBadge("changed"), "You have changes that aren't on the website yet.", item.publishedAt ? ` Last published ${fmtDate(item.publishedAt)}.` : ""));
    else if (s === "new") banner.append(h("div", { class: "banner banner--warn" }, statusBadge("new"), "Not on the website yet — it's only visible in preview until you publish."));
    else if (s === "scheduled") banner.append(h("div", { class: "banner banner--info" }, statusBadge("scheduled"), `Will publish automatically on ${fmtDate(item.publishAt)}.`));
    else if (s === "deleted") banner.append(h("div", { class: "banner banner--danger" }, statusBadge("deleted"), "Marked for deletion. It stays on the website until you publish; discard to keep it."));
  }
  paintBanner();

  /* ---------- actions ---------- */
  const dirtyNote = h("span", { class: "muted small", hidden: true }, "Unsaved changes");
  const saveBtn = h("button", { class: "btn btn--navy", type: "button", disabled: !isNew }, isNew ? "Create draft" : "Save draft");
  const publishBtn = h("button", { class: "btn btn--primary", type: "button" }, "Save & publish");
  const previewBtn = h("button", { class: "btn", type: "button" }, "Preview");
  const moreBtns = [];

  async function save(opts = {}) {
    const value = form.getValue();
    try {
      let res;
      if (isNew && !item) {
        res = await api.post(`/content/${type}`, value);
        item = res.item;
        state.dirty = false;
        refreshPending();
        if (!opts.stay) { toast("Draft created.", "ok"); go(`#/c/${type}/${item.id}`); }
        return true;
      }
      res = await api.put(`/content/${type}/${item.id}`, { data: value, ifMatch: item.updatedAt });
      item = res.item;
      form.setErrors([]);
      state.dirty = false;
      saveBtn.disabled = true;
      dirtyNote.hidden = true;
      paintBanner(); paintButtons();
      toast("Draft saved.", "ok");
      refreshPending();
      return true;
    } catch (e) {
      if (e.status === 422) {
        const orphans = form.setErrors(e.details || []);
        toast(orphans.length ? orphans[0].message : "Please fix the highlighted fields.", "error");
      } else toast(e.message, "error");
      return false;
    }
  }

  async function publish() {
    const wasNew = isNew && !item;
    if (wasNew) { if (!(await save({ stay: true }))) return; }
    else if (state.dirty) { if (!(await save())) return; }
    try {
      const res = await api.post(`/content/${type}/${item.id}/publish`);
      if (wasNew) { toast("Published — it's live now.", "ok"); refreshPending(); go(`#/c/${type}/${item.id}`); return; }
      if (res.removed) { toast("Removed from the website.", "ok"); state.dirty = false; refreshPending(); go(listHash(type)); return; }
      item = res.item;
      paintBanner(); paintButtons();
      toast("Published — it's live now.", "ok");
      refreshPending();
    } catch (e) { toast(e.message, "error"); }
  }

  saveBtn.addEventListener("click", save);
  publishBtn.addEventListener("click", publish);
  previewBtn.addEventListener("click", async () => {
    if (state.dirty) toast("Preview shows your last saved draft — save first to include recent edits.");
    window.open(`/preview/${PREVIEW_PAGE[type]}`, "_blank", "noopener");
  });

  const actionsBar = h("div", { class: "sticky-actions" });
  function paintButtons() {
    clear(actionsBar);
    actionsBar.append(saveBtn, publishBtn, previewBtn);
    if (item) {
      if (item.status === "changed" || item.status === "deleted" || item.status === "new" || item.status === "scheduled") {
        actionsBar.append(h("button", { class: "btn", type: "button", onclick: discard }, item.status === "new" ? "Delete draft" : item.status === "deleted" ? "Keep it (cancel delete)" : "Discard changes"));
      }
      if (item.status !== "deleted") {
        actionsBar.append(h("button", { class: "btn", type: "button", onclick: schedule }, item.publishAt ? "Change schedule…" : "Schedule…"));
      }
      if (item.versionCount) actionsBar.append(h("button", { class: "btn", type: "button", onclick: history }, `History (${item.versionCount})`));
      if (!isSingleton && item.status !== "deleted") actionsBar.append(h("button", { class: "btn btn--danger", type: "button", onclick: remove }, "Delete"));
    }
    actionsBar.append(h("span", { class: "grow" }), dirtyNote);
    publishBtn.disabled = !!(item && item.status === "deleted");
  }

  async function discard() {
    const msg = item.status === "new" ? "Delete this unpublished draft?" : item.status === "deleted" ? "Cancel the deletion and keep this on the website?" : "Throw away your draft changes and go back to what's live?";
    if (!(await confirmDialog(msg, { confirmText: "Yes", danger: item.status === "new" }))) return;
    try {
      const res = await api.post(`/content/${type}/${item.id}/discard`);
      state.dirty = false;
      refreshPending();
      if (res.removed) { toast("Draft deleted.", "ok"); go(listHash(type)); }
      else { toast("Draft reset.", "ok"); editorView(root, type, id); }
    } catch (e) { toast(e.message, "error"); }
  }

  async function remove() {
    const live = item.published != null;
    const msg = live ? `Delete “${item.title}”? It will be removed from the website the next time you publish.` : `Delete “${item.title}”?`;
    if (!(await confirmDialog(msg, { confirmText: "Delete", danger: true }))) return;
    try {
      const res = await api.del(`/content/${type}/${item.id}`);
      state.dirty = false;
      refreshPending();
      if (res.immediate) { toast("Deleted.", "ok"); go(listHash(type)); }
      else { toast("Marked for deletion — publish to remove it from the site.", "ok"); editorView(root, type, id); }
    } catch (e) { toast(e.message, "error"); }
  }

  async function schedule() {
    const input = h("input", { type: "datetime-local", value: localInputValue(item.publishAt) });
    const m = modal("Schedule publishing", h("div", { class: "stack" },
      h("p", null, "The current draft will go live automatically at this time. Edits you save before then are included."),
      h("label", { class: "field" }, h("span", { class: "field__label" }, "Publish at"), input)
    ), {
      footer: [
        item.publishAt ? h("button", { class: "btn btn--danger", type: "button", onclick: async () => { await apply(null); } }, "Clear schedule") : null,
        h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Cancel"),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => apply(input.value ? new Date(input.value).toISOString() : null) }, "Schedule"),
      ],
    });
    async function apply(at) {
      try {
        const res = await api.post(`/content/${type}/${item.id}/schedule`, { at });
        item = res.item; m.close(); paintBanner(); paintButtons(); refreshPending();
        toast(at ? "Scheduled." : "Schedule cleared.", "ok");
      } catch (e) { toast(e.message, "error"); }
    }
  }

  async function history() {
    let versions;
    try { versions = (await api.get(`/content/${type}/${item.id}/versions`)).versions; }
    catch (e) { toast(e.message, "error"); return; }
    const body = h("div", { class: "stack" },
      h("p", { class: "muted" }, "Each time this was published, a copy was kept. Restoring loads that version into your draft (you can review it before publishing), or publish it straight away."),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", null, "Published"), h("th", null, "By"), h("th", null, ""))),
        h("tbody", null, versions.map((v) => h("tr", null,
          h("td", null, fmtDate(v.at)),
          h("td", null, v.by),
          h("td", { class: "actions" },
            h("button", { class: "btn btn--small", type: "button", onclick: () => restore(v.index, false) }, "Restore to draft"),
            " ",
            h("button", { class: "btn btn--small btn--primary", type: "button", onclick: () => restore(v.index, true) }, "Restore & publish")
          )
        )))
      ))
    );
    const m = modal("Version history", body, { wide: true });
    async function restore(index, publishNow) {
      if (!(await confirmDialog(publishNow ? "Restore this version and publish it now?" : "Replace your current draft with this version?", { confirmText: "Restore" }))) return;
      try {
        await api.post(`/content/${type}/${item.id}/restore`, { index, publishNow });
        m.close(); state.dirty = false; refreshPending();
        toast(publishNow ? "Restored and published." : "Restored to draft.", "ok");
        editorView(root, type, id);
      } catch (e) { toast(e.message, "error"); }
    }
  }

  /* ---------- page ---------- */
  const title = isNew ? `New ${spec.singular.toLowerCase()}` : isSingleton ? spec.label : item.title;
  clear(root).append(
    h("div", { class: "page-head" },
      h("div", null,
        !isSingleton ? h("a", { href: listHash(type), class: "small" }, `← ${spec.label}`) : null,
        h("h1", null, title),
        spec.help && isSingleton ? h("p", { class: "muted" }, spec.help) : null
      )
    ),
    h("div", { class: "stack" }, banner, h("div", { class: "card" }, h("div", { class: "card__body" }, form.el)), actionsBar)
  );
  paintButtons();
  if (isNew) saveBtn.disabled = false;
}
