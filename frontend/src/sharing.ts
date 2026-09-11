import {
  widgetFingerprint,
  widgetGroup,
  widgetMetric,
  type DashboardRecipe,
  type RecipePayload,
  type Row,
  type SchemaColumn,
} from './domain/index.ts';

interface RecipeLinkPayload {
  version: 1;
  title: string;
  widgets: unknown[];
}

interface StandaloneDashboard {
  rows: Row[];
  schema: SchemaColumn[];
  widgets: Record<string, { group: string | null; metric: string | null }>;
}

function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function decodeUtf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function encodeRecipeFragment(payload: RecipePayload): string {
  const recipe: RecipeLinkPayload = {
    version: 1,
    title: payload.title,
    widgets: payload.widgets.filter(widget => widget.type !== 'observations'),
  };
  return encodeUtf8(JSON.stringify(recipe))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function decodeRecipeFragment(fragment: string): DashboardRecipe<unknown> | null {
  const encoded = fragment.replace(/^#recipe=/, '');
  if (!encoded || encoded === fragment) return null;
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const parsed = JSON.parse(decodeUtf8(padded)) as Partial<RecipeLinkPayload>;
    if (parsed.version !== 1 || typeof parsed.title !== 'string' || !Array.isArray(parsed.widgets)) return null;
    return { title: parsed.title, widgets: parsed.widgets };
  } catch {
    return null;
  }
}

export function buildRecipeLink(baseUrl: string, payload: RecipePayload): string {
  return `${baseUrl.split('#')[0]}#recipe=${encodeRecipeFragment(payload)}`;
}

export function buildStandaloneHtml(input: {
  title: string;
  dashboardHtml: string;
  css: string;
  rows: Row[];
  schema: SchemaColumn[];
  recipe: DashboardRecipe;
}): string {
  const widgets = Object.fromEntries(input.recipe.widgets.map(widget => [
    widgetFingerprint(widget),
    { group: widgetGroup(widget), metric: widgetMetric(widget) },
  ]));
  const data: StandaloneDashboard = {
    rows: input.rows,
    schema: input.schema,
    widgets,
  };
  const encodedData = encodeUtf8(JSON.stringify(data));
  const title = escapeHtml(input.title);
  const css = input.css.replaceAll('</style', '<\\/style');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${title} · Mise</title>
<style>${css}
.standalone-note{padding:12px 32px;border-bottom:1px solid var(--rule-soft);font:10px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--fg-mute)}
#standalone-inspector[hidden]{display:none}#standalone-inspector{position:fixed;inset:0;z-index:100;background:rgba(31,28,22,.45);display:grid;place-items:center;padding:16px}
.standalone-panel{width:min(900px,100%);max-height:90vh;overflow:auto;background:var(--bg);border:1px solid var(--rule);box-shadow:6px 6px 0 var(--rule);padding:20px}
.standalone-panel header{display:flex;justify-content:space-between;gap:12px;align-items:center}.standalone-panel table{width:100%;border-collapse:collapse;margin-top:12px}.standalone-panel th,.standalone-panel td{padding:7px;border-bottom:1px solid var(--rule-soft);text-align:left}.standalone-panel input{width:100%;padding:9px;border:1px solid var(--rule-soft);margin-top:12px}
</style>
</head>
<body>
<div class="standalone-note">Interactive snapshot exported from Mise · data stays inside this HTML file</div>
${input.dashboardHtml}
<div id="standalone-inspector" hidden>
  <div class="standalone-panel" role="dialog" aria-modal="true" aria-labelledby="standalone-title">
    <header><div><div class="eyebrow eyebrow-accent">Contributing data</div><h2 id="standalone-title"></h2></div><button id="standalone-close" class="btn btn-ghost" type="button">Close</button></header>
    <input id="standalone-search" type="search" aria-label="Filter contributing rows" placeholder="Filter these rows…">
    <div id="standalone-meta" class="eyebrow"></div>
    <div class="table-scroll"><table><thead id="standalone-head"></thead><tbody id="standalone-body"></tbody></table></div>
  </div>
</div>
<script>
const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("${encodedData}"),c=>c.charCodeAt(0))));
const inspector=document.getElementById("standalone-inspector");
const search=document.getElementById("standalone-search");
let selected=[];
const text=value=>value&&typeof value==="object"?JSON.stringify(value):String(value??"—");
function renderRows(){
  const query=search.value.toLowerCase();
  const rows=query?selected.filter(row=>payload.schema.some(column=>text(row[column.name]).toLowerCase().includes(query))):selected;
  document.getElementById("standalone-meta").textContent=rows.length+" matching row"+(rows.length===1?"":"s")+(rows.length>200?" · first 200 shown":"");
  document.getElementById("standalone-head").replaceChildren(Object.assign(document.createElement("tr"),{innerHTML:payload.schema.map(column=>"<th>"+column.name.replaceAll("&","&amp;").replaceAll("<","&lt;")+"</th>").join("")}));
  const body=document.getElementById("standalone-body");body.replaceChildren();
  rows.slice(0,200).forEach(row=>{const tr=document.createElement("tr");payload.schema.forEach(column=>{const td=document.createElement("td");td.textContent=text(row[column.name]);tr.append(td)});body.append(tr)});
}
document.addEventListener("click",event=>{
  const target=event.target.closest("[data-inspect-widget]");
  if(!target)return;
  const widget=payload.widgets[target.dataset.inspectWidget];if(!widget)return;
  const value=target.dataset.inspectValue?decodeURIComponent(target.dataset.inspectValue):null;
  selected=payload.rows.filter(row=>(value===null||!widget.group||String(row[widget.group]??"—")===String(value))&&(!widget.metric||typeof row[widget.metric]==="number"));
  document.getElementById("standalone-title").textContent=value===null?"Source rows":String(value);
  search.value="";renderRows();inspector.hidden=false;search.focus();
});
search.addEventListener("input",renderRows);
document.getElementById("standalone-close").addEventListener("click",()=>inspector.hidden=true);
inspector.addEventListener("click",event=>{if(event.target===inspector)inspector.hidden=true});
document.addEventListener("keydown",event=>{if(event.key==="Escape")inspector.hidden=true});
</script>
</body>
</html>`;
}
