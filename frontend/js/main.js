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
   * Contact page only ([contactForm] doesn't exist elsewhere, so this is a
   * no-op on every other page). There's no backend yet to receive a real
   * submission (see README) — rather than have the form silently do
   * nothing (or worse, look like it sent when it didn't), this builds a
   * mailto: link from the field values and hands off to the visitor's own
   * email client, which is upfront in the UI via .form-note.
   */
  function initContactForm() {
    var form = document.getElementById("contactForm");
    if (!form) return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var name = form.elements.name.value.trim();
      var phone = form.elements.phone.value.trim();
      var email = form.elements.email.value.trim();
      var message = form.elements.message.value.trim();

      var subject = "Enquiry from " + (name || "KIPL website");
      var body = [
        "Name: " + name,
        "Phone: " + (phone || "-"),
        "Email: " + email,
        "",
        message,
      ].join("\n");

      window.location.href =
        "mailto:info@kipl.co" +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);
    });
  }

  /**
   * Explicitly scrolls to the element matching location.hash, instead of
   * trusting the browser to do it natively. Browsers are inconsistent
   * about honoring a URL fragment on a *fresh* page load when html has
   * scroll-behavior: smooth (base.css sets that sitewide, for the nicer
   * in-page jump feel) — confirmed here as a real gap: landing on
   * about.html#our-team from a dropdown link left window.scrollY at 0
   * with the hash still correctly in the URL. A same-page anchor click
   * (already on about.html, clicking a dropdown link) isn't affected —
   * that goes through the browser's separate, reliable in-page anchor-
   * navigation path, not this "fragment present at initial load" one.
   *
   * Deliberately waits for the window `load` event, not DOMContentLoaded
   * (when every other init function here runs) or a same-tick
   * requestAnimationFrame/setTimeout(0) — tested all three directly and
   * only `load` reliably produces a working scroll here. Images/fonts
   * are still loading at DOMContentLoaded, and scrollIntoView silently
   * no-ops rather than erroring when called before the browser's layout
   * has fully settled from those, instead of scrolling to a since-shifted
   * position — worth the extra wait since a hash link that lands you at
   * the top of the page instead of the right section is a broken link in
   * effect, even though it "worked" by every other measure.
   */
  function initHashScroll() {
    if (!window.location.hash) return;
    var target;
    try {
      target = document.querySelector(window.location.hash);
    } catch (e) {
      return;
    }
    if (!target) return;

    function scrollToTarget() {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    }

    if (document.readyState === "complete") {
      scrollToTarget();
    } else {
      window.addEventListener("load", scrollToTarget);
    }
  }

  /**
   * Intercepts same-site link clicks and fades in the full-viewport flash
   * (css/components.css .page-transition) before actually navigating, so
   * moving between pages feels like one continuous site instead of a flash
   * of a blank new document. The reveal on the *arriving* page is pure CSS
   * (see components.css) — this function only owns the "fade in, then go"
   * half, which unavoidably needs JS to delay the navigation.
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
    var COVER_MS = prefersReducedMotion ? 40 : 170;

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

  /**
   * Projects page's featured carousel (projects.html [data-featured-
   * carousel]) — both slides are already fully rendered in the markup
   * (see css/projects.css .featured comment for why), this just toggles
   * which one carries .is-active and updates the "N / 2" counter. No-op
   * with fewer than 2 slides, and everywhere else on the site since the
   * trigger element doesn't exist.
   */
  function initFeaturedCarousel() {
    var root = document.querySelector("[data-featured-carousel]");
    if (!root) return;

    var slides = root.querySelectorAll("[data-featured-slide]");
    if (slides.length < 2) return;

    var counters = root.querySelectorAll("[data-featured-counter]");
    var current = 0;

    function show(index) {
      current = (index + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        slide.classList.toggle("is-active", i === current);
      });
      counters.forEach(function (el) {
        el.textContent = current + 1;
      });
    }

    root.querySelectorAll("[data-featured-prev]").forEach(function (btn) {
      btn.addEventListener("click", function () { show(current - 1); });
    });
    root.querySelectorAll("[data-featured-next]").forEach(function (btn) {
      btn.addEventListener("click", function () { show(current + 1); });
    });
  }

  /**
   * Projects page's filter/sort bar (projects.html .project-filters, now
   * sitting above the domain-group lists rather than a separate card
   * grid) — status tabs and domain chips combine with AND (e.g. Active +
   * Mining & Logistics shows only that domain's active rows). The domain
   * chip shows/hides whole [data-domain] groups; the status tab hides
   * individual [data-status] rows within whatever groups are still
   * showing, and a group left with zero visible rows after that is
   * hidden too rather than showing an empty banner+header. Sorting
   * reorders rows *within* each group via the CSS `order` property
   * (same technique the old card grid used) rather than re-appending
   * nodes.
   */
  function initProjectFilters() {
    var groups = document.querySelectorAll(".domain-group");
    if (!groups.length) return;

    var statusButtons = document.querySelectorAll("[data-filter-status]");
    var domainButtons = document.querySelectorAll("[data-filter-domain]");
    var sortSelect = document.querySelector("[data-filter-sort]");
    var countEls = document.querySelectorAll("[data-project-count]");

    var state = { status: "all", domain: "all", sort: "value" };

    function applyFilter() {
      var visibleCount = 0;
      groups.forEach(function (group) {
        var matchesDomain = state.domain === "all" || group.getAttribute("data-domain") === state.domain;
        var groupVisibleRows = 0;
        group.querySelectorAll(".domain-row").forEach(function (row) {
          var matchesStatus = state.status === "all" || row.getAttribute("data-status") === state.status;
          var show = matchesDomain && matchesStatus;
          row.classList.toggle("is-hidden", !show);
          if (show) groupVisibleRows += 1;
        });
        var showGroup = groupVisibleRows > 0;
        group.classList.toggle("is-hidden", !showGroup);
        // .domain-group carries [data-reveal] (js/animations.js#initReveals,
        // a one-time ScrollTrigger fade keyed to the *unfiltered* layout's
        // scroll positions). Filtering changes page height, so a group's
        // trigger point can shift out of reach and it never fires — the
        // group is technically unhidden but stuck at opacity:0, reading as
        // a blank gap under a nonzero count. Forcing it visible here
        // sidesteps that entirely rather than chasing ScrollTrigger's
        // recalculated offsets.
        if (showGroup) {
          group.style.opacity = "1";
          group.style.transform = "none";
        }
        visibleCount += groupVisibleRows;
      });
      countEls.forEach(function (el) { el.textContent = visibleCount; });
    }

    function applySort() {
      groups.forEach(function (group) {
        var rows = group.querySelectorAll(".domain-row");
        var sorted = Array.prototype.slice.call(rows).sort(function (a, b) {
          if (state.sort === "az") {
            return a.getAttribute("data-title").localeCompare(b.getAttribute("data-title"));
          }
          return parseFloat(b.getAttribute("data-value")) - parseFloat(a.getAttribute("data-value"));
        });
        sorted.forEach(function (row, i) {
          row.style.order = i;
        });
      });
    }

    statusButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        statusButtons.forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        state.status = btn.getAttribute("data-filter-status");
        applyFilter();
      });
    });

    domainButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        domainButtons.forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        state.domain = btn.getAttribute("data-filter-domain");
        applyFilter();
      });
    });

    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        state.sort = sortSelect.value;
        applySort();
      });
    }

    applySort();
    applyFilter();
  }

  /**
   * Services page's quick-nav strip (services.html .service-quicknav) —
   * marks whichever chip's target section is currently in view as the
   * visitor scrolls. No chip is active in the markup itself — .is-active
   * is added here and only here, so the highlight strictly tracks scroll
   * position: nothing is marked until the first card actually reaches the
   * tracked line.
   *
   * Previously an IntersectionObserver watching a thin band via negative-
   * percentage rootMargin ("-40% 0px -55% 0px"). Dropped in favor of a
   * plain scroll listener + getBoundingClientRect check after it got
   * stuck permanently on the first chip regardless of scroll position —
   * this reads each section's own position directly on every scroll tick
   * instead of depending on the browser to notify us of a percentage-
   * margin crossing, so there's no intermediate calculation that can go
   * stale or fail silently.
   */
  function initServiceQuicknavSpy() {
    var links = document.querySelectorAll(".service-quicknav__item[href^='#']");
    if (!links.length) return;

    var targets = [];
    links.forEach(function (link) {
      var section = document.getElementById(link.getAttribute("href").slice(1));
      if (section) targets.push({ link: link, section: section });
    });
    if (!targets.length) return;

    function setActive(link) {
      links.forEach(function (l) {
        l.classList.toggle("is-active", l === link);
      });
    }

    var ticking = false;
    function updateActive() {
      ticking = false;
      // A line roughly two-fifths down the viewport — whichever card has
      // scrolled its own top above this line, most recently, is "the one
      // in view". Checking every target fresh each tick (rather than
      // reacting to a single boundary-crossing notification) means this
      // is self-correcting on every scroll/resize, with nothing cached
      // that could get out of sync with the page's actual layout.
      var line = window.innerHeight * 0.4;
      var current = null;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].section.getBoundingClientRect().top <= line) {
          current = targets[i];
        }
      }
      if (current) setActive(current.link);
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(updateActive);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    updateActive();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNavScroll();
    initMobileMenu();
    initNavDropdowns();
    initFooterYear();
    initHashScroll();
    initPageTransitions();
    initContactForm();
    initFeaturedCarousel();
    initProjectFilters();
    initServiceQuicknavSpy();

    if (window.KIPL && window.KIPL.animations) {
      window.KIPL.animations.initMosaicReveal();
      window.KIPL.animations.initMosaicRowFade();
      window.KIPL.animations.initScrollRefresh();
      window.KIPL.animations.initHeroSlideshow();
      window.KIPL.animations.initHeroIntro();
      window.KIPL.animations.initReveals();
      window.KIPL.animations.initCounters();
      window.KIPL.animations.initTrendChart();
      window.KIPL.animations.initTrendTooltip();
      window.KIPL.animations.initMilestoneBars();
      window.KIPL.animations.initMilestoneTooltip();
      window.KIPL.animations.initMarquee();
    }
  });
})();
