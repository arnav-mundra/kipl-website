"use strict";

const {
  escHtml, fmtInt, trim2, word, cap, formatValue, formatYears, projectTitle, figuresMath, growthPhrase,
  setLeadText, setBg, syncList, pad2,
} = require("./util");
const charts = require("./charts");

/** Replace the text that follows an element's child nodes (e.g. text after an inline icon). */
function setTrailingText($, el, text) {
  const $el = $(el);
  $el.contents().filter((_, n) => n.type === "text").remove();
  $el.append(" " + escHtml(text) + " ");
}

const byValueThenPriority = (a, b) => {
  if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
  const av = a.valueCr == null ? -1 : a.valueCr;
  const bv = b.valueCr == null ? -1 : b.valueCr;
  if (bv !== av) return bv - av;
  return projectTitle(a).localeCompare(projectTitle(b));
};

function patchProjects($, c) {
  const { site, figures, domains, projects } = c;
  const math = figuresMath(figures);
  const n = math.series.length;

  /* ---- hero stats ---- */
  const $vals = $(".projects-hero__stat-value");
  setLeadText($, $vals.eq(0), "₹" + trim2(math.last.turnover));
  setLeadText($, $vals.eq(1), fmtInt(math.last.workforce));
  setLeadText($, $vals.eq(2), String(n));
  $vals.eq(3).text(String(figures.totalProjects));
  $(".projects-hero__stat-label").eq(0).text(`${math.last.label.replace("-", "–")} Turnover`);

  /* ---- growth band ---- */
  $(".growth h2").text(`${cap(word(n))} years of consistent growth.`);
  $(".growth__lead").text(
    `Turnover has ${growthPhrase(math.ratio, math.growthPct)} since ${math.first.label}, and our workforce has grown alongside it — ` +
      `from ${fmtInt(math.first.workforce)} to ${fmtInt(math.last.workforce)} people over the same ${word(n)} years.`
  );
  const $gv = $(".growth-stat__value");
  setLeadText($, $gv.eq(0), "₹" + trim2(math.last.turnover));
  setLeadText($, $gv.eq(1), fmtInt(math.last.workforce));
  $(".growth-stat__label").eq(0).text(`${math.last.label} Turnover`);
  const $chart = $("svg.growth-chart");
  $chart.html(charts.growthBars(math.series));
  $chart.attr("aria-label", charts.growthAria(math.series));

  /* ---- featured carousel ---- */
  const featured = projects
    .filter((p) => p.featured && p.visible)
    .sort((a, b) => (a.featuredOrder || 0) - (b.featuredOrder || 0));
  const domainName = (id) => (domains.find((d) => d.id === id) || {}).name || "";

  if (!featured.length) {
    $("[data-featured-carousel]").closest("section").remove();
  } else {
    const total = featured.length;
    const $carousel = $("[data-featured-carousel]");
    syncList($, $carousel, "[data-featured-slide]", featured, {
      fill($s, p, i) {
        $s.toggleClass("is-active", i === 0);
        setBg($s.find(".featured__media"), p.featuredImage);
        $s.find(".featured__index").text(pad2(i + 1));
        $s.find(".featured__index-total").text(`/ ${pad2(total)}`);
        $s.find("h2").text(projectTitle(p));
        setTrailingText($, $s.find(".featured__location"), p.location);
        $s.find(".featured__desc").text(p.featuredDescription || p.description || "");
        const $sv = $s.find(".featured__stat-value");
        $sv.eq(0).text(p.client || "—");
        $sv.eq(1).text(domainName(p.domain));
        $sv.eq(2).text(formatValue(p));
        $sv.eq(3).text(`${cap(p.status)}, ${formatYears(p)}`);
      },
    });
    const $counter = $carousel.find(".featured__counter");
    $counter.contents().filter((_, node) => node.type === "text").remove();
    $counter.append(` / ${total}`);
    if (total < 2) $carousel.find(".featured__nav").remove();
  }

  /* ---- domain groups ---- */
  const maxPer = (site.projectsPage && site.projectsPage.maxPerDomain) || 5;
  const groups = domains
    .filter((d) => d.showOnProjects)
    .map((d) => ({
      domain: d,
      rows: projects.filter((p) => p.visible && p.domain === d.id).sort(byValueThenPriority).slice(0, maxPer),
    }))
    .filter((g) => g.rows.length);

  const $container = $(".domain-groups > .container");
  if (!groups.length) {
    $(".project-filters").remove();
    $container.find(".domain-group").remove();
    $container.append('<p style="color:var(--color-ink-soft)">No projects to show yet — check back soon.</p>');
    return;
  }

  syncList($, $container, ".domain-group", groups, {
    fill($g, g, i) {
      const d = g.domain;
      $g.attr("data-domain", d.id);
      $g.find(".domain-group__index").text(pad2(i + 1));
      $g.find(".domain-group__heading h3").text(d.name);
      const $tag = $g.find(".domain-group__heading p");
      if (d.tagline) $tag.text(d.tagline);
      else $tag.remove();
      const $banner = $g.find(".domain-group__banner");
      if (d.bannerImage) $banner.find("img").attr("src", d.bannerImage);
      else $banner.remove();

      syncList($, $g.find(".domain-group__list"), ".domain-row", g.rows, {
        fill($r, p) {
          $r.attr("data-status", p.status)
            .attr("data-value", p.valueCr == null ? 0 : p.valueCr)
            .attr("data-year", p.yearStart)
            .attr("data-title", projectTitle(p));
          $r.find(".domain-row__title").text(projectTitle(p));
          const $desc = $r.find(".domain-row__desc");
          if (p.description) $desc.text(p.description);
          else $desc.remove();
          $r.find(".domain-row__location").text(p.location);
          $r.find(".domain-row__year").text(formatYears(p));
          $r.find(".domain-row__value").text(formatValue(p));
        },
      });
    },
  });

  /* ---- filter chips follow the groups ---- */
  const $wrap = $(".project-filters__domains");
  const $chips = $wrap.children("button");
  const chipTemplate = $.html($chips.eq(1));
  $chips.slice(1).remove();
  groups.forEach((g) => {
    const $chip = $(chipTemplate);
    $chip.attr("data-filter-domain", g.domain.id).removeClass("is-active").text(g.domain.name);
    $wrap.append($chip);
  });

  $("[data-project-count]").text(String(groups.reduce((sum, g) => sum + g.rows.length, 0)));
}

module.exports = { patchProjects };
