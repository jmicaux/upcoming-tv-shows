// Regenerates watchlist.html from index.html. GitHub Pages serves it at <site>/watchlist,
// so the Watchlist has a clean address that survives a reload. Run after editing index.html:
//   node tools/make-watchlist.js
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

function build(indexHtml) {
  const canonical = /(\s*<link rel="canonical"[^>]*>)/;
  if (!canonical.test(indexHtml)) throw new Error("index.html has no canonical link");
  return "<!-- Generated from index.html by tools/make-watchlist.js — do not edit by hand. -->\n" +
    indexHtml.replace(canonical, '$1\n  <meta name="robots" content="noindex">');
}
module.exports = { build };

if (require.main === module) {
  const out = build(fs.readFileSync(path.join(root, "index.html"), "utf8"));
  fs.writeFileSync(path.join(root, "watchlist.html"), out);
  console.log("watchlist.html updated");
}
