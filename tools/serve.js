// Local stand-in for GitHub Pages: extensionless URLs resolve to .html (or dir/index.html),
// unknown addresses get 404.html. Serves the repo (or dist/) under the Pages base path:
//   node tools/serve.js                     → http://localhost:8765/upcoming-tv-shows/
//   ROOT=dist PORT=9000 node tools/serve.js
// Used by the end-to-end tests (playwright.config.js).
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(process.env.ROOT || ".");
const base = process.env.BASE || "/upcoming-tv-shows/";
const port = Number(process.env.PORT || 8765);
const types = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".xml": "application/xml", ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain",
};
const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (!url.startsWith(base)) { res.writeHead(404); return res.end(); }
  const target = path.join(root, url.slice(base.length));
  if (!target.startsWith(root)) { res.writeHead(403); return res.end(); } // no ../ escape
  const file = [target, target + ".html", path.join(target, "index.html")].find(isFile);
  if (!file) {
    const notFound = path.join(root, "404.html");
    res.writeHead(404, { "content-type": "text/html" });
    return res.end(isFile(notFound) ? fs.readFileSync(notFound) : "Not found");
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${base}`));
