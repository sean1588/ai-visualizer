import { readFileSync } from "node:fs";

import { incomingKind, inferSchema, parseAndValidateRecipe } from "../src/domain/index.ts";
import { buildPrompt } from "../src/prompts.ts";

const baseUrl = (process.env.MISE_APP_URL || "https://app.mise.seanholung.com").replace(/\/$/, "");
const root = new URL("../../eval-datasets/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const selected = process.argv[2]
  ? manifest.filter(entry => entry.id === process.argv[2])
  : manifest;

if (!selected.length) throw new Error(`Unknown evaluation dataset: ${process.argv[2]}`);

const results = [];
for (const entry of selected) {
  const incoming = incomingKind(readFileSync(new URL(entry.path, root), "utf8"));
  if (incoming.kind !== "rows") throw new Error(`${entry.id} did not parse as rows`);
  const schema = inferSchema(incoming.rows);
  const response = await fetch(`${baseUrl}/api/cook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "plan", prompt: buildPrompt(incoming.rows, schema, "") }),
  });
  const payload = await response.json();
  const recipe = response.ok ? parseAndValidateRecipe(String(payload.text || ""), schema, incoming.rows) : null;
  results.push({
    id: entry.id,
    status: response.status,
    valid: !!recipe,
    widgets: recipe?.widgets.length || 0,
    rejectedWidgets: recipe?.rejectedWidgets || 0,
    types: recipe?.widgets.map(widget => widget.type) || [],
  });
}

console.log(JSON.stringify({
  evaluatedAt: new Date().toISOString(),
  endpoint: baseUrl,
  results,
}, null, 2));

if (results.some(result => !result.valid)) process.exitCode = 1;
