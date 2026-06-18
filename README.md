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
  engine), **Volume History** (12-month seasonality), Schedule, Commercial,
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
Labour cost  = total hours × loaded $/hr
Fuel/veh     = total km × vehicle $/km
Base cost    = labour + fuel/veh + tolls + overnight + loading extras
Base price   = base cost ÷ (1 − target margin)
Price inc FL = base price × (1 + fuel levy)
Margin %     = (price − cost) ÷ price
Decision     = GO (≥ target) · REVIEW (within 8 pts) · NO-GO (below)
```

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
