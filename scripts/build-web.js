/* Assemble the static site for Cloudflare Pages into public/.
 * index.html at the root, all assets under /static/ (paths already absolute).
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "public");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "static"), { recursive: true });
fs.copyFileSync(path.join(root, "app", "templates", "index.html"), path.join(out, "index.html"));
fs.cpSync(path.join(root, "app", "static"), path.join(out, "static"), { recursive: true });
// SPA fallback (single page; any unknown path serves the app)
fs.copyFileSync(path.join(out, "index.html"), path.join(out, "404.html"));

console.log("Built public/:", fs.readdirSync(out).join(", "));
