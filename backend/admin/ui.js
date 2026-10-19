/* Tiny DOM + UI helpers. Elements are built with textContent (never innerHTML)
   so content from the database can't inject markup into the admin. */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected" || k === "multiple") el[k] = !!v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function spinner() {
  return h("div", { class: "spinner", role: "status", "aria-label": "Loading" });
}

/* ---------- toasts ---------- */
let toastBox;
export function toast(message, type = "info") {
  if (!toastBox) {
    toastBox = h("div", { class: "toasts", role: "status" });
    document.body.append(toastBox);
  }
  const t = h("div", { class: "toast" + (type === "error" ? " toast--error" : type === "ok" ? " toast--ok" : "") }, message);
  toastBox.append(t);
  setTimeout(() => t.remove(), type === "error" ? 7000 : 3800);
}

/* ---------- modal ---------- */
export function modal(title, body, { wide = false, footer = null, onClose } = {}) {
  const prevFocus = document.activeElement;
  const close = (result) => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose(result);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const closeBtn = h("button", { class: "btn btn--ghost btn--icon", type: "button", "aria-label": "Close", onclick: () => close() }, "✕");
  const box = h(
    "div",
    { class: "modal" + (wide ? " modal--wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "modal__head" }, h("h2", null, title), closeBtn),
    h("div", { class: "modal__body" }, body),
    footer ? h("div", { class: "modal__foot" }, footer) : null
  );
  const overlay = h("div", { class: "overlay", onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
  const first = box.querySelector("input, select, textarea, button.btn--primary");
  (first || closeBtn).focus();
  return { close, box };
}

export function confirmDialog(message, { confirmText = "Confirm", danger = false, title = "Are you sure?" } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; m.close(v); resolve(v); };
    const m = modal(title, h("p", null, message), {
      footer: [
        h("button", { class: "btn", type: "button", onclick: () => done(false) }, "Cancel"),
        h("button", { class: "btn " + (danger ? "btn--danger" : "btn--primary"), type: "button", onclick: () => done(true) }, confirmText),
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export function promptDialog(title, label, { initial = "", type = "text", confirmText = "Save", help = "" } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h("input", { type, value: initial, autocomplete: "off" });
    const done = (v) => { answered = true; m.close(); resolve(v); };
    const m = modal(
      title,
      h("label", { class: "field" }, h("span", { class: "field__label" }, label), input, help ? h("div", { class: "field__help" }, help) : null),
      {
        footer: [
          h("button", { class: "btn", type: "button", onclick: () => done(null) }, "Cancel"),
          h("button", { class: "btn btn--primary", type: "button", onclick: () => done(input.value) }, confirmText),
        ],
        onClose: () => { if (!answered) resolve(null); },
      }
    );
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(input.value); });
  });
}

/* ---------- formatting ---------- */
export function fmtDate(iso, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts = withTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleString("en-IN", opts);
}

export function ago(iso) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 14) return Math.floor(s / 86400) + " d ago";
  return fmtDate(iso, false);
}

export function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

const STATUS_LABEL = { live: "Live", changed: "Draft changes", new: "Not published", scheduled: "Scheduled", deleted: "Pending delete" };
export function statusBadge(status) {
  return h("span", { class: "badge badge--" + status }, STATUS_LABEL[status] || status);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Download a text blob (used for CSV/JSON that arrive via fetch). */
export function downloadLink(url, label, cls = "btn") {
  return h("a", { class: cls, href: url, download: "" }, label);
}
