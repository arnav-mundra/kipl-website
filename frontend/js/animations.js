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
  if (hasGsap && window.Draggable) {
    window.gsap.registerPlugin(window.Draggable);
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
   * Draws in the Home growth-trend line chart (Home only —
   * [data-trend-chart], see index.html) as it scrolls into view: the line
   * traces itself via a stroke-dashoffset tween (the standard SVG
   * "line-draw" technique — measure the path's real rendered length with
   * getTotalLength(), since that varies with the path's actual geometry
   * and can't be hardcoded in CSS), the area fill fades in underneath it,
   * then the point markers fade in and their dots grow from r:0 back to
   * their real radius. Same once-per-page-load, no-replay-on-rescroll
   * behavior as initCounters (ScrollTrigger once: true) and the same
   * GSAP/reduced-motion fallback shape used throughout this file — if
   * either is unavailable, every piece just snaps straight to its
   * finished state instead of animating.
   *
   * Deliberately NOT animating the point <g>s via CSS transform: scale()
   * — transform-box: fill-box origin resolution for an SVG <g> containing
   * both a circle and (on two of the five points) a wide text label is
   * unreliable across browsers, and in practice collapsed every point
   * toward one shared, wrong-looking spot instead of scaling each from
   * its own center. Animating the circle's r attribute directly sidesteps
   * transform-origin entirely — there's no origin ambiguity in growing a
   * circle from its own cx/cy — and the text labels get a plain opacity
   * fade, which has no origin concept to get wrong either.
   */
  function initTrendChart() {
    var chart = document.querySelector("[data-trend-chart]");
    if (!chart) return;

    var line = chart.querySelector("[data-trend-line]");
    var area = chart.querySelector("[data-trend-area]");
    var points = chart.querySelectorAll("[data-trend-point]");
    // .trend-chart__dot specifically, not a bare "circle" — each point
    // also has a larger invisible .trend-chart__hit circle
    // (js/animations.js#initTrendTooltip) for easier hovering, which
    // must NOT be swept into this same grow-in tween.
    var dots = chart.querySelectorAll("[data-trend-point] .trend-chart__dot");

    if (!hasGsap || !window.ScrollTrigger || prefersReducedMotion) {
      if (line) line.style.opacity = 1;
      if (area) area.style.opacity = 1;
      points.forEach(function (p) {
        p.style.opacity = 1;
      });
      return;
    }

    var length = line.getTotalLength();
    line.style.strokeDasharray = length;
    line.style.strokeDashoffset = length;

    var radii = [];
    dots.forEach(function (dot, i) {
      radii[i] = parseFloat(dot.getAttribute("r"));
      dot.setAttribute("r", 0);
    });

    window.ScrollTrigger.create({
      trigger: chart,
      start: "top 75%",
      once: true,
      onEnter: function () {
        window.gsap
          .timeline()
          .to(line, { opacity: 1, strokeDashoffset: 0, duration: 1.4, ease: "power2.out" })
          .to(area, { opacity: 1, duration: 0.8, ease: "power1.out" }, "-=0.7")
          .to(points, { opacity: 1, duration: 0.4, ease: "power1.out", stagger: 0.12 }, "-=1.1")
          .to(
            dots,
            {
              attr: { r: function (i) { return radii[i]; } },
              duration: 0.5,
              ease: "back.out(2)",
              stagger: 0.12,
            },
            "-=1.1"
          );
      },
    });
  }

  /**
   * Hover/focus tooltip for the Home growth-trend chart's five points
   * (see index.html's .trend-chart__hit circles) — reveals that year's
   * exact turnover figure, including the three middle years that have no
   * value printed anywhere else on the chart, and grows the dot slightly
   * for feedback. Deliberately independent of ScrollTrigger and of
   * initTrendChart's reveal-on-scroll: this is plain, always-on
   * mouseenter/focus handling, not tied to any animation frame loop, so
   * it works immediately regardless of whether the chart has finished (or
   * even started) its scroll-triggered draw-in.
   *
   * The dot grows via a direct r-attribute change (GSAP-tweened if
   * available, an instant set otherwise), not a CSS r transition — this
   * browser engine accepts writes to a circle's CSS `r` property but
   * never actually paints them (confirmed via getComputedStyle staying
   * frozen at the attribute value regardless), so a CSS-only version of
   * this silently did nothing. Attribute writes are what
   * initTrendChart's own reveal animation already uses successfully, so
   * this reuses that same proven mechanism instead. Each hit circle's
   * data-r is its dot's real resting radius, read once from markup —
   * not from the dot's live r attribute, which initTrendChart may have
   * already zeroed out for its own reveal tween by the time this runs.
   */
  function initTrendTooltip() {
    var chart = document.querySelector("[data-trend-chart]");
    var tooltip = document.querySelector("[data-trend-tooltip]");
    if (!chart || !tooltip) return;

    var container = tooltip.parentElement;
    var hits = chart.querySelectorAll("[data-trend-hit]");

    function growDot(hit, r) {
      var point = hit.closest("[data-trend-point]");
      var dot = point ? point.querySelector(".trend-chart__dot") : null;
      if (!dot) return;
      if (hasGsap) {
        window.gsap.to(dot, { attr: { r: r }, duration: 0.2, ease: "power1.out" });
      } else {
        dot.setAttribute("r", r);
      }
    }

    function show(hit) {
      var point = hit.closest("[data-trend-point]");
      if (point) point.classList.add("is-hovered");
      growDot(hit, parseFloat(hit.getAttribute("data-r")) + 3);

      tooltip.textContent = hit.getAttribute("data-year") + " · " + hit.getAttribute("data-value");

      var hitBox = hit.getBoundingClientRect();
      var containerBox = container.getBoundingClientRect();
      tooltip.style.left = hitBox.left + hitBox.width / 2 - containerBox.left + "px";
      tooltip.style.top = hitBox.top - containerBox.top + "px";
      tooltip.classList.add("is-visible");
    }

    function hide(hit) {
      var point = hit.closest("[data-trend-point]");
      if (point) point.classList.remove("is-hovered");
      growDot(hit, parseFloat(hit.getAttribute("data-r")));
      tooltip.classList.remove("is-visible");
    }

    hits.forEach(function (hit) {
      hit.addEventListener("mouseenter", function () { show(hit); });
      hit.addEventListener("mouseleave", function () { hide(hit); });
      hit.addEventListener("focus", function () { show(hit); });
      hit.addEventListener("blur", function () { hide(hit); });
    });
  }

  /**
   * Continuously loops the client-logo marquee track (its HTML content is
   * duplicated once so a full-width translate is seamless). Runs
   * continuously, including under the cursor — deliberately no
   * pause-on-hover. Also draggable (js/animations.js#initMarqueeDrag below)
   * — the auto-scroll only ever pauses while a drag is actively in
   * progress, resuming the instant the pointer is released.
   *
   * Uses a plain pixel `x` tween now (was `xPercent: -50`) rather than
   * percent-based translation — Draggable's `type: "x"` reads/writes the
   * same `x` property GSAP tweens use, so keeping both on `x` means they
   * can hand off to each other directly without any unit conversion.
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
      var pxPerSecond = 65;
      var distance = track.scrollWidth / 2; // width of one (non-duplicated) copy of the logos

      var tween = window.gsap.to(track, {
        x: -distance,
        duration: distance / pxPerSecond,
        ease: "none",
        repeat: -1,
      });

      initMarqueeDrag(track, wrapper, distance, pxPerSecond, tween);
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
   * Lets a visitor grab the marquee track and drag it by hand — the
   * auto-scroll pauses only for the duration of an actual press-and-drag,
   * never merely on hover, and resumes on release from wherever the
   * visitor left it rather than snapping back.
   *
   * Bounded, not infinitely wrapping: the track's own content is only
   * duplicated once (for the auto-scroll loop), so there isn't a third
   * copy to reveal if a visitor dragged further than that — bounding drag
   * to the track's real scrollable range (0 to -(scrollWidth - wrapper
   * width)) means they can always drag through every logo at least once
   * in either direction without ever exposing blank space past the end.
   *
   * On release, a brand-new tween is created — rather than resuming the
   * original — targeting one more `distance` of travel from wherever the
   * drag left off, then repeating from there (repeat: -1 restarts a tween
   * from its own recorded "from" value each cycle, and since the content
   * repeats visually every `distance` px, snapping back to *any* absolute
   * x looks identical to continuing, so there's no need to fold the
   * dragged position back into a single canonical cycle first).
   *
   * This turned out to be load-bearing, not just simpler: resuming the
   * original tween via .progress(p).play() silently failed to animate at
   * all after a drag — confirmed with gsap.ticker.tick() called manually
   * (bypassing rAF/real-time entirely) still not moving x, so it wasn't a
   * throttled-tab false alarm either. Draggable's own internal renders
   * during the drag itself compete for ownership of the same `x`
   * property the tween drives (GSAP's default overwrite management lets
   * the more recent assignment win), leaving the original tween's render
   * function disconnected even though .paused()/.progress() still
   * reported plausible-looking values. A freshly created tween has no
   * such stale state to inherit.
   */
  function initMarqueeDrag(track, wrapper, distance, pxPerSecond, tween) {
    if (!window.Draggable) return;

    var maxDrag = track.scrollWidth - wrapper.clientWidth;

    window.Draggable.create(track, {
      type: "x",
      bounds: { minX: -maxDrag, maxX: 0 },
      allowNativeTouchScrolling: false,
      onPress: function () {
        tween.pause();
      },
      onRelease: function () {
        tween.kill();
        var currentX = window.gsap.getProperty(track, "x");
        tween = window.gsap.to(track, {
          x: currentX - distance,
          duration: distance / pxPerSecond,
          ease: "none",
          repeat: -1,
        });
      },
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
   * Every scroll-scrubbed mosaic-reveal/row-fade trigger above is built at
   * DOMContentLoaded, from each host's position at that exact moment — but
   * the page's real layout isn't necessarily final yet. Web fonts (Forum/
   * Poppins/Inter, loaded async via the Google Fonts <link>) can swap in
   * afterwards and change heading/paragraph line-heights, and the About
   * page in particular has several text-heavy sections stacked above the
   * mosaic-reveal photos — a late font swap shifts everything below it
   * down (or up) by however much its box height changed.
   *
   * ScrollTrigger caches each trigger's start/end scroll position at setup
   * time and does not re-measure on its own when something *else* on the
   * page reflows later — see initMosaicRowFade's comment above for the
   * same underlying lesson via a different reflow source (there: JS
   * rewriting text content; here: async font loading). The visible
   * symptom is identical either way: a trigger firing against a stale
   * position looks like the pixel effect "sometimes doesn't appear" —
   * whether it does depends on the font finishing loading before or after
   * ScrollTrigger's initial calculation, which is inherently racy (network
   * speed, cache state), hence "sometimes".
   *
   * Fix: call ScrollTrigger.refresh() once every font the page requested
   * has actually loaded (document.fonts.ready), and again on window `load`
   * as a second pass in case images (hero, team photos) still shifted
   * anything despite their reserved aspect-ratio boxes. refresh()
   * re-measures every trigger's start/end against current layout — safe to
   * call more than once, it's a full recalculation, not a toggle.
   */
  function initScrollRefresh() {
    if (!hasGsap || !window.ScrollTrigger) return;

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        window.ScrollTrigger.refresh();
      });
    }

    window.addEventListener("load", function () {
      window.ScrollTrigger.refresh();
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
    initTrendChart: initTrendChart,
    initTrendTooltip: initTrendTooltip,
    initMarquee: initMarquee,
    initMosaicReveal: initMosaicReveal,
    initMosaicRowFade: initMosaicRowFade,
    initScrollRefresh: initScrollRefresh,
    initHeroSlideshow: initHeroSlideshow,
    prefersReducedMotion: prefersReducedMotion,
  };
})();
