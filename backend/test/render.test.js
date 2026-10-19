"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const util = require("../src/render/util");
const charts = require("../src/render/charts");
const seed = require("../seed/content.json");

test("value formatting: crore, lakh, free text", () => {
  assert.equal(util.formatValue({ valueCr: 34.4 }), "₹34.40 Cr");
  assert.equal(util.formatValue({ valueCr: 100.82 }), "₹100.82 Cr");
  assert.equal(util.formatValue({ valueCr: 0.58 }), "₹58 Lakh");
  assert.equal(util.formatValue({ valueCr: 0.855 }), "₹85.5 Lakh");
  assert.equal(util.formatValue({ valueCr: null, valueLabel: "Variable" }), "Variable");
  assert.equal(util.formatValue({ valueCr: null, valueLabel: "" }), "—");
});

test("year formatting", () => {
  assert.equal(util.formatYears({ yearStart: 2023, yearEnd: 2026 }), "2023–26");
  assert.equal(util.formatYears({ yearStart: 2026, yearEnd: null }), "2026");
  assert.equal(util.formatYears({ yearStart: 2025, yearEnd: 2025 }), "2025");
});

test("number words and the growth phrase", () => {
  assert.equal(util.word(5), "five");
  assert.equal(util.word(15), "15");
  const { ratio, growthPct } = util.figuresMath(seed.figures);
  assert.equal(growthPct, 178);
  assert.equal(util.growthPhrase(ratio, growthPct), "nearly tripled");
  assert.equal(util.growthPhrase(1.4, 40), "grown by 40%");
});

test("years active: automatic unless overridden", () => {
  const base = Object.assign({}, seed.figures, { yearsActive: null, established: 2009 });
  assert.equal(util.figuresMath(base).yearsActive, new Date().getFullYear() - 2009);
  assert.equal(util.figuresMath(Object.assign({}, base, { yearsActive: 20 })).yearsActive, 20);
});

test("chart geometry reproduces the original hand-drawn charts", () => {
  const s = seed.figures.series;

  const trend = charts.trendChart(s, "");
  assert.ok(trend.includes('d="M40,154.05 L170,127.16 L300,111.04 L430,110.24 L560,36.69"'), "trend line path");
  assert.ok(trend.includes('data-value="₹100.82 Cr"'));

  const mile = charts.milestoneBars(s);
  assert.ok(mile.includes('data-final-y="166.06" data-final-height="58.94"'), "first milestone bar");
  assert.ok(mile.includes('data-final-y="61.17" data-final-height="163.83"'), "tallest milestone bar");
  assert.ok(mile.includes("translate(52,134.06)"), "manpower icon sits above the bar");
  assert.ok(mile.includes(">1,100<"), "manpower is formatted with separators");

  const bars = charts.growthBars(s);
  const first = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(bars).slice(1).map(Number);
  assert.deepEqual(first.slice(0, 1).concat(first.slice(2, 3)), [24, 56], "first growth bar position and width");
  assert.ok(Math.abs(first[1] - 147.2) < 0.1 && Math.abs(first[3] - 52.8) < 0.1, "first growth bar height matches the original");
  assert.ok(bars.includes("growth-chart__bar--current"));
});

test("charts adapt to a different number of years", () => {
  const three = seed.figures.series.slice(0, 3);
  const bars = charts.growthBars(three);
  assert.equal((bars.match(/<rect /g) || []).length, 3);
  const rects = [...bars.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(rects[2][0] + rects[2][1] <= 416.01, "bars stay inside the viewBox");
  assert.equal((charts.trendChart(three, "").match(/data-trend-point/g) || []).length, 3);
});

test("syncList reuses, reorders, adds and removes nodes using the page's own markup", () => {
  const cheerio = require("cheerio");
  const $ = cheerio.load('<ul><li data-k="a">A</li><li data-k="b">B</li><li data-k="c">C</li></ul>');
  util.syncList($, $("ul"), "li", [{ k: "c" }, { k: "new" }, { k: "a" }], {
    keyOfNode: ($n) => $n.attr("data-k"),
    keyOfItem: (i) => i.k,
    fill($n, i) { $n.attr("data-k", i.k).text(i.k.toUpperCase()); },
  });
  assert.deepEqual($("li").map((_, e) => $(e).text()).get(), ["C", "NEW", "A"]);
});
