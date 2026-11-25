"use strict";

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");

const SITE_ROOT = __dirname;
dotenv.config({ path: path.join(SITE_ROOT, ".env") });

const NEEDS = ["automation", "systems", "billing", "dashboards", "other"];
const BUDGETS = ["not-sure", "under-50k", "50k-150k", "150k-500k", "500k-plus"];
const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;

function readText(value) {
  return typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim() : "";
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
  const rateLimits = new Map();
  const app = express();

  app.disable("x-powered-by");
  if (/^(1|true)$/i.test(process.env.TRUST_PROXY || "")) app.set("trust proxy", 1);
  const canonicalHost = (config.CANONICAL_HOST || "").trim().toLowerCase();
  if (canonicalHost) {
    app.use(function (req, res, next) {
      if (req.hostname.toLowerCase() === canonicalHost && req.protocol === "https") return next();
      return res.redirect(301, "https://" + canonicalHost + req.originalUrl);
    });
  }
  app.use(helmet());
  app.use(compression());

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
    const message = typeof body.message === "string"
      ? body.message.replace(/\r\n?/g, "\n").normalize("NFC").trim()
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
    app.use(express.static(SITE_ROOT, {
      dotfiles: "deny",
      index: "index.html",
      maxAge: "1h",
      setHeaders: function (res, filePath) {
        if (/\.(?:css|js)$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
        } else if (/\.(?:svg|png|jpe?g|webp|avif|woff2?)$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=604800, must-revalidate");
        }
      }
    }));
  }

  app.use(function (req, res) {
    if (req.path.indexOf("/api/") === 0) return res.status(404).json({ ok: false, message: "API endpoint not found." });
    if (options.serveStatic === false) return res.status(404).send("Page not found.");
    return res.status(404).sendFile(path.join(SITE_ROOT, "404.html"));
  });

  app.use(function (error, req, res, next) {
    if (res.headersSent) return next(error);
    if (req.path.indexOf("/api/") === 0) {
      console.error("Contact API request failed:", error.status || error.name || "unknown error");
      return res.status(error.status || 500).json({ ok: false, message: "The request could not be processed." });
    }
    console.error("Site request failed:", error.status || error.name || "unknown error");
    return res.status(error.status || 500).send("The request could not be processed.");
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, function () {
    console.log("HarshaForge is listening on port " + port + ".");
  });
}

module.exports = { createApp: createApp };
