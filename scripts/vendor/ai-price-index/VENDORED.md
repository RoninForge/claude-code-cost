# Vendored ai-price-index

Verbatim copy of the `lib/` output of
[ai-price-index](https://github.com/RoninForge/ai-price-index) (`node tools/build-npm.mjs`),
bundled so this plugin prices token usage with **zero runtime network** and
**no npm install** at plugin load.

- Source: ai-price-index `main` at `b3b09d3` (#96, per-request prompt-length tiers),
  which is ahead of the latest npm release (1.0.62). `data.json` records the same ref
  in `source`. Also vendors `index.d.ts`.
- Data modified:  `2026-11-16`
- Models covered: 149
- Pricing data license: CC BY 4.0. Tooling: MIT.

The local `package.json` here (`{"type":"module"}`) is NOT from upstream; it exists
only so these `.js` files load as ES modules on every Node version (>= 18). Upstream
sets `type:module` at its package root, which is not vendored. Keep this file on refresh.

Refresh: `npm pack ai-price-index@latest` (or `node tools/build-npm.mjs` in a checkout),
copy `lib/{data.json,engine.js,index.js}` and `index.d.ts` here (leave this `package.json`
and `VENDORED.md` in place), record the source above, then bump the plugin version.
