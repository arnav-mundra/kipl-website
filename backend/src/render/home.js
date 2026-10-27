"use strict";

const {
  escHtml, fmtInt, trim2, word, cap, formatValue, formatYears, figuresMath,
  setBg, syncList, replaceCountWord, pad2,
} = require("./util");
const charts = require("./charts");
const icons = require("./icons");

function patchHome($, c) {
  const { site, figures, people, domains, projects, clients } = c;
  const math = figuresMath(figures);

  /* ---- hero ---- */
  if (site.hero.eyebrow) $(".hero--home .eyebrow").text(site.hero.eyebrow);
  $(".hero--home h1").text(site.hero.headline);
  if (site.hero.lead) $(".hero--home .hero__lead").text(site.hero.lead);

  /* ---- stat band ---- */
  const $stats = $(".stats .stat");
  $stats.eq(0).find(".stat__value").text(String(figures.established));
  $stats.eq(1).find("[data-counter-to]").attr("data-counter-to", math.yearsActive);
  $stats.eq(2).find("[data-counter-to]").attr("data-counter-to", figures.fabricationCapacity);
  $stats.eq(3).find("[data-counter-to]").attr("data-counter-to", domains.length);

  /* ---- core values ---- */
  syncList($, $(".values .mosaic-row-list"), ".mosaic-row", people.coreValues, {
    fill($li, v, i) {
      const $panel = $li.find(".mosaic-row__panel");
      $panel
        .attr("data-mosaic-tone", i % 4)
        .removeClass("mosaic-row__panel--tint-blue mosaic-row__panel--tint-orange")
        .addClass(i % 2 === 0 ? "mosaic-row__panel--tint-blue" : "mosaic-row__panel--tint-orange");
      setBg($panel, v.image);
      $li.find(".mosaic-row__index").text(pad2(i + 1));
      $li.find(".mosaic-row__name").text(v.name);
      $li.find(".mosaic-row__detail .eyebrow").text(v.tagline);
      $li.find(".mosaic-row__desc").html(`<strong>${escHtml(v.lead)}</strong> ${escHtml(v.text)}`);
    },
  });

  /* ---- services tiles ---- */
  replaceCountWord($(".service-tiles h2.section-head__title"), domains.length);
  syncList($, $(".service-tiles__grid"), ".service-tile", domains, {
    keyOfNode: ($li) => ($li.find("a").attr("href") || "").replace(/^\/?services(\.html)?#/, ""),
    keyOfItem: (d) => d.id,
    fill($li, d, i, isNew) {
      $li.find("a").attr("href", `/services#${d.id}`);
      const $media = $li.find(".service-tile__media");
      $media.attr("data-mosaic-tone", i % 4);
      setBg($media, d.tileImage);
      if (isNew) $media.find("svg").replaceWith(icons.tile);
      $li.find(".service-tile__index").text(pad2(i + 1));
      $li.find(".service-tile__name").text(d.name);
      $li.find(".service-tile__desc").text(d.tileDescription || "");
    },
  });

  /* ---- selected projects (featured, first two) ---- */
  const featured = projects
    .filter((p) => p.featured && p.visible)
    .sort((a, b) => (a.featuredOrder || 0) - (b.featuredOrder || 0))
    .slice(0, 2);
  if (!featured.length) {
    $(".project-teasers").remove();
  } else {
    syncList($, $(".project-teasers__grid"), ".project-teaser", featured, {
      fill($li, p, i) {
        const $media = $li.find(".project-teaser__media");
        $media.attr("data-mosaic-tone", i % 4);
        setBg($media, p.featuredImage);
        $li.find(".project-teaser__client").text(p.client);
        $li.find(".project-teaser__title").text(p.title);
        $li.find(".project-teaser__location").text(p.location);
        const $meta = $li.find(".project-teaser__meta span");
        $meta.eq(0).text(formatValue(p));
        $meta.eq(1).text(`${cap(p.status)}, ${formatYears(p)}`);
      },
    });
  }

  /* ---- client logo marquee ---- */
  const logos = clients.filter((x) => x.visible);
  if (!logos.length) {
    $(".marquee-section").remove();
  } else {
    const img = (cl, dup) =>
      `<img class="marquee__logo" src="${escHtml(cl.logo)}" alt="${dup ? "" : escHtml(cl.name)}"${dup ? ' aria-hidden="true"' : ""} />`;
    const html =
      logos.map((cl) => img(cl, false)).join("\n          ") +
      "\n          <!-- Duplicated for a seamless loop — aria-hidden + alt=\"\" since it's a non-informative repeat. -->\n          " +
      logos.map((cl) => img(cl, true)).join("\n          ");
    $("#marqueeTrack").html(html);
  }

  /* ---- growth trend ---- */
  const first = math.first;
  const last = math.last;
  $(".growth-trend__lead").text(
    `Turnover has climbed from ₹${trim2(first.turnover)} Cr to ₹${trim2(last.turnover)} Cr over the last ${word(math.series.length)} years — ` +
      `and our workforce has scaled right alongside it, from ${fmtInt(first.workforce)} to ${fmtInt(last.workforce)} people.`
  );
  const $trend = $("svg[data-trend-chart]");
  const defs = $.html($trend.find("defs"));
  $trend.html(charts.trendChart(math.series, defs));
  $trend.attr("aria-label", charts.trendAria(math.series));
  $(".growth-trend__callout-value [data-counter-to]").attr("data-counter-to", math.growthPct);

  /* ---- leadership teaser ---- */
  const md = people.md;
  const $portrait = $(".leadership-teaser__portrait");
  setBg($portrait, md.photo);
  $portrait.attr("aria-label", `${md.name}, ${md.title}`);
  if (md.teaserQuote) $(".leadership-teaser__quote").text(md.teaserQuote);
  $(".leadership-teaser__name").text(md.name);
  $(".leadership-teaser__title").text(md.teaserTitle || md.title);
}

module.exports = { patchHome };
