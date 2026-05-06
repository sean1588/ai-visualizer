# Mise · demo video plan

_Target: 25–35 seconds. Single take, no narration, ambient audio only. Posted on Twitter, Bluesky, Hacker News, Product Hunt, and as the hero on `marketing.html`._

The whole point: show the **paste → plate → chef → adjusted plate** loop in one breath. No talking, just doing. The product is the demo.

---

## Beat sheet

| t (s) | What's on screen | Why |
|---|---|---|
| 0:00 – 0:02 | **Cold open.** marketing.html hero, "Mise" wordmark in Fraunces italic, oxblood period landing with a soft pop. *Mise en place — for your data* eyebrow visible. | Establish brand. Two seconds.|
| 0:02 – 0:03 | Click "Sauté it" CTA. | Show the verb. The button is the brand. |
| 0:03 – 0:06 | Land on the empty state. Fast cursor flick to the **Stripe payouts** sample chip. Click. CSV fills the textarea instantly. | Skip the "where do I start?" friction. Use the sample, not real data. |
| 0:06 – 0:08 | Click **Render dashboard →**. | The verb again. |
| 0:08 – 0:13 | Loading screen flashes through 4 steps with the right-side schema panel populating. Hold for ~5s — this is the *"reading your data"* moment. **DO NOT cut this.** It's the trust moment. | The reveal works because we *show* the schema being inferred. People don't believe the AI part is real until they see it think. |
| 0:13 – 0:16 | Dashboard renders. Slow ~1.5s breathing pause on the finished plate — title, observations card, KPIs across the top, line + bar in the middle, donut + statlist, table at the bottom. | Let the polish land. This is the screenshot people will grab. |
| 0:16 – 0:18 | Cursor drifts bottom-right. **"Talk to the chef"** pill highlights. Click. | Reveal the second product. |
| 0:18 – 0:20 | Panel slides in. Cursor clicks the suggestion chip: ***"Promote the first KPI to a hero — full width"***. | Use a suggestion, not freetype, so timing is predictable. |
| 0:20 – 0:23 | Panel shows ***tasting…*** with the pulsing dot. Hold. | The wait IS the magic. Don't cut it. ~2.5s feels right. |
| 0:23 – 0:26 | Recipe updates live. The promoted KPI **pulses oxblood**. Chef reply appears in italic Fraunces: *"Promoted MRR to the hero. The rest tightens around it."* with the small **DONUT → BAR · KPI → HERO** changes line. | The pulse is the entire reason this video works. Make sure it's visible. |
| 0:26 – 0:30 | Cursor drifts to top-right. Click **Recipe ↓**. Browser download notification flashes (`stripe-payouts.recipe.json`). | Show that the artifact is real and exportable. People love this part. |
| 0:30 – 0:33 | Final card overlay — black with cream Fraunces italic: ***Mise. mise.app.*** | Closing wordmark. URL. That's it. |

**Total: ~33 seconds.** If it feels rushed, cut the recipe export beat (0:26–0:30) — but only that one. Everything else is load-bearing.

---

## Production notes

**Recording:**
- 1920x1080, screen recording at 60fps. **Crisp** is more important than long.
- Use a tool that records the cursor. Loom or QuickTime + a cursor highlighter. The cursor doing the verbs is part of the show.
- Hide the browser chrome (full-screen Safari with `cmd+shift+f`, or Chrome with `--app=` flag).
- Use a real-feeling browser: bookmarks bar visible but with neutral/personal-seeming bookmarks, normal tab. Don't use `localhost:` — host on a temporary public URL for the recording.

**Audio:**
- **No music.** No voiceover. Ambient room tone only — the *mechanical click of the keys, the soft tap of the cursor*. This is *Apple film grammar*, not *SaaS landing page* grammar.
- If you must have audio, a single low piano note at 0:00 and one at 0:31. That's it.

**Pacing:**
- Cursor moves should look natural. No teleporting. Use easing on the cursor path if your tool supports it.
- The `tasting…` and the pulse are the two spots where you slow down. Everything else can be slightly faster than feels comfortable.

**Don't:**
- Don't add captions. The screen tells the story.
- Don't show your face.
- Don't show the URL bar typing — start on the page.
- Don't cut to multiple shots. **One take.** The continuity is the point.

---

## Variants for distribution

**Twitter/Bluesky (33s, MP4)** — the canonical version. Posted with a single line: *"Made a thing. mise.app"*. No emoji. No thread. Let the video do the work.

**Marketing hero (autoplay, muted, looping)** — same video, looped, with the final card cut so it loops cleanly back to the open. Embedded above the fold on `marketing.html`, replacing or sitting above the current Hero.

**Hacker News / Show HN (link only)** — title: *"Show HN: Mise — paste data, get a dashboard you can talk to"*. Body: *"Built this over a few weekends. The chef-chat panel is the part I'm proudest of. Free, no signup, no servers — drop a CSV and try it. Source on GitHub. Feedback welcome."* Link to `mise.app`.

**Product Hunt (15s cut)** — first 15 seconds only (paste → render → first plate landing). PH users scroll fast; you have the duration of one breath.

**GIF (~3MB, 12fps)** — for places that don't autoplay video (Reddit, GitHub README). Cut to: paste, render, plate landing, chef adjusts, pulse. Skip the closing card.

---

## What you're really showing

The video is a **trust artifact**. Three claims, made by demonstration not assertion:

1. **It's fast** — paste-to-plate in ~13 seconds on screen, ~7 seconds of which is the (intentional) "reading your data" beat. People will perceive this as instant.
2. **It's real AI, not a template** — the schema panel populating + the chef adjusting + the pulse on the changed widget = three separate moments where the AI is visibly *deciding*.
3. **It's yours, not ours** — the recipe download at the end, plus the lack of any login/account/upload UX, says everything we want it to say without saying it.

If a viewer walks away with all three, the video did its job.

---

## Open questions for you

- **Music: yes or no?** I lean no, but a single low piano hit on the cold open and the closing card is defensible.
- **What sample dataset?** Stripe payouts is the safest (everyone knows what it is, the metrics are interesting). SaaS metrics is also a good pick. The HR dataset is too dry; skip it for the video.
- **Where does the video live?** Twitter is the launch, but the marketing site needs an embedded version too. Self-hosted MP4 with `<video autoplay muted playsinline loop>` is the right call — no YouTube embed, no third-party tracking.
- **Do we record it ourselves, or hire someone?** If you're comfortable with screen recording and a clear plan, a careful 30-minute solo session beats a $400 freelancer. The video doesn't need to be *good*; it needs to be *honest*.

_Last updated: 2026-05-02. Aim to record the week before launch, when the product is locked and the URL is live._
