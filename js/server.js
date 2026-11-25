"use strict";

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");

const SITE_ROOT = __dirname;
dotenv.config({ path: path.join(SITE_ROOT, ".env") });

const NEEDS = ["automation", "systems", "billing", "dashboards", "other"];
const BUDGETS = ["not-sure", "under-50k", "50k-150k", "150k-500k", "500k-plus"];
const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;

/* Phase 11: strips control characters (incl. null bytes) in addition to the
   existing trim/whitespace tidy, so they can't sneak through length checks. */
function readText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTransport(config) {
  const port = Number(config.SMTP_PORT);
  const ready = config.SMTP_HOST && Number.isInteger(port) && port > 0 && port < 65536 &&
    config.SMTP_USER && config.SMTP_PASS && config.MAIL_FROM && config.MAIL_TO;
  if (!ready) return null;

  const secure = config.SMTP_SECURE
    ? String(config.SMTP_SECURE).toLowerCase() === "true"
    : port === 465;

  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: port,
    secure: secure,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS }
  });
}

function createApp(options) {
  options = options || {};
  const config = options.mailConfig || process.env;
  const mailer = options.transporter || buildTransport(config);
  const allowedOrigins = new Set(
    (options.allowedOrigins || config.ALLOWED_ORIGINS || "")
      .split(",").map(function (origin) { return origin.trim(); }).filter(Boolean)
  );

  /* Phase 8 rate limiter, with a Phase 11 periodic sweep so the Map doesn't
     grow forever on a long-running process. Per-process only — see the
     multi-instance note if this ever runs behind a load balancer. */
  const rateLimits = new Map();
  const sweepTimer = setInterval(function () {
    const now = Date.now();
    rateLimits.forEach(function (limit, key) {
      if (limit.resetAt <= now) rateLimits.delete(key);
    });
  }, RATE_WINDOW_MS);
  if (sweepTimer.unref) sweepTimer.unref();

  const app = express();

  app.disable("x-powered-by");
  if (/^(1|true)$/i.test(process.env.TRUST_PROXY || "")) app.set("trust proxy", 1);

  /* Phase 11: HTTPS redirect. Works behind a proxy that sets x-forwarded-proto
     (Render/Railway/Heroku/Nginx) and with no proxy (req.secure) alike.
     Skipped outside production so local http://localhost keeps working. */
  app.use(function (req, res, next) {
    if (process.env.NODE_ENV !== "production") return next();
    const isSecure = req.secure || req.get("x-forwarded-proto") === "https";
    if (isSecure) return next();
    return res.redirect(301, "https://" + req.get("host") + req.originalUrl);
  });

  /* Phase 11: hardened headers. CSP's style-src keeps 'unsafe-inline' because
     the site uses inline style="" attributes and an inline <noscript> style
     block; script-src stays strict with no 'unsafe-inline' since that's the
     actual XSS vector, and the former inline scripts in 404.html/500.html
     were moved into js/main.js so this doesn't break them. */
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: []
      }
    },
    hsts: {
      maxAge: 63072000, // 2 years
      includeSubDomains: true,
      preload: false // flip to true only once you submit to hstspreload.org
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  }));

  // Helmet 8 dropped its built-in Permissions-Policy middleware — set it directly.
  app.use(function (req, res, next) {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), midi=(), interest-cohort=()"
    );
    next();
  });

  app.use("/api", function (req, res, next) {
    const origin = req.get("Origin");
    if (!origin) return next();

    let sameOrigin = false;
    try {
      const parsed = new URL(origin);
      sameOrigin = parsed.host === req.get("host") && parsed.protocol === req.protocol + ":";
    } catch (error) {
      sameOrigin = false;
    }

    if (!sameOrigin && !allowedOrigins.has(origin) && !allowedOrigins.has("*")) {
      return res.status(403).json({ ok: false, message: "This origin is not allowed." });
    }

    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Accept");
      return res.sendStatus(204);
    }
    return next();
  });

  app.use(express.json({ limit: "16kb", strict: true }));

  app.post("/api/contact", function (req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let limit = rateLimits.get(key);
    if (!limit || limit.resetAt <= now) {
      limit = { count: 0, resetAt: now + RATE_WINDOW_MS };
      rateLimits.set(key, limit);
    }
    if (limit.count >= RATE_LIMIT) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, message: "Please wait before sending another message." });
    }
    limit.count++;

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (readText(body.reference_code)) return res.json({ ok: true });

    const name = readText(body.name);
    const email = readText(body.email);
    const company = readText(body.company);
    const need = readText(body.need);
    const budget = readText(body.budget);
    // Phase 11: message keeps its own path (preserves newlines) but now also
    // strips control characters before the length checks run.
    const message = typeof body.message === "string"
      ? body.message
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
          .replace(/\r\n?/g, "\n")
          .normalize("NFC")
          .trim()
      : "";
    const errors = {};

    if (name.length < 2) errors.name = "Please enter your name using at least 2 characters.";
    else if (name.length > 80) errors.name = "Please keep your name under 80 characters.";
    if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = "Please enter a valid email address.";
    if (!company) errors.company = "Please enter your company or business name.";
    else if (company.length > 120) errors.company = "Please keep the company name under 120 characters.";
    if (NEEDS.indexOf(need) === -1) errors.need = "Please choose the option closest to what you need.";
    if (budget && BUDGETS.indexOf(budget) === -1) errors.budget = "Please choose one of the listed budget ranges.";
    if (message.length < 20) errors.message = "Please add a little more detail, at least 20 characters.";
    else if (message.length > 2000) errors.message = "Please keep your message under 2000 characters.";

    if (Object.keys(errors).length) return res.status(422).json({ ok: false, errors: errors });
    if (!mailer) {
      return res.status(503).json({ ok: false, message: "Email delivery is not configured. Please email us directly." });
    }

    const text = [
      "Name: " + name,
      "Email: " + email,
      "Company: " + company,
      "What they need: " + need,
      "Budget: " + (budget || "Not provided"),
      "",
      "Message:",
      message
    ].join("\n");

    mailer.sendMail({
      from: config.MAIL_FROM,
      to: config.MAIL_TO,
      replyTo: { name: name, address: email },
      subject: "HarshaForge enquiry from " + name,
      text: text
    }).then(function () {
      res.json({ ok: true });
    }).catch(function (error) {
      console.error("Contact email delivery failed:", error.code || error.name || "unknown error");
      res.status(502).json({ ok: false, message: "We could not deliver your message. Please email us directly." });
    });
  });

  app.use("/api", function (req, res) {
    res.status(404).json({ ok: false, message: "API endpoint not found." });
  });

  if (options.serveStatic !== false) {
    app.use(function (req, res, next) {
      const blocked = ["/server.js", "/js/server.js", "/package.json", "/package-lock.json", "/repomix-output.xml"];
      if (blocked.indexOf(req.path) !== -1 || req.path.indexOf("/node_modules/") === 0) {
        return res.sendStatus(404);
      }
      return next();
    });
    app.use(express.static(SITE_ROOT, { dotfiles: "deny", index: "index.html" }));
  }

  // Phase 10: on-brand error pages instead of plain text.
  app.use(function (req, res) {
    if (req.path.indexOf("/api/") === 0) return res.status(404).json({ ok: false, message: "API endpoint not found." });
    return res.status(404).sendFile(path.join(SITE_ROOT, "404.html"));
  });

  app.use(function (error, req, res, next) {
    if (res.headersSent) return next(error);
    if (req.path.indexOf("/api/") === 0) {
      console.error("Contact API request failed:", error.status || error.name || "unknown error");
      return res.status(error.status || 500).json({ ok: false, message: "The request could not be processed." });
    }
    console.error("Site request failed:", error.status || error.name || "unknown error");
    if (error.status === 403) return res.status(403).sendFile(path.join(SITE_ROOT, "403.html"));
    return res.status(500).sendFile(path.join(SITE_ROOT, "500.html"));
  });

  // Example only, for when a real admin area exists later:
  // function requireAuth(req, res, next) {
  //   if (!isAuthorized(req)) {
  //     var err = new Error("Forbidden");
  //     err.status = 403;
  //     return next(err);
  //   }
  //   next();
  // }
  // app.get("/admin", requireAuth, function (req, res) { ... });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, function () {
    console.log("HarshaForge is listening on port " + port + ".");
  });
}

module.exports = { createApp: createApp };