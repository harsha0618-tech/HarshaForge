"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("./server");

const validPayload = {
  name: "Harsha User",
  email: "person@example.com",
  company: "Example Studio",
  need: "automation",
  budget: "",
  message: "We repeat this task every week and want to simplify the process.",
  reference_code: ""
};

async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

function createTestApp(transporter) {
  return createApp({
    transporter: transporter,
    mailConfig: { MAIL_FROM: "site@example.com", MAIL_TO: "studio@example.com" },
    serveStatic: false
  });
}

test("sends a valid contact enquiry by email", async function () {
  const sent = [];
  const app = createTestApp({
    sendMail: async function (message) { sent.push(message); }
  });

  await withServer(app, async function (baseUrl) {
    const response = await fetch(baseUrl + "/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload)
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "studio@example.com");
    assert.equal(sent[0].replyTo.address, validPayload.email);
    assert.match(sent[0].text, /We repeat this task every week/);
  });
});

test("rejects invalid enquiries with field errors", async function () {
  let sendCount = 0;
  const app = createTestApp({
    sendMail: async function () { sendCount++; }
  });

  await withServer(app, async function (baseUrl) {
    const response = await fetch(baseUrl + "/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validPayload, email: "not-an-email", message: "short" })
    });
    const result = await response.json();

    assert.equal(response.status, 422);
    assert.ok(result.errors.email);
    assert.ok(result.errors.message);
    assert.equal(sendCount, 0);
  });
});

test("does not send enquiries containing the honeypot value", async function () {
  let sendCount = 0;
  const app = createTestApp({
    sendMail: async function () { sendCount++; }
  });

  await withServer(app, async function (baseUrl) {
    const response = await fetch(baseUrl + "/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validPayload, reference_code: "bot-filled" })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(sendCount, 0);
  });
});

/* ---------- Phase 14: SEO checks ---------- */

const ORIGIN = "https://www.harshaforge.com";
const NOINDEX_PAGES = ["403.html", "404.html", "500.html"];
const indexablePages = fs.readdirSync(__dirname)
  .filter(function (file) { return file.endsWith(".html") && NOINDEX_PAGES.indexOf(file) === -1; });

function pageUrl(file) {
  return file === "index.html" ? ORIGIN + "/" : ORIGIN + "/" + file;
}

test("every indexable page has unique SEO tags and a single H1", function () {
  const titles = new Set();
  const descriptions = new Set();
  indexablePages.forEach(function (file) {
    const html = fs.readFileSync(path.join(__dirname, file), "utf8");
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
    const description = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1];
    assert.ok(title, file + " is missing <title>");
    assert.ok(title.length <= 60, file + " title is over 60 characters");
    assert.ok(description, file + " is missing a meta description");
    assert.ok(description.length >= 70 && description.length <= 160, file + " description should be 70-160 characters");
    assert.ok(!titles.has(title), file + " reuses another page's title");
    assert.ok(!descriptions.has(description), file + " reuses another page's description");
    titles.add(title);
    descriptions.add(description);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, file + " must have exactly one <h1>");
    assert.ok(html.indexOf('<link rel="canonical" href="' + pageUrl(file) + '">') !== -1, file + " canonical is missing or wrong");
    assert.ok(html.indexOf('<meta property="og:url" content="' + pageUrl(file) + '">') !== -1, file + " og:url is missing or wrong");
    assert.equal(html.indexOf('name="robots" content="noindex'), -1, file + " is accidentally noindexed");
  });
});

test("heading levels never skip downwards", function () {
  indexablePages.forEach(function (file) {
    const html = fs.readFileSync(path.join(__dirname, file), "utf8");
    let last = 0;
    (html.match(/<h[1-6][\s>]/g) || []).forEach(function (tag) {
      const level = Number(tag[2]);
      assert.ok(level <= last + 1, file + " jumps from h" + last + " to h" + level);
      last = level;
    });
  });
});

test("sitemap.xml lists exactly the indexable pages", function () {
  const xml = fs.readFileSync(path.join(__dirname, "sitemap.xml"), "utf8");
  const listed = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map(function (loc) { return loc.replace(/<\/?loc>/g, ""); }).sort();
  assert.deepEqual(listed, indexablePages.map(pageUrl).sort());
});

test("robots.txt points at the sitemap and keeps the API out of search", function () {
  const robots = fs.readFileSync(path.join(__dirname, "robots.txt"), "utf8");
  assert.match(robots, /^Sitemap: https:\/\/www\.harshaforge\.com\/sitemap\.xml$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
});

test("home page carries valid Organization structured data", function () {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const raw = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
  assert.ok(raw, "JSON-LD block is missing");
  const org = JSON.parse(raw)["@graph"].filter(function (node) { return node["@type"] === "Organization"; })[0];
  assert.equal(org.name, "HarshaForge Digital Solutions");
  assert.equal(org.url, ORIGIN + "/");
});

test("serves robots.txt, sitemap.xml and a real 404 status for unknown pages", async function () {
  const app = createApp({ mailConfig: {} });
  await withServer(app, async function (baseUrl) {
    const robots = await fetch(baseUrl + "/robots.txt");
    assert.equal(robots.status, 200);
    const sitemap = await fetch(baseUrl + "/sitemap.xml");
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get("content-type"), /xml/);
    const missing = await fetch(baseUrl + "/no-such-page.html");
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /wrong turn/);
  });
});

test("redirects to the canonical https host when CANONICAL_HOST is set", async function () {
  const app = createApp({ mailConfig: { CANONICAL_HOST: "www.harshaforge.com" }, serveStatic: false });
  await withServer(app, async function (baseUrl) {
    const response = await fetch(baseUrl + "/about.html?x=1", { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), "https://www.harshaforge.com/about.html?x=1");
  });
});
