/**
 * KIPL — page entry point.
 *
 * Owns UI wiring that isn't animation (nav scroll state, mobile menu) and
 * kicks off the animation module in js/animations.js. Every
 * future page includes this same file — page-specific behavior should stay
 * out of here.
 */
(function () {
  "use strict";

  function initNavScroll() {
    var nav = document.getElementById("siteNav");
    if (!nav) return;

    var threshold = 24;
    var ticking = false;

    function update() {
      nav.classList.toggle("is-scrolled", window.scrollY > threshold);
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          window.requestAnimationFrame(update);
          ticking = true;
        }
      },
      { passive: true }
    );

    update();
  }

  function initMobileMenu() {
    var toggle = document.getElementById("navToggle");
    var links = document.getElementById("navLinks");
    if (!toggle || !links) return;

    function close() {
      toggle.classList.remove("is-active");
      links.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.classList.toggle("is-active", open);
      toggle.setAttribute("aria-expanded", String(open));
    });

    links.querySelectorAll(".nav__link").forEach(function (link) {
      link.addEventListener("click", close);
    });
  }

  function initFooterYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = new Date().getFullYear();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNavScroll();
    initMobileMenu();
    initFooterYear();

    if (window.KIPL && window.KIPL.animations) {
      window.KIPL.animations.initMosaicReveal();
      window.KIPL.animations.initMosaicRowFade();
      window.KIPL.animations.initHeroSlideshow();
      window.KIPL.animations.initHeroIntro();
      window.KIPL.animations.initReveals();
      window.KIPL.animations.initCounters();
      window.KIPL.animations.initMarquee();
    }
  });
})();
