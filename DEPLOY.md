# Deploying the JD Tender Hub to Cloudflare Pages

This is a **fully static web app** — no server, no backend. All logic (pricing
engine, Excel import/export, PDF generation, maps) runs in the browser, and each
user's data is saved in **their own browser** (localStorage), with JSON
**Backup / Restore** in the Reports tab to move data between people or devices.

The third-party libraries (SheetJS, jsPDF, Leaflet) are **vendored** into
`app/static/vendor/`, so nothing is fetched from a CDN — it works even on
locked-down corporate networks. (The route map's geocoding/tiles still need
internet; everything else works offline.)

## Build

```bash
npm run build      # -> writes the deployable site to ./public
```

`public/` contains `index.html` at the root and everything else under
`/static/`. That's the whole site.

## Option A — Cloudflare Pages (Git, recommended)

1. Push this repo to GitHub/GitLab.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, pick this repo and the branch.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `public`
4. **Save and Deploy.** Every push redeploys automatically.

## Option B — Direct upload with Wrangler

```bash
npm run build
npx wrangler pages deploy public --project-name jdt-tender-hub
```

## Option C — ZIP for dashboard upload (no CLI on the upload machine)

For uploading from a locked-down machine that can't run Node/Wrangler, build the
ZIP **once on any machine that has Node**, then drag it into the dashboard:

```bash
npm run zip        # -> jdt-tender-hub.zip  (static site + AI proxy)
```

Then: Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Upload assets** → drop `jdt-tender-hub.zip`.

The ZIP bundles a self-contained `_worker.js` (generated from
`functions/api/analyse.js`), so the `/api/analyse` AI proxy works through a plain
dashboard upload — which, unlike Git/Wrangler deploys, does **not** compile the
`functions/` directory on its own. After the first upload, set the
`ANTHROPIC_API_KEY` secret (below) to enable the AI button.

## Custom domain

In the Pages project → **Custom domains** → add e.g. `tenders.jdrt.com.au`
(Cloudflare handles the TLS certificate).

## AI-assisted analysis (optional)

The tender workspace's **Per-Tonne** tab has a *Generate analysis & response*
button. It posts the engine-computed figures to a **Cloudflare Pages Function**
(`functions/api/analyse.js`, served at `/api/analyse`) which calls Claude
server-side and returns a procurement-ready rationale.

The Anthropic API key lives **only on the server** — it is never shipped to the
browser. To enable the feature:

1. Pages project → **Settings → Variables and Secrets** → add a **secret**:
   - **Name:** `ANTHROPIC_API_KEY`  **Value:** your key (`sk-ant-…`)
   - *(optional)* `ANTHROPIC_MODEL` to override the default `claude-opus-4-8`.
2. Redeploy (or it applies on the next deploy).

The whole app keeps working without the key — only the AI button is disabled
(it returns a clear "not configured" message). The function makes its outbound
call from Cloudflare's edge to `api.anthropic.com`, so a locked-down **user**
network doesn't block it; only Cloudflare → Anthropic egress matters, which is
always permitted.

**Local development:**

```bash
cp .dev.vars.example .dev.vars   # then put your key in .dev.vars (gitignored)
npm run build
npx wrangler pages dev public    # serves the site + /api/* functions locally
```

## Notes

- Data is per-browser. To share a register, use **Reports → Backup data** to
  download a `.json` and **Reports → Restore data** on the other machine. (If
  you later want a shared multi-user store, that needs a small Cloudflare
  Workers + KV/D1 backend — ask and we'll add it.)
- The only secret is the optional `ANTHROPIC_API_KEY` above; the static site
  itself needs no environment variables.
