/* HarshaForge — main.js (Phase 1: Foundation)
   - Mobile nav toggle (click, Esc, outside click, resize, link click)
   - Footer year
   - Button loading helper: HF.setLoading(btn, true|false)               */
(function () {
  "use strict";

  var MOBILE_MAX = 599;

  /* ---- Mobile navigation ---- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");

  function setNav(open) {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    nav.classList.toggle("is-open", open);
  }
  function isOpen() { return toggle && toggle.getAttribute("aria-expanded") === "true"; }

  if (toggle && nav) {
    toggle.addEventListener("click", function () { setNav(!isOpen()); });

    // Esc closes and returns focus to the toggle
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) { setNav(false); toggle.focus(); }
    });
    // Click outside closes
    document.addEventListener("click", function (e) {
      if (isOpen() && !nav.contains(e.target) && !toggle.contains(e.target)) setNav(false);
    });
    // Choosing a link closes
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setNav(false);
    });
    // Leaving mobile width resets state
    window.addEventListener("resize", function () {
      if (window.innerWidth > MOBILE_MAX && isOpen()) setNav(false);
    });
  }

  /* ---- Footer year ---- */
  var yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---- Button loading state (used by forms in Phase 8) ---- */
  window.HF = window.HF || {};
  window.HF.setLoading = function (btn, on) {
    if (!btn) return;
    btn.classList.toggle("is-loading", on);
    btn.disabled = on;
    btn.setAttribute("aria-busy", String(on));
  };
    /* ---- Scroll reveal (skipped for reduced motion / old browsers) ---- */
  var revealEls = document.querySelectorAll(".reveal");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("IntersectionObserver" in window) || reduceMotion) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); io.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---- Lazy media: skeleton + blur-up + graceful fallback ---- */
  document.querySelectorAll(".media-lazy").forEach(function (box) {
    var img = box.querySelector(".media-lazy__img");
    if (!img) return;
    function ok()   { box.classList.remove("is-pending"); box.classList.add("is-loaded"); }
    function fail() { box.classList.remove("is-pending"); box.classList.add("is-error"); }
    if (img.complete) { (img.naturalWidth > 0 ? ok : fail)(); return; }
    box.classList.add("is-pending");
    img.addEventListener("load", ok, { once: true });
    img.addEventListener("error", fail, { once: true });
  });
    /* ---- Work page: client-side filter (Phase 4) ----
     Filters by category + type. State is mirrored to ?category=&type= so a
     filtered view can be linked to. URL values are checked against a whitelist
     and never inserted into the page as HTML.                              */
  var workGrid = document.getElementById("work-grid");
  if (workGrid) {
    var CATEGORIES = ["all", "automation", "systems", "billing", "dashboards"];
    var TYPES = ["all", "real", "concept"];

    var workTools = document.getElementById("work-tools");
    var workStatus = document.getElementById("work-status");
    var workEmpty = document.getElementById("work-empty");
    var workEmptyMsg = document.getElementById("work-empty-msg");
    var workClear = document.getElementById("work-clear");
    var workCards = Array.prototype.slice.call(workGrid.querySelectorAll("[data-category]"));
    var catBtns = Array.prototype.slice.call(document.querySelectorAll("[data-filter-category]"));
    var typeBtns = Array.prototype.slice.call(document.querySelectorAll("[data-filter-type]"));
    var workState = { category: "all", type: "all" };

    function pressed(btns, attr, value) {
      btns.forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value));
      });
    }

    function syncUrl() {
      try {
        var params = [];
        if (workState.category !== "all") params.push("category=" + workState.category);
        if (workState.type !== "all") params.push("type=" + workState.type);
        var url = window.location.pathname + (params.length ? "?" + params.join("&") : "") + window.location.hash;
        window.history.replaceState(null, "", url);
      } catch (e) { /* non-critical: ignore */ }
    }

    function applyWorkFilter() {
      var shown = 0;
      workCards.forEach(function (card) {
        var okCat = workState.category === "all" || card.getAttribute("data-category") === workState.category;
        var okType = workState.type === "all" || card.getAttribute("data-type") === workState.type;
        var match = okCat && okType;
        card.hidden = !match;
        if (match) shown++;
      });

      pressed(catBtns, "data-filter-category", workState.category);
      pressed(typeBtns, "data-filter-type", workState.type);

      workGrid.hidden = shown === 0;
      workEmpty.hidden = shown !== 0;

      if (shown === 0) {
        workStatus.textContent = "No projects match the selected filters.";
        workEmptyMsg.textContent = workState.type === "real"
          ? "We have not published any real client projects yet. Every project here is labeled as a concept build, and real work will be added once clients approve sharing it."
          : "Try a different category, or clear the filters to see every project.";
      } else {
        workStatus.textContent = "Showing " + shown + " of " + workCards.length + " projects.";
      }
      syncUrl();
    }

    // Read initial state from the URL (whitelisted values only)
    try {
      var qs = new URLSearchParams(window.location.search);
      var qCat = qs.get("category"), qType = qs.get("type");
      if (CATEGORIES.indexOf(qCat) > -1) workState.category = qCat;
      if (TYPES.indexOf(qType) > -1) workState.type = qType;
    } catch (e) { /* older browser: default to All */ }

    workTools.addEventListener("click", function (e) {
      var c = e.target.closest("[data-filter-category]");
      var t = e.target.closest("[data-filter-type]");
      if (c) { workState.category = c.getAttribute("data-filter-category"); applyWorkFilter(); }
      else if (t) { workState.type = t.getAttribute("data-filter-type"); applyWorkFilter(); }
    });

    workClear.addEventListener("click", function () {
      workState.category = "all"; workState.type = "all";
      applyWorkFilter();
      var first = catBtns[0]; if (first) first.focus();
    });

    // Reveal the controls (they stay hidden without JS) and render
    workTools.hidden = false;
    applyWorkFilter();
  }
    /* ---- FAQ accordion: opening one closes the others (Phase 7) ----
     Uses native <details>/<summary>, so keyboard access and ARIA state
     are handled by the browser; this only adds single-open behavior. */
  var accordionItems = document.querySelectorAll(".accordion__item");
  accordionItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (item.open) {
        accordionItems.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      }
    });
  });
    /* ---- Contact form (Phase 8) ----
     Client-side checks mirror the server rules, but the server is the real
     gate. Anything typed by the visitor, or sent back by the server, is only
     ever written with textContent, never innerHTML.                        */
  var contactForm = document.getElementById("contact-form");
  if (contactForm) {
    var ENDPOINT = contactForm.getAttribute("data-endpoint") || "/api/contact";
    var TIMEOUT_MS = 15000;
    var MSG_MIN = 20;
    var MSG_MAX = 2000;
    var EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
    var NEEDS = ["automation", "systems", "billing", "dashboards", "other"];
    var BUDGETS = ["not-sure", "under-50k", "50k-150k", "150k-500k", "500k-plus"];
    var KEYS = ["name", "email", "company", "need", "budget", "message"];

    var inputs = {};
    var slots = {};
    var touched = {};
    KEYS.forEach(function (k) {
      inputs[k] = document.getElementById("cf-" + k);
      slots[k] = document.getElementById("cf-" + k + "-error");
    });

    var trap = document.getElementById("cf-reference");
    var submitBtn = document.getElementById("cf-submit");
    var formCard = document.getElementById("contact-form-card");
    var successCard = document.getElementById("contact-success");
    var successTitle = document.getElementById("contact-success-title");
    var successName = document.getElementById("cf-success-name");
    var alertBox = document.getElementById("cf-alert");
    var alertText = document.getElementById("cf-alert-text");
    var statusEl = document.getElementById("cf-status");
    var counter = document.getElementById("cf-message-count");
    var submitting = false;

    var GENERIC_MSG = "Something went wrong on our side and your message was not sent. Please try again in a moment.";
    var NETWORK_MSG = "We could not reach the server. Check your connection and try again.";
    var LIMIT_MSG = "You have sent several messages in a short time. Please wait a while before trying again.";

    /* Read a field the same way the server will: trimmed, whitespace tidied */
    function read(key) {
      var v = inputs[key].value;
      if (key === "message") return v.replace(/\r\n?/g, "\n").trim();
      return v.replace(/\s+/g, " ").trim();
    }

    /* One rule per field. Each returns "" when fine, or a specific message. */
    var rules = {
      name: function (v) {
        if (!v) return "Please enter your name.";
        if (v.length < 2) return "That name looks too short. Please enter at least 2 characters.";
        if (v.length > 80) return "Please keep your name under 80 characters.";
        return "";
      },
      email: function (v) {
        if (!v) return "Please enter your email address so we know where to reply.";
        if (v.length > 254 || !EMAIL_RE.test(v)) return "That email looks invalid. Check for a missing @ or domain, for example name@company.com.";
        return "";
      },
      company: function (v) {
        if (!v) return "Please enter your company or business name. If you work for yourself, your own name is fine.";
        if (v.length > 120) return "Please keep the company name under 120 characters.";
        return "";
      },
      need: function (v) {
        return NEEDS.indexOf(v) === -1 ? "Please choose the option closest to what you need." : "";
      },
      budget: function (v) {
        return (v === "" || BUDGETS.indexOf(v) > -1) ? "" : "Please choose one of the listed ranges, or leave it blank.";
      },
      message: function (v) {
        if (!v) return "Please describe what you would like to improve.";
        if (v.length < MSG_MIN) return "Please add a little more detail, at least " + MSG_MIN + " characters, so our first reply can be specific.";
        if (v.length > MSG_MAX) return "Please keep your message under " + MSG_MAX + " characters.";
        return "";
      }
    };

    function setFieldError(key, msg) {
      var input = inputs[key];
      slots[key].textContent = msg;
      input.closest(".field").classList.toggle("has-error", !!msg);
      if (msg) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      return msg;
    }

    function validateField(key) {
      return setFieldError(key, rules[key](read(key)));
    }

    /* Validates everything; returns the first invalid input (or null) */
    function validateAll() {
      var first = null;
      KEYS.forEach(function (k) {
        touched[k] = true;
        if (validateField(k) && !first) first = inputs[k];
      });
      return first;
    }

    function clearAllErrors() {
      KEYS.forEach(function (k) { setFieldError(k, ""); touched[k] = false; });
    }

    function showAlert(msg) {
      alertText.textContent = msg;
      alertBox.hidden = false;
      alertBox.scrollIntoView({ block: "nearest" });
    }
    function hideAlert() {
      alertBox.hidden = true;
      alertText.textContent = "";
    }

    function updateCounter() {
      var n = inputs.message.value.length;
      counter.textContent = n + " / " + MSG_MAX;
      counter.classList.toggle("is-near", n >= MSG_MAX - 100);
    }

    /* Check on leaving a field, then keep the message fresh while they fix it */
    KEYS.forEach(function (k) {
      var el = inputs[k];
      el.addEventListener("blur", function () { touched[k] = true; validateField(k); });
      el.addEventListener((k === "need" || k === "budget") ? "change" : "input", function () {
        if (touched[k] || el.closest(".field").classList.contains("has-error")) validateField(k);
      });
    });
    inputs.message.addEventListener("input", updateCounter);

    /* Optional prefill from ?need=billing (whitelisted, never inserted as HTML) */
    try {
      var qNeed = new URLSearchParams(window.location.search).get("need");
      if (NEEDS.indexOf(qNeed) > -1) inputs.need.value = qNeed;
    } catch (e) { /* older browser: leave the dropdown blank */ }

    function showSuccess() {
      var firstName = read("name").split(" ")[0];
      successName.textContent = firstName || "there";
      contactForm.reset();
      clearAllErrors();
      hideAlert();
      updateCounter();
      formCard.hidden = true;
      successCard.hidden = false;
      successTitle.focus();
    }

    document.getElementById("cf-reset").addEventListener("click", function () {
      successCard.hidden = true;
      formCard.hidden = false;
      inputs.name.focus();
    });

    function handleResponse(status, data) {
      data = data || {};

      if (status >= 200 && status < 300 && data.ok) { showSuccess(); return; }

      // Server-side validation caught something the browser let through
      if (status === 422 && data.errors) {
        var first = null;
        KEYS.forEach(function (k) {
          if (typeof data.errors[k] === "string") {
            touched[k] = true;
            setFieldError(k, data.errors[k]);
            if (!first) first = inputs[k];
          }
        });
        if (first) { first.focus(); return; }
      }

      if (status === 429) {
        showAlert(typeof data.message === "string" && data.message ? data.message : LIMIT_MSG);
        return;
      }
      showAlert(GENERIC_MSG);
    }

    function send(payload) {
      submitting = true;
      HF.setLoading(submitBtn, true);
      statusEl.textContent = "Sending your message.";

      var ctrl = ("AbortController" in window) ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

      function done() {
        clearTimeout(timer);
        submitting = false;
        HF.setLoading(submitBtn, false);
        statusEl.textContent = "";
      }

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (res) {
          return res.json().then(
            function (d) { return { status: res.status, data: d }; },
            function () { return { status: res.status, data: {} }; }
          );
        })
        .then(function (out) { done(); handleResponse(out.status, out.data); })
        .catch(function () { done(); showAlert(NETWORK_MSG); });
    }

    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submitting) return;            // blocks double-submit
      hideAlert();

      var firstBad = validateAll();
      if (firstBad) { firstBad.focus(); return; }

      // Honeypot filled: act as if it worked, send nothing
      if (trap && trap.value) { showSuccess(); return; }

      send({
        name: read("name"),
        email: read("email"),
        company: read("company"),
        need: read("need"),
        budget: read("budget"),
        message: read("message"),
        reference_code: trap ? trap.value : ""
      });
    });

    updateCounter();
  }
    /* ---- Offline / network state banner (Phase 10) ----
     Pairs with the existing contact-form network alert (Phase 8) — this one
     is site-wide so any page tells the visitor their connection dropped,
     not just the form.                                                     */
  var offlineBanner = document.getElementById("offline-banner");
  function setOffline(off) {
    if (!offlineBanner) return;
    offlineBanner.classList.toggle("is-visible", off);
    document.body.classList.toggle("has-offline-banner", off);
    offlineBanner.setAttribute("aria-hidden", String(!off));
  }
  if (offlineBanner) {
    setOffline(!navigator.onLine);
    window.addEventListener("online", function () { setOffline(false); });
    window.addEventListener("offline", function () { setOffline(true); });
  }

  /* ---- Page-transition progress bar (Phase 10, optional) ----
     This site uses normal full-page navigation, so this is only a perceived-
     performance nicety on slow connections, not a routing requirement.     */
  var pageProgress = document.getElementById("page-progress");
  if (pageProgress) {
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var url;
      try { url = new URL(a.href, window.location.href); } catch (err) { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.hash) return; // same-page anchor
      pageProgress.classList.add("is-active");
      pageProgress.style.width = "70%";
    });
    window.addEventListener("pageshow", function () {
      pageProgress.classList.remove("is-active");
      pageProgress.style.width = "0%";
    });
  }

  /* ---- 404 page: client-side quick search (Phase 11: moved out of inline
     <script> so script-src can drop 'unsafe-inline') ---- */
  var errSearch = document.getElementById("error-search");
  var errResults = document.getElementById("error-search-results");
  if (errSearch && errResults) {
    var SITE_PAGES = [
      { title: "Home", href: "index.html", desc: "Overview of HarshaForge." },
      { title: "Services", href: "services.html", desc: "What we build, by business outcome." },
      { title: "Work", href: "work.html", desc: "Case studies and concept builds." },
      { title: "About", href: "about.html", desc: "Studio story and direct access." },
      { title: "Process", href: "process.html", desc: "Discover, design, build, test, launch, support." },
      { title: "Pricing", href: "pricing.html", desc: "Engagement models and FAQ." },
      { title: "Contact", href: "contact.html", desc: "Book a consultation." },
      { title: "Automation", href: "automation.html", desc: "Automate manual processes." },
      { title: "Management systems", href: "management-systems.html", desc: "Custom management systems." },
      { title: "Billing and inventory", href: "billing-inventory.html", desc: "Billing and inventory automation." },
      { title: "Internal tools", href: "internal-tools.html", desc: "Internal tools and dashboards." },
      { title: "Privacy policy", href: "privacy.html", desc: "" },
      { title: "Terms of service", href: "terms.html", desc: "" }
    ];
    errSearch.addEventListener("input", function () {
      var q = errSearch.value.trim().toLowerCase();
      while (errResults.firstChild) errResults.removeChild(errResults.firstChild);
      if (!q) { errResults.hidden = true; return; }
      var matches = SITE_PAGES.filter(function (p) {
        return p.title.toLowerCase().indexOf(q) > -1 || p.desc.toLowerCase().indexOf(q) > -1;
      }).slice(0, 6);
      if (!matches.length) {
        var li = document.createElement("li");
        li.textContent = "No matching pages. Try the links below, or contact us.";
        errResults.appendChild(li);
      } else {
        matches.forEach(function (p) {
          var li = document.createElement("li");
          var a = document.createElement("a");
          a.href = p.href;
          a.textContent = p.title;
          li.appendChild(a);
          errResults.appendChild(li);
        });
      }
      errResults.hidden = false;
    });
  }

  /* ---- 500 page: retry button (Phase 11: moved out of inline onclick) ---- */
  var errRetry = document.getElementById("error-retry");
  if (errRetry) errRetry.addEventListener("click", function () { location.reload(); });
})();