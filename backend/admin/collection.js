import { api } from "./api.js";
import { h, clear, spinner, toast, statusBadge, ago, debounce } from "./ui.js";
import { state, refreshPending } from "./state.js";

const trim2 = (n) => String(Number(Number(n).toFixed(2)));

function formatCell(field, value, refs) {
  if (value === undefined || value === null || value === "") return "—";
  switch (field.type) {
    case "boolean": return value ? "Yes" : "No";
    case "select": return (field.options.find((o) => o.value === value) || { label: value }).label.replace(/ \(.*\)$/, "");
    case "ref": return ((refs[field.ref] || []).find((r) => r.id === value) || { name: value }).name;
    case "number":
      if (field.key === "valueCr") return value >= 1 ? `₹${Number(value).toFixed(2)} Cr` : `₹${trim2(value * 100)} Lakh`;
      return String(value);
    default: return String(value);
  }
}

/** List view for a collection: search, filters, status badges, reorder, quick publish. */
export async function collectionView(root, type) {
  const spec = state.schemas[type];
  if (!spec) { clear(root).append(h("div", { class: "empty" }, "You don't have access to this section.")); return; }
  clear(root).append(spinner());

  let items, refs = {};
  async function load() {
    const res = await api.get(`/content/${type}`);
    items = res.items;
    refs = res.refs || {};
  }
  try { await load(); } catch (e) { clear(root).append(h("div", { class: "empty" }, e.message)); return; }

  const search = h("input", { type: "search", placeholder: `Search ${spec.label.toLowerCase()}…`, "aria-label": "Search" });
  const filters = {};
  const filterEls = [];
  if (type === "projects") {
    const dom = h("select", { "aria-label": "Domain" }, h("option", { value: "" }, "All domains"), (refs.domains || []).map((d) => h("option", { value: d.id }, d.name)));
    const st = h("select", { "aria-label": "Status" }, h("option", { value: "" }, "Any status"), h("option", { value: "active" }, "Active"), h("option", { value: "completed" }, "Completed"));
    const vis = h("select", { "aria-label": "Visibility" }, h("option", { value: "" }, "Shown or hidden"), h("option", { value: "yes" }, "Shown on website"), h("option", { value: "no" }, "Hidden"));
    Object.assign(filters, { domain: dom, status: st, visible: vis });
    filterEls.push(dom, st, vis);
  }

  const tbody = h("tbody");
  const count = h("span", { class: "muted small" });
  const cols = spec.listColumns.map((k) => spec.fields.find((f) => f.key === k)).filter(Boolean);

  function sorted(list) {
    const arr = list.slice();
    if (spec.ordered) arr.sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
    else if (type === "projects") {
      const dn = (id) => ((refs.domains || []).find((d) => d.id === id) || { name: "~" }).name;
      arr.sort((a, b) => dn(a.data.domain).localeCompare(dn(b.data.domain)) || (b.data.valueCr || -1) - (a.data.valueCr || -1));
    }
    return arr;
  }

  function visible() {
    const q = search.value.trim().toLowerCase();
    return sorted(items).filter((it) => {
      if (q && !(it.title + " " + JSON.stringify(it.data)).toLowerCase().includes(q)) return false;
      if (filters.domain && filters.domain.value && it.data.domain !== filters.domain.value) return false;
      if (filters.status && filters.status.value && it.data.status !== filters.status.value) return false;
      if (filters.visible && filters.visible.value && (filters.visible.value === "yes") !== !!it.data.visible) return false;
      return true;
    });
  }

  async function move(item, dir) {
    const order = sorted(items).filter((i) => i.status !== "deleted").map((i) => i.id);
    const i = order.indexOf(item.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    try {
      const res = await api.post(`/content/${type}/reorder`, { ids: order });
      items = res.items;
      paint(); refreshPending();
    } catch (e) { toast(e.message, "error"); }
  }

  async function quickPublish(item) {
    try {
      await api.post(`/content/${type}/${item.id}/publish`);
      toast(`Published “${item.title}”.`, "ok");
      await load(); paint(); refreshPending();
    } catch (e) { toast(e.message, "error"); }
  }

  function paint() {
    clear(tbody);
    const rows = visible();
    count.textContent = `${rows.length} of ${items.length}`;
    if (!rows.length) {
      tbody.append(h("tr", null, h("td", { colspan: cols.length + 4, class: "empty" }, items.length ? "Nothing matches your filters." : `No ${spec.label.toLowerCase()} yet.`)));
      return;
    }
    const ordered = !!spec.ordered;
    rows.forEach((it, idx) => {
      tbody.append(h("tr", null,
        h("td", null, h("a", { class: "cell-title", href: `#/c/${type}/${it.id}` }, it.title)),
        cols.map((f) => h("td", null, formatCell(f, it.data[f.key], refs))),
        h("td", null, statusBadge(it.status)),
        h("td", { class: "muted small" }, ago(it.updatedAt)),
        h("td", { class: "actions" },
          ordered ? [
            h("button", { class: "btn btn--small btn--icon", type: "button", title: "Move up", "aria-label": "Move up", disabled: idx === 0 || !!search.value, onclick: () => move(it, -1) }, "↑"),
            " ",
            h("button", { class: "btn btn--small btn--icon", type: "button", title: "Move down", "aria-label": "Move down", disabled: idx === rows.length - 1 || !!search.value, onclick: () => move(it, 1) }, "↓"),
            " ",
          ] : null,
          it.status !== "live" && it.status !== "deleted" ? [h("button", { class: "btn btn--small btn--primary", type: "button", onclick: () => quickPublish(it) }, "Publish"), " "] : null,
          h("a", { class: "btn btn--small", href: `#/c/${type}/${it.id}` }, "Edit")
        )
      ));
    });
  }

  search.addEventListener("input", debounce(paint, 150));
  filterEls.forEach((f) => f.addEventListener("change", paint));

  clear(root).append(
    h("div", { class: "page-head" },
      h("div", null, h("h1", null, spec.label), spec.help ? h("p", { class: "muted" }, spec.help) : null),
      h("a", { class: "btn btn--primary", href: `#/c/${type}/new` }, `+ New ${spec.singular.toLowerCase()}`)
    ),
    h("div", { class: "card" },
      h("div", { class: "card__head" },
        h("div", { class: "row grow" }, h("div", { style: { minWidth: "220px", flex: "1" } }, search), filterEls.map((f) => h("div", { style: { minWidth: "150px" } }, f))),
        count
      ),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null,
          h("th", null, spec.singular),
          cols.map((f) => h("th", null, f.label.replace(/\(.*\)/, "").trim())),
          h("th", null, "Status"), h("th", null, "Edited"), h("th", null, "")
        )),
        tbody
      ))
    )
  );
  paint();
}
