"use strict";

const { escHtml } = require("./util");
const { phoneHref, brLines } = require("./common");

function patchContact($, c) {
  const { contact } = c.site;
  const $items = $(".contact-info__item");

  $items.eq(0).find(".contact-info__value").html("\n" + contact.addressLines.map(escHtml).join("<br />\n") + "\n");
  $items.eq(1).find(".contact-info__value").html(`<a href="${escHtml(phoneHref(contact.phone))}">${escHtml(contact.phone)}</a>`);
  $items.eq(2).find(".contact-info__value").html(`<a href="mailto:${escHtml(contact.email)}">${escHtml(contact.email)}</a>`);

  if (contact.hoursLines.length) $items.eq(3).find(".contact-info__value").html(brLines(contact.hoursLines));
  else $items.eq(3).remove();

  const $map = $(".contact-map");
  if (contact.mapQuery) {
    $map.find("iframe").attr(
      "src",
      `https://maps.google.com/maps?q=${encodeURIComponent(contact.mapQuery)}&t=&z=17&ie=UTF8&iwloc=&output=embed`
    );
  } else {
    $map.remove();
  }

  // The form posts to /api/enquiries when the CMS server is running and falls
  // back to opening the visitor's mail client (to this address) otherwise.
  $("#contactForm").attr("data-mailto", contact.email);
}

module.exports = { patchContact };
