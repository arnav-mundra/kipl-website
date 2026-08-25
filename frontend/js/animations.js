/**
 * KIPL — GSAP / ScrollTrigger animation module.
 *
 * Exposes small, named init functions on `window.KIPL.animations`, called
 * once from js/main.js after DOMContentLoaded. Keeping this separate from
 * main.js means a future page only needs to add markup (data-reveal,
 * data-counter-to, etc.) — no new animation code required.
 *
 * All motion is skipped/shortened when the visitor has requested reduced
 * motion (prefers-reduced-motion). No video, no 3D, no heavy parallax —
 * restrained fade/slide-up reveals and one linear marquee loop only.
 */
(function () {
  "use strict";

  var hasGsap = typeof window.gsap !== "undefined";
  var prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (hasGsap && window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
  }

  // Shared by initMosaicReveal's cell tween and initMosaicRowFade's detail
  // fade — both live on the same .mosaic-row, so they need the identical
  // scroll range to resolve in sync rather than drifting apart if one gets
  // tuned later and not the other.
  var MOSAIC_SCROLL_RANGE = { start: "top 88%", end: "top 45%", scrub: 0.4 };

  /** Plays once on load: staggers the hero card's copy in. */
  function initHeroIntro() {
    var targets = document.querySelectorAll("[data-reveal-hero]");
    if (!targets.length) return;

    if (!hasGsap || prefersReducedMotion) {
      targets.forEach(function (el) {
        el.style.opacity = 1;
        el.style.transform = "none";
      });
      return;
    }

    window.gsap.timeline({ delay: 0.15 }).fromTo(
      targets,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: "power2.out",
        stagger: 0.08,
      }
    );
  }

  /**
   * Scroll-triggered fade/slide-up for every other [data-reveal] element.
   * Uses ScrollTrigger.batch so elements animate as they individually enter
   * view — restrained by nature, since a normal scroll pace only brings one
   * section into range at a time.
   */
  function initReveals() {
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;

    if (!hasGsap || !window.ScrollTrigger || prefersReducedMotion) {
      targets.forEach(function (el) {
        el.style.opacity = 1;
        el.style.transform = "none";
      });
      return;
    }

    window.ScrollTrigger.batch(targets, {
      start: "top 85%",
      once: true,
      onEnter: function (batch) {
        window.gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: "power2.out",
          stagger: 0.1,
        });
      },
    });
  }

  /**
   * Counts [data-counter-to] elements up from 0 once they scroll into view.
   * Optional data-counter-suffix / data-counter-prefix add fixed text
   * (the suffix/prefix itself does not animate).
   */
  function initCounters() {
    var counters = document.querySelectorAll("[data-counter-to]");
    if (!counters.length) return;

    counters.forEach(function (el) {
      var target = parseFloat(el.getAttribute("data-counter-to"), 10);
      var prefix = el.getAttribute("data-counter-prefix") || "";
      var suffix = el.getAttribute("data-counter-suffix") || "";

      if (!hasGsap || !window.ScrollTrigger || prefersReducedMotion) {
        el.textContent = prefix + target + suffix;
        return;
      }

      var proxy = { val: 0 };
      window.ScrollTrigger.create({
        trigger: el,
        start: "top 90%",
        once: true,
        onEnter: function () {
          window.gsap.to(proxy, {
            val: target,
            duration: 1.4,
            ease: "power1.out",
            onUpdate: function () {
              el.textContent = prefix + Math.round(proxy.val) + suffix;
            },
            onComplete: function () {
              el.textContent = prefix + target + suffix;
            },
          });
        },
      });
    });
  }

  /**
   * Continuously loops the client-logo marquee track (its HTML content is
   * duplicated once so a 50% translate is seamless). Runs continuously,
   * including under the cursor — deliberately no pause-on-hover.
   *
   * Logos load eagerly on purpose (no loading="lazy") — the track is a
   * `width: max-content` row far wider than the viewport, and the browser's
   * lazy-load heuristic judges an image's proximity to the viewport by its
   * actual layout position, oblivious to the `overflow: hidden` wrapper
   * clipping most of that row from view. Most logos sat well outside its
   * trigger margin and would load inconsistently — sometimes not at all —
   * which is exactly what made the marquee stall. Still waits for every
   * logo to finish loading (or error out) before measuring and starting,
   * since even eager images take a moment: starting off track.scrollWidth
   * before they arrive would measure a near-collapsed track (just the flex
   * gaps) and produce a tween that jumps once the real images pop in.
   */
  function initMarquee() {
    var track = document.getElementById("marqueeTrack");
    var wrapper = document.getElementById("marquee");
    if (!track || !wrapper) return;

    if (!hasGsap || prefersReducedMotion) return;

    function start() {
      var pxPerSecond = 55;
      var distance = track.scrollWidth / 2;
      var duration = distance / pxPerSecond;

      window.gsap.to(track, {
        xPercent: -50,
        duration: duration,
        ease: "none",
        repeat: -1,
      });
    }

    var pending = Array.prototype.filter.call(track.querySelectorAll("img"), function (img) {
      return !img.complete;
    });

    if (!pending.length) {
      start();
      return;
    }

    var remaining = pending.length;
    function settle() {
      remaining -= 1;
      if (remaining <= 0) start();
    }
    pending.forEach(function (img) {
      img.addEventListener("load", settle, { once: true });
      img.addEventListener("error", settle, { once: true });
    });
  }

  /**
   * Generates a brand-toned "grain" texture on an offscreen canvas: a
   * diagonal duotone gradient between two resolved CSS colors, plus
   * per-pixel luminance noise for a film-grain look. Stands in for real
   * photography — see initMosaicReveal below, which slices this into cells.
   * Returns a data URL so it can be reused as background-image on many
   * elements without re-rendering.
   */
  function createGrainTexture(colorA, colorB, size) {
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");

    var gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, colorA);
    gradient.addColorStop(1, colorB);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    var imageData = ctx.getImageData(0, 0, size, size);
    var data = imageData.data;
    for (var i = 0; i < data.length; i += 4) {
      var noise = (Math.random() - 0.5) * 42;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL("image/png");
  }

  /**
   * Builds a `.mosaic-grid` of `.mosaic-cell` divs (mostly 1x1, some 2x2 for
   * the mixed-block-size look) as a direct child of `host`, packed with
   * explicit grid positions so coverage is exact — no gaps, no CSS
   * auto-placement spilling into extra rows. Shared by initMosaicReveal
   * (scroll/load reveals) and initHeroSlideshow (photo dissolve): both need
   * the same "grid of cells over a host" shape, just different fill logic
   * and trigger. Host needs position:relative/overflow:hidden.
   */
  function packMosaicGrid(host, cols, rows) {
    var grid = document.createElement("div");
    grid.className = "mosaic-grid";
    grid.setAttribute("aria-hidden", "true");
    grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    grid.style.gridTemplateRows = "repeat(" + rows + ", 1fr)";
    host.appendChild(grid);

    var occupied = [];
    for (var r = 0; r < rows; r++) occupied.push(new Array(cols).fill(false));

    var cells = [];
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        if (occupied[row][col]) continue;

        var canBeBig =
          row + 1 < rows &&
          col + 1 < cols &&
          !occupied[row][col + 1] &&
          !occupied[row + 1][col] &&
          !occupied[row + 1][col + 1];
        var isBig = canBeBig && Math.random() < 0.22;

        var cell = document.createElement("div");
        cell.className = "mosaic-cell";
        cell.style.gridColumnStart = col + 1;
        cell.style.gridRowStart = row + 1;

        if (isBig) {
          cell.style.gridColumnEnd = "span 2";
          cell.style.gridRowEnd = "span 2";
          occupied[row][col] = occupied[row][col + 1] = true;
          occupied[row + 1][col] = occupied[row + 1][col + 1] = true;
        } else {
          occupied[row][col] = true;
        }

        grid.appendChild(cell);
        cells.push(cell);
      }
    }

    return { grid: grid, cells: cells };
  }

  /**
   * Mosaic reveal: slices a single coherent image (a generated grain
   * texture by default, or a real photo if the host already has a
   * background-image) into a grid of mixed 1x1 / 2x2 cells, each already
   * showing its correct slice, then pops them in — in random order — as the
   * host scrolls into view. Hero tiles reveal on load instead (scrub needs
   * scroll distance, and the hero has none available above the fold).
   *
   * Density is controlled per-element via data-mosaic-cols / data-mosaic-
   * rows (defaults below, halved automatically on narrow viewports).
   */
  function initMosaicReveal() {
    var hosts = document.querySelectorAll("[data-mosaic-reveal]");
    if (!hosts.length) return;

    // No GSAP or reduced motion: leave hosts showing their plain CSS
    // fallback background — nothing to build or animate.
    if (!hasGsap || prefersReducedMotion) return;

    var rootStyles = getComputedStyle(document.documentElement);
    function cssVar(name) {
      return rootStyles.getPropertyValue(name).trim();
    }

    // Four duotone pairings cycled via data-mosaic-tone, staying inside the
    // brand palette while still giving each swatch a distinct wash.
    var tones = [
      [cssVar("--color-blue-700"), cssVar("--color-blue-300")],
      [cssVar("--color-orange-600"), cssVar("--color-orange-100")],
      [cssVar("--color-blue-500"), cssVar("--color-orange-500")],
      [cssVar("--color-orange-500"), cssVar("--color-blue-300")],
    ];
    var textureCache = {};
    function textureFor(toneIndex) {
      if (!textureCache[toneIndex]) {
        var pair = tones[toneIndex % tones.length];
        textureCache[toneIndex] = createGrainTexture(pair[0], pair[1], 360);
      }
      return textureCache[toneIndex];
    }

    var isNarrow = window.innerWidth < 700;
    // Large, few, chunky blocks — not a fine grain — per the reference:
    // the whole point is that individual rectangles are visible sweeping
    // across, not a blended texture. Row height is clamped fairly short
    // (see .mosaic-row in components.css), so rows sit at the Math.max(3,…)
    // floor below regardless; this mainly controls column count.
    var targetCellSize = isNarrow ? 90 : 160; // px — keeps cells roughly square regardless of host shape

    hosts.forEach(function (host) {
      var hostBox = host.getBoundingClientRect();
      var autoCols = Math.max(3, Math.round(hostBox.width / targetCellSize));
      var autoRows = Math.max(3, Math.round(hostBox.height / targetCellSize));
      var cols = parseInt(host.getAttribute("data-mosaic-cols"), 10) || autoCols;
      var rows = parseInt(host.getAttribute("data-mosaic-rows"), 10) || autoRows;
      var toneIndex = parseInt(host.getAttribute("data-mosaic-tone"), 10) || 0;

      // data-mosaic-fill: cells assemble as a flat color instead of slicing
      // a photo/texture. Either way — fill, generated texture, or (later) a
      // real photo — the assembled cells end up showing exactly the same
      // content the host itself would otherwise display, so the host's own
      // background must stay hidden while cells are mid-reveal, or the
      // "reveal" is a no-op (the content's already fully visible underneath
      // the opacity:0 cells). Clearing it also gives the "assembles from
      // black" look instead of a mismatched static gradient underneath, and
      // — since this is scrub-driven, not once — means scrolling back up
      // past the host goes properly blank again too, not just replays.
      var fillColor = host.getAttribute("data-mosaic-fill");
      var hostImage, hasRealImage, textureUrl;

      if (fillColor) {
        host.style.background = "transparent";
      } else {
        // Only a real url(...) background (a photo dropped in later) should
        // skip texture generation — the CSS fallback gradient also
        // populates background-image but isn't "real" content, so it
        // doesn't count here.
        hostImage = getComputedStyle(host).backgroundImage;
        hasRealImage = /^url\(/.test(hostImage);
        textureUrl = hasRealImage ? null : "url(" + textureFor(toneIndex) + ")";
        host.style.backgroundImage = "none";
      }

      var built = packMosaicGrid(host, cols, rows);
      var cells = built.cells;

      if (fillColor) {
        cells.forEach(function (cell) {
          cell.style.background = fillColor;
        });
      } else {
        // Read back each cell's rendered rect (cheap: background-image/size/
        // position are paint-only, so this doesn't re-trigger layout per
        // iteration) to slice the shared texture at the right offset.
        cells.forEach(function (cell) {
          var rect = cell.getBoundingClientRect();
          cell.style.backgroundImage = textureUrl || hostImage;
          cell.style.backgroundSize = hostBox.width + "px " + hostBox.height + "px";
          cell.style.backgroundPosition =
            "-" + Math.round(rect.left - hostBox.left) + "px -" + Math.round(rect.top - hostBox.top) + "px";
        });
      }

      // Each cell pops in fast on its own (short duration), but the stagger
      // spread across the whole grid keeps the overall cascade reading as
      // deliberate rather than a single instant flash. packMosaicGrid builds
      // `cells` row-by-row, left-to-right within each row, so from: "start"
      // (sequential array order, not "random") is what makes the sweep read
      // as left-to-right rather than scattered.
      var tweenVars = {
        opacity: 1,
        duration: 0.4,
        ease: "power1.out",
        stagger: { each: 0.1, from: "start" },
      };

      if (host.closest(".hero")) {
        window.gsap.timeline({ delay: 0.35 }).to(cells, tweenVars);
      } else if (window.ScrollTrigger) {
        window.gsap.to(
          cells,
          Object.assign({}, tweenVars, {
            scrollTrigger: {
              trigger: host,
              start: MOSAIC_SCROLL_RANGE.start,
              end: MOSAIC_SCROLL_RANGE.end,
              scrub: MOSAIC_SCROLL_RANGE.scrub,
            },
          })
        );
      }
    });
  }

  /**
   * Scroll-scrubbed fade for each mosaic row's detail column (eyebrow +
   * description + link) — uses the exact same MOSAIC_SCROLL_RANGE as that
   * row's mosaic-cell tween so the copy resolves in lockstep with the
   * pixel reveal beside it, not on its own separate timing.
   *
   * This replaced an earlier character-scramble version that rewrote each
   * paragraph's .textContent on every scroll tick. Two problems: it read as
   * a glitchy distraction rather than a polish, and — worse — every tick
   * could change the text's line-wrap and therefore its rendered height,
   * reflowing the page and shifting every row below it. ScrollTrigger
   * caches each row's start/end scroll position at setup time, so that
   * live reflow silently desynced them, which is why the pixel effect
   * looked like it only ever "worked once" instead of repeating on every
   * scroll pass. A pure opacity/transform fade never touches layout, so it
   * can't cause that.
   */
  function initMosaicRowFade() {
    var targets = document.querySelectorAll(".mosaic-row__detail");
    if (!targets.length) return;

    if (!hasGsap || !window.ScrollTrigger || prefersReducedMotion) {
      targets.forEach(function (el) {
        el.style.opacity = 1;
        el.style.transform = "none";
      });
      return;
    }

    targets.forEach(function (el) {
      var row = el.closest(".mosaic-row");
      if (!row) return;

      window.gsap.fromTo(
        el,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          ease: "power1.out",
          scrollTrigger: {
            trigger: row,
            start: MOSAIC_SCROLL_RANGE.start,
            end: MOSAIC_SCROLL_RANGE.end,
            scrub: MOSAIC_SCROLL_RANGE.scrub,
          },
        }
      );
    });
  }

  /**
   * Hero background slideshow: cycles the photos listed in the host's
   * data-hero-images (comma-separated URLs), dissolving to the next one
   * every ~3.2s via the same mosaic-cell mechanic used elsewhere on the
   * page (packMosaicGrid) instead of a plain crossfade — a grid of cells,
   * each already showing the correct slice of the incoming photo, pops in
   * over the current photo in random order.
   *
   * .hero__slide-base (set directly in HTML to the first photo) is the
   * static layer underneath; once a dissolve finishes, its background-image
   * is swapped to match what the now-fully-opaque cells already show, and
   * the cell grid is torn down — so nothing needs to be undone before the
   * next cycle starts.
   */
  function initHeroSlideshow() {
    var stage = document.querySelector("[data-hero-slideshow]");
    if (!stage) return;

    var urls = (stage.getAttribute("data-hero-images") || "")
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (urls.length < 2) return;

    var base = stage.querySelector(".hero__slide-base");
    if (!base) return;

    // Warm the cache so a dissolve never reveals a half-loaded image.
    urls.forEach(function (url) {
      var img = new Image();
      img.src = url;
    });

    // No motion: hold on the first frame already painted via inline style.
    if (!hasGsap || prefersReducedMotion) return;

    var current = 0;
    var cycleMs = 3200;
    var isNarrow = window.innerWidth < 700;
    var targetCellSize = isNarrow ? 34 : 52;

    function dissolveTo(index) {
      var stageBox = stage.getBoundingClientRect();
      var cols = Math.max(4, Math.round(stageBox.width / targetCellSize));
      var rows = Math.max(3, Math.round(stageBox.height / targetCellSize));

      var built = packMosaicGrid(stage, cols, rows);
      var grid = built.grid;
      var cells = built.cells;
      var url = "url('" + urls[index] + "')";

      cells.forEach(function (cell) {
        var rect = cell.getBoundingClientRect();
        cell.style.backgroundImage = url;
        cell.style.backgroundSize = stageBox.width + "px " + stageBox.height + "px";
        cell.style.backgroundPosition =
          "-" + Math.round(rect.left - stageBox.left) + "px -" + Math.round(rect.top - stageBox.top) + "px";
      });

      window.gsap.to(cells, {
        opacity: 1,
        duration: 1.6,
        ease: "power1.inOut",
        stagger: { each: 0.015, from: "random" },
        onComplete: function () {
          base.style.backgroundImage = url;
          grid.remove();
        },
      });
    }

    // Skip ticks while the tab is backgrounded — otherwise a visitor who
    // leaves this tab hidden mid-cycle comes back to a burst of queued
    // dissolves all resolving at once.
    var isHidden = document.hidden;
    document.addEventListener("visibilitychange", function () {
      isHidden = document.hidden;
    });

    window.setInterval(function () {
      if (isHidden) return;
      current = (current + 1) % urls.length;
      dissolveTo(current);
    }, cycleMs);
  }

  window.KIPL = window.KIPL || {};
  window.KIPL.animations = {
    initHeroIntro: initHeroIntro,
    initReveals: initReveals,
    initCounters: initCounters,
    initMarquee: initMarquee,
    initMosaicReveal: initMosaicReveal,
    initMosaicRowFade: initMosaicRowFade,
    initHeroSlideshow: initHeroSlideshow,
    prefersReducedMotion: prefersReducedMotion,
  };
})();
