import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const RENDERED_SHAPE_CHEF = {
  title: PLAN.title,
  reply: "Kept the same plate; the shape is now normalized.",
  changes: ["normalized rendered widgets"],
  widgets: [
    { type: "kpi", span: 3, title: "MRR", label: "MRR", value: "102.4k", delta: 8.4, metric: "mrr" },
    { type: "kpi", span: 3, title: "New Customers", label: "New Customers", value: "184", delta: 9.5, metric: "new_customers" },
    { type: "kpi", span: 3, title: "Churn", label: "Churn", value: "22", delta: 22.2, metric: "churn" },
    { type: "kpi", span: 3, title: "NPS", label: "NPS", value: "61", delta: 5.2, metric: "nps" },
    { type: "line", span: 8, title: "MRR Trend", x: "month", y: "mrr" },
    { type: "bar", span: 4, title: "Customer Acquisition", x: "month", y: "new_customers" },
    { type: "bar", span: 6, title: "Monthly Churn", x: "month", y: "churn" },
    { type: "line", span: 6, title: "NPS Trend", x: "month", y: "nps" },
  ],
};

const AIRPORTS = [
  { code: "ATL", name: "Hartsfield-Jackson Atlanta International", city: "Atlanta", country: "US", lat: 33.6407, lon: -84.4277 },
  { code: "PEK", name: "Beijing Capital International", city: "Beijing", country: "CN", lat: 40.0801, lon: 116.5846 },
  { code: "DXB", name: "Dubai International", city: "Dubai", country: "AE", lat: 25.2528, lon: 55.3644 },
  { code: "LAX", name: "Los Angeles International", city: "Los Angeles", country: "US", lat: 33.9425, lon: -118.4081 },
  { code: "HND", name: "Tokyo Haneda", city: "Tokyo", country: "JP", lat: 35.5494, lon: 139.7798 },
  { code: "ORD", name: "O'Hare International", city: "Chicago", country: "US", lat: 41.9742, lon: -87.9073 },
  { code: "LHR", name: "London Heathrow", city: "London", country: "GB", lat: 51.47, lon: -0.4543 },
  { code: "PVG", name: "Shanghai Pudong International", city: "Shanghai", country: "CN", lat: 31.1443, lon: 121.8083 },
  { code: "CDG", name: "Charles de Gaulle", city: "Paris", country: "FR", lat: 49.0097, lon: 2.5479 },
  { code: "AMS", name: "Amsterdam Schiphol", city: "Amsterdam", country: "NL", lat: 52.3105, lon: 4.7683 },
  { code: "DFW", name: "Dallas/Fort Worth International", city: "Dallas", country: "US", lat: 32.8998, lon: -97.0403 },
  { code: "FRA", name: "Frankfurt Airport", city: "Frankfurt", country: "DE", lat: 50.0379, lon: 8.5622 },
];

const SEGMENT_REVENUE = [
  { segment: "startup", revenue: 12000, channel: "organic" },
  { segment: "startup", revenue: 8000, channel: "paid" },
  { segment: "midmarket", revenue: 24000, channel: "organic" },
  { segment: "midmarket", revenue: 16000, channel: "partner" },
  { segment: "enterprise", revenue: 60000, channel: "partner" },
];

const AGGREGATE_PLAN = {
  title: "Segment Revenue",
  widgets: [
    { type: "kpi", span: 3, title: "Total Revenue", fields: { metric: "revenue", aggregate: "sum" } },
    { type: "kpi", span: 3, title: "Average Revenue", fields: { metric: "revenue", aggregate: "average" } },
    { type: "bar", span: 6, title: "Revenue by Segment", fields: { x: "segment", y: "revenue" } },
    { type: "table", span: 12, title: "Rows", fields: { limit: 10 } },
  ],
};

const WORKBENCH_ROWS = [
  { date: "2026-01-01", segment: "Free", revenue: 10, orders: 2, customer_email: "ada@example.com" },
  { date: "2026-02-01", segment: "Pro", revenue: 20, orders: 4, customer_email: "lin@example.com" },
  { date: "2026-03-01", segment: "Pro", revenue: 30, orders: 6, customer_email: "sam@example.com" },
  { date: "2026-04-01", segment: "Team", revenue: 40, orders: 8, customer_email: "jo@example.com" },
  { date: "2026-05-01", segment: "Pro", revenue: 50, orders: 10, customer_email: "max@example.com" },
  { date: "2026-06-01", segment: "Pro", revenue: 60, orders: 12, customer_email: "ivy@example.com" },
  { date: "2026-07-01", segment: "Pro", revenue: 70, orders: 14, customer_email: "lee@example.com" },
];

const WORKBENCH_PLAN = {
  title: "Segment Workbench",
  widgets: [
    { type: "kpi", span: 3, title: "Revenue", fields: { metric: "revenue", aggregate: "sum", format: "number" } },
    { type: "kpi", span: 3, title: "Orders", fields: { metric: "orders", aggregate: "sum", format: "number" } },
    { type: "bar", span: 6, title: "Revenue by segment", fields: { x: "segment", y: "revenue", aggregate: "sum", format: "number" } },
    { type: "table", span: 12, title: "Rows", fields: { limit: 10, sort: "revenue", order: "desc" } },
  ],
};

const BARLEY = [
  { yield: 27.0, variety: "Manchuria", year: 1931, site: "University Farm" },
  { yield: 43.1, variety: "Manchuria", year: 1932, site: "University Farm" },
  { yield: 34.7, variety: "Glabron", year: 1931, site: "Waseca" },
  { yield: 55.2, variety: "Glabron", year: 1932, site: "Waseca" },
  { yield: 39.3, variety: "No. 457", year: 1931, site: "Morris" },
  { yield: 58.1, variety: "No. 457", year: 1932, site: "Morris" },
];

const TABLE_ONLY_PLAN = {
  title: "Barley Trial",
  widgets: [
    { type: "table", span: 12, title: "Rows", fields: { limit: 10 } },
  ],
};

const QUOTED_COMMA_CSV = [
  "Date,Product,Qty,Amount,Rep,Note",
  '2026-08-03,"Widget, C",3,400.00,Ava,"quoted comma"',
  "2026-08-04,Gadget,1,50.00,Bea,plain",
  "",
  "2026-08-05,Widget,2,80.00,Ava,third",
].join("\n");

const MESSY_SALES_CSV = "\uFEFFDate,Product,Qty,Amount,Rep,Note\n" + QUOTED_COMMA_CSV.split("\n").slice(1).join("\n");

const TOP_N_ROWS = [
  { week: "2026-W01", expansion_usd: 120 },
  { week: "2026-W02", expansion_usd: 40 },
  { week: "2026-W03", expansion_usd: 880 },
  { week: "2026-W04", expansion_usd: 15 },
  { week: "2026-W05", expansion_usd: 410 },
  { week: "2026-W06", expansion_usd: 90 },
  { week: "2026-W07", expansion_usd: 700 },
  { week: "2026-W08", expansion_usd: 55 },
  { week: "2026-W09", expansion_usd: 300 },
  { week: "2026-W10", expansion_usd: 10 },
  { week: "2026-W11", expansion_usd: 250 },
  { week: "2026-W12", expansion_usd: 5 },
];

const TOP_N_PLAN = {
  title: "Expansion",
  widgets: [
    { type: "kpi", span: 3, title: "Expansion", fields: { metric: "expansion_usd", aggregate: "sum" } },
    { type: "table", span: 12, title: "Top 10 Weeks by Expansion USD", fields: { limit: 10 } },
  ],
};

const Q1_REVENUE_CSV = readFileSync(new URL("./fixtures/q1_revenue.csv", import.meta.url), "utf8");

const Q1_REVENUE_PLAN = {
  title: "SaaS Revenue Retention Dashboard",
  observations: [
    "Enterprise finishes at 571.2k MRR and 1.22 NRR on 2026-03-24.",
    "SMB ends at 1,838 active accounts, 0.95 NRR, and 2.6% logo churn.",
    "Mid-Market MRR rises to 251.4k while NRR holds above 1.0.",
  ],
  widgets: [
    { type: "kpi", span: 3, title: "CURRENT MRR", fields: { metric: "mrr_usd", aggregate: "last" } },
    { type: "kpi", span: 3, title: "ACTIVE ACCOUNTS", fields: { metric: "active_accounts", aggregate: "last" } },
    { type: "kpi", span: 3, title: "NET REVENUE RETENTION", fields: { metric: "nrr", aggregate: "last" } },
    { type: "kpi", span: 3, title: "LOGO CHURN", fields: { metric: "logo_churn", aggregate: "last" } },
    { type: "line", span: 6, title: "MRR Trend", fields: { x: "week", y: "mrr_usd" } },
    { type: "line", span: 6, title: "NRR Trend", fields: { x: "week", y: "nrr" } },
    { type: "bar", span: 6, title: "MRR by Segment", fields: { x: "segment", y: "mrr_usd" } },
  ],
};

const NESTED_COMMITS = [
  { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", html_url: "https://github.com/sean1588/ai-visualizer/commit/aaaaaaaa", author: { login: "octocat", id: 1 }, commit: { message: "fix parser" } },
  { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", html_url: "https://github.com/sean1588/ai-visualizer/commit/bbbbbbbb", author: { login: "hubot", id: 2 }, commit: { message: "add chef" } },
];

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

test("landing copy accurately describes local profiling", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();

    assert.match(text, /profiles your data locally/i);
    assert.match(text, /raw rows are not sent/i);
    assert.match(text, /aggregate facts sent once for inference/i);
    assert.doesNotMatch(text, /Nothing is uploaded/i);
    assert.doesNotMatch(text, /Claude/i);
    const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
    assert.equal(favicon, "/favicon.svg");
    assert.equal((await page.request.get(`${BASE_URL}${favicon}`)).status(), 200);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("planner and Chef prompts use complete-data facts without raw rows", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const rows = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      revenue_usd: 100 + index,
      private_note: `secret-note-${index}`,
    }));
    const result = await page.evaluate(input => {
      const api = window.__mise;
      const schema = api.inferSchema(input);
      const recipe = {
        title: "Revenue",
        widgets: [{ type: "kpi", span: 3, title: "Revenue", label: "Revenue", metric: "revenue_usd", aggregate: "sum", value: "500" }],
      };
      return {
        plan: api.buildPrompt(input, schema, ""),
        chef: api.chefBuildPrompt("Make revenue currency", recipe, input, schema),
        profile: api.buildDataProfile(input, schema),
      };
    }, rows);

    assert.match(result.plan, /<DATA_PROFILE>/);
    assert.match(result.chef, /<DATA_PROFILE>/);
    assert.doesNotMatch(result.plan, /SAMPLE_ROWS|secret-note/);
    assert.doesNotMatch(result.chef, /SAMPLE_ROWS|secret-note/);
    assert.match(result.plan, /concise "rationale"/i);
    assert.match(result.chef, /Preserve each widget.s top-level "rationale"/i);
    const revenue = result.profile.facts.find(fact => fact.column === "revenue_usd");
    assert.equal(revenue.sum, 2190);
    assert.equal(revenue.trend.first, 100);
    assert.equal(revenue.trend.last, 119);
  });
});

test("sample dashboard renders and exports a PNG", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");
    await setTheme(page, "marketing");

    const downloadPromise = page.waitForEvent("download");
    await clickMenuItem(page, "#export-menu", "#export-btn");
    const download = await downloadPromise;

    assert.match(download.suggestedFilename(), /\.png$/);
    assert.equal(await page.evaluate(() => window.__html2canvasOptions.backgroundColor), "#fafaf7");
    const text = await page.locator("body").innerText();
    assert.match(text, /102\.4k/);
    assert.match(text, /MRR Trend/);
    assert.doesNotMatch(text, /undefined/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("action hierarchy keeps the landing header quiet and the palette reaches every action", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    assert.equal(await page.locator(".top-right").count(), 0, "landing header has no action cluster");
    assert.equal(await page.locator("header.top button").count(), 1, "only the wordmark is interactive on landing");
    assert.equal(await page.locator("#status-pill").count(), 0);
    assert.equal(await page.locator("#command-palette[open]").count(), 0);
    await page.keyboard.press("Control+k");
    assert.equal(await page.locator("#command-palette[open]").count(), 0, "palette is dashboard-only");

    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const header = await page.locator(".top-right").innerText();
    assert.match(header, /Saved in this browser/i);
    assert.match(header, /Data/i);
    assert.match(header, /Export/i);
    assert.match(header, /Present/i);
    assert.match(header, /(⌘|Ctrl\+)K/);
    assert.equal(await page.locator(".top-right .btn:visible").count(), 3, "pill · Data ▾ · Export ▾ · Present");
    assert.equal(await page.locator("#recipe-undo").count(), 0);
    assert.equal(await page.locator(".dash-head .btn").count(), 1, "the head keeps a single Analyze button");
    assert.equal(await page.locator("#open-workbench").textContent(), "Analyze");
    assert.equal(await page.locator("#mobile-analyze").count(), 0, "the mobile action bar does not render on desktop");
    assert.equal(await page.locator(".dash-head select").count(), 0);

    await page.locator("#data-menu").click();
    assert.ok(await page.locator("#replace-data-btn").isVisible());
    assert.ok(await page.locator("#action-data-health").isVisible());
    assert.equal(await page.locator("#refresh-btn").count(), 0, "Refresh data is absent, not disabled, for local data");
    assert.equal(await page.locator("#open-alerts").count(), 0, "Alerts is absent, not disabled, for local data");
    assert.equal(await page.locator(".top-right details.menu[open] .menu-list button:disabled").count(), 0);
    await page.locator("#export-menu").click();
    assert.equal(await page.locator("details.menu[open]").count(), 1, "only one menu is open at a time");
    assert.ok(await page.locator("#export-btn").isVisible());
    assert.ok(await page.locator("#action-backup").isVisible());
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("details.menu[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "export-menu");

    await page.keyboard.press("Control+k");
    await page.waitForSelector("#command-palette[open]");
    assert.equal(await page.locator("#command-palette").getAttribute("aria-labelledby"), "command-palette-title");
    await page.waitForFunction(() => document.activeElement?.id === "command-input");
    const paletteText = await page.locator("#command-list").innerText();
    assert.match(paletteText, /Executive brief/);
    assert.match(paletteText, /Notes & backup/);
    assert.match(paletteText, /Talk to the Chef/);
    assert.doesNotMatch(paletteText, /Refresh data|Undo/);
    await page.locator("#command-input").fill("png");
    assert.equal(await page.locator(".command-item").count(), 1);
    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.png$/);
    await page.waitForFunction(() => !document.querySelector("#command-palette")?.hasAttribute("open"));

    await page.keyboard.press("/");
    await page.waitForSelector("#chef-panel.is-open");
    await page.waitForFunction(() => document.activeElement?.id === "chef-input");
    await page.keyboard.type("/ is not typed into the chef");
    assert.equal(await page.locator("#chef-input").inputValue(), "/ is not typed into the chef");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#chef-panel")?.classList.contains("is-open"));
  });
});

test("completed-plate gallery teaches prompts and direct edits share undo history", async () => {
  await withPage(async page => {
    const requests = [];
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, PLAN, request => requests.push(request.postDataJSON()));
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    assert.equal(await page.locator(".example-card").count(), 5);
    await page.locator(".example-card").first().locator(".example-teaching button").click();
    assert.match(await page.locator("#notes").inputValue(), /Treat MRR as the primary metric/i);
    await page.locator('[data-example="saas"]').click();
    await page.waitForSelector("#chef-fab.is-visible");
    assert.equal(requests.length, 0);
    assert.equal(await page.locator("#recipe-undo").count(), 0, "undo is hidden until there is history");
    assert.equal(await page.locator(".recipe-history").count(), 0);

    await openWidgetMenu(page, ".w-kpi");
    await page.locator(".w-kpi .widget-rationale summary").first().click();
    assert.match(await page.locator(".w-kpi .widget-rationale p").first().innerText(), /recurring revenue is the primary operating metric/i);

    await openWidgetMenu(page, ".w-kpi");
    await clickWidgetMenuItem(page, "Move later");
    assert.equal(await page.locator(".w-kpi .label").first().innerText(), "NEW CUSTOMERS");
    assert.match(await page.locator(".recipe-history").innerText(), /2 revisions/i);
    assert.equal(await page.locator("#recipe-redo").isEnabled(), false);

    await page.locator("#recipe-undo").click();
    assert.equal(await page.locator(".w-kpi .label").first().innerText(), "CURRENT MRR");
    assert.equal(await page.locator("#recipe-undo").isEnabled(), false);
    await page.locator("#recipe-redo").click();
    assert.equal(await page.locator(".w-kpi .label").first().innerText(), "NEW CUSTOMERS");

    await page.keyboard.press("Control+z");
    assert.equal(await page.locator(".w-kpi .label").first().innerText(), "CURRENT MRR");
    await page.keyboard.press("Shift+Control+z");
    assert.equal(await page.locator(".w-kpi .label").first().innerText(), "NEW CUSTOMERS");

    await openWidgetMenu(page, ".w-kpi");
    await clickWidgetMenuItem(page, /Resize · 3\/12/);
    assert.equal(await page.locator(".w-kpi").first().evaluate(element => element.style.gridColumn), "span 4");

    const widgetCount = await page.locator("#dash-grid > [data-fp]").count();
    await openWidgetMenu(page, ".w-kpi");
    await clickWidgetMenuItem(page, "Duplicate");
    assert.equal(await page.locator("#dash-grid > [data-fp]").count(), widgetCount + 1);
    await openWidgetMenu(page, ".w-kpi");
    await clickWidgetMenuItem(page, "Remove");
    assert.equal(await page.locator("#dash-grid > [data-fp]").count(), widgetCount);

    await openWidgetMenu(page, ".w-kpi");
    await clickWidgetMenuItem(page, "Ask the Chef");
    assert.match(await page.locator("#chef-target").innerText(), /Editing/i);
    await page.locator("#chef-input").fill("Make this widget full width");
    await page.locator("#chef-send").click();
    await page.waitForFunction(() => document.querySelector("#chef-msgs")?.innerText.includes("Trimmed"));
    assert.equal(requests.length, 1);
    assert.match(requests[0].prompt, /<TARGET_WIDGET>[\s\S]*"index": 1/);
    assert.match(requests[0].prompt, /Make this widget full width/);
  });
});

test("Chef edit removes observations without dropping valid dashboard widgets", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.locator("#chef-fab").click();
    await page.locator("#chef-empty .chef-suggestion[data-prompt='Hide the observations']").click();
    await page.waitForFunction(() => !document.body.innerText.includes("What stood out"));

    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, /What stood out/);
    assert.match(text, /102\.4k/);
    assert.match(text, /MRR Trend/);
    assert.match(text, /Customer Acquisition/);
    assert.doesNotMatch(text, /undefined/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("Chef refuses suspicious partial recipes instead of applying table-only collapse", async () => {
  await withPage(async page => {
    await mockInference(page, BROKEN_PARTIAL_CHEF);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.locator("#chef-fab").click();
    await page.locator("#chef-empty .chef-suggestion[data-prompt='Hide the observations']").click();
    await page.waitForFunction(() => document.body.innerText.includes("The chef returned an incomplete recipe"));

    const text = await page.locator("body").innerText();
    assert.match(text, /The chef returned an incomplete recipe/);
    assert.match(text, /What stood out/);
    assert.match(text, /MRR Trend/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("Chef history resets when starting a different dashboard", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.locator("#chef-fab").click();
    await page.locator("#chef-input").fill("Please remove the notes from this dashboard");
    await page.locator("#chef-send").click();
    await page.waitForFunction(() => document.body.innerText.includes("Trimmed the tasting notes"));

    await page.evaluate(() => window.reset());
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    await page.locator("#chef-fab").click();

    const panelText = await page.locator("#chef-panel").innerText();
    assert.match(panelText, /TELL THE CHEF WHAT TO CHANGE/);
    assert.doesNotMatch(panelText, /Please remove the notes/);
    assert.doesNotMatch(panelText, /Trimmed the tasting notes/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("Chef history resets when restoring another saved dashboard", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.locator("#chef-fab").click();
    await page.locator("#chef-input").fill("Please remove the notes from this dashboard");
    await page.locator("#chef-send").click();
    await page.waitForFunction(() => document.body.innerText.includes("Trimmed the tasting notes"));

    await page.evaluate(() => window.reset());
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.evaluate(() => window.reset());
    await page.locator(".recent-card").first().click();
    await page.waitForSelector("#chef-fab.is-visible");
    await page.locator("#chef-fab").click();

    const panelText = await page.locator("#chef-panel").innerText();
    assert.match(panelText, /TELL THE CHEF WHAT TO CHANGE/);
    assert.doesNotMatch(panelText, /Please remove the notes/);
    assert.doesNotMatch(panelText, /Trimmed the tasting notes/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("mobile dashboard fold uses a bottom action bar without horizontal overflow", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    assert.ok(await page.locator("#drop").isVisible());
    assert.ok(await page.locator("#crumb").isVisible());
    assert.ok(await page.locator(".example-gallery").isVisible());
    assert.equal(await page.locator("header.top #data-menu").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#mobile-analyze");

    const metrics = await page.evaluate(() => {
      const title = document.querySelector("#dash-title");
      const kpi = document.querySelector(".w-kpi .value");
      const bar = document.querySelector("#mobile-action-bar");
      const header = document.querySelector("header.top");
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        titleBottom: title?.getBoundingClientRect().bottom ?? null,
        kpiBottom: kpi?.getBoundingClientRect().bottom ?? null,
        headerHeight: header?.getBoundingClientRect().height ?? null,
        barTargets: [...(bar?.querySelectorAll(":scope > button, :scope > .menu > summary") || [])].map(el => {
          const rect = el.getBoundingClientRect();
          return { id: el.id, height: rect.height, width: rect.width };
        }),
      };
    });

    assert.equal(metrics.scrollWidth <= metrics.width, true);
    assert.ok(metrics.headerHeight <= 48);
    assert.ok(metrics.titleBottom > 0 && metrics.titleBottom <= metrics.height);
    assert.ok(metrics.kpiBottom > 0 && metrics.kpiBottom <= metrics.height);
    assert.equal(await page.locator("header.top #data-menu").count(), 0);
    assert.equal(await page.locator("header.top #export-menu").count(), 0);
    assert.equal(await page.locator("#chef-fab").isVisible(), false);
    assert.equal(metrics.barTargets.length, 4);
    for (const target of metrics.barTargets) {
      assert.ok(target.height >= 44, `${target.id} height ${target.height}`);
      assert.ok(target.width >= 44, `${target.id} width ${target.width}`);
    }

    await page.locator("#mobile-analyze").click();
    await page.waitForSelector("#analysis-workbench[open]");
    assert.equal(await page.locator("#mobile-action-bar").isVisible(), false);
    await page.locator("#analysis-workbench .dialog-close").click();
    await page.waitForFunction(() => !document.querySelector("#analysis-workbench")?.hasAttribute("open"));
    await page.waitForSelector("#mobile-analyze");

    await openMobileSheet(page, "#mobile-export");
    const exportSheet = await page.locator("details.menu-sheet[open] .menu-list").innerText();
    assert.match(exportSheet, /Export PNG/);
    assert.match(exportSheet, /Interactive HTML/);
    assert.match(exportSheet, /Recipe JSON/);
    assert.match(exportSheet, /Copy recipe link/);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("details.menu-sheet[open]"));

    await openMobileSheet(page, "#mobile-more");
    const moreSheet = await page.locator("details.menu-sheet[open] .menu-list").innerText();
    assert.match(moreSheet, /Replace data/);
    assert.match(moreSheet, /Present/);
    await page.getByRole("menuitem", { name: /Present/ }).click();
    await page.waitForFunction(() => document.body.classList.contains("presentation-mode"));
    assert.equal(await page.locator("#mobile-action-bar").isVisible(), false);
    assert.equal(await page.locator("#chef-fab").isVisible(), false);
    await page.locator("#exit-presentation").click();
    await page.waitForFunction(() => !document.body.classList.contains("presentation-mode"));
    await page.waitForSelector("#mobile-analyze");

    await page.locator("#mobile-chef").click();
    await page.waitForSelector("#chef-panel.is-open");
    assert.equal(await page.locator("#mobile-action-bar").isVisible(), false);
    assert.equal(await page.locator("#chef-fab").isVisible(), false);
    await page.locator("#chef-close").click();
    await page.waitForFunction(() => !document.querySelector("#chef-panel")?.classList.contains("is-open"));
    await page.waitForSelector("#mobile-analyze");
  }, { context: { ...devices["iPhone 13"] } });
});

test("coarse-pointer controls meet the 44px touch target baseline", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    assert.ok(await page.locator("#browse-btn").evaluate(element => element.getBoundingClientRect().height) >= 44);
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#mobile-analyze");
    assert.ok(await page.locator(".widget-menu-trigger").first().evaluate(element => element.getBoundingClientRect().height) >= 44);
    await page.locator("#mobile-more").click();
    assert.ok(await page.locator("#replace-data-btn").evaluate(element => element.getBoundingClientRect().height) >= 44);
    await page.keyboard.press("Escape");
    await page.locator("#mobile-analyze").click();
    assert.ok(await page.locator(".workbench-tabs button").first().evaluate(element => element.getBoundingClientRect().height) >= 44);
    assert.ok(await page.locator("#focus-filter-form select").first().evaluate(element => element.getBoundingClientRect().height) >= 44);
    await page.getByRole("button", { name: "Goals" }).click();
    await page.locator("#kpi-goal-form input[name=target]").fill("100");
    await page.locator("#kpi-goal-form button[type=submit]").click();
    const goalRemove = page.locator("#kpi-goal-list article > button").first();
    assert.ok(await goalRemove.evaluate(element => element.getBoundingClientRect().width) >= 44);
  }, { context: { hasTouch: true, viewport: devices["iPhone 14 Pro"].viewport } });
});

test("Chef accepts recoverable rendered-widget replies instead of surfacing invalid recipe", async () => {
  await withPage(async page => {
    await mockInference(page, RENDERED_SHAPE_CHEF);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await page.locator("#chef-fab").click();
    await page.locator("#chef-input").fill("Make the layout a little cleaner");
    await page.locator("#chef-send").click();
    await page.waitForFunction(() => document.body.innerText.includes("Kept the same plate"));

    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, /No valid widgets|incomplete recipe|Couldn.t parse/i);
    assert.match(text, /102\.4k/);
    assert.match(text, /MRR Trend/);
    assert.match(text, /Customer Acquisition/);
  });
});

test("entity/location JSON falls back to count breakdown and table instead of blank dashboard", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, { title: "Airport Dataset", widgets: [] });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(AIRPORTS, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const text = await page.locator("body").innerText();
    assert.match(text, /Entity Overview/);
    assert.match(text, /Records by Country/);
    assert.match(text, /Rows/);
    assert.match(text, /12 rows/);
    assert.doesNotMatch(text, /^LAT$/im);
    assert.doesNotMatch(text, /^LON$/im);
    assert.doesNotMatch(text, /undefined/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("category bar charts aggregate repeated labels instead of rendering one bar per row", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const text = await page.locator("body").innerText();
    assert.match(text, /120k/);
    assert.match(text, /24k/);
    assert.match(text, /Revenue by Segment/);
    assert.match(text, /bar · 3 groups/i);
    assert.doesNotMatch(text, /bar · 5\b/i);
    assert.doesNotMatch(text, /undefined/);
  });
});

test("widget assumptions are visible and editable without another AI call", async () => {
  await withPage(async page => {
    let cookCalls = 0;
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN, () => { cookCalls++; });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const firstKpi = page.locator(".w-kpi").first();
    await openWidgetMenu(page, ".w-kpi");
    await firstKpi.locator("[data-edit-assumptions]").click();
    await page.locator('#assumptions-form [name="aggregate"]').selectOption("average");
    await page.locator('#assumptions-form [name="format"]').selectOption("currency");
    await page.getByRole("button", { name: "Apply assumptions" }).click();

    const edited = await page.evaluate(() => {
      const widget = window.__mise.state.recipe.widgets.find(item => item.type === "kpi");
      return { aggregate: widget.aggregate, format: widget.format };
    });
    assert.deepEqual(edited, { aggregate: "average", format: "currency" });
    assert.match(await firstKpi.innerText(), /\$24k/);
    assert.equal(cookCalls, 1);
  });
});

test("chart points and legends open the contributing-row inspector", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const point = page.locator(".w-chart circle.chart-hit").first();
    assert.match(await point.locator("title").textContent(), /Jan.*\$42,000/i);
    await point.click();
    assert.match(await page.locator("#inspector-title").textContent(), /Jan/);
    assert.match(await page.locator("#inspector-meta").textContent(), /1 matching row/);
    assert.match(await page.locator("#inspector-table").innerText(), /\$42,000/);
    await page.locator("#inspector-close").click();

    await page.evaluate(() => window.reset());
    await page.unroute("**/api/cook");
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, {
      title: "Segment Mix",
      widgets: [
        { type: "donut", span: 6, title: "Revenue by Segment", fields: { cat: "segment", metric: "revenue" } },
      ],
    });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector(".legend-button");
    await page.locator(".legend-button").filter({ hasText: "startup" }).click();
    assert.match(await page.locator("#inspector-title").textContent(), /startup/i);
    assert.match(await page.locator("#inspector-meta").textContent(), /2 matching rows/);
  });
});

test("clicking a chart value focuses the dashboard and Chef suggestions stay schema-aware", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const unfocusedKpi = await page.locator(".w-kpi .value").first().innerText();
    await page.locator('.w-chart rect.chart-hit[data-inspect-value="startup"]').click();
    await page.waitForSelector("#inspector-dialog[open]");
    assert.match(await page.locator("#focus-on-value").innerText(), /Focus dashboard on Segment = startup/i);
    await page.locator("#focus-on-value").click();
    await page.waitForFunction(() => document.querySelector("#focus-summary")?.textContent?.includes("2 of 5 rows"));
    assert.match(await page.locator("#focus-summary").innerText(), /Focused · 2 of 5 rows/i);
    assert.equal(await page.locator(".focus-chip").count(), 1);
    assert.match(await page.locator(".focus-chip-body").innerText(), /Segment is startup/i);
    const focusedKpi = await page.locator(".w-kpi .value").first().innerText();
    assert.notEqual(focusedKpi, unfocusedKpi);
    assert.match(focusedKpi, /\$20k/i);
    assert.deepEqual(await page.evaluate(() => window.__mise.state.filters.map(filter => filter.value)), ["startup"]);

    await page.locator(".w-chart rect.chart-hit").first().click();
    await page.waitForSelector("#inspector-dialog[open]");
    await page.locator("#focus-on-value").click();
    assert.equal(await page.locator(".focus-chip").count(), 1);
    assert.deepEqual(await page.evaluate(() => window.__mise.state.filters.map(filter => filter.value)), ["startup"]);

    await page.locator(".focus-chip-remove").click();
    await page.waitForFunction(() => document.querySelectorAll(".w-chart rect.chart-hit").length >= 3);
    await page.locator('.w-chart rect.chart-hit[data-inspect-value="enterprise"]').click();
    await page.waitForSelector("#inspector-dialog[open]");
    assert.match(await page.locator("#focus-on-value").innerText(), /enterprise/i);
    await page.locator("#focus-on-value").click();
    await page.waitForFunction(() => document.querySelector("#focus-summary")?.textContent?.includes("enterprise"));
    assert.equal(await page.locator(".focus-chip").count(), 1);
    assert.match(await page.locator("#focus-summary").innerText(), /Focused · 1 of 5 rows/i);
    assert.match(await page.locator(".w-kpi .value").first().innerText(), /\$60k/i);
    assert.deepEqual(await page.evaluate(() => window.__mise.state.filters.map(filter => filter.value)), ["enterprise"]);

    await page.locator("#presentation-mode").click();
    await page.waitForFunction(() => document.body.classList.contains("presentation-mode"));
    assert.match(await page.locator("#focus-summary").innerText(), /Segment is enterprise/i);
    assert.equal(await page.locator("#focus-clear").isVisible(), false);
    assert.equal(await page.locator(".focus-chip-remove").isVisible(), false);
    assert.equal(await page.locator(".focus-chip-body").isVisible(), true);
    await page.locator("#exit-presentation").click();
    await page.waitForFunction(() => !document.body.classList.contains("presentation-mode"));

    await page.locator(".focus-chip-body").click();
    await page.waitForSelector("#analysis-workbench[open]");
    assert.match(await page.locator("#analysis-workbench button.active").innerText(), /Focus/i);
    await closeWorkbench(page);

    await page.locator(".focus-chip-remove").click();
    await page.waitForFunction(() => !document.querySelector("#focus-summary"));

    await page.locator('.w-chart rect.chart-hit[data-inspect-value="startup"]').click();
    await page.locator("#focus-on-value").click();
    await page.waitForSelector("#focus-summary");
    await page.locator("#focus-clear").click();
    await page.waitForFunction(() => !document.querySelector("#focus-summary"));
  });
});

test("Chef empty-state suggestions use the current recipe and offer Try next after a reply", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");
    await page.locator("#chef-fab").click();
    await page.waitForSelector("#chef-panel.is-open");
    const suggestionLabels = await page.locator("#chef-empty .chef-suggestion").allTextContents();
    assert.ok(suggestionLabels.length >= 1 && suggestionLabels.length <= 5);
    assert.ok(suggestionLabels.some(label => /Current MRR|Monthly metrics|Hide the observations/i.test(label)));
    assert.ok(suggestionLabels.every(label => !/Swap the donut/i.test(label)));
    assert.doesNotMatch(await page.locator(".chef-empty-title").innerText(), /donut/i);
    const firstPrompt = await page.locator("#chef-empty .chef-suggestion").first().getAttribute("data-prompt");
    await page.locator("#chef-empty .chef-suggestion").first().click();
    await page.waitForFunction(() => document.querySelector("#chef-msgs")?.innerText.includes("Trimmed"));
    await page.locator("#chef-try-next").waitFor();
    assert.match(await page.locator("#chef-try-next").innerText(), /Try next/i);
    assert.ok(await page.locator("#chef-try-next .chef-suggestion").count() >= 1);
    assert.ok(await page.locator("#chef-try-next .chef-suggestion").count() <= 3);
    assert.equal(firstPrompt, await page.evaluate(() => window.__mise.state.chefHistory[0].content));
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("charts expose summaries, data tables, keyboard inspection, and live status", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    assert.equal(await page.locator("#status-pill").getAttribute("role"), "status");
    assert.equal(await page.locator("#status-pill").getAttribute("aria-live"), "polite");
    assert.match(await page.locator("button.mark").getAttribute("aria-label"), /new Mise dashboard/i);
    assert.match(await page.locator(".w-chart svg").first().getAttribute("aria-label"), /MRR Trend.*12 points/i);

    await page.locator(".w-chart .chart-data-table summary").first().click();
    assert.match(await page.locator(".w-chart .chart-data-table table").first().getAttribute("aria-label"), /MRR Trend chart data/i);
    assert.ok(await page.locator(".w-chart .chart-data-table tbody tr").first().count());

    await page.locator(".w-chart .chart-keyboard-point").first().press("Enter");
    await page.waitForSelector("#inspector-dialog[open]");
    await page.waitForFunction(() => document.activeElement?.id === "inspector-search");
  });
});

test("product events contain only allowlisted metadata", async () => {
  await withPage(async page => {
    const events = [];
    await mockInference(page);
    await page.unroute("**/api/events");
    await page.route("**/api/events", async route => {
      events.push(route.request().postDataJSON());
      await route.fulfill({ status: 204, body: "" });
    });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");
    await page.locator(".w-chart .chart-hit").first().click();
    await page.locator("#inspector-close").click();
    const downloadPromise = page.waitForEvent("download");
    await clickMenuItem(page, "#export-menu", "#export-recipe-btn");
    await downloadPromise;
    await page.waitForFunction(() => window.__mise.state.stage === "dash");
    await page.waitForTimeout(100);

    const names = events.map(item => item.event);
    assert.ok(names.includes("ingest_started"));
    assert.ok(names.includes("dashboard_rendered"));
    assert.ok(names.includes("chart_inspected"));
    assert.ok(names.includes("export_created"));
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /mrr|month|https?:|SaaS Growth/i);
    assert.ok(events.every(item => item.version === 1));
  });
});

test("data health explains irregular rows and records explicit schema overrides", async () => {
  await withPage(async page => {
    let cookCalls = 0;
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, {
      title: "Health Review",
      widgets: [
        { type: "kpi", span: 3, title: "Revenue", fields: { metric: "revenue", aggregate: "sum" } },
        { type: "table", span: 12, title: "Rows", fields: { limit: 10 } },
      ],
    }, () => { cookCalls++; });
    const csv = [
      "date,segment,revenue",
      "2026-01-01,A,10",
      "2026-01-01,B,20",
      "unknown,C,",
      "2026-02-01,D,1000,unexpected",
    ].join("\n");

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(csv);
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    await page.locator("#data-health-btn").click();

    let text = await page.locator("#data-health-dialog").innerText();
    assert.match(text, /Irregular CSV rows kept/i);
    assert.match(text, /Missing values/i);
    assert.match(text, /Mixed date values in date/i);
    assert.match(text, /extra fields were preserved/i);
    await page.getByRole("button", { name: /Treat date as a date/i }).click();
    await page.waitForFunction(() => document.getElementById("data-health-dialog")?.innerText.includes("Repeated date values"));

    text = await page.locator("#data-health-dialog").innerText();
    assert.match(text, /Repeated date values/i);
    assert.match(text, /schema override/i);
    assert.match(text, /Treat date as a date column/i);
    assert.equal(cookCalls, 1);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mise.recents.v1"))[0]);
    assert.equal(stored.schemaOverrides.date, "date");
    assert.equal(stored.dataAudit.at(-1).action, "schema-override");
  });
});

test("recipe links reapply without AI and standalone HTML keeps chart inspection local", async () => {
  await withPage(async page => {
    let cookCalls = 0;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN, () => { cookCalls++; });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    await clickMenuItem(page, "#export-menu", "#share-recipe-link");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(link, /#recipe=/);
    assert.doesNotMatch(link, /example\.test|SEGMENT_REVENUE/);

    await page.goto(link, { waitUntil: "networkidle" });
    assert.match(await page.locator("body").innerText(), /Shared recipe ready: Segment Revenue/i);
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    assert.equal(cookCalls, 1);

    const downloadPromise = page.waitForEvent("download");
    await clickMenuItem(page, "#export-menu", "#export-html-btn");
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.html$/);
    const path = await download.path();
    assert.ok(path);
    const html = readFileSync(path, "utf8");
    assert.match(html, /Interactive snapshot exported from Mise/);
    assert.match(html, /standalone-inspector/);

    await page.setContent(html, { waitUntil: "load" });
    await page.locator(".chart-hit").first().click();
    assert.equal(await page.locator("#standalone-inspector").getAttribute("hidden"), null);
    assert.match(await page.locator("#standalone-meta").innerText(), /matching row/i);
    await page.evaluate(() => { location.hash = "embed"; });
    await page.waitForFunction(() => document.body.classList.contains("mise-embed"));
    assert.equal(await page.locator(".standalone-note").isVisible(), false);
  });
});

test("workbench Brief and Recipe tabs and the Notes theme picker remain traceable and local", async () => {
  await withPage(async page => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");
    assert.equal(await page.locator("#open-brief, #open-recipe-inspector, .dash-head #theme-picker").count(), 0);

    await setTheme(page, "marketing");
    assert.equal(await page.locator("body").getAttribute("data-theme"), "marketing");

    const workbench = await openWorkbenchTab(page, "Recipe");
    assert.equal(await workbench.locator(".workbench-tabs button").count(), 6);
    await page.waitForSelector("#recipe-inspector");
    let text = await page.locator("#recipe-inspector").innerText();
    assert.match(text, /Browser-local data/i);
    assert.match(text, /Last-point outlier exclusion enabled/i);
    assert.match(text, /Current MRR/i);
    assert.match(text, /primary operating metric/i);
    assert.equal(await page.locator("#executive-brief").count(), 0);

    await openWorkbenchTab(page, "Brief");
    await page.waitForSelector("#executive-brief");
    text = await page.locator("#executive-brief").innerText();
    assert.match(text, /Current MRR is \$102\.4k/i);
    assert.match(text, /supporting rows/i);
    await page.locator("#copy-brief").click();
    const markdown = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(markdown, /# SaaS Growth Review — executive brief/);
    assert.match(markdown, /#mise-widget-/);
    await page.getByRole("button", { name: /View 12 supporting rows/i }).first().click();
    await page.waitForFunction(() => !document.querySelector("#analysis-workbench")?.hasAttribute("open"));
    assert.match(await page.locator("#inspector-title").innerText(), /Current MRR/i);
    await page.locator("#inspector-close").click();

    await page.keyboard.press("Control+k");
    await page.waitForSelector("#command-palette[open]");
    await page.locator("#command-input").fill("executive");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#analysis-workbench[open]");
    await page.waitForSelector("#executive-brief");
    await closeWorkbench(page);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("SaaS Growth Review").first().click();
    await openWorkbenchTab(page, "Notes & backup");
    assert.equal(await page.locator("#theme-picker").inputValue(), "marketing");
  });
});

test("analysis workbench keeps ten browser-local enhancements cohesive and persistent", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, WORKBENCH_PLAN);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(WORKBENCH_ROWS));
    await page.locator("#notes").fill("Initial workbench context.");
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Segment Workbench").first().click();
    assert.match(await page.locator("#dashboard-context").innerText(), /Initial workbench context/i);

    await page.locator("#open-workbench").click();
    await page.waitForSelector("#analysis-workbench[open]");
    const workbench = page.locator("#analysis-workbench");
    assert.match(await workbench.innerText(), /Explore without changing the recipe/i);
    assert.equal(await workbench.getAttribute("aria-labelledby"), "workbench-title");
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Focus");

    await workbench.locator("#focus-filter-form select[name=column]").selectOption("segment");
    await workbench.locator("#focus-filter-form select[name=operator]").selectOption("equals");
    await workbench.locator("#focus-filter-form input[name=value]").fill("Pro");
    await workbench.locator("#focus-filter-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#focus-summary")?.textContent?.includes("5 of 7 rows"));
    assert.match(await page.locator("#focus-summary").innerText(), /Focused/i);
    assert.match(await page.locator("#focus-summary").innerText(), /Segment is Pro/i);

    await workbench.locator("#save-view-form input[name=name]").fill("Pro accounts");
    await workbench.locator("#save-view-form button[type=submit]").click();
    assert.match(await workbench.locator("#saved-view-list").innerText(), /Pro accounts/i);
    await workbench.locator("#focus-filter-form select[name=column]").selectOption("segment");
    await workbench.locator("#focus-filter-form select[name=operator]").selectOption("equals");
    await workbench.locator("#focus-filter-form input[name=value]").fill("Missing");
    await workbench.locator("#focus-filter-form button[type=submit]").click();
    await page.locator("#focus-empty").waitFor();
    assert.match(await page.locator("#focus-empty").innerText(), /No rows match/i);
    await workbench.locator("#saved-view-list article > button").first().click();
    await page.waitForFunction(() => !document.querySelector("#focus-empty"));

    await workbench.getByRole("button", { name: "Goals" }).click();
    await workbench.locator("#kpi-goal-form input[name=target]").fill("45");
    await workbench.locator("#kpi-goal-form button[type=submit]").click();
    assert.match(await workbench.locator("#kpi-goal-list").innerText(), /Met/i);
    assert.equal(await page.locator(".w-kpi .kpi-goal.met").count(), 1);

    await workbench.getByRole("button", { name: "Discover" }).click();
    assert.match(await workbench.locator("#column-profile-list").innerText(), /Revenue/i);
    assert.match(await workbench.locator("#correlation-list").innerText(), /Revenue ↔ Orders/i);
    assert.match(await workbench.locator("#privacy-finding-list").innerText(), /Customer email/i);
    assert.ok(await workbench.locator("#follow-up-list button").count() >= 3);
    await workbench.locator("#follow-up-list button").filter({ hasText: /changing/i }).click();
    await page.waitForSelector("#chef-panel.is-open");
    assert.match(await page.locator("#chef-input").inputValue(), /Emphasize the trend/i);
    await page.locator("#chef-close").click();

    await page.locator("#open-workbench").click();
    await workbench.getByRole("button", { name: "Notes & backup" }).click();
    await workbench.locator("#dashboard-notes").fill("Review Pro growth with finance.");
    await workbench.getByRole("button", { name: "Save context" }).click();
    assert.match(await page.locator("#dashboard-context").innerText(), /Review Pro growth with finance/i);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Save context");

    const downloadPromise = page.waitForEvent("download");
    await workbench.locator("#export-dashboard-bundle").click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.mise\.json$/);
    const downloadPath = await download.path();
    const backup = JSON.parse(readFileSync(downloadPath, "utf8"));
    assert.equal(backup.kind, "mise-dashboard-bundle");
    assert.equal(backup.dashboard.savedViews[0].name, "Pro accounts");
    assert.equal(backup.dashboard.dashboardNotes, "Review Pro growth with finance.");

    await workbench.locator("#dashboard-bundle-input").setInputFiles({
      name: "broken.mise.json",
      mimeType: "application/json",
      buffer: Buffer.from("{not json"),
    });
    await workbench.locator("#backup-import-error").waitFor();
    assert.match(await workbench.locator("#backup-import-error").innerText(), /not valid JSON/i);
    assert.ok(await page.locator("#root").count());

    let importedRefreshes = 0;
    page.on("request", request => {
      if (request.url().includes("/api/fetch-data")) importedRefreshes++;
    });
    backup.dashboard.filters = "not-an-array";
    backup.dashboard.dataSource = {
      type: "http",
      url: "https://example.com/data.json",
      refreshMinutes: 5,
    };
    await workbench.locator("#dashboard-bundle-input").setInputFiles({
      name: "corrupted.mise.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.waitForFunction(() => document.querySelector("#backup-import-error")?.textContent?.includes("invalid focus filters"));
    assert.ok(await page.locator("#analysis-workbench[open]").count());
    backup.dashboard.filters = [];
    await workbench.locator("#dashboard-bundle-input").setInputFiles({
      name: "portable.mise.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await workbench.locator("#backup-preview").waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "confirm-dashboard-restore");
    assert.equal(await workbench.locator("#backup-preview").getAttribute("role"), "status");
    await workbench.getByRole("button", { name: "Restore this backup" }).click();
    await page.waitForFunction(() => !document.querySelector("#analysis-workbench")?.hasAttribute("open"));
    assert.match(await page.locator("#dash-title").innerText(), /Segment Workbench/i);
    assert.deepEqual(await page.evaluate(() => ({
      filters: window.__mise.state.filters,
      refreshMinutes: window.__mise.state.dataSource.refreshMinutes,
    })), { filters: [], refreshMinutes: 0 });
    assert.equal(importedRefreshes, 0);

    await page.locator("#presentation-mode").click();
    assert.equal(await page.locator(".top").evaluate(element => getComputedStyle(element).display), "none");
    assert.ok(await page.locator("#exit-presentation").isVisible());
    await page.waitForFunction(() => document.activeElement?.id === "exit-presentation");
    assert.equal(await page.locator(".w-actions").first().isVisible(), false);
    assert.equal(await page.locator("#data-health-btn").isVisible(), false);
    assert.equal(await page.locator("#data-menu").isVisible(), false);
    assert.equal(await page.locator("#export-menu").isVisible(), false);
    assert.equal(await page.locator("#open-workbench").isVisible(), false);
    assert.equal(await page.locator("#status-pill").isVisible(), false);
    await page.locator("#exit-presentation").click();
    await page.waitForFunction(() => document.activeElement?.id === "presentation-mode");
    await page.keyboard.press("p");
    await page.waitForFunction(() => document.body.classList.contains("presentation-mode"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.body.classList.contains("presentation-mode"));

    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Segment Workbench").first().click();
    await page.locator("#open-workbench").click();
    await workbench.waitFor({ state: "visible" });
    assert.match(await workbench.locator("#saved-view-list").innerText(), /Pro accounts/i);
    assert.match(await page.locator("#dashboard-context").innerText(), /Review Pro growth with finance/i);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("public source conveniences and while-open thresholds evaluate after refresh", async () => {
  await withPage(async page => {
    let fetchCalls = 0;
    let requestedUrl = "";
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN);
    await page.route("**/api/fetch-data", async route => {
      fetchCalls++;
      requestedUrl = route.request().postDataJSON().url;
      const rows = fetchCalls === 1
        ? SEGMENT_REVENUE
        : [...SEGMENT_REVENUE, { segment: "enterprise", revenue: 30000, channel: "partner" }];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: JSON.stringify(rows),
          contentType: "application/json",
          finalUrl: requestedUrl,
        }),
      });
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#http-url").fill("https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=42");
    await page.locator("#fetch-url-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    assert.equal(requestedUrl, "https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=42");

    await clickMenuItem(page, "#data-menu", "#open-alerts");
    await page.locator('#alert-form select[name="widget"]').selectOption({ label: "Total Revenue" });
    await page.locator('#alert-form input[name="threshold"]').fill("125000");
    await page.locator('#alert-form button[type="submit"]').click();
    assert.match(await page.locator("#alert-list").innerText(), /Watching/i);
    await page.locator("#alerts-dialog .dialog-close").click();

    await clickMenuItem(page, "#data-menu", "#refresh-btn");
    await page.waitForFunction(() => document.getElementById("status-pill")?.innerText.includes("THRESHOLD ALERT"));
    await page.locator("#data-menu").click();
    assert.match(await page.locator("#open-alerts").innerText(), /Alerts · 1/i);
    await page.locator("#open-alerts").click();
    assert.match(await page.locator("#alert-list").innerText(), /Triggered/i);
    assert.match(await page.locator("#alert-list").innerText(), /\$150k/i);
  });
});

test("chartable table-only model output falls back to a useful dashboard", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, TABLE_ONLY_PLAN);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(BARLEY, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const text = await page.locator("body").innerText();
    assert.match(text, /Showing a default layout based on your schema/);
    assert.match(text, /bar|donut|line|count/i);
    assert.match(text, /Raw rows|Rows/i);
    assert.doesNotMatch(text, /undefined/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("partially invalid planner output visibly reports rejected widgets", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, {
      title: "Repaired revenue",
      widgets: [
        { type: "kpi", span: 3, title: "Revenue", fields: { metric: "revenue", aggregate: "sum" } },
        { type: "line", span: 6, title: "Invalid", fields: { x: "missing_date", y: "revenue" } },
        { type: "table", span: 12, title: "Rows", fields: { limit: 10 } },
      ],
    });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#rejected-widgets-banner");
    assert.match(await page.locator("#rejected-widgets-banner").innerText(), /1 invalid model widget was rejected/i);
    assert.match(await page.locator("body").innerText(), /\$120k/);
  });
});

test("HTTP source dashboards save a refreshable URL and refresh without re-planning", async () => {
  await withPage(async page => {
    let cookCalls = 0;
    let fetchCalls = 0;
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN, () => { cookCalls++; });
    await page.route("**/api/fetch-data", async route => {
      fetchCalls++;
      const rows = fetchCalls === 1
        ? SEGMENT_REVENUE
        : [...SEGMENT_REVENUE, { segment: "enterprise", revenue: 30000, channel: "partner" }];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: JSON.stringify(rows),
          contentType: "application/json",
          finalUrl: "https://example.test/revenue.json",
        }),
      });
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#http-url").fill("https://example.test/revenue.json");
    await page.locator("#fetch-url-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    let text = await page.locator("body").innerText();
    assert.match(await page.locator("#status-pill").innerText(), /Saved in this browser · just now/i);
    assert.match(text, /120k/);
    assert.equal(cookCalls, 1);

    await clickMenuItem(page, "#data-menu", "#refresh-btn");
    await page.waitForFunction(() => document.body.innerText.includes("150k"));

    text = await page.locator("body").innerText();
    assert.match(text, /150k/);
    assert.match(text, /bar · 3 groups/i);
    assert.match(text, /Since previous data/i);
    assert.match(text, /\+1 rows/i);
    assert.match(text, /Schema unchanged/i);
    assert.match(text, /Fetched just now/i);
    assert.equal(fetchCalls, 2);
    assert.equal(cookCalls, 1);

    await page.locator("#refresh-cadence").selectOption("5");
    await page.evaluate(() => {
      const recents = JSON.parse(localStorage.getItem("mise.recents.v1"));
      recents[0].dataSource.fetchedAt = "2020-01-01T00:00:00.000Z";
      recents[0].dataSource.lastAttemptAt = "2020-01-01T00:00:00.000Z";
      localStorage.setItem("mise.recents.v1", JSON.stringify(recents));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Segment Revenue").first().click();
    await page.waitForSelector("#chef-fab.is-visible");
    assert.equal(await page.locator("#refresh-btn").count(), 1);
    assert.equal(await page.locator("#refresh-btn").isEnabled(), true);
    assert.equal(await page.locator("#refresh-cadence").inputValue(), "5");
    assert.match(await page.locator("#dataset-comparison").innerText(), /Since previous data/i);
    await page.waitForFunction(() => document.getElementById("status-pill")?.innerText.includes("REFRESHED"));
    assert.equal(fetchCalls, 3);
    assert.equal(cookCalls, 1);
  });
});

test("local dashboards replace data against the same recipe and report schema drift", async () => {
  await withPage(async page => {
    let cookCalls = 0;
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN, () => { cookCalls++; });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const replacement = [
      { segment: "startup", revenue: 20000, gross_margin: 0.72 },
      { segment: "midmarket", revenue: 40000, gross_margin: 0.76 },
      { segment: "enterprise", revenue: 90000, gross_margin: 0.81 },
      { segment: "enterprise", revenue: 30000, gross_margin: 0.83 },
    ];
    await page.locator("#replacement-input").setInputFiles({
      name: "next-period.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(replacement)),
    });
    await page.waitForFunction(() => document.body.innerText.includes("180k"));

    const text = await page.locator("body").innerText();
    assert.match(text, /Segment Revenue/);
    assert.match(text, /Since previous data/i);
    assert.match(text, /-1 rows/i);
    assert.match(text, /2 schema changes/i);
    assert.match(text, /added gross_margin/i);
    assert.match(text, /removed channel/i);
    assert.match(text, /\+\$60k/);
    assert.match(text, /vs previous dataset/i);
    assert.equal(cookCalls, 1);
    await page.locator("#data-menu").click();
    assert.equal(await page.locator("#replace-data-btn").isVisible(), true);
    assert.equal(await page.locator("#refresh-btn").count(), 0, "local datasets do not show Refresh data");
    assert.equal(await page.locator("#open-alerts").count(), 0, "local datasets do not show Alerts");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#data-menu")?.closest("details")?.open);

    await page.locator("#open-workbench").click();
    const workbench = page.locator("#analysis-workbench");
    await workbench.locator("#focus-filter-form select[name=column]").selectOption("segment");
    await workbench.locator("#focus-filter-form select[name=operator]").selectOption("equals");
    await workbench.locator("#focus-filter-form input[name=value]").fill("enterprise");
    await workbench.locator("#focus-filter-form button[type=submit]").click();
    await workbench.locator(".dialog-close").click();
    assert.equal(await page.locator(".dataset-delta").count(), 0);
    assert.equal(await page.locator("#dataset-comparison").count(), 0);
    await openWorkbenchTab(page, "Brief");
    await page.waitForSelector("#executive-brief");
    assert.doesNotMatch(await page.locator("#executive-brief").innerText(), /from the previous dataset/i);
    await closeWorkbench(page);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Segment Revenue").first().click();
    assert.equal(await page.locator("#dataset-comparison").count(), 0);
    await page.locator("#focus-clear").click();
    assert.match(await page.locator("#dataset-comparison").innerText(), /added gross_margin/i);
  });
});

test("HTTP refresh failures remain visible without replacing good rows", async () => {
  await withPage(async page => {
    let fetchCalls = 0;
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN);
    await page.route("**/api/fetch-data", async route => {
      fetchCalls++;
      if (fetchCalls > 1) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "upstream_failed", detail: "source unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: JSON.stringify(SEGMENT_REVENUE),
          contentType: "application/json",
          finalUrl: "https://example.test/revenue.json",
        }),
      });
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#http-url").fill("https://example.test/revenue.json");
    await page.locator("#fetch-url-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    await clickMenuItem(page, "#data-menu", "#refresh-btn");
    await page.waitForSelector("#refresh-error");

    assert.match(await page.locator("#refresh-error").innerText(), /upstream_failed.*source unavailable/i);
    assert.match(await page.locator("body").innerText(), /120k/);
    await page.waitForTimeout(2300);
    assert.match(await page.locator("#status-pill").innerText(), /Refresh failed/i);
    assert.equal(await page.locator("#status-pill .pill-dot.active").count(), 0);
  }, { allowConsole: /\[refresh\] failed|Failed to load resource/ });
});

test("applying an HTTP recipe to pasted CSV does not advertise refresh", async () => {
  await withPage(async page => {
    let fetchCalls = 0;
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN);
    await page.route("**/api/fetch-data", async route => {
      fetchCalls++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: JSON.stringify(SEGMENT_REVENUE),
          contentType: "application/json",
          finalUrl: "https://example.test/revenue.json",
        }),
      });
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#file-input").setInputFiles({
      name: "segment.recipe.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        title: "Segment Revenue",
        widgets: AGGREGATE_PLAN.widgets,
        dataSource: { type: "http", url: "https://example.test/revenue.json" },
        generator: "Mise v0.6",
      })),
    });
    await page.waitForSelector("#chef-fab.is-visible");

    const chrome = await page.evaluate(() => ({
      pill: document.getElementById("status-pill").innerText,
      refreshPresent: !!document.getElementById("refresh-btn"),
      hasHttp: window.__mise.hasHttpSource(),
      liveType: window.__mise.state.dataSource?.type || null,
    }));

    assert.match(chrome.pill, /Saved in this browser/i);
    assert.equal(chrome.refreshPresent, false);
    assert.equal(chrome.hasHttp, false);
    assert.equal(chrome.liveType, null);

    await page.locator("#data-menu").click();
    assert.equal(await page.locator("#refresh-btn").count(), 0);
    await page.waitForTimeout(80);
    assert.equal(fetchCalls, 0);
  });
});

test("quoted-comma CSV keeps fields intact and aggregates by the real rep", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const result = await page.evaluate(text => {
      const incoming = window.__mise.incomingKind(text);
      const rows = incoming.rows;
      const byRep = {};
      for (const row of rows) {
        byRep[row.Rep] = (byRep[row.Rep] || 0) + row.Amount;
      }
      return {
        product: rows[0].Product,
        amount: rows[0].Amount,
        rep: rows[0].Rep,
        note: rows[0].Note,
        dropped: incoming.health.rowsDropped,
        parsed: incoming.health.rowsParsed,
        groups: Object.keys(byRep).sort(),
        ava: byRep.Ava,
      };
    }, MESSY_SALES_CSV);

    assert.equal(result.product, "Widget, C");
    assert.equal(result.amount, 400);
    assert.equal(result.rep, "Ava");
    assert.equal(result.note, "quoted comma");
    assert.equal(result.parsed, 3);
    assert.equal(result.dropped, 1);
    assert.deepEqual(result.groups, ["Ava", "Bea"]);
    assert.equal(result.ava, 480);
  });
});

test("header-only CSV, empty CSV, and a single JSON object are rejected", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const messages = await page.evaluate(() => {
      const tryParse = text => {
        try { window.__mise.incomingKind(text); return "ok"; }
        catch (e) { return e.message; }
      };
      return {
        empty: tryParse(""),
        headers: tryParse("Date,Amount\n"),
        object: tryParse(JSON.stringify({ hello: "world", nested: { a: 1 } })),
      };
    });
    assert.match(messages.empty, /Nothing to parse/i);
    assert.match(messages.headers, /header row and one data row/i);
    assert.match(messages.object, /single JSON object/i);
  });
});

test("top-N table is sorted by the named metric and shows a transform chip", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, TOP_N_PLAN);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(TOP_N_ROWS, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const info = await page.evaluate(() => {
      const table = window.__mise.state.recipe.widgets.find(w => w.type === "table");
      const shown = window.__mise.sortedTableRows(table).map(r => r.expansion_usd);
      return {
        sort: table.sort,
        order: table.order,
        limit: table.limit,
        shown,
        chip: window.__mise.tableTransformLabel(table),
      };
    });

    assert.equal(info.sort, "expansion_usd");
    assert.equal(info.order, "desc");
    assert.equal(info.limit, 10);
    assert.deepEqual(info.shown, [...info.shown].sort((a, b) => b - a));
    assert.equal(info.shown[0], 880);
    assert.equal(info.shown.length, 10);
    assert.match(info.chip, /sort: expansion_usd desc/i);
    assert.match(await page.locator("body").innerText(), /sort: expansion_usd desc/i);
  });
});

test("recipe download writes a file and re-imports against new data without re-planning", async () => {
  await withPage(async page => {
    let cookCalls = 0;
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, AGGREGATE_PLAN, () => { cookCalls++; });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(JSON.stringify(SEGMENT_REVENUE, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    assert.equal(cookCalls, 1);

    const downloadPromise = page.waitForEvent("download");
    await clickMenuItem(page, "#export-menu", "#export-recipe-btn");
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.recipe\.json$/);
    assert.match(download.suggestedFilename(), /\d{4}-/);
    const recipePath = await download.path();
    assert.ok(recipePath);

    await page.evaluate(() => window.reset());
    await page.locator("#paste").fill(JSON.stringify(
      [...SEGMENT_REVENUE, { segment: "enterprise", revenue: 30000, channel: "partner" }],
      null,
      2
    ));
    await page.locator("#file-input").setInputFiles(recipePath);
    await page.waitForSelector("#chef-fab.is-visible");

    const text = await page.locator("body").innerText();
    assert.match(text, /150k/);
    assert.equal(cookCalls, 1);
  });
});

test("PNG exports use unique timestamps and surface encode failures", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const firstPromise = page.waitForEvent("download");
    await clickMenuItem(page, "#export-menu", "#export-btn");
    const first = await firstPromise;

    const secondPromise = page.waitForEvent("download");
    await clickMenuItem(page, "#export-menu", "#export-btn");
    const second = await secondPromise;

    assert.match(first.suggestedFilename(), /\.png$/);
    assert.match(first.suggestedFilename(), /\d{4}-/);
    assert.notEqual(first.suggestedFilename(), second.suggestedFilename());

    await page.evaluate(() => {
      window.html2canvas = async () => {
        const canvas = document.createElement("canvas");
        canvas.toBlob = cb => cb(null);
        return canvas;
      };
    });
    await clickMenuItem(page, "#export-menu", "#export-btn");
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("failed"));
  }, { allowConsole: /PNG export failed|PNG encode failed/ });
});

test("one-level nested JSON flattens and never prints [object Object]", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, {
      title: "Commits",
      widgets: [
        { type: "kpi", span: 3, title: "Authors", fields: { metric: "author.id", aggregate: "count" } },
        { type: "table", span: 12, title: "Rows", fields: { limit: 10 } },
      ],
    });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const parsed = await page.evaluate(rows => window.__mise.incomingKind(JSON.stringify(rows)).rows, NESTED_COMMITS);
    assert.equal(parsed[0]["author.login"], "octocat");
    assert.equal(parsed[0]["commit.message"], "fix parser");
    assert.ok(!JSON.stringify(parsed).includes("[object Object]"));

    await page.locator("#paste").fill(JSON.stringify(NESTED_COMMITS, null, 2));
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");
    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, /\[object Object\]/);
    assert.match(text, /octocat/);
  }, { allowConsole: /AI response did not validate, falling back/ });
});

test("one row per date×segment is a weekly series, not 36 raw points", async () => {
  await withPage(async page => {
    await mockInference(page, CHEF_WITHOUT_OBSERVATIONS, Q1_REVENUE_PLAN);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#paste").fill(Q1_REVENUE_CSV);
    await page.locator("#render-btn").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const info = await page.evaluate(() => {
      const kpis = [...document.querySelectorAll(".w-kpi")].map(el => ({
        label: el.querySelector(".label")?.textContent.trim(),
        value: el.querySelector(".value")?.textContent.trim(),
        delta: el.querySelector(".delta")?.textContent.trim() || "",
      }));
      const charts = [...document.querySelectorAll(".w-chart")].map(el => ({
        title: el.querySelector("h3")?.textContent.trim(),
        meta: el.querySelector(".meta")?.textContent.trim(),
      }));
      const state = window.__mise.state;
      const weekCol = state.schema.find(c => c.name === "week");
      const mrrSeries = window.__mise.seriesBy(state.rows, "week", "mrr_usd", undefined, state.schema);
      const nrrSeries = window.__mise.seriesBy(state.rows, "week", "nrr", undefined, state.schema);
      const mrrKpi = state.recipe.widgets.find(w => w.type === "kpi" && /mrr/i.test(w.label || w.title || ""));
      return {
        rowCount: state.rows.length,
        weekType: weekCol?.type,
        uniqueWeeks: new Set(state.rows.map(r => r.week)).size,
        kpis,
        charts,
        mrrSeriesLen: mrrSeries.length,
        nrrSeriesLen: nrrSeries.length,
        lastMrr: mrrSeries[mrrSeries.length - 1]?.y,
        prevMrr: mrrSeries[mrrSeries.length - 2]?.y,
        lastNrr: nrrSeries[nrrSeries.length - 1]?.y,
        mrrKpiValue: mrrKpi?.value,
        mrrKpiDelta: mrrKpi?.delta,
      };
    });

    assert.equal(info.rowCount, 36);
    assert.equal(info.weekType, "date");
    assert.equal(info.uniqueWeeks, 12);
    assert.equal(info.mrrSeriesLen, 12, "MRR trend must collapse to one point per week");
    assert.equal(info.nrrSeriesLen, 12, "NRR trend must collapse to one point per week");
    assert.equal(info.lastMrr, 905700, "last-week company MRR is Enterprise+Mid-Market+SMB");
    assert.equal(info.prevMrr, 894728);
    assert.ok(Math.abs(info.lastNrr - (1.22 + 1.07 + 0.95) / 3) < 1e-9);

    const currentMrr = info.kpis.find(k => /current mrr/i.test(k.label));
    assert.ok(currentMrr, "CURRENT MRR kpi is present");
    assert.equal(currentMrr.value, "$905.7k");
    assert.doesNotMatch(currentMrr.value, /83\.1k/);
    assert.doesNotMatch(currentMrr.delta, /66\.9%/);
    const expectedDelta = ((905700 - 894728) / 894728) * 100;
    assert.ok(Math.abs(info.mrrKpiDelta - expectedDelta) < 0.05, `week-over-week delta, got ${info.mrrKpiDelta}`);

    const mrrTrend = info.charts.find(c => /mrr trend/i.test(c.title));
    const nrrTrend = info.charts.find(c => /nrr trend/i.test(c.title));
    const bySegment = info.charts.find(c => /mrr by segment/i.test(c.title));
    assert.match(mrrTrend.meta, /line · 12 pts/i);
    assert.match(nrrTrend.meta, /line · 12 pts/i);
    assert.doesNotMatch(mrrTrend.meta, /36/);
    assert.doesNotMatch(nrrTrend.meta, /36/);
    assert.match(bySegment.meta, /bar · 3 groups/i);
  });
});

test("compact numbers never print 1000B for just-under-a-trillion values", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const formatted = await page.evaluate(() => {
      const rows = [{ nps: 61, ratio: 0.61 }, { nps: 70, ratio: 0.7 }];
      const schema = window.__mise.inferSchema(rows);
      const format = (value, column, requested = "auto") =>
        window.__mise.formatCompact(value, column, requested, { rows, schema });
      return {
        justUnderT: format(999999999999),
        trillion: format(1e12),
        billion: format(1.5e9),
        wholePercent: format(61, "nps", "percent"),
        ratioPercent: format(0.61, "ratio", "percent"),
        negativeCurrency: format(-1200, "revenue_usd", "currency"),
      };
    });
    assert.doesNotMatch(formatted.justUnderT, /1000\s*[Bb]/);
    assert.match(formatted.justUnderT, /T|999/);
    assert.match(formatted.trillion, /T/);
    assert.equal(formatted.billion, "1.5B");
    assert.equal(formatted.wholePercent, "61%");
    assert.equal(formatted.ratioPercent, "61%");
    assert.equal(formatted.negativeCurrency, "-$1.2k");
  });
});

test("widget menu, observations placement, rename, and drag-to-reorder", async () => {
  await withPage(async page => {
    await mockInference(page);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByText("SAAS METRICS").click();
    await page.waitForSelector("#chef-fab.is-visible");

    const widgetCount = await page.locator("#dash-grid > [data-fp]").count();
    assert.equal(await page.locator("#dash-grid .widget-menu-trigger").count(), widgetCount);
    const firstKpi = page.locator(".w-kpi").first();
    assert.equal(await firstKpi.locator(".widget-menu-trigger").count(), 1);
    assert.equal(await firstKpi.locator(".widget-drag-handle").count(), 1);
    assert.equal(await firstKpi.locator("button.widget-action, .assumption-chip, .widget-edit").count(), 0);
    assert.equal(await page.locator(".table-toolbar .table-export-btn").count(), 0);

    const kinds = await page.evaluate(() => [...document.querySelectorAll("#dash-grid > [data-fp] > .w")].map(element => {
      if (element.classList.contains("w-kpi")) return "kpi";
      if (element.classList.contains("w-obs")) return "obs";
      if (element.classList.contains("w-table")) return "table";
      return "chart";
    }));
    assert.deepEqual(kinds.slice(0, 5), ["kpi", "kpi", "kpi", "kpi", "obs"]);
    assert.ok(await page.locator(".obs-more summary").isVisible());
    assert.match(await page.locator(".obs-more summary").innerText(), /Show all 3/i);
    assert.equal(await page.locator(".obs-item:visible").count(), 2);
    await page.locator(".obs-more summary").click();
    assert.equal(await page.locator(".obs-item:visible").count(), 3);

    await openWidgetMenu(page, ".w-kpi");
    await page.locator("details.widget-menu[open] [data-inspect-widget]").click();
    await page.waitForSelector("#inspector-dialog[open]");
    await page.locator("#inspector-close").click();

    await openWidgetMenu(page, ".w-kpi");
    await clickWidgetMenuItem(page, /Rename/);
    await page.locator(".w-kpi .inline-rename-input").fill("Hero MRR");
    await page.locator(".w-kpi .inline-rename-input").press("Enter");
    assert.match(await firstKpi.locator(".label").innerText(), /HERO MRR/);
    await page.locator("#recipe-undo").click();
    assert.match(await firstKpi.locator(".label").innerText(), /CURRENT MRR/);

    await firstKpi.locator(".label").dblclick();
    await page.locator(".w-kpi .inline-rename-input").fill("Primary MRR");
    await page.locator(".w-kpi .inline-rename-input").press("Enter");
    assert.match(await firstKpi.locator(".label").innerText(), /PRIMARY MRR/);
    await page.locator("#recipe-undo").click();

    await page.locator("#dash-title").dblclick();
    await page.locator("#dash-title").fill("Growth Review");
    await page.locator("#dash-title").press("Enter");
    assert.match(await page.locator("#dash-title").innerText(), /Growth Review/);
    await page.locator("#recipe-undo").click();
    assert.match(await page.locator("#dash-title").innerText(), /SaaS Growth Review/i);

    await dragWidget(page, 0, 1, true);
    assert.equal(await firstKpi.locator(".label").innerText(), "NEW CUSTOMERS");
    await page.locator("#recipe-undo").click();
    assert.equal(await firstKpi.locator(".label").innerText(), "CURRENT MRR");

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const csvDownload = page.waitForEvent("download");
    await openWidgetMenu(page, ".w-table");
    await page.locator("[data-export-csv]").click();
    assert.match((await csvDownload).suggestedFilename(), /\.csv$/);
    await openWidgetMenu(page, ".w-table");
    await page.locator("[data-copy-md]").click();
    await page.waitForFunction(() => document.getElementById("status-pill")?.textContent?.includes("Copied markdown"));
  });
});

async function widgetCard(page, fingerprintOrIndex) {
  if (typeof fingerprintOrIndex === "number") return page.locator("#dash-grid > [data-fp]").nth(fingerprintOrIndex);
  if (typeof fingerprintOrIndex === "string" && /^[.#[]/.test(fingerprintOrIndex)) return page.locator(fingerprintOrIndex).first();
  return page.locator(`[data-fp="${fingerprintOrIndex}"]`);
}

async function clickWidgetMenuItem(page, name) {
  await page.locator("details.widget-menu[open] .menu-list button").filter({ hasText: name }).click();
}

async function openWidgetMenu(page, fingerprintOrIndex) {
  const card = await widgetCard(page, fingerprintOrIndex);
  const opened = await card.locator("details.widget-menu").evaluate(element => element.open);
  if (!opened) await card.locator(".widget-menu-trigger").click();
  await page.waitForSelector("details.widget-menu[open]");
  return card;
}

async function dragWidget(page, fromDisplayIndex, toIndex, after = true) {
  await page.evaluate(([from, to, insertAfter]) => {
    const cards = [...document.querySelectorAll("#dash-grid > [data-fp] > .w")];
    const source = cards[from]?.querySelector(".widget-drag-handle");
    const target = cards[to];
    if (!source || !target) throw new Error("missing drag source or target");
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    const rect = target.getBoundingClientRect();
    const clientX = insertAfter ? rect.right - 4 : rect.left + 4;
    const clientY = rect.top + rect.height / 2;
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
  }, [fromDisplayIndex, toIndex, after]);
}

async function clickMenuItem(page, menuId, itemSelector) {
  await page.locator(menuId).click();
  await page.waitForSelector(`${itemSelector}:visible`);
  await page.locator(itemSelector).click();
}

async function openMobileSheet(page, summaryId) {
  await page.locator(summaryId).click();
  await page.waitForSelector("details.menu-sheet[open] .menu-list");
}

async function openWorkbenchTab(page, label) {
  const workbench = page.locator("#analysis-workbench");
  if (!(await workbench.evaluate(element => element.open))) await page.locator("#open-workbench").click();
  await page.waitForSelector("#analysis-workbench[open]");
  await workbench.getByRole("button", { name: label, exact: true }).click();
  return workbench;
}

async function closeWorkbench(page) {
  await page.locator("#analysis-workbench .dialog-close").click();
  await page.waitForFunction(() => !document.querySelector("#analysis-workbench")?.hasAttribute("open"));
}

async function setTheme(page, value) {
  await openWorkbenchTab(page, "Notes & backup");
  await page.locator("#theme-picker").selectOption(value);
  await closeWorkbench(page);
}

async function withPage(fn, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1100 }, ...(options.context || {}) });
  const messages = [];
  page.on("console", msg => {
    if (["error", "warning"].includes(msg.type())) messages.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", error => messages.push(`pageerror: ${error.message}`));
  try {
    await fn(page);
    const unexpected = options.allowConsole
      ? messages.filter(message => !options.allowConsole.test(message))
      : messages;
    assert.deepEqual(unexpected, []);
  } finally {
    await browser.close();
  }
}

async function mockInference(page, chefRecipe = CHEF_WITHOUT_OBSERVATIONS, planRecipe = PLAN, onRequest = null) {
  await page.addInitScript(() => {
    window.html2canvas = async function (_, options) {
      window.__html2canvasOptions = options;
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      canvas.getContext("2d").fillRect(0, 0, 64, 64);
      return canvas;
    };
  });
  await page.route("**/api/events", async route => {
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/cook", async route => {
    onRequest?.(route.request());
    const body = route.request().postDataJSON();
    const payload = body.kind === "chef" ? chefRecipe : planRecipe;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: JSON.stringify(payload) }),
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
