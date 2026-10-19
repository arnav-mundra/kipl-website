"use strict";

const { escHtml, fmtInt, figuresMath, setBg, syncList, pad2 } = require("./util");
const charts = require("./charts");

const withPeriod = (s) => (/[.!?]$/.test(s) ? s : s + ".");

function patchAbout($, c) {
  const { figures, people, team } = c;
  const math = figuresMath(figures);

  /* ---- milestones ---- */
  $(".milestones__lead").text(
    `Every year of growth in turnover has come with real headcount behind it — from ${fmtInt(math.first.workforce)} people in ${math.first.label} to ${fmtInt(math.last.workforce)} today.`
  );
  const $chart = $("svg[data-milestone-chart]");
  $chart.html(charts.milestoneBars(math.series));
  $chart.attr("aria-label", charts.milestoneAria(math.series));

  /* ---- mission & vision ---- */
  const $cards = $(".mission-card");
  $cards.eq(0).find("p").text(people.vision);
  $cards.eq(1).find("p").text(people.mission);

  /* ---- values strip ---- */
  syncList($, $(".values-strip"), ".values-strip__item", people.coreValues, {
    fill($li, v, i) {
      $li.find(".values-strip__index").text(pad2(i + 1));
      $li.find("h4").text(v.name);
      $li.find("p").text(withPeriod(v.tagline));
    },
  });

  /* ---- MD's desk ---- */
  const md = people.md;
  const $portrait = $(".md-desk__portrait");
  setBg($portrait, md.photo);
  $portrait.attr("aria-label", `${md.name}, ${md.title}`);
  $(".md-desk__name").text(md.name);
  $(".md-desk__title").text(md.title);
  const paras = md.paragraphs.map((p) => `<p>${escHtml(p)}</p>`).join("\n");
  const sign = md.signoff ? `<p class="md-desk__signoff">${escHtml(md.signoff)}</p>` : "";
  $(".md-desk__bio").html(paras + "\n" + sign);

  /* ---- team ---- */
  const visible = team.filter((t) => t.visible);
  const leaders = visible.filter((t) => t.tier === "leadership");
  const heads = visible.filter((t) => t.tier === "hod");

  const photo = ($el, t) => {
    if (t.photo) setBg($el, t.photo);
    else $el.removeAttr("style");
    $el.attr("aria-label", t.name);
  };

  if (!leaders.length) $(".team-grid").remove();
  else {
    syncList($, $(".team-grid"), ".team-card", leaders, {
      fill($card, t) {
        photo($card.find(".team-card__photo"), t);
        $card.find(".team-card__name").text(t.name);
        $card.find(".team-card__title").text(t.title);
        const $bio = $card.find(".team-card__bio");
        if (t.bio) $bio.text(t.bio);
        else $bio.remove();
      },
    });
  }

  if (!heads.length) {
    $(".hod-head, .hod-grid").remove();
  } else {
    syncList($, $(".hod-grid"), ".hod-card", heads, {
      fill($card, t) {
        photo($card.find(".hod-card__photo"), t);
        $card.find(".hod-card__name").text(t.name);
        $card.find(".hod-card__title").text(t.title);
      },
    });
  }
}

module.exports = { patchAbout };
