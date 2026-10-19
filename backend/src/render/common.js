"use strict";

const { escHtml, setBg } = require("./util");

const phoneHref = (phone) => "tel:" + String(phone).replace(/[^\d+]/g, "");
const brLines = (lines) => lines.map(escHtml).join("<br />");

/** Footer contact column, tagline and legal line — identical markup on every page. */
function patchFooter($, c) {
  const { contact, footer } = c.site;

  if (footer.tagline) $(".footer__tagline").text(footer.tagline);

  const $items = $(".footer__contact li");
  $items.eq(0).html(brLines(contact.addressLines));
  $items.eq(1).html(`<a href="${escHtml(phoneHref(contact.phone))}">${escHtml(contact.phone)}</a>`);
  $items.eq(2).html(`<a href="mailto:${escHtml(contact.email)}">${escHtml(contact.email)}</a>`);

  const legal = [];
  if (footer.cin) legal.push("CIN: " + footer.cin);
  if (footer.msme) legal.push("MSME: " + footer.msme);
  $(".footer__bottom span").last().text(legal.join(" · "));
}

/** Slideshow photos shared by the Home / About / Contact heroes. */
function patchHeroImages($, c) {
  const images = c.site.hero.images;
  if (!images.length) return;
  $("[data-hero-slideshow]").attr("data-hero-images", images.join(","));
  setBg($(".hero__slide-base"), images[0]);
}

/** schema.org LocalBusiness block (Home only) kept in step with the site settings. */
function patchJsonLd($, c, origin) {
  const el = $('script[type="application/ld+json"]').first();
  if (!el.length) return;
  let data;
  try { data = JSON.parse(el.html()); } catch (_) { return; }
  const { contact, footer } = c.site;
  data.telephone = contact.phone.replace(/\s+/g, "-");
  data.email = contact.email;
  data.foundingDate = String(c.figures.established);
  if (data.address) {
    const lines = contact.addressLines.join(" ");
    const pin = /(\d{6})\s*$/.exec(lines);
    if (pin) data.address.postalCode = pin[1];
  }
  const ids = [];
  if (footer.cin) ids.push({ "@type": "PropertyValue", name: "CIN", value: footer.cin });
  if (footer.msme) ids.push({ "@type": "PropertyValue", name: "MSME/UDYAM", value: footer.msme });
  data.identifier = ids;
  data.url = origin + "/";
  // `<` is escaped so the JSON can never close the script element early.
  el.html(JSON.stringify(data, null, 2).replace(/</g, "\\u003c"));
}

module.exports = { patchFooter, patchHeroImages, patchJsonLd, phoneHref, brLines };
