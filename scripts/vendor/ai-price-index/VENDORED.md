# Vendored ai-price-index

Verbatim copy of the `lib/` output of the published
[ai-price-index](https://www.npmjs.com/package/ai-price-index) npm package,
bundled so this plugin prices token usage with **zero runtime network** and
**no npm install** at plugin load.

- Source package: `ai-price-index@1.0.3` (npm, published)
- Data modified:  `2026-06-22`
- Models covered: 95
- Pricing data license: CC BY 4.0. Tooling: MIT.

The local `package.json` here (`{"type":"module"}`) is NOT from upstream; it exists
only so these `.js` files load as ES modules on every Node version (>= 18). Upstream
sets `type:module` at its package root, which is not vendored. Keep this file on refresh.

Refresh: `npm pack ai-price-index@latest`, copy `package/lib/{data.json,engine.js,index.js}`
here (leave this `package.json` and `VENDORED.md` in place), then bump the plugin version.
