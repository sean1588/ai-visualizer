# Mise · product vocabulary

_The kitchen metaphor we've committed to. Use these words consistently across product, marketing, docs, and copy. Brand language is half the brand._

---

## Core terms

### Mise
The product. Pronounced *meez*. Short for *mise en place* — French culinary term meaning "everything in its place," the chef's prep work before service begins. The wordmark is **Mise.** in Fraunces italic with an oxblood period.

Tagline: ***mise en place* for your data.**

### Recipe
The JSON layout that Claude returns — title, widgets, fields, observations. The user's notes guide it; the validator sanity-checks it; the renderer plates it. Already in the codebase as `recipe`. Export filename: `<slug>.recipe.json`.

### Garnish
The Notes textarea on the empty state. Optional. Steers Claude's recipe toward what *you* want emphasized. *"Add a garnish — anything you want emphasized: 'highlight churn over 5%', 'treat MRR as the hero', 'show by region not by month'."*

### Pantry
The widget shelf — the collection of widget types you can grab and drop. KPIs, line charts, donuts, tables. *Stuff on hand.* (Not yet built — reserved for v1.1 if/when we add manual widget insertion.)

### Plates
The collection of saved dashboards. Each finished dashboard is a *plate* — a thing you've cooked. Page header: *"Your plates."* Pairs with "in this browser, not on our servers" because plates live at home.

### The Chef
The chat-to-edit panel inside a rendered dashboard. Type a request in natural language, the chef adjusts the recipe. *"Swap the donut for a bar chart."* *"Sort the table by date desc."* *"Hide observations."*

---

## Verbs (actions the user takes)

### Sauté
The primary CTA. *"Sauté it →"* / *"Sauté your data →"*. Active, fast, has visible motion. Replaces "Try it free" / "Drop a file" / "Generate."

### Plate (verb)
The act of rendering. Internal use mostly — *"plate the recipe"*. Distinct from the noun *"a plate"*.

### Prep
What happens before the recipe runs — schema inference, type detection, sample sniffing. Could appear as a status: *"Prep complete · 8 columns inferred."*

### Taste
The Claude-thinking moment. Loading state for AI calls: *"Tasting…"*

### Cook
The active render step. Loading state: *"Cooking…"*

### To the pass
Optional copy for the export action — kitchen counter where dishes leave. *"To the pass →"* as the export button. Currently we use "Export HTML" / "Export recipe" — keep until we want to lean further into the metaphor.

---

## Status & system messages

| Surface | Word/phrase | Notes |
|---|---|---|
| Schema inference | **Prepping…** / **Prep complete** | Replaces silent inference |
| Claude call | **Tasting…** | Italic Fraunces, lowercase |
| Render | **Cooking…** | Used briefly during the plate animation |
| Recipe failed validation | **Recipe didn't pass tasting — using the house plan** | Already there as a banner |
| Saved to localStorage | **Plated.** | One-word toast |
| Clear pantry/plates | **Clear all your plates from this browser?** | Confirm dialog |
| Empty plates state | **No plates yet — sauté something to get started** | |

---

## Words we **don't** use

- ❌ **Visualizer** — old name. Strike on sight.
- ❌ **Generate / generated** — flat, AI-slop adjacent. Use *plate* or *cook*.
- ❌ **Dashboard** in user-facing copy where *plate* works — but **dashboard** is fine in technical context (docs, exports, API). Don't get cute where clarity matters.
- ❌ **Dishes / Courses** for individual widgets — we tried this, too cute, hurts comprehension.
- ❌ **Spoiled / Off** for bad data — funny but condescending.
- ❌ **Ingredients** for individual data columns — we considered it; not landing. Columns stay columns.

---

## Marketing copy patterns

**Header pattern:** Fraunces italic verb-phrase, often with one *emphasized* word.
- *"A dashboard that runs **entirely** in your browser."*
- *"Plates you keep. Recipes you can read."*
- *"From paste to plate in 12 seconds."*

**Eyebrow pattern:** mono caps, single line, often using a brand word.
- `MISE EN PLACE — FOR YOUR DATA`
- `WHAT'S ON YOUR PLATE`
- `THE PANTRY · 8 WIDGET TYPES`

**Glossary footer (proposed for marketing.html):**
Three columns, mono caps for term, Fraunces italic for definition.
- **MISE** — *the product. mise en place for your data.*
- **RECIPE** — *the layout the AI returns from your data.*
- **GARNISH** — *your notes to the chef.*
- **PLATES** — *your saved dashboards.*
- **THE CHEF** — *the chat that adjusts the dashboard on request.*

---

## Edge cases & open questions

- **Plural handling.** "Plates" reads better than "plate" as the page name. "Pantry" stays singular. Don't pluralize Mise.
- **Internationalization.** The metaphor is rooted in French culinary tradition; *mise en place* is widely recognized in English-speaking professional kitchens. For non-English markets, the metaphor may need re-examining — but for v1, English-only.
- **The Chef vs chat input.** Some users may find "The Chef" too cute and prefer plain "Adjust." Consider supporting both: panel chrome can read **Adjust** (functional), but the loading microcopy and AI persona can be the chef (*"the chef is tasting…"*). Best of both.
- **Tone calibration.** The metaphor is **flavor**, not a costume. We don't say *"bon appétit"* or use chef-hat emoji. The brand is editorial, not whimsical. Think *Eleven Madison Park*, not *Ratatouille*.

---

_Last updated: 2026-05-02 during the Mise naming pass._
