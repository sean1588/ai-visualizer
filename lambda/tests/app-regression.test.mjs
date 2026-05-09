import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { chromium, devices } from "playwright";

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const PLAN = {
  title: "SaaS Revenue & Retention Dashboard",
  observations: [
    "MRR rises from 42k in Jan to 102.4k in Dec, more than doubling over the period.",
    "New customers increase from 84 to 184 while NPS improves from 38 to 61.",
    "Churn ticks up to 22 in Dec and should be watched alongside growth.",
  ],
  widgets: [
    { type: "kpi", span: 3, title: "MRR", fields: { metric: "mrr", spark: "month" } },
    { type: "kpi", span: 3, title: "New Customers", fields: { metric: "new_customers", spark: "month" } },
    { type: "kpi", span: 3, title: "Churn", fields: { metric: "churn", spark: "month" } },
    { type: "kpi", span: 3, title: "NPS", fields: { metric: "nps", spark: "month" } },
    { type: "line", span: 8, title: "MRR Trend", fields: { x: "month", y: "mrr" } },
    { type: "bar", span: 4, title: "Customer Acquisition", fields: { x: "month", y: "new_customers" } },
    { type: "bar", span: 6, title: "Monthly Churn", fields: { x: "month", y: "churn" } },
    { type: "line", span: 6, title: "NPS Trend", fields: { x: "month", y: "nps" } },
  ],
};

const CHEF_WITHOUT_OBSERVATIONS = {
  title: PLAN.title,
  reply: "Trimmed the tasting notes; the core metrics stay on the plate.",
  changes: ["removed observations widget"],
  widgets: PLAN.widgets,
};

const BROKEN_PARTIAL_CHEF = {
  title: PLAN.title,
  reply: "Removed the tasting notes.",
  changes: ["removed observations widget"],
  widgets: [
    { type: "kpi", span: 3, label: "Revenue", value: "102.4k", delta: 8.4, sparkCol: "month" },
    { type: "line", span: 8, title: "Broken trend", x: "mrr", y: "month" },
    { type: "table", span: 12, title: "Only surviving table", fields: { limit: 10 } },
  ],
};

let server;

test.before(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: new URL("../../public/", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(BASE_URL);
});

test.after(async () => {
  if (!server) return;
  server.kill();
  await once(server, "exit").catch(() => {});
});

test("landing copy accurately describes sampled-row inference", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();

    assert.match(text, /samples a few rows for inference/i);
    assert.match(text, /sample rows sent once for inference/i);
    assert.doesNotMatch(text, /Nothing is uploaded/i);
    assert.doesNotMatch(text, /Claude/i);
  });
});

test("sample dashboard renders and exports a PNG", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-btn").click();
    const download = await downloadPromise;

    assert.match(download.suggestedFilename(), /\.png$/);
    const text = await page.locator("body").innerText();
    assert.match(text, /102\.4k/);
    assert.match(text, /MRR Trend/);
    assert.doesNotMatch(text, /undefined/);
  });
});

test("Chef edit removes observations without dropping valid dashboard widgets", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.locator("#chef-fab").click();
    await page.getByText("Hide the observations widget").click();
    await page.waitForFunction(() => !document.body.innerText.includes("What stood out"));

    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, /What stood out/);
    assert.match(text, /102\.4k/);
    assert.match(text, /MRR Trend/);
    assert.match(text, /Customer Acquisition/);
    assert.doesNotMatch(text, /undefined/);
  });
});

test("Chef refuses suspicious partial recipes instead of applying table-only collapse", async () => {
  await withPage(async page => {
    await mockInference(page, BROKEN_PARTIAL_CHEF);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.locator("#chef-fab").click();
    await page.getByText("Hide the observations widget").click();
    await page.waitForFunction(() => document.body.innerText.includes("The chef returned an incomplete recipe"));

    const text = await page.locator("body").innerText();
    assert.match(text, /The chef returned an incomplete recipe/);
    assert.match(text, /What stood out/);
    assert.match(text, /MRR Trend/);
  });
});

test("mobile dashboard stacks without horizontal overflow and uses compact Chef button", async () => {
  await withPage(async page => {
    await page.setViewportSize(devices["iPhone 14 Pro"].viewport);
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const metrics = await page.evaluate(() => {
      const fab = document.querySelector("#chef-fab");
      const label = fab?.querySelector("span:last-child");
      const rect = fab?.getBoundingClientRect();
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        fabLabelDisplay: label ? getComputedStyle(label).display : null,
        fabWidth: rect?.width,
        fabHeight: rect?.height,
      };
    });

    assert.equal(metrics.scrollWidth, metrics.width);
    assert.equal(metrics.fabLabelDisplay, "none");
    assert.equal(metrics.fabWidth, 46);
    assert.equal(metrics.fabHeight, 46);
  });
});

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
  const messages = [];
  page.on("console", msg => {
    if (["error", "warning"].includes(msg.type())) messages.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", error => messages.push(`pageerror: ${error.message}`));
  try {
    await fn(page);
    assert.deepEqual(messages, []);
  } finally {
    await browser.close();
  }
}

async function mockInference(page, chefRecipe = CHEF_WITHOUT_OBSERVATIONS) {
  await page.route("**/api/cook", async route => {
    const body = route.request().postDataJSON();
    const payload = body.kind === "chef" ? chefRecipe : PLAN;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: JSON.stringify(payload) }),
    });
  });
  await page.route("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.html2canvas = async function () {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          canvas.getContext('2d').fillRect(0, 0, 64, 64);
          return canvas;
        };
      `,
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
