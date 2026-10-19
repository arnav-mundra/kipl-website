"use strict";

const NF = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

const escHtml = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtInt = (n) => NF.format(Math.round(Number(n) || 0));
const trim2 = (n) => String(Number(Number(n).toFixed(2)));

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "₹34.40 Cr" / "₹58 Lakh" / the free-text label when there's no number. */
function formatValue(p) {
  if (p.valueCr == null || p.valueCr === "") return p.valueLabel || "—";
  const v = Number(p.valueCr);
  if (v >= 1) return "₹" + v.toFixed(2) + " Cr";
  return "₹" + trim2(v * 100) + " Lakh";
}

/** "2023–26", or just "2026" for a single year / open-ended contract. */
function formatYears(p) {
  const start = Number(p.yearStart);
  const end = p.yearEnd == null || p.yearEnd === "" ? null : Number(p.yearEnd);
  if (end && end > start) return `${start}–${String(end).slice(-2)}`;
  return String(start);
}

const projectTitle = (p) => (p.client ? `${p.client} — ${p.title}` : p.title);

/** Series maths shared by every figure on the site. */
function figuresMath(fig) {
  const series = fig.series;
  const first = series[0];
  const last = series[series.length - 1];
  const growthPct = Math.round(((last.turnover - first.turnover) / first.turnover) * 100);
  const ratio = last.turnover / first.turnover;
  const yearsActive = fig.yearsActive != null && fig.yearsActive !== "" ? Number(fig.yearsActive) : new Date().getFullYear() - Number(fig.established);
  return { series, first, last, growthPct, ratio, yearsActive, maxTurnover: Math.max(...series.map((s) => s.turnover)) };
}

function growthPhrase(ratio, growthPct) {
  if (ratio >= 3) return "more than tripled";
  if (ratio >= 2.75) return "nearly tripled";
  if (ratio >= 2) return "more than doubled";
  return `grown by ${growthPct}%`;
}

/** Replace only the direct text of an element, keeping child elements (e.g. a unit suffix span). */
function setLeadText($, el, text) {
  const $el = $(el);
  $el.contents().filter((_, n) => n.type === "text").remove();
  $el.prepend(escHtml(text));
}

function setBg($el, imagePath) {
  if (imagePath) $el.attr("style", `background-image:url('${imagePath.replace(/'/g, "%27")}')`);
  else $el.removeAttr("style");
}

/** Swap a spelled-out count ("Six domains…") for the current number, keeping capitalisation. */
function replaceCountWord($el, n) {
  const text = $el.text();
  const next = text.replace(/\b(six|Six)\b/, (m) => (m[0] === "S" ? cap(word(n)) : word(n)));
  if (next !== text) $el.text(next);
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Make an existing list of nodes reflect `items`, reusing the page's own
 * markup as the template (so animations, classes and icons stay exactly as
 * authored). Nodes are matched by key where possible; anything new is cloned
 * from `template` (default: the first node); nodes with no matching item are
 * dropped. Order follows `items`.
 */
function syncList($, container, selector, items, opts) {
  const { keyOfNode, keyOfItem, fill, template } = opts;
  const $container = $(container);
  const nodes = $container.children(selector).toArray();
  const templateHtml = template != null ? template : nodes.length ? $.html(nodes[0]) : null;
  if (!templateHtml && items.length) return [];

  const byKey = new Map();
  if (keyOfNode) nodes.forEach((n) => { const k = keyOfNode($(n)); if (k != null && !byKey.has(k)) byKey.set(k, n); });

  const used = [];
  items.forEach((item, i) => {
    let node = keyOfItem && keyOfNode ? byKey.get(keyOfItem(item)) : null;
    if (node) byKey.delete(keyOfItem(item));
    const $node = node ? $(node) : $(templateHtml);
    fill($node, item, i, !node);
    used.push($node);
  });

  nodes.forEach((n) => $(n).remove());
  used.forEach(($n) => $container.append($n));
  return used;
}

module.exports = {
  escHtml, fmtInt, trim2, word, cap, formatValue, formatYears, projectTitle, figuresMath, growthPhrase,
  setLeadText, setBg, syncList, replaceCountWord, pad2,
};
