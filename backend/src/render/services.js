"use strict";

const { escHtml, fmtInt, figuresMath, setLeadText, setBg, syncList, replaceCountWord, pad2 } = require("./util");
const icons = require("./icons");

function replaceIn($el, pairs) {
  const before = $el.text();
  let after = before;
  for (const [re, to] of pairs) after = after.replace(re, to);
  if (after !== before) $el.text(after);
}

function patchServices($, c) {
  const { figures, domains } = c;
  const math = figuresMath(figures);

  /* ---- hero stats ---- */
  const $vals = $(".services-hero__stat-value");
  $vals.eq(0).text(String(domains.length));
  setLeadText($, $vals.eq(1), "~" + figures.fabricationCapacity);
  setLeadText($, $vals.eq(2), fmtInt(math.last.workforce));
  $vals.eq(3).text(String(figures.totalProjects));

  /* ---- "Six domains…" wording follows the real count ---- */
  replaceCountWord($(".services-hero h1"), domains.length);
  replaceCountWord($(".services-list__intro"), domains.length);
  replaceCountWord($(".industries__lead"), domains.length);

  /* ---- quick nav ---- */
  syncList($, $(".service-quicknav__list"), "li", domains, {
    keyOfNode: ($li) => ($li.find("a").attr("href") || "").replace("#", ""),
    keyOfItem: (d) => d.id,
    fill($li, d, _i, isNew) {
      $li.find("a").attr("href", `#${d.id}`);
      if (isNew) $li.find(".service-quicknav__icon").html(icons.quicknav);
      $li.find(".service-quicknav__label").text(d.name);
    },
  });

  /* ---- service cards ---- */
  syncList($, $(".services-list__cards"), "article.service-card", domains, {
    keyOfNode: ($a) => $a.attr("id"),
    keyOfItem: (d) => d.id,
    fill($a, d, i) {
      $a.attr("id", d.id);
      const $media = $a.find(".service-card__media");
      $media.attr("data-mosaic-tone", i % 4);
      setBg($media, d.servicesImage);
      $a.find(".service-card__index").text(pad2(i + 1));
      $a.find(".service-card__title").text(d.name);
      $a.find(".service-card__lead").text(d.lead);
      const $list = $a.find(".service-card__list");
      if (d.bullets.length) $list.html(d.bullets.map((b) => `<li>${escHtml(b)}</li>`).join("\n"));
      else $list.remove();
      $a.find(".service-card__action .visually-hidden").text(`about ${d.name}`);
    },
  });

  /* ---- "Why KIPL" figures ---- */
  $(".why__item-text").each((_, el) => {
    replaceIn($(el), [
      [/workforce of [\d,]+\+/, `workforce of ${fmtInt(math.last.workforce)}+`],
      [/since \d{4}/, `since ${figures.established}`],
      [/~\d+ MT\/month/, `~${figures.fabricationCapacity} MT/month`],
      [/\b\d+ active and completed/, `${figures.totalProjects} active and completed`],
    ]);
  });
}

module.exports = { patchServices };
