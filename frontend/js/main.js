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

    links.querySelectorAll(".nav__link, .nav__dropdown-link").forEach(function (link) {
      link.addEventListener("click", close);
    });
  }

  /**
   * Wires the "About" nav item's caret-toggled dropdown (see
   * css/components.css .nav__item--dropdown). CSS alone handles the
   * pointer-device hover flyout; this only owns the click/tap toggle that
   * both touch devices and the mobile accordion layout need, plus closing
   * on outside click / Escape / picking a link.
   */
  function initNavDropdowns() {
    var items = document.querySelectorAll(".nav__item--dropdown");
    if (!items.length) return;

    function closeAll(except) {
      items.forEach(function (item) {
        if (item === except) return;
        item.classList.remove("is-open");
        var toggle = item.querySelector(".nav__dropdown-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      });
    }

    items.forEach(function (item) {
      var toggle = item.querySelector(".nav__dropdown-toggle");
      if (!toggle) return;

      toggle.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = item.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        closeAll(item);
      });

      item.querySelectorAll(".nav__dropdown-link").forEach(function (link) {
        link.addEventListener("click", function () {
          item.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
        });
      });
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".nav__item--dropdown")) closeAll();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAll();
    });
  }

  function initFooterYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = new Date().getFullYear();
  }

  /**
   * Intercepts same-site link clicks and grows the top-edge progress bar
   * (css/components.css .page-transition) before actually navigating, so
   * moving between pages feels like one continuous site instead of a flash
   * of a blank new document. The reveal on the *arriving* page is pure CSS
   * (see components.css) — this function only owns the "grow the bar, then
   * go" half, which unavoidably needs JS to delay the navigation.
   *
   * Navigation is timed with a plain setTimeout matched to the CSS
   * transition duration, not a transitionend listener — that event can
   * fail to fire (an interrupted transition, a throttled background tab),
   * and a link that silently stops working is worse than a transition that
   * occasionally cuts a few ms short.
   */
  function initPageTransitions() {
    var panel = document.querySelector(".page-transition");
    if (!panel) return;

    var prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    var COVER_MS = prefersReducedMotion ? 60 : 400;

    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var link = e.target.closest("a[href]");
      if (!link || (link.target && link.target !== "_self")) return;

      var url;
      try {
        url = new URL(link.href, window.location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same-page anchor jump (e.g. the services quick-nav) — let the
      // browser handle it natively, no full navigation is happening.
      if (url.pathname === window.location.pathname && url.hash) return;

      e.preventDefault();
      panel.classList.add("page-transition--cover");
      window.setTimeout(function () {
        try {
          sessionStorage.setItem("kiplNavigating", "1");
        } catch (err) {}
        window.location.href = link.href;
      }, COVER_MS);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNavScroll();
    initMobileMenu();
    initNavDropdowns();
    initFooterYear();
    initPageTransitions();

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
