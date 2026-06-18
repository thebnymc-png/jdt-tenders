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

## Custom domain

In the Pages project → **Custom domains** → add e.g. `tenders.jdrt.com.au`
(Cloudflare handles the TLS certificate).

## Notes

- Data is per-browser. To share a register, use **Reports → Backup data** to
  download a `.json` and **Reports → Restore data** on the other machine. (If
  you later want a shared multi-user store, that needs a small Cloudflare
  Workers + KV/D1 backend — ask and we'll add it.)
- No environment variables or secrets are required.
