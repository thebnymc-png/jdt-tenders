# JDT Pricing Model — Standalone Desktop App


> **Deploying as a web app?** This now also runs as a fully client-side static site on **Cloudflare Pages** (no server, data in the browser). See **[DEPLOY.md](DEPLOY.md)**.
A portable, offline pricing tool for **JD Refrigerated Transport**, rebuilt from
the original `JDT_Pricing_Model.xlsx` workbook into a single Windows executable.
No Excel, no macros, no install — copy `JDT_Pricing_Model.exe` to a USB stick or
shared drive and run it. All data and generated quote PDFs are saved next to the
`.exe`, so the whole tool stays self-contained and portable.

Every formula and decision rule was ported 1:1 from the workbook and verified
against its live values (see `tests/`).

## Console (enterprise UI)

The app uses a "Clean Technical" desktop console (Linear/Vercel style) built for
high-volume, professional use:

- **Collapsible sidebar** IA: Active Tenders, Bid Analysis · Settings, Lanes,
  Warehousing, Leg Builder, Quote, Portfolio · Carrier Network, Compliance · Reports.
- **Active Tenders** — a dense, sortable grid (lanes, pallets/wk, deadline,
  bids, engine-priced bid value, status) with inline hover actions
  (Edit / Award / Reject) and expandable rows showing competing bids.
- **Tender workspace** — each tender opens a full-page RFQ with sections:
  Overview, **Operational Lanes** (collection/delivery postcodes, pallets,
  weights, dimensions, stackability, loading type — each priced by the cost
  engine), **Per-Tonne** (banded $/t rate card per lane, a per-load check
  showing whether each load bills at the band rate or the Min Charge floor,
  and a live Method A vs B revenue comparison), **Volume History**
  (12-month seasonality), Schedule, Commercial,
  Technology, Contract, and Bids, plus a **live network map** (OpenStreetMap;
  needs internet, degrades gracefully offline).
- **Excel import** — upload any supplier tender workbook and map its columns
  to JDT lane fields (auto-guessed) to bulk-create priced operational lanes.
- **Bid Analysis** — pipeline-by-status and value-by-status breakdowns plus
  portfolio economics.
- **Carrier Network & Compliance** — editable registers (Compliance ships seeded
  with a Chain-of-Responsibility checklist).
- **Command palette** (⌘K / Ctrl-K) to jump to any view, tender or action.
- **Light / dark themes** that follow the OS by default, with a header toggle.
- Tabular numerals, 1px borders, WCAG-AA contrast, Inter (falls back to the
  native SF Pro / Segoe UI when offline).

## What it does

| Tab | Purpose |
|-----|---------|
| **Settings** | Global pricing assumptions — driver labour, statutory loadings, vehicle $/km, fuel levy, target margin. Drives the live *loaded $/hr* engine. |
| **Lanes** | 640 pre-loaded transport lanes. Edit inputs → live cost/trip, base price, price + fuel levy, margin %, annual revenue/GP and a **GO / REVIEW / NO-GO** decision. |
| **Warehousing** | Cost-to-serve model — storage, inbound/outbound handling, case picks, VAS hours → per-pallet price and account margin. |
| **Leg Builder** | Break a complex trip into legs (yard/load/drive/unload/return) and see the live trip price. |
| **Summary** | Whole-portfolio rollup: transport + warehousing + combined, weekly/annual revenue, GP and blended margin. |
| **Quote** | Flag lanes/accounts with **Quote? = Y**, fill customer details, and **Generate Quote PDF** — saved as `JDT_Quote_<Customer>_<#>_<date>.pdf` and opened automatically. |
| **Tenders** | Tender-management register with a status pipeline (Draft / Submitted / Shortlisted / Won / Lost / No-bid), **capture the current priced model as a tender and reload it later**, a dashboard (open / weighted / won value, win-rate, due-soon & overdue), and due-date highlighting (amber ≤14 days, red overdue). |

## Exports

An **Export** menu (top bar) writes files next to the app and opens them:

| Export | Output |
|--------|--------|
| Full model → Excel | `JDT_Model_<date>.xlsx` — Settings, Lanes, Warehousing, Summary, Tenders with all computed columns |
| Data tables → PDF | `JDT_Data_<date>.pdf` — printable Lanes + Warehousing working data |
| Quote → Excel | `JDT_Quote_<Customer>_<date>.xlsx` — the customer quote as a spreadsheet (alongside the PDF) |
| Tender register → Excel / PDF | `JDT_Tenders_<date>.xlsx` / `.pdf` — all tenders plus pipeline totals |

Exports use the same numbers shown on screen (the UI posts computed rows; the backend only formats them), so they can never drift from the app.

The **Reset** button (top-right) clears all pricing inputs and restores Settings
defaults, keeping lane and customer names as the template — exactly like the
workbook's reset macro.

## The pricing engine

```
Loaded $/hr  = base × OT × (1 + super) × (1 + workcover + payroll)
             ↳ Day Rate (RT ≤ cutoff km) · LineHaul (RT > cutoff, default 250km)
Labour cost  = total hours × loaded $/hr
Fuel/veh     = total km × vehicle $/km
Base cost    = labour + fuel/veh + tolls + overnight + loading extras
Base price   = base cost ÷ (1 − target margin)
Price inc FL = base price × (1 + fuel levy)
Margin %     = (price − cost) ÷ price
Decision     = GO (≥ target) · REVIEW (within 8 pts) · NO-GO (below)
```

### Per-tonne banded pricing

For tenders quoted on $/tonne (rather than flat or hourly), the engine derives a
banded rate card from each lane's FTL prices and bills every load at the floor or
the band rate, whichever is higher — ported 1:1 from the Simplot workbook's
*Methodology* §5 and *Per-Tonne Analysis* tabs:

```
FTL Single   = lane priced on a Semi   (FTL Rigid = same trip on a Rigid)
Min Charge   = ROUND(FTL Rigid × 0.85)              ← floor for sub-tonne loads
Band $/t     = FTL ÷ anchor   (0-5/5-10/10-14 → Rigid · 14t+ → Semi)
Billed $     = MAX(Min Charge, band $/t × actual tonnes)
```

Two anchoring methods are selectable per quote:

| Method | Anchor | Formula | When |
|--------|--------|---------|------|
| **A** | band ceiling | FTL ÷ {5, 10, 14, 22} | Current Simplot v3 rate card (reproduces it exactly) |
| **B** | band midpoint | FTL ÷ {2.5, 7.5, 12, 18} | Proposed — recovers truck cost at the *typical* load (median ≈ midpoint, not ceiling) |

`engine.js` exposes `bandRates()`, `bandForTonnes()`, `quoteTonnage()` and
`computeLaneBands()`; all four are validated against the workbook's published
values in `tests/test_bands.js`.

### Shipment revenue simulation

Import a raw shipment export (destination + tonnage) on a tender's **Per-Tonne**
tab and the engine groups it by the lane serving each destination, buckets the
loads into bands, and bills every consignment at the floor-or-rate rule —
reproducing the workbook's *Per-Tonne Analysis* §3–§4. The result is a
destination-by-destination table (shipment count, total/median tonnes, band
distribution) and a **Method A vs B** revenue comparison on your actual load
distribution — the evidence that drives the v1→v2 decision.
`engine.js` exposes `analyseShipments(shipments, lanes, settings)`.

### Unit rate equivalents

Every lane's base price is also expressed across the full suite of quoting bases
so you can respond on whatever basis a tender asks for: **flat** (per trip),
**per pallet**, **per tonne**, **per kg**, and **per km**. The Per-Tonne tab shows
a *Unit rate equivalents* table, the Leg Builder shows them as KPIs, and the
Excel/PDF exports carry a `$/kg` column. `engine.js` exposes `perKg`/`perKgFL`
and `perKm`/`perKmFL` alongside the existing `perSpace`/`perTonne`/`perHour`.

### Day Rate vs LineHaul

Labour is priced on the **Day Rate** for round trips at or under the LineHaul
cutoff (default 250 km RT) and on the higher **LineHaul** rate beyond it, matching
the workbook's two-rate build. Both bases and the cutoff are editable in Settings;
`engine.js` exposes `loadedDayRate()`, `loadedLineHaulRate()` and `rateForKm()`.

### AI Analysis (in-app agent)

The **AI Analysis** sidebar view is a self-contained, multi-turn tender
assistant. Drop in an Excel/CSV file, then chat: *answer questions, extract data,
present options, or set up a tender*. It shares the Pages Function proxy
(`kind:"agent"`) and works in two ways:

- **Query tools** (`read_sheet_rows`, `aggregate_sheet`) run **immediately** in
  the browser over the *full* data and feed the result back to the model — so
  questions like "which destinations carry the most tonnes?" or "what's the
  average tonnage per destination?" are answered with exact figures, not guessed
  from a sample. The model can loop these until it has what it needs.
- **Action tools** (`create_tender`, `set_tender_fields`,
  `add_lanes_from_sheet`, `add_shipments_from_sheet`, `add_bids`, `add_carriers`,
  `set_method`) are **proposed for review** — you see a "Proposed changes" card
  and click **Apply** or **Discard** before anything is written. Applied changes
  are listed back with a link to the tender, and follow-ups in the same chat keep
  building the same tender.

The model only ever chooses the sheet + column mapping; the browser applies it to
the full file locally, so large exports are never transcribed or re-uploaded.

### AI-assisted tender response

The **Per-Tonne** tab can turn the verified figures into a procurement-ready
rationale. The browser posts only engine-computed numbers (rate cards, per-load
billing, the Method A vs B simulation) to a **Cloudflare Pages Function**
(`functions/api/analyse.js`) that holds the Anthropic API key as an encrypted
secret and asks Claude (default `claude-opus-4-8`) to write the justification —
grounded only in those numbers, never inventing figures. The key never reaches
the browser. Setup and local-dev steps are in **[DEPLOY.md](DEPLOY.md)**; the app
works fully without it (the AI button just reports it isn't configured).

## Getting the executable

### Option A — download from CI (no setup)
Every push builds the EXE on a Windows runner. Open the repo's **Actions** tab →
the latest **Build Windows EXE** run → download the
**`JDT_Pricing_Model-windows`** artifact. Unzip and run `JDT_Pricing_Model.exe`.

### Option B — build it yourself on Windows
```bat
git clone <repo> && cd jdt-tenders
build\build_windows.bat
```
The portable app appears at `dist\JDT_Pricing_Model.exe`.

## Running from source (any OS, for development)

```bash
pip install -r requirements.txt
python run.py
```

Opens a native desktop window (Edge WebView2 via pywebview). If pywebview isn't
available it falls back to your default browser. Calculation logic lives in
`app/static/engine.js`; the Flask backend (`app/server.py`) only handles saving
state and rendering the PDF, so the two can never drift.

## Tests

```bash
node tests/test_engine.js                       # engine vs. workbook values + pipeline math
PYTHONPATH=. python tests/test_backend.py       # API + quote PDF generation
PYTHONPATH=. python tests/test_exports.py       # Excel + PDF exporters
```

## Project layout

```
run.py                     entry point (dev + PyInstaller)
app/
  main.py                  starts server + opens the desktop window
  server.py                Flask API: load/save state, render PDF
  pdf_quote.py             ReportLab quote PDF
  paths.py                 portable data paths (next to the .exe)
  templates/index.html     single-page UI
  static/engine.js         calculation engine (ported from Excel)
  static/seed.js           default settings / warehousing / leg builder
  static/seed_lanes.json   640 transport lanes
  static/app.js            UI controller
  static/styles.css
build/
  JDT_Pricing_Model.spec   PyInstaller build spec
  build_windows.bat        local Windows build script
.github/workflows/build-exe.yml   CI that builds & uploads the EXE
tests/
```
