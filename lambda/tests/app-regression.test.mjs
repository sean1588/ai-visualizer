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

test("landing copy accurately describes sampled-row inference", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();

    assert.match(text, /samples a few rows for inference/i);
    assert.match(text, /sample rows sent once for inference/i);
    assert.doesNotMatch(text, /Nothing is uploaded/i);
    assert.doesNotMatch(text, /Claude/i);
  }, { allowConsole: /AI response did not validate, falling back/ });
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
  }, { allowConsole: /AI response did not validate, falling back/ });
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
  }, { allowConsole: /AI response did not validate, falling back/ });
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
    assert.match(text, /HTTP · refreshable/i);
    assert.match(text, /120k/);
    assert.equal(cookCalls, 1);

    await page.locator("#refresh-btn").click();
    await page.waitForFunction(() => document.body.innerText.includes("150k"));

    text = await page.locator("body").innerText();
    assert.match(text, /150k/);
    assert.match(text, /bar · 3 groups/i);
    assert.equal(fetchCalls, 2);
    assert.equal(cookCalls, 1);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Segment Revenue").first().click();
    await page.waitForSelector("#chef-fab.is-visible");
    assert.equal(await page.locator("#refresh-btn").isEnabled(), true);
  });
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
      refreshDisabled: document.getElementById("refresh-btn").disabled,
      hasHttp: hasHttpSource(),
      liveType: state.dataSource?.type || null,
    }));

    assert.doesNotMatch(chrome.pill, /HTTP\s*·\s*refreshable/i);
    assert.equal(chrome.refreshDisabled, true);
    assert.equal(chrome.hasHttp, false);
    assert.equal(chrome.liveType, null);

    await page.locator("#refresh-btn").click({ force: true });
    await page.waitForTimeout(80);
    assert.equal(fetchCalls, 0);
  });
});

test("quoted-comma CSV keeps fields intact and aggregates by the real rep", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const result = await page.evaluate(text => {
      const incoming = incomingKind(text);
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
        try { incomingKind(text); return "ok"; }
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
      const table = state.recipe.widgets.find(w => w.type === "table");
      const shown = sortedTableRows(table).map(r => r.expansion_usd);
      return {
        sort: table.sort,
        order: table.order,
        limit: table.limit,
        shown,
        chip: tableTransformLabel(table),
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
    await page.locator("#export-recipe-btn").click();
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
    await page.locator("#export-btn").click();
    const first = await firstPromise;

    const secondPromise = page.waitForEvent("download");
    await page.locator("#export-btn").click();
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
    await page.locator("#export-btn").click();
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
    const parsed = await page.evaluate(rows => incomingKind(JSON.stringify(rows)).rows, NESTED_COMMITS);
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

test("compact numbers never print 1000B for just-under-a-trillion values", async () => {
  await withPage(async page => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const formatted = await page.evaluate(() => ({
      justUnderT: fmtCompact(999999999999),
      trillion: fmtCompact(1e12),
      billion: fmtCompact(1.5e9),
    }));
    assert.doesNotMatch(formatted.justUnderT, /1000\s*[Bb]/);
    assert.match(formatted.justUnderT, /T|999/);
    assert.match(formatted.trillion, /T/);
    assert.equal(formatted.billion, "1.5B");
  });
});

async function withPage(fn, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
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
