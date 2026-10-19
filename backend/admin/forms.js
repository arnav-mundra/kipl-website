import { h } from "./ui.js";
import { pickImage } from "./media.js";

/**
 * Schema-driven forms. The server publishes each resource's field list
 * (backend/src/schemas.js); this turns those definitions into inputs, and
 * maps validation errors (by path such as "series[2].turnover") back onto
 * the right input.
 */

function blankValue(f) {
  switch (f.type) {
    case "boolean": return f.default === true;
    case "list": return [];
    case "object": return Object.fromEntries(f.fields.map((x) => [x.key, blankValue(x)]));
    case "number": return f.default !== undefined ? f.default : "";
    default: return f.default !== undefined ? f.default : "";
  }
}

/** Wrap a leaf input with label, help text and an error slot. */
function wrapper(f, inner, { inline = false } = {}) {
  const err = h("div", { class: "field__error", hidden: true, role: "alert" });
  const el = h("div", { class: "field" + (f.type === "text" || f.type === "list" || f.type === "image" || f.type === "object" ? " field--wide" : "") },
    inline ? null : h("span", { class: "field__label" }, f.label, f.required ? h("span", { class: "req", "aria-hidden": "true" }, "*") : null),
    inner,
    f.help ? h("div", { class: "field__help" }, f.help) : null,
    err
  );
  return {
    el,
    setError(msg) {
      el.classList.toggle("has-error", !!msg);
      err.hidden = !msg;
      err.textContent = msg || "";
    },
  };
}

function leaf(f, value, ctx) {
  const change = () => ctx.onChange && ctx.onChange();

  if (f.type === "string" || f.type === "number") {
    const input = h("input", {
      type: f.type === "number" ? "number" : "text",
      value: value == null ? "" : value,
      placeholder: f.placeholder || "",
      maxlength: f.type === "string" && f.max ? f.max : null,
      step: f.type === "number" ? (f.step || (f.integer ? 1 : "any")) : null,
      min: f.type === "number" && f.min !== undefined ? f.min : null,
      max: f.type === "number" && f.max !== undefined ? f.max : null,
      autocomplete: "off",
      oninput: change,
    });
    const w = wrapper(f, input);
    return { el: w.el, get: () => input.value, setError: w.setError };
  }

  if (f.type === "text") {
    const ta = h("textarea", { value: value || "", maxlength: f.max || null, placeholder: f.placeholder || "", oninput: change });
    const w = wrapper(f, ta);
    return { el: w.el, get: () => ta.value, setError: w.setError };
  }

  if (f.type === "boolean") {
    const cb = h("input", { type: "checkbox", checked: !!value, onchange: change });
    const label = h("label", { class: "checkbox" }, cb, f.label);
    const w = wrapper(f, label, { inline: true });
    return { el: w.el, get: () => cb.checked, setError: w.setError };
  }

  if (f.type === "select" || f.type === "ref") {
    const opts = f.type === "select" ? f.options : (ctx.refs && ctx.refs[f.ref]) || [];
    const select = h("select", { onchange: change },
      !f.required || f.type === "ref" ? h("option", { value: "" }, f.required ? "Choose…" : "— none —") : null,
      opts.map((o) => h("option", { value: o.value !== undefined ? o.value : o.id }, o.label !== undefined ? o.label : o.name))
    );
    select.value = value || (f.required && f.type === "select" && opts[0] ? (opts[0].value) : "");
    if (f.type === "ref" && value && ![...select.options].some((o) => o.value === value)) {
      select.append(h("option", { value }, value + " (missing)"));
      select.value = value;
    }
    const w = wrapper(f, select);
    return { el: w.el, get: () => select.value, setError: w.setError };
  }

  if (f.type === "image") {
    let current = value || "";
    const thumb = h("div", { class: "image-field__thumb" });
    const path = h("div", { class: "image-field__path" });
    const choose = h("button", { class: "btn btn--small", type: "button" }, "Choose image…");
    const remove = h("button", { class: "btn btn--small btn--ghost", type: "button" }, "Remove");
    const paint = () => {
      thumb.style.backgroundImage = current ? `url("/${current}")` : "";
      thumb.textContent = current ? "" : "No image";
      path.textContent = current;
      remove.hidden = !current;
      choose.textContent = current ? "Change image…" : "Choose image…";
    };
    choose.addEventListener("click", async () => {
      const picked = await pickImage({ purpose: f.purpose || "photo", canUpload: ctx.canUpload !== false });
      if (picked) { current = picked; paint(); change(); }
    });
    remove.addEventListener("click", () => { current = ""; paint(); change(); });
    paint();
    const w = wrapper(f, h("div", { class: "image-field" }, thumb, h("div", null, h("div", { class: "row" }, choose, remove), path)));
    return { el: w.el, get: () => current, setError: w.setError };
  }

  throw new Error("Unsupported field type " + f.type);
}

/* ---------- nested structures ---------- */

function objectBody(fields, data, ctx) {
  const children = {};
  const grid = h("div", { class: "form-grid" });
  for (const f of fields) {
    const c = control(f, data ? data[f.key] : undefined, ctx);
    children[f.key] = c;
    grid.append(c.el);
  }
  return {
    el: grid,
    get: () => Object.fromEntries(fields.map((f) => [f.key, children[f.key].get()])),
    find(tokens) {
      if (!tokens.length) return null;
      const [k, ...rest] = tokens;
      const c = children[k];
      return c ? (rest.length && c.find ? c.find(rest) : c) : null;
    },
  };
}

function listControl(f, value, ctx) {
  const items = [];
  const box = h("div", { class: "list-items" });
  const addBtn = h("button", { class: "btn btn--small", type: "button" }, "+ Add");
  const change = () => ctx.onChange && ctx.onChange();

  const err = h("div", { class: "field__error", hidden: true, role: "alert" });
  const outer = h("div", { class: "field field--wide" },
    h("span", { class: "field__label" }, f.label),
    box,
    h("div", { style: { marginTop: "8px" } }, addBtn),
    f.help ? h("div", { class: "field__help" }, f.help) : null,
    err
  );

  const move = (item, dir) => {
    const i = items.indexOf(item);
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    redraw(); change();
  };
  const del = (item) => { items.splice(items.indexOf(item), 1); redraw(); change(); };

  function tools(item) {
    return h("div", { class: "list-item__tools" },
      h("button", { class: "btn btn--small btn--icon", type: "button", title: "Move up", "aria-label": "Move up", onclick: () => move(item, -1) }, "↑"),
      h("button", { class: "btn btn--small btn--icon", type: "button", title: "Move down", "aria-label": "Move down", onclick: () => move(item, 1) }, "↓"),
      h("button", { class: "btn btn--small btn--icon btn--danger", type: "button", title: "Remove", "aria-label": "Remove", onclick: () => del(item) }, "✕")
    );
  }

  function makeItem(v) {
    if (f.of === "object") {
      const body = objectBody(f.fields, v, ctx);
      return { body, get: () => body.get(), find: (t) => (t.length ? body.find(t) : null), setError() {} };
    }
    const scalar = { key: "item", label: f.label, type: f.of, max: f.itemMax, purpose: f.purpose };
    const c = leaf(scalar, v, ctx);
    // Scalar rows don't repeat the list's label above each input.
    const lab = c.el.querySelector(".field__label");
    if (lab) lab.remove();
    return { body: c, get: () => c.get(), find: () => null, setError: c.setError };
  }

  function redraw() {
    box.replaceChildren();
    items.forEach((item, i) => {
      if (f.of === "object") {
        box.append(h("div", { class: "list-card" },
          h("div", { class: "list-card__head" }, h("span", null, `${f.itemLabel || "Item"} ${i + 1}`), tools(item)),
          item.body.el
        ));
      } else {
        box.append(h("div", { class: "list-item" }, h("div", { class: "grow" }, item.body.el), tools(item)));
      }
    });
    if (!items.length) box.append(h("div", { class: "muted small" }, "Nothing here yet."));
    addBtn.hidden = !!(f.maxItems && items.length >= f.maxItems);
  }

  (Array.isArray(value) ? value : []).forEach((v) => items.push(makeItem(v)));
  addBtn.addEventListener("click", () => {
    items.push(makeItem(f.of === "object" ? blankValue({ type: "object", fields: f.fields }) : ""));
    redraw(); change();
    const last = box.lastElementChild && box.lastElementChild.querySelector("input, textarea, select");
    if (last) last.focus();
  });
  redraw();

  return {
    el: outer,
    get: () => items.map((i) => i.get()),
    setError(msg) { outer.classList.toggle("has-error", !!msg); err.hidden = !msg; err.textContent = msg || ""; },
    find(tokens) {
      if (!tokens.length) return null;
      const m = /^\[(\d+)\]$/.exec(tokens[0]);
      if (!m) return null;
      const item = items[Number(m[1])];
      if (!item) return null;
      return tokens.length === 1 ? item : item.find(tokens.slice(1));
    },
  };
}

function objectControl(f, value, ctx) {
  const body = objectBody(f.fields, value || {}, ctx);
  const set = h("div", { class: "fieldset field--wide" }, h("div", { class: "fieldset__title" }, f.label), f.help ? h("div", { class: "field__help" }, f.help) : null, body.el);
  return { el: set, get: () => body.get(), setError() {}, find: (t) => body.find(t) };
}

function control(f, value, ctx) {
  if (f.type === "list") return listControl(f, value, ctx);
  if (f.type === "object") return objectControl(f, value, ctx);
  return leaf(f, value, ctx);
}

/** "series[2].turnover" -> ["series", "[2]", "turnover"] */
function tokenise(path) {
  return path.match(/[^.[\]]+|\[\d+\]/g) || [];
}

export function createForm(fields, data, ctx = {}) {
  const body = objectBody(fields, data, ctx);
  let flagged = [];
  return {
    el: body.el,
    getValue: () => body.get(),
    /** Show server validation errors. Returns the ones that couldn't be placed. */
    setErrors(errors) {
      flagged.forEach((c) => c.setError(""));
      flagged = [];
      const orphans = [];
      for (const e of errors || []) {
        const c = body.find(tokenise(e.path));
        if (c && c.setError) { c.setError(e.message); flagged.push(c); }
        else orphans.push(e);
      }
      const first = body.el.querySelector(".has-error");
      if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
      return orphans;
    },
  };
}

export { blankValue };
