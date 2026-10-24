import { api } from "./api.js";
import { h, clear, modal, toast, spinner, confirmDialog, fmtBytes, fmtDate, debounce } from "./ui.js";

const url = (p) => "/" + p;

// The hosted admin accepts at most ~4.5 MB per request, so bigger photos are
// scaled down in the browser first (the server resizes to 2400px wide anyway).
const SHRINK_ABOVE = 3.5 * 1024 * 1024;

async function shrink(file, maxWidth) {
  if (file.size <= SHRINK_ABOVE || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxWidth / bmp.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp"; // webp keeps transparency
    const blob = await new Promise((r) => canvas.toBlob(r, type, 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + (type === "image/jpeg" ? ".jpg" : ".webp"), { type });
  } catch (_) {
    return file; // let the server report it
  }
}

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
    files = [...files];
    if (!files.length) return;
    const items = [];
    // One file per request keeps each request under the hosting size limit.
    for (const [i, f] of files.entries()) {
      status.textContent = files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…";
      const fd = new FormData();
      fd.append("purpose", purpose);
      fd.append("files", await shrink(f, purpose === "logo" ? 800 : 2400));
      try {
        const res = await api.upload("/media", fd);
        items.push(...res.items);
        (res.errors || []).forEach((er) => toast(`${er.name}: ${er.error}`, "error"));
      } catch (e) {
        if (e.details && e.details.errors) e.details.errors.forEach((er) => toast(`${er.name}: ${er.error}`, "error"));
        else toast(`${f.name}: ${e.status === 413 ? "That file is too large." : e.message}`, "error");
      }
    }
    if (items.length) toast(`Uploaded ${items.length} image${items.length > 1 ? "s" : ""}.`, "ok");
    if (mode === "pick" && items.length === 1) { onPick(items[0].path); return; }
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
