"use strict";

/**
 * SVG generators for the three growth charts. They reproduce the existing
 * markup (classes, data-* hooks, geometry) from the year-by-year figures, so
 * the scroll animations and tooltips in js/animations.js keep working
 * unchanged. Geometry constants come from the hand-drawn originals.
 */

const { escHtml, fmtInt, trim2 } = require("./util");

const rupee = "₹";
const num = (n) => trim2(n);
const fyLong = (label) => "FY20" + String(label).slice(2); // FY21-22 -> FY2021-22

/* ---------- Home: line chart (viewBox 600x260) ---------- */

function trendChart(series, defsHtml) {
  const n = series.length;
  const max = Math.max(...series.map((s) => s.turnover));
  const x = (i) => 40 + i * (520 / (n - 1));
  const y = (v) => 220 - (v / max) * 183.31;
  const pts = series.map((s, i) => ({ x: +x(i).toFixed(2), y: +y(s.turnover).toFixed(2), s }));

  const line = pts.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" ");
  const area = line + ` L${pts[n - 1].x},220 L${pts[0].x},220 Z`;

  let svg = defsHtml || "";
  svg += `<line x1="24" y1="220" x2="576" y2="220" class="trend-chart__baseline" />`;
  svg += `<path class="trend-chart__area" data-trend-area d="${area}" />`;
  svg += `<path class="trend-chart__line" data-trend-line d="${line}" />`;

  pts.forEach((p, i) => {
    const current = i === n - 1;
    const r = current ? 6 : 5;
    const valueText = `${rupee}${num(p.s.turnover)} Cr`;
    svg += `<g class="trend-chart__point${current ? " trend-chart__point--current" : ""}" data-trend-point>`;
    svg += `<circle class="trend-chart__dot" cx="${p.x}" cy="${p.y}" r="${r}" />`;
    if (i === 0) svg += `<text x="${p.x}" y="${+(p.y - 16).toFixed(2)}" class="trend-chart__value">${num(p.s.turnover)}</text>`;
    if (current) svg += `<text x="${p.x}" y="${+(p.y - 14.7).toFixed(2)}" class="trend-chart__value">${escHtml(valueText)}</text>`;
    svg += `<circle class="trend-chart__hit" data-trend-hit cx="${p.x}" cy="${p.y}" r="16" tabindex="0" data-r="${r}" data-year="${escHtml(p.s.label)}" data-value="${escHtml(valueText)}">`;
    svg += `<title>${escHtml(p.s.label)}: ${escHtml(valueText)}</title></circle></g>`;
  });
  pts.forEach((p) => {
    svg += `<text x="${p.x}" y="240" class="trend-chart__year">${escHtml(p.s.label)}</text>`;
  });
  return svg;
}

function trendAria(series) {
  const a = series[0];
  const z = series[series.length - 1];
  return `Turnover line chart, ${fyLong(a.label)} to ${fyLong(z.label)}, rising from ${num(a.turnover)} to ${num(z.turnover)} crore rupees`;
}

/* ---------- Projects: simple bars (viewBox 440x240) ---------- */

function barGeometry(n) {
  const gap = 28;
  const width = (392 - (n - 1) * gap) / n;
  return { gap, width, x: (i) => 24 + i * (width + gap) };
}

function growthBars(series) {
  const n = series.length;
  const max = Math.max(...series.map((s) => s.turnover));
  const g = barGeometry(n);
  let svg = `<line x1="0" y1="200" x2="440" y2="200" class="growth-chart__baseline" />`;
  series.forEach((s, i) => {
    const h = +((s.turnover / max) * 146.7).toFixed(2);
    const yy = +(200 - h).toFixed(2);
    const cx = +(g.x(i) + g.width / 2).toFixed(2);
    svg += `<g class="growth-chart__bar${i === n - 1 ? " growth-chart__bar--current" : ""}">`;
    svg += `<rect x="${+g.x(i).toFixed(2)}" y="${yy}" width="${+g.width.toFixed(2)}" height="${h}" rx="4" />`;
    svg += `<text x="${cx}" y="${+(yy - 10).toFixed(2)}" class="growth-chart__value">${num(s.turnover)}</text>`;
    svg += `<text x="${cx}" y="220" class="growth-chart__year">${escHtml(s.label)}</text></g>`;
  });
  return svg;
}

function growthAria(series) {
  const a = series[0];
  const z = series[series.length - 1];
  const vals = series.map((s) => num(s.turnover));
  const head = vals.slice(0, -1).join(", ");
  return `Turnover growth chart, ${fyLong(a.label)} to ${fyLong(z.label)}: ${head}, and ${vals[vals.length - 1]} crore rupees`;
}

/* ---------- About: turnover bars + manpower icons (viewBox 440x260) ---------- */

const PERSON = `<circle cx="0" cy="-3.2" r="1.6" /><path d="M-2.6,3.2 C-2.6,-0.2 2.6,-0.2 2.6,3.2 L2.6,4.6 L-2.6,4.6 Z" />`;

function milestoneBars(series) {
  const n = series.length;
  const max = Math.max(...series.map((s) => s.turnover));
  const g = barGeometry(n);
  let svg = `<line x1="10" y1="225" x2="430" y2="225" class="milestone-chart__baseline" />`;
  series.forEach((s, i) => {
    const h = +((s.turnover / max) * 163.83).toFixed(2);
    const fy = +(225 - h).toFixed(2);
    const x0 = +g.x(i).toFixed(2);
    const w = +g.width.toFixed(2);
    const cx = +(g.x(i) + g.width / 2).toFixed(2);
    const manpower = fmtInt(s.workforce);
    svg += `<g class="milestone-bar${i === n - 1 ? " milestone-bar--current" : ""}" data-milestone-item>`;
    svg += `<rect class="milestone-bar__rect" data-milestone-bar x="${x0}" y="225" width="${w}" height="0" rx="4" data-final-y="${fy}" data-final-height="${h}" />`;
    svg += `<text x="${cx}" y="${+(fy + 22).toFixed(2)}" class="milestone-bar__value">${num(s.turnover)}</text>`;
    svg += `<g class="milestone-bar__icon" transform="translate(${cx},${+(fy - 32).toFixed(2)})">${PERSON}</g>`;
    svg += `<text x="${cx}" y="${+(fy - 14).toFixed(2)}" class="milestone-bar__manpower">${manpower}</text>`;
    svg += `<text x="${cx}" y="245" class="milestone-bar__year">${escHtml(s.label)}</text>`;
    svg += `<rect class="milestone-bar__hit" data-milestone-hit x="${x0}" y="0" width="${w}" height="260" tabindex="0" data-year="${escHtml(s.label)}" data-turnover="${rupee}${num(s.turnover)} Cr" data-manpower="${manpower}">`;
    svg += `<title>${escHtml(s.label)}: ${rupee}${num(s.turnover)} Cr turnover, ${manpower} people</title></rect></g>`;
  });
  return svg;
}

function milestoneAria(series) {
  const a = series[0];
  const z = series[series.length - 1];
  const parts = series.map((s, i) => {
    const head = i === 0 ? `${num(s.turnover)} crore rupees` : `${num(s.turnover)} crore`;
    return `${head} and ${fmtInt(s.workforce)} people`;
  });
  return `Turnover and manpower by year, ${fyLong(a.label)} to ${fyLong(z.label)}: ${parts.join(", ")}`;
}

module.exports = { trendChart, trendAria, growthBars, growthAria, milestoneBars, milestoneAria };
