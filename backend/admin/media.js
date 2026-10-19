import { api } from "./api.js";
import { h, clear, modal, toast, spinner, confirmDialog, fmtBytes, fmtDate, debounce } from "./ui.js";

const url = (p) => "/" + p;

/**
 * Image browser shared by the Media page ("manage" mode) and the image picker
 * dialog ("pick" mode). Returns { el, reload }.
 */
export function mediaBrowser({ mode = "manage", purpose = "photo", onPick, canUpload = true } = {}) {
  const grid = h("div", { class: "media-grid" });
  const search = h("input", { type: "search", placeholder: "Search images…", "aria-label": "Search images" });
  const source = h("select", { "aria-label": "Source" },
    h("option", { value: "" }, "All images"),
    h("option", { value: "uploads" }, "Uploaded"),
    h("option", { value: "builtin" }, "Site images")
  );
  const fileInput = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp", class: "sr-only", tabindex: "-1" });
  const status = h("div", { class: "muted small" });

  async function load() {
    clear(grid).append(spinner());
    try {
      const { items } = await api.get(`/media?q=${encodeURIComponent(search.value)}&source=${source.value}`);
      clear(grid);
      status.textContent = `${items.length} image${items.length === 1 ? "" : "s"}`;
      if (!items.length) grid.append(h("div", { class: "empty", style: { gridColumn: "1 / -1" } }, "No images found."));
      items.forEach((m) => grid.append(card(m)));
    } catch (e) {
      clear(grid).append(h("div", { class: "empty" }, e.message));
    }
  }

  function card(m) {
    const click = () => (mode === "pick" ? onPick(m.path) : details(m));
    return h("button", { class: "media-item", type: "button", onclick: click, title: m.path },
      h("span", { class: "media-item__img", style: { backgroundImage: `url("${url(m.thumb)}")` }, role: "img", "aria-label": m.name }),
      h("span", { class: "media-item__meta" },
        h("strong", null, m.name),
        h("span", { class: "muted" }, m.builtin ? `Site image · ${fmtBytes(m.bytes)}` : `${m.width}×${m.height} · ${fmtBytes(m.bytes)}`)
      )
    );
  }

  function details(m) {
    const rows = [
      ["File", m.name],
      ["Path", m.path],
      ["Size", fmtBytes(m.bytes)],
      m.builtin ? ["Type", "Built-in site image (can't be deleted here)"] : ["Dimensions", `${m.width} × ${m.height}px`],
      m.builtin ? null : ["Uploaded", `${fmtDate(m.uploadedAt)} by ${m.uploadedBy}`],
    ].filter(Boolean);
    const body = h("div", { class: "stack" },
      h("img", { src: url(m.path), alt: m.name, style: { maxWidth: "100%", maxHeight: "50vh", borderRadius: "8px", display: "block", margin: "0 auto" } }),
      h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)]))
    );
    const foot = [];
    if (!m.builtin && canUpload) {
      foot.push(h("button", { class: "btn btn--danger", type: "button", onclick: async () => {
        if (!(await confirmDialog(`Delete “${m.name}”? This can't be undone.`, { confirmText: "Delete", danger: true }))) return;
        try { await api.del(`/media/${m.id}`); toast("Image deleted.", "ok"); dlg.close(); load(); }
        catch (e) { toast(e.message, "error"); }
      } }, "Delete"));
    }
    foot.push(h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Close"));
    const dlg = modal("Image details", body, { footer: foot, wide: true });
  }

  async function upload(files) {
    if (!files.length) return;
    const fd = new FormData();
    fd.append("purpose", purpose);
    [...files].forEach((f) => fd.append("files", f));
    status.textContent = "Uploading…";
    try {
      const res = await api.upload("/media", fd);
      if (res.items.length) toast(`Uploaded ${res.items.length} image${res.items.length > 1 ? "s" : ""}.`, "ok");
      (res.errors || []).forEach((er) => toast(`${er.name}: ${er.error}`, "error"));
      if (mode === "pick" && res.items.length === 1) { onPick(res.items[0].path); return; }
    } catch (e) {
      toast(e.message, "error");
      if (e.details && e.details.errors) e.details.errors.forEach((er) => toast(`${er.name}: ${er.error}`, "error"));
    }
    load();
  }

  fileInput.addEventListener("change", () => { upload(fileInput.files); fileInput.value = ""; });

  const drop = h("div", { class: "dropzone" },
    "Drag images here, or ",
    h("button", { class: "btn btn--small", type: "button", onclick: () => fileInput.click() }, "choose files"),
    h("div", { class: "small" }, "JPG, PNG or WebP, up to 15 MB each. Images are resized and optimised automatically." +
      (purpose === "logo" ? " Logos keep transparency." : ""))
  );
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => upload(e.dataTransfer.files));

  search.addEventListener("input", debounce(load, 250));
  source.addEventListener("change", load);

  const el = h("div", { class: "stack" },
    canUpload ? drop : null,
    fileInput,
    h("div", { class: "row" }, h("div", { class: "grow" }, search), h("div", { style: { width: "170px" } }, source), status),
    grid
  );
  load();
  return { el, reload: load };
}

/** Modal that resolves with the chosen image path (or null). */
export function pickImage({ purpose = "photo", canUpload = true } = {}) {
  return new Promise((resolve) => {
    let picked = false;
    const browser = mediaBrowser({
      mode: "pick", purpose, canUpload,
      onPick: (path) => { picked = true; dlg.close(); resolve(path); },
    });
    const dlg = modal("Choose an image", browser.el, { wide: true, onClose: () => { if (!picked) resolve(null); } });
  });
}
