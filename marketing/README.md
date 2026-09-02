# Mise marketing (closest source)

The live marketing site at https://mise.seanholung.com is a Hugo build
(`Hugo 0.147.6`, last-modified 2026-05-12). That Hugo tree is **not** in
https://github.com/sean1588/ai-visualizer — this repo only ships the app
(`public/` → app.mise.seanholung.com, last-modified 2026-05-09, byte-identical
to `origin/main` at `4e9d279`).

`index.html` here is a static snapshot of the live page with the dead
`href="#"` footer links wired to real sections. Deploy it to the marketing
bucket/host in place of the Hugo output, or port the sections back into the
private Hugo repo.

App-side copies of the same pages live at `public/docs/` so the empty-plate
footer on the app works even before marketing is redeployed.
