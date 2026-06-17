/* JDT Tender & Pricing Console — front-end controller.
 * Enterprise shell (sidebar + header + contextual panel) over the pricing
 * engine. State auto-saves to the backend (jdt_pricing_data.json beside the exe).
 */
(function () {
  "use strict";
  var E = window.JDTEngine, Seed = window.JDTSeed;
  var state = null, seedLanes = [], saveTimer = null, laneFilter = "";
  var currentView = "active-tenders";

  // ---- formatting ----------------------------------------------------------
  var fmtMoney = function (v) { return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-AU", { maximumFractionDigits: 0 }); };
  var fmtMoney2 = function (v) { return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var fmtPct = function (v) { return (v * 100).toFixed(1) + "%"; };
  var fmtNum = function (v) { return E.num(v).toLocaleString("en-AU"); };
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function statusClass(s) { return String(s || "Draft").replace(/[^A-Za-z]/g, "") || "NA"; }
  function badge(s) { return '<span class="badge bg-' + statusClass(s) + '">' + esc(s) + "</span>"; }

  // ---- persistence ---------------------------------------------------------
  function markDirty() {
    var s = el("saveState"); s.textContent = "Saving…"; s.classList.add("dirty");
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 500);
  }
  function save() {
    fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) })
      .then(function (r) { var s = el("saveState"); if (r.ok) { s.textContent = "Saved"; s.classList.remove("dirty"); } else s.textContent = "Save failed"; })
      .catch(function () { el("saveState").textContent = "Offline"; });
  }
  function load() {
    return fetch("/static/seed_lanes.json").then(function (r) { return r.json(); })
      .then(function (lanes) { seedLanes = lanes; return fetch("/api/state").then(function (r) { return r.ok ? r.json() : null; }); })
      .then(function (saved) { state = (saved && saved.settings) ? migrate(saved) : Seed.defaultState(seedLanes); })
      .catch(function () { state = Seed.defaultState(seedLanes); });
  }
  function migrate(s) {
    var base = Seed.defaultState(seedLanes);
    s.settings = Object.assign({}, base.settings, s.settings || {});
    s.warehousing = Object.assign({}, base.warehousing, s.warehousing || {});
    s.quote = Object.assign({}, base.quote, s.quote || {});
    s.legBuilder = Object.assign({}, base.legBuilder, s.legBuilder || {});
    if (!Array.isArray(s.lanes) || !s.lanes.length) s.lanes = base.lanes;
    if (!Array.isArray(s.accounts) || !s.accounts.length) s.accounts = base.accounts;
    if (!Array.isArray(s.tenders)) s.tenders = [];
    s.tenders.forEach(normalizeTender);
    if (!Array.isArray(s.carriers)) s.carriers = [];
    if (!Array.isArray(s.compliance) || !s.compliance.length) s.compliance = base.compliance;
    return s;
  }
  function snapshotModel() {
    return JSON.parse(JSON.stringify({
      settings: state.settings, warehousing: state.warehousing, lanes: state.lanes,
      accounts: state.accounts, legBuilder: state.legBuilder, quote: state.quote
    }));
  }
  function restoreModel(snap) {
    if (!snap) return;
    var base = Seed.defaultState(seedLanes);
    state.settings = Object.assign({}, base.settings, snap.settings || {});
    state.warehousing = Object.assign({}, base.warehousing, snap.warehousing || {});
    state.quote = Object.assign({}, base.quote, snap.quote || {});
    state.legBuilder = Object.assign({}, base.legBuilder, snap.legBuilder || {});
    state.lanes = Array.isArray(snap.lanes) && snap.lanes.length ? snap.lanes : base.lanes;
    state.accounts = Array.isArray(snap.accounts) && snap.accounts.length ? snap.accounts : base.accounts;
  }
  function getTender(id) { return state.tenders.find(function (t) { return t.id === id; }); }

  // Bring a saved tender up to the current rich RFQ shape.
  function normalizeTender(t) {
    if (!Array.isArray(t.bids)) t.bids = [];
    if (!Array.isArray(t.lanes)) t.lanes = [];
    if (!Array.isArray(t.volumeHistory) || !t.volumeHistory.length) t.volumeHistory = Seed.defaultVolume();
    t.contract = Object.assign({ duration: "12 months", startDate: "", accessorials: "", disputeRules: "" }, t.contract || {});
    t.schedule = Object.assign({ collectionWindows: "", deliveryTimeframes: "", weekend: "", bookingRules: "" }, t.schedule || {});
    t.commercial = Object.assign({ fuelSurcharge: "", paymentTerms: "", claims: "", minInsurance: "", serviceCredits: "" }, t.commercial || {});
    t.technology = Object.assign({ tracking: "", ediApi: "", pod: "" }, t.technology || {});
    // migrate a legacy single-route tender into one operational lane
    if ((t.origin || t.destination) && !t.lanes.length) {
      t.lanes.push(Seed.newOpLane({ collSuburb: t.origin, delSuburb: t.destination, pallets: t.volume }));
    }
    delete t.origin; delete t.destination; delete t.volume;
    t.lanes.forEach(function (l) { if (!l.id) l.id = Seed.newOpLane().id; });
  }

  // ---- navigation ----------------------------------------------------------
  function gotoView(view) {
    currentView = view;
    var navKey = view === "tender" ? "active-tenders" : view;  // keep parent highlighted on drill-down
    document.querySelectorAll(".sb-item").forEach(function (b) { b.classList.toggle("active", b.dataset.view === navKey); });
    document.querySelectorAll(".view").forEach(function (p) { p.classList.remove("active"); });
    var panel = el("view-" + view); if (panel) panel.classList.add("active");
    el("views").scrollTop = 0;
    renderActive(view);
  }
  function setupNav() {
    el("sbNav").addEventListener("click", function (e) {
      var b = e.target.closest(".sb-item"); if (b) gotoView(b.dataset.view);
    });
    el("sbCollapse").addEventListener("click", function () { document.body.classList.toggle("sb-collapsed"); });
  }
  function renderActive(view) {
    switch (view) {
      case "active-tenders": renderActiveTenders(); break;
      case "tender": renderTender(); break;
      case "bid-analysis": renderBidAnalysis(); break;
      case "settings": renderSettings(); break;
      case "lanes": renderLanes(); break;
      case "warehousing": renderWarehousing(); break;
      case "legbuilder": renderLegBuilder(); break;
      case "summary": renderSummary(); break;
      case "quote": renderQuote(); break;
      case "carrier-network": renderCarriers(); break;
      case "compliance": renderCompliance(); break;
      case "reports": renderReports(); break;
    }
  }

  // ---- theme ---------------------------------------------------------------
  var THEME_KEY = "jdt-theme";
  function sysTheme() { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  function pref() { return localStorage.getItem(THEME_KEY) || "auto"; }
  function applyTheme() {
    var p = pref();
    document.documentElement.setAttribute("data-theme", p === "auto" ? sysTheme() : p);
  }
  function setupTheme() {
    applyTheme();
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (pref() === "auto") applyTheme(); });
    } catch (e) { /* older webview */ }
    el("themeToggle").addEventListener("click", function () {
      var order = ["auto", "light", "dark"], p = pref();
      var next = order[(order.indexOf(p) + 1) % order.length];
      localStorage.setItem(THEME_KEY, next); applyTheme();
      toast("Theme: " + (next === "auto" ? "Follow system" : next.charAt(0).toUpperCase() + next.slice(1)));
    });
  }

  // ---- KPI strip -----------------------------------------------------------
  function pipelineKpis(p) {
    return [
      { k: "Open tenders", v: p.openCount, s: fmtMoney(p.openValue) + " pipeline" },
      { k: "Weighted value", v: fmtMoney(p.weightedValue), s: "probability-adjusted" },
      { k: "Won value", v: fmtMoney(p.wonValue), s: p.wonCount + " won", cls: "good" },
      { k: "Win rate", v: (p.winRate * 100).toFixed(0) + "%", s: p.wonCount + "W / " + p.lostCount + "L", cls: "good" },
      { k: "Due ≤14 days", v: p.dueSoon, s: "closing soon", cls: p.dueSoon ? "warn" : "" },
      { k: "Overdue", v: p.overdue, s: "past due", cls: p.overdue ? "bad" : "" }
    ];
  }
  function renderStrip(target, kpis) {
    el(target).innerHTML = kpis.map(function (c) {
      return '<div class="kpi ' + (c.cls || "") + '"><div class="k">' + c.k + '</div><div class="v">' + c.v + '</div><div class="s">' + c.s + "</div></div>";
    }).join("");
  }

  // ---- ACTIVE TENDERS grid -------------------------------------------------
  var COLS = [
    { key: "reference", label: "Reference" },
    { key: "customer", label: "Customer" },
    { key: "lanes", label: "Lanes", num: true },
    { key: "volume", label: "Pallets/wk", num: true },
    { key: "dueDate", label: "Deadline" },
    { key: "bids", label: "Bids", num: true },
    { key: "value", label: "Bid value", num: true },
    { key: "status", label: "Status" }
  ];
  var sortState = { key: "dueDate", dir: 1 };
  var tenderFilter = { status: "", q: "" };
  var expanded = {};   // id -> true
  var selectedId = null;

  // Bid value = engine-priced annual revenue when the tender has lanes,
  // otherwise the manually entered value.
  function tenderValue(t) {
    return (t.lanes && t.lanes.length) ? E.computeTender(t, state.settings).annualRev : E.num(t.value);
  }
  function tenderPallets(t) { return E.computeTender(t, state.settings).totalPalletsWk; }
  function syncTenderValue(t) {
    if (t.lanes && t.lanes.length) t.value = Math.round(E.computeTender(t, state.settings).annualRev);
  }

  function sortVal(t, key) {
    if (key === "lanes") return (t.lanes || []).length;
    if (key === "bids") return (t.bids || []).length;
    if (key === "volume") return tenderPallets(t);
    if (key === "value") return tenderValue(t);
    return (t[key] || "").toString().toLowerCase();
  }
  function visibleTenders() {
    var q = tenderFilter.q.toLowerCase();
    var rows = state.tenders.filter(function (t) {
      if (tenderFilter.status && (t.status || "Draft") !== tenderFilter.status) return false;
      if (q) {
        var hay = [t.reference, t.customer, t.title].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    rows.sort(function (a, b) {
      var av = sortVal(a, sortState.key), bv = sortVal(b, sortState.key);
      return (av < bv ? -1 : av > bv ? 1 : 0) * sortState.dir;
    });
    return rows;
  }
  function renderTenderHead() {
    var html = "<th></th>";
    COLS.forEach(function (c) {
      var arrow = sortState.key === c.key ? (sortState.dir > 0 ? "▲" : "▼") : "";
      html += '<th class="' + (c.num ? "num" : "") + '" data-sort="' + c.key + '">' + c.label + '<span class="sort">' + arrow + "</span></th>";
    });
    html += "<th></th>";
    el("tendersHead").innerHTML = html;
  }
  function tenderRow(t) {
    var due = E.tenderDueState(t), dueCls = due === "overdue" ? "due-overdue" : due === "soon" ? "due-soon" : "";
    var pallets = tenderPallets(t), val = tenderValue(t);
    var open = expanded[t.id];
    var h = '<tr data-tid="' + t.id + '" class="' + (selectedId === t.id ? "sel" : "") + (open ? " expanded" : "") + '">' +
      '<td><span class="exp" data-exp="' + t.id + '">' + (t.bids && t.bids.length ? "▸" : "") + "</span></td>" +
      "<td><b>" + (esc(t.reference) || '<span style="color:var(--text-3)">—</span>') + "</b></td>" +
      "<td>" + (esc(t.customer) || '<span style="color:var(--text-3)">—</span>') + "</td>" +
      '<td class="num">' + ((t.lanes || []).length || "—") + "</td>" +
      '<td class="num">' + (pallets ? fmtNum(Math.round(pallets)) : "—") + "</td>" +
      '<td class="' + dueCls + '">' + (esc(t.dueDate) || "—") + "</td>" +
      '<td class="num">' + ((t.bids || []).length || "—") + "</td>" +
      '<td class="num">' + (val ? fmtMoney(val) : "—") + "</td>" +
      "<td>" + badge(t.status) + "</td>" +
      '<td><div class="row-actions">' +
        '<button data-edit="' + t.id + '">Edit</button>' +
        '<button class="award" data-award="' + t.id + '">Award</button>' +
        '<button class="reject" data-reject="' + t.id + '">Reject</button>' +
      "</div></td></tr>";
    if (open && t.bids && t.bids.length) {
      var rows = t.bids.map(function (b) {
        return "<tr><td>" + esc(b.carrier || "—") + "</td><td>" + (E.num(b.amount) ? fmtMoney(b.amount) : "—") +
          "</td><td>" + esc(b.leadTime || "—") + "</td><td>" + badge(b.status) + "</td></tr>";
      }).join("");
      h += '<tr class="subrow"><td colspan="10"><div class="bids-inline"><table><thead><tr><th>Carrier</th><th>Bid amount</th><th>Lead time</th><th>Status</th></tr></thead><tbody>' + rows + "</tbody></table></div></td></tr>";
    }
    return h;
  }
  function renderTenderSeg() {
    var seg = el("tenderStatusSeg");
    var items = ["All"].concat(Seed.TENDER_STATUSES);
    seg.innerHTML = items.map(function (s) {
      var val = s === "All" ? "" : s;
      return '<button data-status="' + val + '" class="' + (tenderFilter.status === val ? "on" : "") + '">' + s + "</button>";
    }).join("");
  }
  function renderActiveTenders() {
    renderStrip("tenderStrip", pipelineKpis(E.computePipeline(state.tenders)));
    renderTenderSeg();
    renderTenderHead();
    var rows = visibleTenders();
    el("tendersBody").innerHTML = rows.length
      ? rows.map(tenderRow).join("")
      : '<tr><td colspan="10" class="empty">No tenders match. Use “Create New Tender” or “Capture model”.</td></tr>';
  }
  function bindActiveTenders() {
    el("tendersHead").addEventListener("click", function (e) {
      var th = e.target.closest("[data-sort]"); if (!th) return;
      var k = th.dataset.sort;
      if (sortState.key === k) sortState.dir *= -1; else { sortState.key = k; sortState.dir = 1; }
      renderActiveTenders();
    });
    el("tenderStatusSeg").addEventListener("click", function (e) {
      var b = e.target.closest("[data-status]"); if (!b) return;
      tenderFilter.status = b.dataset.status; renderActiveTenders();
    });
    el("tenderSearch").addEventListener("input", function () { tenderFilter.q = this.value; renderActiveTenders(); });
    el("tendersBody").addEventListener("click", function (e) {
      var exp = e.target.closest("[data-exp]");
      if (exp) { expanded[exp.dataset.exp] = !expanded[exp.dataset.exp]; renderActiveTenders(); return; }
      var edit = e.target.closest("[data-edit]");
      var award = e.target.closest("[data-award]");
      var reject = e.target.closest("[data-reject]");
      if (award) { setTenderStatus(award.dataset.award, "Won"); return; }
      if (reject) { setTenderStatus(reject.dataset.reject, "Lost"); return; }
      var tr = e.target.closest("[data-tid]"); if (!tr) return;
      openTender(edit ? edit.dataset.edit : tr.dataset.tid);
    });
    el("btnCaptureTender").addEventListener("click", function () {
      var t = Seed.newTender({ customer: state.quote.customer || "", reference: state.quote.quoteNumber || "", title: "Captured " + today() });
      captureInto(t); state.tenders.unshift(t); save(); openTender(t.id);
      toast("Captured current model as a new tender.");
    });
    el("btnNewTender").addEventListener("click", function () { openImport("new"); });
  }
  function setTenderStatus(id, status) {
    var t = getTender(id); if (!t) return;
    t.status = status; touchTender(t);
    if (currentView === "active-tenders") renderActiveTenders();
    if (currentView === "tender" && currentTenderId === id) renderTender();
    markDirty();
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function touchTender(t) { t.updatedAt = today(); }
  // Capture the current priced Lanes (flagged Quote? = Y) into the tender as
  // operational lanes, plus a snapshot of the full model.
  function captureInto(t) {
    t.snapshot = snapshotModel();
    if (!t.customer) t.customer = state.quote.customer || "";
    if (!t.reference) t.reference = state.quote.quoteNumber || "";
    var q = E.buildQuote(state);
    if (q.transport && q.transport.length) {
      t.lanes = q.transport.map(function (r, i) {
        var src = state.lanes.filter(function (l) { return String(l.quote || "").toUpperCase() === "Y"; })[i] || {};
        return Seed.newOpLane({
          collSuburb: r.origin, delSuburb: r.dest, vehicle: r.vehicle, pallets: r.spaces, freq: r.trips,
          hrs: src.hrs, km: src.km, tolls: src.tolls, overnight: src.overnight, loadExtras: src.loadExtras
        });
      });
    }
    syncTenderValue(t);
    touchTender(t);
  }

  // ---- TENDER WORKSPACE (full-page RFQ) -----------------------------------
  var currentTenderId = null, currentSection = "overview";
  var SECTIONS = ["overview", "lanes", "volume", "schedule", "commercial", "technology", "contract", "bids"];

  function openTender(id) { currentTenderId = id; currentSection = "overview"; gotoView("tender"); }

  function renderTender() {
    var t = getTender(currentTenderId); if (!t) { gotoView("active-tenders"); return; }
    el("twRef").textContent = t.reference || "TENDER";
    el("twCustomer").textContent = t.customer || "Untitled tender";
    el("twStatusBadge").innerHTML = badge(t.status);
    el("twStatus").innerHTML = Seed.TENDER_STATUSES.map(function (s) { return '<option' + (s === t.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
    el("twTabs").querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.sec === currentSection); });
    renderTenderKpis(t);
    renderSection();
  }
  function renderTenderKpis(t) {
    var c = E.computeTender(t, state.settings);
    renderStrip("twKpis", [
      { k: "Annual bid value", v: fmtMoney(c.annualRev), s: c.laneCount + " lane" + (c.laneCount === 1 ? "" : "s") },
      { k: "Weekly GP", v: fmtMoney(c.weeklyGP), s: "gross profit / wk", cls: "good" },
      { k: "Blended margin", v: fmtPct(c.margin), s: "target " + state.settings.targetMarginPct + "%", cls: "good" },
      { k: "Lanes priced", v: c.go + " / " + c.review + " / " + c.nogo, s: "GO / REVIEW / NO-GO" },
      { k: "Pallets / wk", v: fmtNum(Math.round(c.totalPalletsWk)), s: "throughput" },
      { k: "Win probability", v: E.num(t.probability) + "%", s: t.status }
    ]);
  }

  // section HTML builders ----------------------------------------------------
  // f(label, attr, value, opts) — opts: {type, area, rows, span, hint, ph}
  function f(label, attr, value, opts) {
    opts = opts || {};
    var ctrl = opts.area
      ? '<textarea ' + attr + ' rows="' + (opts.rows || 3) + '"' + (opts.ph ? ' placeholder="' + opts.ph + '"' : "") + ">" + esc(value) + "</textarea>"
      : '<input ' + attr + ' type="' + (opts.type || "text") + '" value="' + esc(value) + '"' + (opts.ph ? ' placeholder="' + opts.ph + '"' : "") + ">";
    return '<label class="f-field' + (opts.span === 2 ? " span2" : "") + '"><span class="f-label">' + label + "</span>" +
      ctrl + (opts.hint ? '<span class="f-hint">' + opts.hint + "</span>" : "") + "</label>";
  }
  function card(title, sub, body, cls) {
    return '<div class="card' + (cls ? " " + cls : "") + '"><div class="card-h">' + title + "</div>" +
      (sub ? '<div class="card-sub">' + sub + "</div>" : "") + body + "</div>";
  }
  function overviewHtml(t) {
    var details = card("Tender details", "Core RFQ identifiers and ownership.",
      '<div class="field-grid">' +
        f("Reference / RFQ #", 'data-tf="reference"', t.reference, { ph: "RFQ-2026-014" }) +
        f("Customer", 'data-tf="customer"', t.customer, { ph: "Customer name" }) +
        f("Title", 'data-tf="title"', t.title, { span: 2, ph: "Short description of the tender" }) +
        f("Owner", 'data-tf="owner"', t.owner) +
        f("Deadline", 'data-tf="dueDate"', t.dueDate, { type: "date" }) +
        f("Submitted", 'data-tf="submittedDate"', t.submittedDate, { type: "date" }) +
        f("Win probability %", 'data-tf="probability"', t.probability, { type: "number" }) +
        f("Notes", 'data-tf="notes"', t.notes, { area: true, span: 2, rows: 3, ph: "Internal notes, assumptions, exclusions…" }) +
      "</div>");
    var note = t.lanes.length ? (t.lanes.length + " lane" + (t.lanes.length === 1 ? "" : "s") + " · collection (blue) → delivery (green). Map pins need an internet connection.") : "Add operational lanes to plot the network.";
    var mapCard = card("Lane network", "", '<div id="tenderMap" class="tw-map"><div class="map-fallback">Loading map…</div></div><div class="map-note">' + note + "</div>", "map-card");
    return '<div class="tw-pane"><div class="ov-grid">' + details + mapCard + "</div></div>";
  }
  var LANE_COLS_HTML =
    '<colgroup><col style="width:80px"><col style="width:130px"><col style="width:80px"><col style="width:130px">' +
    '<col style="width:70px"><col style="width:80px"><col style="width:120px"><col style="width:64px"><col style="width:120px"><col style="width:96px">' +
    '<col style="width:72px"><col style="width:70px"><col style="width:74px">' +
    '<col style="width:88px"><col style="width:90px"><col style="width:74px"><col style="width:88px"><col style="width:100px"><col style="width:40px"></colgroup>' +
    '<thead><tr><th class="l">Coll PC</th><th class="l">Coll suburb</th><th class="l">Del PC</th><th class="l">Del suburb</th>' +
    '<th>Pallets</th><th>Weight kg</th><th class="l">Dims</th><th class="l">Stack</th><th class="l">Loading</th><th class="l">Vehicle</th>' +
    '<th>Freq/wk</th><th>Hrs</th><th>Km</th><th>Cost/trip</th><th>Rate+FL</th><th>Margin</th><th>Decision</th><th>Annual $</th><th></th></tr></thead>';
  function opLaneRowHtml(l, s) {
    var r = E.priceOpLane(l, s);
    function inp(f) { return '<input data-ln="' + l.id + '" data-lf="' + f + '" value="' + esc(l[f]) + '" inputmode="decimal">'; }
    function txt(f) { return '<input class="txt" data-ln="' + l.id + '" data-lf="' + f + '" value="' + esc(l[f]) + '">'; }
    function sel(f, opts) { return '<select data-ln="' + l.id + '" data-lf="' + f + '">' + opts.map(function (o) { return '<option' + (o === l[f] ? " selected" : "") + ">" + o + "</option>"; }).join("") + "</select>"; }
    return '<tr class="row-' + (r.decision || "none") + '" data-lrow="' + l.id + '">' +
      '<td class="txt">' + txt("collPostcode") + '</td><td class="txt">' + txt("collSuburb") + '</td>' +
      '<td class="txt">' + txt("delPostcode") + '</td><td class="txt">' + txt("delSuburb") + '</td>' +
      "<td>" + inp("pallets") + "</td><td>" + inp("weightKg") + '</td><td class="txt">' + txt("dims") + "</td>" +
      '<td class="txt">' + sel("stackable", ["Y", "N"]) + '</td><td class="txt">' + sel("loadingType", Seed.LOADING_TYPES) + '</td><td class="txt">' + sel("vehicle", Seed.VEHICLES) + "</td>" +
      "<td>" + inp("freq") + "</td><td>" + inp("hrs") + "</td><td>" + inp("km") + "</td>" +
      '<td class="calc">' + fmtMoney2(r.cost) + '</td><td class="calc">' + fmtMoney2(r.priceFL) + "</td>" +
      '<td class="calc">' + (r.decision ? fmtPct(r.margin) : "—") + "</td>" +
      '<td class="calc cell-dec dec-' + (r.decision || "") + '">' + (r.decision || "—") + "</td>" +
      '<td class="calc">' + fmtMoney(r.annualRev) + "</td>" +
      '<td><button class="rowdel" data-lanedel="' + l.id + '" title="Delete lane">×</button></td></tr>';
  }
  function lanesHtml(t, s) {
    var rows = (t.lanes || []).map(function (l) { return opLaneRowHtml(l, s); }).join("");
    var n = (t.lanes || []).length;
    return '<div class="tw-toolbar"><button class="btn btn-primary" data-addlane>+ Add lane</button>' +
      '<button class="btn" data-import><svg viewBox="0 0 24 24" class="ico"><path d="M12 15V3m0 12l-4-4m4 4l4-4M5 17v3h14v-3"/></svg> Import from Excel</button>' +
      '<span class="tw-count">' + n + " lane" + (n === 1 ? "" : "s") + " · priced by the cost engine</span></div>" +
      '<div class="grid-wrap"><table class="pgrid" id="tenderLanes">' + LANE_COLS_HTML + "<tbody>" +
      (rows || '<tr><td colspan="19" class="empty">No lanes yet. Add one or import from Excel.</td></tr>') +
      "</tbody></table></div>";
  }
  function recalcOpLaneRow(t, l) {
    var tr = el("tenderLanes") && el("tenderLanes").querySelector('tr[data-lrow="' + l.id + '"]'); if (!tr) return;
    var r = E.priceOpLane(l, state.settings), c = tr.querySelectorAll("td.calc");
    c[0].textContent = fmtMoney2(r.cost); c[1].textContent = fmtMoney2(r.priceFL);
    c[2].textContent = r.decision ? fmtPct(r.margin) : "—";
    c[3].textContent = r.decision || "—"; c[3].className = "calc cell-dec dec-" + (r.decision || "");
    c[4].textContent = fmtMoney(r.annualRev); tr.className = "row-" + (r.decision || "none");
  }
  function volStats(t) {
    var ship = t.volumeHistory.map(function (v) { return E.num(v.shipments); });
    var totS = ship.reduce(function (a, x) { return a + x; }, 0);
    var totP = t.volumeHistory.reduce(function (a, v) { return a + E.num(v.pallets); }, 0);
    return { totS: totS, totP: totP, avg: totS / 12, peak: Math.max.apply(null, ship.concat(0)) };
  }
  function volBarsHtml(t) {
    var max = Math.max(1, Math.max.apply(null, t.volumeHistory.map(function (v) { return E.num(v.shipments); })));
    return t.volumeHistory.map(function (v) {
      var h = E.num(v.shipments) / max * 170;
      return '<div class="vol-col"><div class="vol-bar" style="height:' + Math.max(2, h).toFixed(0) + 'px" title="' + v.month + ": " + E.num(v.shipments) + ' shipments"></div><div class="vol-m">' + v.month + "</div></div>";
    }).join("");
  }
  function volTotalsHtml(t) {
    var s = volStats(t);
    return '<div class="card-foot"><span class="cf">Total shipments<b id="volTotS">' + fmtNum(s.totS) + '</b></span>' +
      '<span class="cf">Total pallets<b id="volTotP">' + fmtNum(s.totP) + '</b></span>' +
      '<span class="cf">Monthly avg<b id="volAvg">' + fmtNum(Math.round(s.avg)) + '</b></span>' +
      '<span class="cf">Peak month<b id="volPeak">' + fmtNum(s.peak) + "</b></span></div>";
  }
  function volumeHtml(t) {
    var rows = t.volumeHistory.map(function (v, i) {
      return '<tr><td class="txt" style="padding:0 12px">' + v.month + "</td>" +
        '<td><input data-vol="' + i + '" data-vf="shipments" value="' + esc(v.shipments) + '" inputmode="decimal"></td>' +
        '<td><input data-vol="' + i + '" data-vf="pallets" value="' + esc(v.pallets) + '" inputmode="decimal"></td></tr>';
    }).join("");
    var bars = card("Monthly shipments", "12-month seasonality — taller bars are busier months.",
      '<div class="vol-grid" id="volBars">' + volBarsHtml(t) + "</div>" + volTotalsHtml(t));
    var table = card("Volumes by month", "",
      '<div class="grid-wrap"><table class="pgrid" id="volTable"><colgroup><col style="width:120px"><col><col></colgroup>' +
      '<thead><tr><th class="l">Month</th><th>Shipments</th><th>Pallets</th></tr></thead><tbody>' + rows + "</tbody></table></div>");
    return '<div class="tw-pane"><div class="vol-layout">' + bars + table + "</div></div>";
  }
  function renderVolBars(t) {
    if (el("volBars")) el("volBars").innerHTML = volBarsHtml(t);
    var s = volStats(t);
    if (el("volTotS")) el("volTotS").textContent = fmtNum(s.totS);
    if (el("volTotP")) el("volTotP").textContent = fmtNum(s.totP);
    if (el("volAvg")) el("volAvg").textContent = fmtNum(Math.round(s.avg));
    if (el("volPeak")) el("volPeak").textContent = fmtNum(s.peak);
  }
  // sectionForm(title, sub, sec, fields) — fields: [label, key, value, opts]
  function sectionForm(title, sub, sec, fields) {
    var body = '<div class="field-grid">' +
      fields.map(function (fd) { return f(fd[0], 'data-ts="' + sec + "." + fd[1] + '"', fd[2], fd[3] || {}); }).join("") + "</div>";
    return '<div class="tw-pane">' + card(title, sub, body) + "</div>";
  }
  function bidRowHtml(b) {
    var opts = Seed.BID_STATUSES.map(function (s) { return '<option' + (s === b.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
    return '<div class="bidrow" data-bid="' + b.id + '">' +
      '<input class="bcar" data-bf="carrier" placeholder="Carrier name" value="' + esc(b.carrier) + '">' +
      '<input class="bamt" data-bf="amount" type="number" placeholder="Amount $" value="' + esc(b.amount) + '">' +
      '<select data-bf="status">' + opts + "</select>" +
      '<button class="btn btn-sm" data-bidaward="1" title="Award this bid — marks tender Won">✓</button>' +
      '<button class="btn btn-sm" data-bidremove="1" title="Remove">✕</button></div>';
  }
  function bidsHtml(t) {
    var bids = (t.bids || []).map(bidRowHtml).join("");
    var head = (t.bids && t.bids.length) ? '<div class="bid-head"><span>Carrier</span><span>Bid amount</span><span>Status</span><span></span></div>' : "";
    return '<div class="tw-pane tw-pane-narrow">' + card("Competing carrier bids",
      "Record rival carrier quotes. Awarding a bid marks the tender Won.",
      head + '<div class="bidlist">' + (bids || '<div style="color:var(--text-3);font-size:12.5px">No bids recorded yet.</div>') +
      '</div><button class="btn btn-sm" data-addbid style="margin-top:12px">+ Add bid</button>') + "</div>";
  }
  function renderSection() {
    var t = getTender(currentTenderId); if (!t) { gotoView("active-tenders"); return; }
    var sec = currentSection, body = el("twBody");
    if (sec === "overview") { body.innerHTML = overviewHtml(t); renderTenderMap(t); }
    else if (sec === "lanes") body.innerHTML = lanesHtml(t, state.settings);
    else if (sec === "volume") body.innerHTML = volumeHtml(t);
    else if (sec === "schedule") body.innerHTML = sectionForm("Scheduling", "Collection and delivery requirements.", "schedule", [
      ["Collection windows", "collectionWindows", t.schedule.collectionWindows, { ph: "e.g. Mon–Fri 06:00–14:00" }],
      ["Delivery timeframes", "deliveryTimeframes", t.schedule.deliveryTimeframes, { ph: "e.g. Next day by 12:00" }],
      ["Weekend / out-of-hours", "weekend", t.schedule.weekend, { ph: "e.g. Saturday AM on request" }],
      ["Booking rules", "bookingRules", t.schedule.bookingRules, { area: true, span: 2, ph: "Lead times, slot booking, portals…" }]]);
    else if (sec === "commercial") body.innerHTML = sectionForm("Commercial terms", "Pricing, payment and risk terms.", "commercial", [
      ["Fuel surcharge method", "fuelSurcharge", t.commercial.fuelSurcharge, { ph: "e.g. Monthly, indexed to diesel" }],
      ["Payment terms", "paymentTerms", t.commercial.paymentTerms, { ph: "e.g. 30 days EOM" }],
      ["Minimum insurance", "minInsurance", t.commercial.minInsurance, { ph: "e.g. $5M public liability" }],
      ["Service credits / penalties", "serviceCredits", t.commercial.serviceCredits, { ph: "e.g. 2% per late %" }],
      ["Claims process", "claims", t.commercial.claims, { area: true, span: 2, ph: "Notification windows, liability caps…" }]]);
    else if (sec === "technology") body.innerHTML = sectionForm("Technology requirements", "Visibility and integration expectations.", "technology", [
      ["Tracking / visibility", "tracking", t.technology.tracking, { ph: "e.g. Live GPS, milestone events" }],
      ["EDI / API integration", "ediApi", t.technology.ediApi, { ph: "e.g. EDI 214, REST API" }],
      ["Proof-of-delivery (POD)", "pod", t.technology.pod, { area: true, span: 2, ph: "Digital POD, signature/photo, SLA…" }]]);
    else if (sec === "contract") body.innerHTML = sectionForm("Contract expectations", "Term, accessorials and governance.", "contract", [
      ["Duration", "duration", t.contract.duration, { ph: "e.g. 12 months" }],
      ["Start date", "startDate", t.contract.startDate, { type: "date" }],
      ["Accessorial charges", "accessorials", t.contract.accessorials, { area: true, span: 2, ph: "Waiting time, tail-lift, futile delivery, redelivery…" }],
      ["Dispute rules", "disputeRules", t.contract.disputeRules, { area: true, span: 2, ph: "Escalation, governing law, mediation…" }]]);
    else if (sec === "bids") body.innerHTML = bidsHtml(t);
  }
  function bindTenderWorkspace() {
    el("twBack").addEventListener("click", function () { gotoView("active-tenders"); });
    el("twDelete").addEventListener("click", function () {
      var t = getTender(currentTenderId); if (!t) return;
      if (!confirm("Delete this tender? This cannot be undone.")) return;
      state.tenders = state.tenders.filter(function (x) { return x.id !== t.id; });
      markDirty(); gotoView("active-tenders");
    });
    el("twStatus").addEventListener("change", function () {
      var t = getTender(currentTenderId); if (!t) return;
      t.status = this.value; touchTender(t); renderTender(); markDirty();
    });
    el("twTabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-sec]"); if (!b) return;
      currentSection = b.dataset.sec;
      el("twTabs").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
      renderSection();
    });
    var body = el("twBody");
    function onEdit(e) {
      var t = getTender(currentTenderId); if (!t) return; var x = e.target;
      if (x.dataset.tf != null) { t[x.dataset.tf] = x.value; touchTender(t); markDirty(); }
      else if (x.dataset.ts != null) { var p = x.dataset.ts.split("."); t[p[0]] = t[p[0]] || {}; t[p[0]][p[1]] = x.value; touchTender(t); markDirty(); }
      else if (x.dataset.ln != null) {
        var l = t.lanes.find(function (y) { return y.id === x.dataset.ln; });
        if (l) { l[x.dataset.lf] = x.value; recalcOpLaneRow(t, l); syncTenderValue(t); renderTenderKpis(t); markDirty(); }
      } else if (x.dataset.vol != null) {
        var v = t.volumeHistory[x.dataset.vol]; if (v) { v[x.dataset.vf] = x.value; renderVolBars(t); markDirty(); }
      } else if (x.dataset.bf != null) {
        var row = x.closest("[data-bid]"); var b = t.bids.find(function (y) { return y.id === row.dataset.bid; });
        if (b) { b[x.dataset.bf] = x.value; markDirty(); }
      }
    }
    body.addEventListener("input", onEdit);
    body.addEventListener("change", onEdit);
    body.addEventListener("click", function (e) {
      var t = getTender(currentTenderId); if (!t) return;
      if (e.target.closest("[data-addlane]")) { t.lanes.push(Seed.newOpLane({})); syncTenderValue(t); touchTender(t); renderSection(); renderTenderKpis(t); markDirty(); return; }
      if (e.target.closest("[data-import]")) { openImport(); return; }
      var ld = e.target.closest("[data-lanedel]");
      if (ld) { t.lanes = t.lanes.filter(function (y) { return y.id !== ld.dataset.lanedel; }); syncTenderValue(t); renderSection(); renderTenderKpis(t); markDirty(); return; }
      if (e.target.closest("[data-addbid]")) { t.bids.push(Seed.newBid({})); renderSection(); markDirty(); return; }
      var row = e.target.closest("[data-bid]");
      if (row) {
        var b = t.bids.find(function (y) { return y.id === row.dataset.bid; }); if (!b) return;
        if (e.target.closest("[data-bidremove]")) { t.bids = t.bids.filter(function (y) { return y.id !== b.id; }); renderSection(); markDirty(); }
        else if (e.target.closest("[data-bidaward]")) {
          t.bids.forEach(function (y) { y.status = y.id === b.id ? "Awarded" : (y.status === "Awarded" ? "Pending" : y.status); });
          t.status = "Won"; touchTender(t); renderTender(); markDirty(); toast("Bid awarded — tender marked Won.");
        }
      }
    });
  }

  // ---- route map (Leaflet via CDN, geocode via Nominatim) -----------------
  var leafletPromise = null, geoCache = {};
  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      var css = document.createElement("link"); css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
      var s = document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      s.onload = function () { resolve(window.L); }; s.onerror = reject;
      document.head.appendChild(s);
      setTimeout(function () { if (!window.L) reject(new Error("timeout")); }, 6000);
    });
    return leafletPromise;
  }
  function geocode(q) {
    if (!q) return Promise.resolve(null);
    if (geoCache[q] !== undefined) return Promise.resolve(geoCache[q]);
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=" + encodeURIComponent(q);
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); })
      .then(function (j) { var hit = j && j[0] ? [parseFloat(j[0].lat), parseFloat(j[0].lon)] : null; geoCache[q] = hit; return hit; })
      .catch(function () { return null; });
  }
  function renderTenderMap(t) {
    var holder = el("tenderMap"); if (!holder) return;
    var lanes = (t.lanes || []).filter(function (l) { return (l.collPostcode || l.collSuburb) || (l.delPostcode || l.delSuburb); }).slice(0, 12);
    if (!lanes.length) { holder.innerHTML = '<div class="map-fallback">Add lanes with postcodes or suburbs to map the network.</div>'; return; }
    holder.innerHTML = '<div class="map-fallback">Loading map…</div>';
    ensureLeaflet().then(function (L) {
      var jobs = [];
      lanes.forEach(function (l) {
        jobs.push(geocode(l.collPostcode || l.collSuburb));
        jobs.push(geocode(l.delPostcode || l.delSuburb));
      });
      return Promise.all(jobs).then(function (pts) {
        if (currentTenderId !== t.id || currentSection !== "overview") return;
        holder.innerHTML = "";
        var map = L.map(holder, { attributionControl: false }).setView([-25, 134], 4);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
        var all = [];
        for (var i = 0; i < lanes.length; i++) {
          var a = pts[i * 2], b = pts[i * 2 + 1];
          if (a) { L.circleMarker(a, { radius: 5, color: "#1BA3DD", fillOpacity: .9 }).addTo(map); all.push(a); }
          if (b) { L.circleMarker(b, { radius: 5, color: "#059669", fillOpacity: .9 }).addTo(map); all.push(b); }
          if (a && b) L.polyline([a, b], { color: "#1BA3DD", weight: 2, opacity: .55 }).addTo(map);
        }
        if (all.length) map.fitBounds(all, { padding: [30, 30], maxZoom: 11 });
        else holder.innerHTML = '<div class="map-fallback">Couldn\'t locate those places.</div>';
        setTimeout(function () { map.invalidateSize(); }, 60);
      });
    }).catch(function () { holder.innerHTML = '<div class="map-fallback">Map needs an internet connection — unavailable offline.</div>'; });
  }

  // ---- EXCEL IMPORT (flexible column mapping) ------------------------------
  var importData = null;  // { sheets:[{name,headers,rows}] }
  // keys are ordered most-specific first; matched as case-insensitive substrings
  var IMPORT_FIELDS = [
    ["collPostcode", "Collection postcode", ["collection postcode", "coll postcode", "coll pc", "origin postcode", "pickup postcode", "from postcode"]],
    ["collSuburb", "Collection suburb/town", ["collection suburb", "coll suburb", "collection town", "origin suburb", "pickup suburb", "pickup town"]],
    ["delPostcode", "Delivery postcode", ["delivery postcode", "del postcode", "del pc", "destination postcode", "drop postcode", "to postcode"]],
    ["delSuburb", "Delivery suburb/town", ["delivery suburb", "del suburb", "delivery town", "destination suburb", "drop suburb"]],
    ["pallets", "Pallets", ["pallet", "spaces", "units", "qty"]],
    ["weightKg", "Weight (kg)", ["weight", "mass"]],
    ["dims", "Dimensions", ["dimension", "dims", "lxwxh", "size"]],
    ["stackable", "Stackable", ["stackable", "stack"]],
    ["loadingType", "Loading type", ["loading", "load type", "handling"]],
    ["vehicle", "Vehicle", ["vehicle", "truck", "equipment"]],
    ["freq", "Frequency / week", ["frequency", "per week", "/wk", "freq", "trips", "loads"]],
    ["hrs", "Hours / trip", ["hours", "hrs", "time per"]],
    ["km", "Km / trip", ["km", "kms", "distance"]]
  ];
  // Try each key across all not-yet-used columns (specific keys first).
  function guessColumn(headers, keys, used) {
    for (var k = 0; k < keys.length; k++) {
      for (var i = 0; i < headers.length; i++) {
        if (used[i]) continue;
        if (String(headers[i]).toLowerCase().indexOf(keys[k]) >= 0) return i;
      }
    }
    return -1;
  }
  // mode "new"  -> Create New Tender (chooser, then build a tender from Excel)
  // mode "lanes" -> add lanes to the open tender (from the workspace)
  var importMode = "lanes";
  function showImportStep(step) {  // "choose" | "file" | "map"
    el("importChoose").hidden = step !== "choose";
    el("importStep1").hidden = step !== "file";
    el("importStep2").hidden = step !== "map";
    el("importDetails").hidden = !(step === "map" && importMode === "new");
    el("importBack").hidden = !(step === "file" && importMode === "new") && step !== "map";
    el("importDo").hidden = step !== "map";
  }
  function openImport(mode) {
    importMode = mode || "lanes";
    importData = null;
    el("importModal").hidden = false;
    el("importTitle").textContent = importMode === "new" ? "Create a tender" : "Import lanes from Excel";
    el("importDo").textContent = importMode === "new" ? "Create tender" : "Import lanes";
    el("importFile").value = ""; el("importStatus").textContent = "";
    ["impCustomer", "impReference", "impTitle", "impDue", "impOwner"].forEach(function (id) { el(id).value = ""; });
    showImportStep(importMode === "new" ? "choose" : "file");
  }
  function closeImport() { el("importModal").hidden = true; }
  function renderImportMapping() {
    var sheet = importData.sheets[parseInt(el("importSheet").value, 10)] || importData.sheets[0];
    el("importRowInfo").textContent = "(" + sheet.rowCount + " data rows)";
    var used = {};
    el("importMap").innerHTML = IMPORT_FIELDS.map(function (f) {
      var guess = guessColumn(sheet.headers, f[2], used);
      if (guess >= 0) used[guess] = true;
      var opts = '<option value="-1"' + (guess < 0 ? " selected" : "") + ">—</option>" +
        sheet.headers.map(function (h, i) { return '<option value="' + i + '"' + (i === guess ? " selected" : "") + ">" + esc(h) + "</option>"; }).join("");
      return '<label>' + f[1] + '<select data-imp="' + f[0] + '">' + opts + "</select></label>";
    }).join("");
  }
  // Build operational lanes from the mapped sheet; returns the lane array.
  function lanesFromMapping() {
    var sheet = importData.sheets[parseInt(el("importSheet").value, 10)];
    var map = {};
    el("importMap").querySelectorAll("[data-imp]").forEach(function (sel) { map[sel.dataset.imp] = parseInt(sel.value, 10); });
    var lanes = [];
    sheet.rows.forEach(function (row) {
      var seed = {};
      IMPORT_FIELDS.forEach(function (f) { var ci = map[f[0]]; if (ci >= 0) seed[f[0]] = row[ci]; });
      if (seed.stackable != null) { var sv = String(seed.stackable).toLowerCase(); seed.stackable = (sv.indexOf("n") === 0 || sv === "false" || sv === "0") ? "N" : "Y"; }
      if (Object.keys(seed).some(function (k) { return String(seed[k]).trim() !== ""; })) lanes.push(Seed.newOpLane(seed));
    });
    return lanes;
  }
  function bindImport() {
    el("importClose").addEventListener("click", closeImport);
    el("importTemplate").addEventListener("click", function () { doExport("import-template"); });
    el("importModal").addEventListener("click", function (e) { if (e.target === el("importModal")) closeImport(); });
    el("chooseBlank").addEventListener("click", function () {
      var t = Seed.newTender({ customer: state.quote.customer || "", reference: state.quote.quoteNumber || "" });
      state.tenders.unshift(t); markDirty(); closeImport(); openTender(t.id);
    });
    el("chooseImport").addEventListener("click", function () { showImportStep("file"); });
    el("importBack").addEventListener("click", function () {
      if (!el("importStep2").hidden) showImportStep("file");
      else if (importMode === "new") showImportStep("choose");
    });
    el("importFile").addEventListener("change", function () {
      var file = this.files[0]; if (!file) return;
      el("importStatus").textContent = "Reading " + file.name + "…";
      var fd = new FormData(); fd.append("file", file);
      fetch("/api/import/excel", { method: "POST", body: fd }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) { el("importStatus").textContent = res.error || "Could not read the file."; return; }
          importData = res;
          el("importSheet").innerHTML = res.sheets.map(function (s, i) { return '<option value="' + i + '">' + esc(s.name) + " (" + s.rowCount + " rows)</option>"; }).join("");
          renderImportMapping();
          showImportStep("map");
        }).catch(function (e) { el("importStatus").textContent = "Import failed: " + e; });
    });
    el("importSheet").addEventListener("change", renderImportMapping);
    el("importDo").addEventListener("click", function () {
      if (!importData) return;
      var lanes = lanesFromMapping();
      if (importMode === "new") {
        var t = Seed.newTender({
          customer: el("impCustomer").value, reference: el("impReference").value, title: el("impTitle").value,
          dueDate: el("impDue").value, owner: el("impOwner").value || undefined
        });
        t.lanes = lanes; syncTenderValue(t); touchTender(t);
        state.tenders.unshift(t); save(); closeImport(); openTender(t.id);
        toast("Created tender with " + lanes.length + " lane" + (lanes.length === 1 ? "" : "s") + ".");
      } else {
        var cur = getTender(currentTenderId); if (!cur) return;
        lanes.forEach(function (l) { cur.lanes.push(l); });
        syncTenderValue(cur); touchTender(cur); save();
        closeImport(); currentSection = "lanes"; renderTender();
        toast("Imported " + lanes.length + " lane" + (lanes.length === 1 ? "" : "s") + ".");
      }
    });
  }

  // ---- BID ANALYSIS --------------------------------------------------------
  function renderBidAnalysis() {
    var p = E.computePipeline(state.tenders);
    renderStrip("bidStrip", pipelineKpis(p));
    var maxCount = Math.max(1, Math.max.apply(null, Seed.TENDER_STATUSES.map(function (s) { return p.byStatus[s] || 0; })));
    el("statusBars").innerHTML = Seed.TENDER_STATUSES.map(function (s) {
      var n = p.byStatus[s] || 0;
      return barRow(s, n, n / maxCount, s);
    }).join("");
    // value by status
    var valByStatus = {};
    state.tenders.forEach(function (t) { valByStatus[t.status] = (valByStatus[t.status] || 0) + E.num(t.value); });
    var maxVal = Math.max(1, Math.max.apply(null, Seed.TENDER_STATUSES.map(function (s) { return valByStatus[s] || 0; })));
    el("valueBars").innerHTML = Seed.TENDER_STATUSES.map(function (s) {
      var v = valByStatus[s] || 0; return barRow(s, fmtMoney(v), v / maxVal, s);
    }).join("");
    var sm = E.computeSummary(state).combined;
    el("bidPortfolio").innerHTML = [
      ["Weekly revenue", fmtMoney(sm.weekRev)], ["Weekly GP", fmtMoney(sm.weekGP)],
      ["Blended margin", fmtPct(sm.margin)], ["Annual revenue", fmtMoney(sm.annualRev)],
      ["Annual GP", fmtMoney(sm.annualGP)]
    ].map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("");
  }
  function barRow(label, valText, frac, statusForColor) {
    var color = statusForColor ? "var(--st-" + statusClass(statusForColor).toLowerCase() + ")" : "var(--primary)";
    return '<div class="bar-row"><span class="lbl">' + esc(label) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + Math.max(2, frac * 100).toFixed(0) + '%;background:' + color + '"></span></span>' +
      '<span class="val">' + valText + "</span></div>";
  }

  // ---- CARRIER NETWORK -----------------------------------------------------
  function carrierRow(c, i) {
    var opts = Seed.COMPLIANCE_STATUSES.map(function (s) { return '<option' + (s === c.compliance ? " selected" : "") + ">" + s + "</option>"; }).join("");
    function inp(f, w) { return '<input data-car="' + i + '" data-f="' + f + '" value="' + esc(c[f]) + '"' + (w ? ' class="' + w + '"' : "") + ">"; }
    return "<tr>" +
      '<td class="txt"><input class="txt" data-car="' + i + '" data-f="name" value="' + esc(c.name) + '"></td>' +
      '<td class="txt">' + inp("base", "txt") + "</td>" +
      '<td class="txt">' + inp("fleet", "txt") + "</td>" +
      '<td class="txt">' + inp("lanes", "txt") + "</td>" +
      "<td>" + '<input data-car="' + i + '" data-f="rating" type="number" value="' + esc(c.rating) + '">' + "</td>" +
      '<td class="txt"><select data-car="' + i + '" data-f="compliance">' + opts + "</select></td>" +
      '<td class="txt">' + inp("contact", "txt") + "</td>" +
      '<td><button class="rowdel" data-cardel="' + i + '">×</button></td></tr>';
  }
  function renderCarriers() {
    var has = state.carriers.length;
    el("carrierTable").parentElement.style.display = has ? "" : "none";
    el("carrierEmpty").hidden = !!has;
    el("carrierBody").innerHTML = state.carriers.map(carrierRow).join("");
  }
  function bindCarriers() {
    function add() { state.carriers.push(Seed.newCarrier({})); renderCarriers(); markDirty(); }
    el("btnAddCarrier").addEventListener("click", add);
    el("btnAddCarrier2").addEventListener("click", add);
    el("carrierBody").addEventListener("input", function (e) {
      var i = e.target.dataset.car; if (i == null) return;
      state.carriers[i][e.target.dataset.f] = e.target.value; markDirty();
    });
    el("carrierBody").addEventListener("click", function (e) {
      var d = e.target.closest("[data-cardel]"); if (!d) return;
      state.carriers.splice(parseInt(d.dataset.cardel, 10), 1); renderCarriers(); markDirty();
    });
  }

  // ---- COMPLIANCE ----------------------------------------------------------
  function renderCompliance() {
    var items = state.compliance, n = items.length;
    var counts = { Compliant: 0, Due: 0, Overdue: 0, "N/A": 0 };
    items.forEach(function (x) { counts[x.status] = (counts[x.status] || 0) + 1; });
    var scored = n - (counts["N/A"] || 0);
    renderStrip("complianceStrip", [
      { k: "Obligations", v: n, s: "tracked" },
      { k: "Compliant", v: counts.Compliant, s: scored ? Math.round(counts.Compliant / scored * 100) + "% of scored" : "—", cls: "good" },
      { k: "Due", v: counts.Due, s: "review needed", cls: counts.Due ? "warn" : "" },
      { k: "Overdue", v: counts.Overdue, s: "action required", cls: counts.Overdue ? "bad" : "" }
    ]);
    el("complianceBody").innerHTML = items.map(function (x, i) {
      var opts = Seed.COMPLIANCE_STATUSES.map(function (s) { return '<option' + (s === x.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
      return "<tr>" +
        '<td class="txt"><input class="txt" style="width:280px" data-cm="' + i + '" data-f="item" value="' + esc(x.item) + '"></td>' +
        '<td class="txt"><input class="txt" data-cm="' + i + '" data-f="owner" value="' + esc(x.owner) + '"></td>' +
        '<td class="txt"><select data-cm="' + i + '" data-f="status">' + opts + "</select></td>" +
        '<td><input data-cm="' + i + '" data-f="due" type="date" value="' + esc(x.due) + '" style="width:140px"></td>' +
        '<td class="txt"><input class="txt" style="width:200px" data-cm="' + i + '" data-f="notes" value="' + esc(x.notes) + '"></td>' +
        '<td><button class="rowdel" data-cmdel="' + i + '">×</button></td></tr>';
    }).join("");
  }
  function bindCompliance() {
    el("btnAddCompliance").addEventListener("click", function () { state.compliance.push(Seed.newComplianceItem({})); renderCompliance(); markDirty(); });
    el("complianceBody").addEventListener("input", function (e) {
      var i = e.target.dataset.cm; if (i == null) return;
      state.compliance[i][e.target.dataset.f] = e.target.value;
      if (e.target.dataset.f === "status") renderCompliance();
      markDirty();
    });
    el("complianceBody").addEventListener("click", function (e) {
      var d = e.target.closest("[data-cmdel]"); if (!d) return;
      state.compliance.splice(parseInt(d.dataset.cmdel, 10), 1); renderCompliance(); markDirty();
    });
  }

  // ---- REPORTS -------------------------------------------------------------
  var REPORTS = [
    { id: "quote-pdf", tag: "PDF", title: "Customer Quote", desc: "Branded quotation PDF of items flagged Quote? = Y." },
    { id: "excel-full", tag: "Excel", title: "Full Model", desc: "Settings, Lanes, Warehousing, Summary & Tenders." },
    { id: "data-pdf", tag: "PDF", title: "Working Data", desc: "Priced lanes and warehousing accounts." },
    { id: "quote-excel", tag: "Excel", title: "Quote Spreadsheet", desc: "The customer quote as an .xlsx." },
    { id: "tenders-excel", tag: "Excel", title: "Tender Register", desc: "All tenders plus pipeline totals." },
    { id: "tenders-pdf", tag: "PDF", title: "Tender Register", desc: "Printable register with pipeline summary." },
    { id: "import-template", tag: "Template", title: "Tender Import Template", desc: "Blank Excel template for importing tender lanes." }
  ];
  function renderReports() {
    el("reportGrid").innerHTML = REPORTS.map(function (r) {
      return '<div class="report-card" data-report="' + r.id + '">' +
        '<div class="rc-ico"><svg viewBox="0 0 24 24" class="ico"><path d="M7 3h7l5 5v13H7zM14 3v5h5"/></svg></div>' +
        '<span class="tag">' + r.tag + "</span><h3>" + r.title + "</h3><p>" + r.desc + "</p></div>";
    }).join("");
  }
  function bindReports() {
    el("reportGrid").addEventListener("click", function (e) {
      var c = e.target.closest("[data-report]"); if (!c) return;
      if (c.dataset.report === "quote-pdf") generatePdf(); else doExport(c.dataset.report);
    });
  }

  // ---- COMMAND PALETTE -----------------------------------------------------
  var NAV = [
    ["active-tenders", "Active Tenders"], ["bid-analysis", "Bid Analysis"], ["settings", "Settings"],
    ["lanes", "Lanes"], ["warehousing", "Warehousing"], ["legbuilder", "Leg Builder"], ["quote", "Quote"],
    ["summary", "Portfolio"], ["carrier-network", "Carrier Network"], ["compliance", "Compliance"], ["reports", "Reports"]
  ];
  var cmdkItems = [], cmdkActive = 0;
  function buildCmdk(q) {
    q = (q || "").toLowerCase();
    var items = [];
    NAV.forEach(function (n) { if (!q || n[1].toLowerCase().indexOf(q) >= 0) items.push({ group: "Navigate", label: n[1], run: function () { gotoView(n[0]); } }); });
    state.tenders.forEach(function (t) {
      var label = (t.reference || t.customer || "Tender");
      if (!q || (t.reference + " " + t.customer + " " + (t.title || "")).toLowerCase().indexOf(q) >= 0)
        items.push({ group: "Tenders", label: label, meta: t.customer || "", run: function () { openTender(t.id); } });
    });
    [["Create new tender", function () { el("btnNewTender").click(); }],
     ["Export full model → Excel", function () { doExport("excel-full"); }],
     ["Export tender register → PDF", function () { doExport("tenders-pdf"); }],
     ["Generate quote PDF", function () { generatePdf(); }]
    ].forEach(function (a) { if (!q || a[0].toLowerCase().indexOf(q) >= 0) items.push({ group: "Actions", label: a[0], run: a[1] }); });
    return items.slice(0, 40);
  }
  function renderCmdk() {
    var lastGroup = "", html = "";
    cmdkItems.forEach(function (it, i) {
      if (it.group !== lastGroup) { html += '<div class="cmdk-group">' + it.group + "</div>"; lastGroup = it.group; }
      html += '<div class="cmdk-item ' + (i === cmdkActive ? "active" : "") + '" data-i="' + i + '">' + esc(it.label) +
        (it.meta ? '<span class="meta">' + esc(it.meta) + "</span>" : "") + "</div>";
    });
    el("cmdkList").innerHTML = html || '<div class="cmdk-group">No matches</div>';
  }
  function openCmdk() {
    el("cmdk").hidden = false; var inp = el("cmdkInput"); inp.value = ""; cmdkActive = 0;
    cmdkItems = buildCmdk(""); renderCmdk(); inp.focus();
  }
  function closeCmdk() { el("cmdk").hidden = true; }
  function runCmdk(i) { var it = cmdkItems[i]; if (it) { closeCmdk(); it.run(); } }
  function setupCmdk() {
    el("searchTrigger").addEventListener("click", openCmdk);
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); el("cmdk").hidden ? openCmdk() : closeCmdk(); }
      else if (e.key === "Escape") { if (!el("cmdk").hidden) closeCmdk(); else if (el("ctx").classList.contains("open")) closeCtx(); }
    });
    el("cmdkInput").addEventListener("input", function () { cmdkItems = buildCmdk(this.value); cmdkActive = 0; renderCmdk(); });
    el("cmdkInput").addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); cmdkActive = Math.min(cmdkActive + 1, cmdkItems.length - 1); renderCmdk(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); cmdkActive = Math.max(cmdkActive - 1, 0); renderCmdk(); }
      else if (e.key === "Enter") { e.preventDefault(); runCmdk(cmdkActive); }
    });
    el("cmdkList").addEventListener("click", function (e) { var it = e.target.closest("[data-i]"); if (it) runCmdk(parseInt(it.dataset.i, 10)); });
    el("cmdk").addEventListener("click", function (e) { if (e.target === el("cmdk")) closeCmdk(); });
  }

  // =========================================================================
  // PRICING WORKSPACE (engine views) — unchanged calculation logic
  // =========================================================================
  function renderSettings() {
    document.querySelectorAll("[data-set]").forEach(function (inp) { inp.value = state.settings[inp.dataset.set]; });
    el("loadedRate").textContent = fmtMoney2(E.loadedHourlyRate(state.settings));
  }
  function bindSettings() {
    document.querySelectorAll("[data-set]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        state.settings[inp.dataset.set] = inp.value === "" ? "" : parseFloat(inp.value);
        el("loadedRate").textContent = fmtMoney2(E.loadedHourlyRate(state.settings)); markDirty();
      });
    });
  }
  function laneRowHtml(lane, idx) {
    var r = E.computeLane(lane, state.settings);
    var veh = Seed.VEHICLES.map(function (v) { return '<option' + (v === lane.vehicle ? " selected" : "") + ">" + v + "</option>"; }).join("");
    function inp(field) { return '<input data-lane="' + idx + '" data-f="' + field + '" value="' + esc(lane[field]) + '" inputmode="decimal">'; }
    return '<tr class="row-' + (r.decision || "none") + '" data-row="' + idx + '">' +
      '<td class="txt"><input class="txt" data-lane="' + idx + '" data-f="origin" value="' + esc(lane.origin) + '"></td>' +
      '<td class="txt"><input class="txt" data-lane="' + idx + '" data-f="dest" value="' + esc(lane.dest) + '"></td>' +
      '<td class="txt"><select data-lane="' + idx + '" data-f="vehicle">' + veh + '</select></td>' +
      "<td>" + inp("spaces") + "</td><td>" + inp("trips") + "</td><td>" + inp("hrs") + "</td><td>" + inp("km") + "</td>" +
      "<td>" + inp("tolls") + "</td><td>" + inp("overnight") + "</td><td>" + inp("loadExtras") + "</td>" +
      '<td class="calc">' + fmtMoney2(r.cost) + "</td><td class=\"calc\">" + fmtMoney2(r.base) + "</td><td class=\"calc\">" + fmtMoney2(r.priceFL) + "</td>" +
      '<td class="calc">' + (r.decision ? fmtPct(r.margin) : "—") + "</td>" +
      '<td class="calc">' + fmtMoney(r.annualRev) + "</td><td class=\"calc\">" + fmtMoney(r.annualGP) + "</td>" +
      '<td class="calc cell-dec dec-' + (r.decision || "") + '">' + (r.decision || "—") + "</td>" +
      '<td><input class="qflag" data-lane="' + idx + '" data-f="quote" value="' + esc(lane.quote) + '" maxlength="1"></td>' +
      '<td><button class="rowdel" data-del="' + idx + '" title="Delete lane">×</button></td></tr>';
  }
  function renderLanes() {
    var body = el("lanesBody"), html = "", f = laneFilter.toLowerCase();
    state.lanes.forEach(function (lane, i) {
      if (f && !((lane.origin || "") + " " + (lane.dest || "") + " " + (lane.vehicle || "")).toLowerCase().includes(f)) return;
      html += laneRowHtml(lane, i);
    });
    body.innerHTML = html || '<tr><td colspan="19" class="empty">No lanes match the filter.</td></tr>';
  }
  function recalcLaneRow(idx) {
    var tr = el("lanesBody").querySelector('tr[data-row="' + idx + '"]'); if (!tr) return;
    var r = E.computeLane(state.lanes[idx], state.settings), c = tr.querySelectorAll("td.calc");
    c[0].textContent = fmtMoney2(r.cost); c[1].textContent = fmtMoney2(r.base); c[2].textContent = fmtMoney2(r.priceFL);
    c[3].textContent = r.decision ? fmtPct(r.margin) : "—"; c[4].textContent = fmtMoney(r.annualRev); c[5].textContent = fmtMoney(r.annualGP);
    c[6].textContent = r.decision || "—"; c[6].className = "calc cell-dec dec-" + (r.decision || ""); tr.className = "row-" + (r.decision || "none");
  }
  function bindLanes() {
    var body = el("lanesBody");
    body.addEventListener("input", function (e) {
      var t = e.target, idx = t.dataset.lane; if (idx == null) return;
      state.lanes[idx][t.dataset.f] = t.value; recalcLaneRow(parseInt(idx, 10)); markDirty();
    });
    body.addEventListener("change", function (e) { if (e.target.dataset.f === "vehicle") { recalcLaneRow(parseInt(e.target.dataset.lane, 10)); markDirty(); } });
    body.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]"); if (!del) return;
      state.lanes.splice(parseInt(del.dataset.del, 10), 1); renderLanes(); markDirty();
    });
    el("laneSearch").addEventListener("input", function () { laneFilter = this.value; renderLanes(); });
    el("btnAddLane").addEventListener("click", function () {
      state.lanes.unshift({ origin: "", dest: "", vehicle: "Rigid", spaces: "", trips: "", hrs: "", km: "", tolls: "", overnight: "", loadExtras: "", quote: "" });
      laneFilter = ""; el("laneSearch").value = ""; renderLanes(); markDirty();
    });
  }
  function whRowHtml(acc, idx) {
    var r = E.computeWarehouse(acc, state.warehousing);
    function inp(field) { return '<input data-acc="' + idx + '" data-f="' + field + '" value="' + esc(acc[field]) + '" inputmode="decimal">'; }
    return '<tr class="row-' + (r.decision || "none") + '" data-arow="' + idx + '">' +
      '<td class="txt"><input class="txt" data-acc="' + idx + '" data-f="customer" value="' + esc(acc.customer) + '"></td>' +
      "<td>" + inp("pallets") + "</td><td>" + inp("inb") + "</td><td>" + inp("outb") + "</td>" +
      "<td>" + inp("cases") + "</td><td>" + inp("vasHrs") + "</td><td>" + inp("other") + "</td>" +
      '<td class="calc">' + fmtMoney2(r.cost) + "</td><td class=\"calc\">" + fmtMoney2(r.base) + "</td>" +
      '<td class="calc">' + (r.decision ? fmtPct(r.margin) : "—") + "</td><td class=\"calc\">" + fmtMoney2(r.perPallet) + "</td>" +
      '<td class="calc">' + fmtMoney(r.annualRev) + "</td><td class=\"calc\">" + fmtMoney(r.annualGP) + "</td>" +
      '<td class="calc cell-dec dec-' + (r.decision || "") + '">' + (r.decision || "—") + "</td>" +
      '<td><input class="qflag" data-acc="' + idx + '" data-f="quote" value="' + esc(acc.quote) + '" maxlength="1"></td>' +
      '<td><button class="rowdel" data-accdel="' + idx + '" title="Delete account">×</button></td></tr>';
  }
  function renderWarehousing() {
    document.querySelectorAll("[data-wh]").forEach(function (inp) { inp.value = state.warehousing[inp.dataset.wh]; });
    el("whBody").innerHTML = state.accounts.map(whRowHtml).join("");
  }
  function recalcWhRow(idx) {
    var tr = el("whBody").querySelector('tr[data-arow="' + idx + '"]'); if (!tr) return;
    var r = E.computeWarehouse(state.accounts[idx], state.warehousing), c = tr.querySelectorAll("td.calc");
    c[0].textContent = fmtMoney2(r.cost); c[1].textContent = fmtMoney2(r.base); c[2].textContent = r.decision ? fmtPct(r.margin) : "—";
    c[3].textContent = fmtMoney2(r.perPallet); c[4].textContent = fmtMoney(r.annualRev); c[5].textContent = fmtMoney(r.annualGP);
    c[6].textContent = r.decision || "—"; c[6].className = "calc cell-dec dec-" + (r.decision || ""); tr.className = "row-" + (r.decision || "none");
  }
  function bindWarehousing() {
    document.querySelectorAll("[data-wh]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        state.warehousing[inp.dataset.wh] = inp.value === "" ? "" : parseFloat(inp.value);
        state.accounts.forEach(function (_, i) { recalcWhRow(i); }); markDirty();
      });
    });
    el("whBody").addEventListener("input", function (e) {
      var idx = e.target.dataset.acc; if (idx == null) return;
      state.accounts[idx][e.target.dataset.f] = e.target.value; recalcWhRow(parseInt(idx, 10)); markDirty();
    });
    el("whBody").addEventListener("click", function (e) {
      var d = e.target.closest("[data-accdel]"); if (!d) return;
      state.accounts.splice(parseInt(d.dataset.accdel, 10), 1); renderWarehousing(); markDirty();
    });
    el("btnAddAccount").addEventListener("click", function () {
      state.accounts.push(Seed.emptyAccount("")); renderWarehousing(); markDirty();
    });
  }
  function renderLegBuilder() {
    var lb = state.legBuilder;
    document.querySelectorAll("[data-lb]").forEach(function (inp) { inp.value = lb[inp.dataset.lb]; });
    el("legBody").innerHTML = lb.legs.map(function (leg, i) {
      return "<tr><td>" + (i + 1) + "</td>" +
        '<td class="txt"><input class="txt" data-leg="' + i + '" data-f="label" value="' + esc(leg.label) + '"></td>' +
        '<td class="txt"><input class="txt" data-leg="' + i + '" data-f="type" value="' + esc(leg.type) + '"></td>' +
        '<td><input data-leg="' + i + '" data-f="hours" value="' + esc(leg.hours) + '" inputmode="decimal"></td>' +
        '<td><input data-leg="' + i + '" data-f="km" value="' + esc(leg.km) + '" inputmode="decimal"></td>' +
        '<td><button class="rowdel" data-legdel="' + i + '" title="Remove leg">×</button></td></tr>';
    }).join("");
    recalcLeg();
  }
  function recalcLeg() {
    var r = E.computeLegs(state.legBuilder, state.settings), lb = state.legBuilder;
    el("legTotHrs").textContent = r.totalHours; el("legTotKm").textContent = r.totalKm;
    renderStrip("legKpis", [
      { k: "Price + fuel levy", v: fmtMoney2(r.priceFL), s: "per trip", cls: "good" },
      { k: "Margin %", v: fmtPct(r.margin), s: "target " + state.settings.targetMarginPct + "%", cls: "good" },
      { k: "Cost / trip", v: fmtMoney2(r.cost), s: "all-in" },
      { k: "Base price", v: fmtMoney2(r.base), s: "excl. fuel levy" },
      { k: "Per pallet space", v: fmtMoney2(r.perSpace), s: E.num(lb.spaces) + " spaces" },
      { k: "Per hour", v: fmtMoney2(r.perHour), s: r.totalHours + " hrs" },
      { k: "Annual revenue", v: fmtMoney(r.annualRev), s: E.num(lb.trips) + " trips/wk", cls: "good" },
      { k: "Annual GP", v: fmtMoney(r.annualGP), s: "gross profit", cls: "good" }
    ]);
    el("legBreakdown").innerHTML = [
      ["Total hours", r.totalHours], ["Total km", r.totalKm],
      ["Loaded $/hr", fmtMoney2(r.loaded)], ["Vehicle $/km", fmtMoney2(r.veh)],
      ["Labour $", fmtMoney2(r.labour)], ["Fuel &amp; vehicle $", fmtMoney2(r.fuelVeh)],
      ["Extras $", fmtMoney2(r.extras)], ["Cost / trip", fmtMoney2(r.cost)]
    ].map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>"; }).join("");
  }
  function bindLegBuilder() {
    document.querySelectorAll("[data-lb]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var v = inp.value;
        state.legBuilder[inp.dataset.lb] = (inp.tagName === "SELECT") ? v : (v === "" ? "" : (isNaN(parseFloat(v)) ? v : parseFloat(v)));
        recalcLeg(); markDirty();
      });
    });
    el("legBody").addEventListener("input", function (e) {
      var i = e.target.dataset.leg; if (i == null) return;
      state.legBuilder.legs[i][e.target.dataset.f] = e.target.value; recalcLeg(); markDirty();
    });
    el("legBody").addEventListener("click", function (e) {
      var d = e.target.closest("[data-legdel]"); if (!d) return;
      state.legBuilder.legs.splice(parseInt(d.dataset.legdel, 10), 1); renderLegBuilder(); markDirty();
    });
    el("btnAddLeg").addEventListener("click", function () {
      state.legBuilder.legs.push({ label: "", type: "drive", hours: 0, km: 0 }); renderLegBuilder(); markDirty();
    });
  }
  function dl(rows) { return rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join(""); }
  function renderSummary() {
    var s = E.computeSummary(state), t = s.transport, w = s.warehousing, c = s.combined;
    el("sumTransport").innerHTML = dl([["Weekly revenue", fmtMoney(t.weekRev)], ["Weekly cost", fmtMoney(t.weekCost)], ["Weekly GP", fmtMoney(t.weekGP)], ["Blended margin %", fmtPct(t.margin)], ["Annual revenue", fmtMoney(t.annualRev)], ["Annual GP", fmtMoney(t.annualGP)], ["Lanes priced", t.priced], ["GO / REVIEW / NO-GO", t.go + " / " + t.review + " / " + t.nogo]]);
    el("sumWarehouse").innerHTML = dl([["Weekly revenue", fmtMoney(w.weekRev)], ["Weekly cost", fmtMoney(w.weekCost)], ["Weekly GP", fmtMoney(w.weekGP)], ["Blended margin %", fmtPct(w.margin)], ["Annual revenue", fmtMoney(w.annualRev)], ["Annual GP", fmtMoney(w.annualGP)], ["Accounts priced", w.priced], ["GO / REVIEW / NO-GO", w.go + " / " + w.review + " / " + w.nogo]]);
    el("sumCombined").innerHTML = dl([["Weekly revenue", fmtMoney(c.weekRev)], ["Weekly GP", fmtMoney(c.weekGP)], ["Blended margin %", fmtPct(c.margin)], ["Annual revenue", fmtMoney(c.annualRev)], ["Annual GP", fmtMoney(c.annualGP)]]);
  }
  function renderQuote() {
    document.querySelectorAll("[data-q]").forEach(function (inp) { inp.value = state.quote[inp.dataset.q] || ""; });
    var q = E.buildQuote(state), html = "";
    html += '<div class="qsection"><h3>Transport — Linehaul &amp; Metro Lanes</h3>';
    if (q.transport.length) {
      html += '<table><thead><tr><th>Origin</th><th>Destination</th><th>Vehicle</th><th>Spaces</th><th>Trips/wk</th><th>Rate/trip</th><th>Weekly $</th><th>Annual $</th></tr></thead><tbody>';
      q.transport.forEach(function (r) { html += "<tr><td>" + esc(r.origin) + "</td><td>" + esc(r.dest) + "</td><td>" + esc(r.vehicle) + "</td><td>" + fmtNum(r.spaces) + "</td><td>" + fmtNum(r.trips) + "</td><td>" + fmtMoney2(r.ratePerTrip) + "</td><td>" + fmtMoney2(r.weekly) + "</td><td>" + fmtMoney(r.annual) + "</td></tr>"; });
      html += "</tbody><tfoot><tr><td colspan='6'>Transport subtotal</td><td>" + fmtMoney2(q.transportWeekly) + "</td><td>" + fmtMoney(q.transportAnnual) + "</td></tr></tfoot></table>";
    } else html += '<p class="empty">No transport lanes flagged. Set Quote? = Y on the Lanes view.</p>';
    html += "</div><div class=\"qsection\"><h3>Warehousing — Storage, Handling &amp; VAS</h3>";
    if (q.warehousing.length) {
      html += '<table><thead><tr><th>Customer</th><th>Pallets</th><th>Inb/wk</th><th>Outb/wk</th><th>Cases/wk</th><th>$/pallet</th><th>Weekly $</th><th>Annual $</th></tr></thead><tbody>';
      q.warehousing.forEach(function (r) { html += "<tr><td>" + esc(r.customer) + "</td><td>" + fmtNum(r.pallets) + "</td><td>" + fmtNum(r.inb) + "</td><td>" + fmtNum(r.outb) + "</td><td>" + fmtNum(r.cases) + "</td><td>" + fmtMoney2(r.perPallet) + "</td><td>" + fmtMoney2(r.weekly) + "</td><td>" + fmtMoney(r.annual) + "</td></tr>"; });
      html += "</tbody><tfoot><tr><td colspan='6'>Warehousing subtotal</td><td>" + fmtMoney2(q.warehousingWeekly) + "</td><td>" + fmtMoney(q.warehousingAnnual) + "</td></tr></tfoot></table>";
    } else html += '<p class="empty">No warehousing accounts flagged. Set Quote? = Y on the Warehousing view.</p>';
    html += "</div><div class=\"qtotal\"><span>TOTAL CONTRACT VALUE</span><span>Weekly " + fmtMoney2(q.totalWeekly) + " &nbsp;·&nbsp; Annual <b>" + fmtMoney(q.totalAnnual) + "</b></span></div>";
    el("quotePreview").innerHTML = html;
  }
  function bindQuote() {
    document.querySelectorAll("[data-q]").forEach(function (inp) { inp.addEventListener("input", function () { state.quote[inp.dataset.q] = inp.value; markDirty(); }); });
    el("btnPdf").addEventListener("click", generatePdf);
  }
  function generatePdf() {
    var q = E.buildQuote(state);
    if (!q.transport.length && !q.warehousing.length) return toast("Nothing flagged for the quote — set Quote? = Y on Lanes or Warehousing.", true);
    save();
    var btn = el("btnPdf"); btn.disabled = true; btn.textContent = "Generating…";
    fetch("/api/quote/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote: state.quote, computed: q }) })
      .then(function (r) { return r.json(); })
      .then(function (res) { btn.disabled = false; btn.textContent = "Generate Quote PDF"; toast(res.ok ? "PDF saved: " + res.filename : (res.error || "PDF failed"), !res.ok); })
      .catch(function (e) { btn.disabled = false; btn.textContent = "Generate Quote PDF"; toast("PDF failed: " + e, true); });
  }

  // ---- exports -------------------------------------------------------------
  function activeLanes() { return state.lanes.filter(function (l) { return E.num(l.spaces) > 0 || E.num(l.trips) > 0 || E.num(l.hrs) > 0 || E.num(l.km) > 0; }); }
  function activeAccounts() { return state.accounts.filter(function (a) { return E.num(a.pallets) > 0 || (!E.isBlank(a.customer) && (E.num(a.inb) || E.num(a.outb) || E.num(a.cases) || E.num(a.vasHrs))); }); }
  function laneExportRows(lanes) {
    return lanes.map(function (l) {
      var r = E.computeLane(l, state.settings);
      return { origin: l.origin || "", dest: l.dest || "", vehicle: l.vehicle || "", spaces: E.num(l.spaces), trips: E.num(l.trips), hrs: E.num(l.hrs), km: E.num(l.km), tolls: E.num(l.tolls), overnight: E.num(l.overnight), loadExtras: E.num(l.loadExtras), cost: r.cost, base: r.base, priceFL: r.priceFL, margin: r.margin, annualRev: r.annualRev, annualGP: r.annualGP, decision: r.decision, quote: l.quote || "" };
    });
  }
  function accountExportRows(accs) {
    return accs.map(function (a) {
      var r = E.computeWarehouse(a, state.warehousing);
      return { customer: a.customer || "", pallets: E.num(a.pallets), inb: E.num(a.inb), outb: E.num(a.outb), cases: E.num(a.cases), vasHrs: E.num(a.vasHrs), other: E.num(a.other), cost: r.cost, base: r.base, margin: r.margin, perPallet: r.perPallet, annualRev: r.annualRev, annualGP: r.annualGP, decision: r.decision, quote: a.quote || "" };
    });
  }
  function buildExportPayload(type) {
    var p = { type: type };
    if (type === "excel-full") { p.settings = state.settings; p.warehousing = state.warehousing; p.lanes = laneExportRows(state.lanes); p.accounts = accountExportRows(state.accounts); p.summary = E.computeSummary(state); p.tenders = state.tenders; p.pipeline = E.computePipeline(state.tenders); }
    else if (type === "data-pdf") { p.lanes = laneExportRows(activeLanes()); p.accounts = accountExportRows(activeAccounts()); p.summary = E.computeSummary(state); }
    else if (type === "quote-excel") { p.quote = state.quote; p.computed = E.buildQuote(state); }
    else if (type === "tenders-excel" || type === "tenders-pdf") { p.tenders = state.tenders; p.pipeline = E.computePipeline(state.tenders); }
    return p;
  }
  function doExport(type) {
    if ((type === "tenders-excel" || type === "tenders-pdf") && !state.tenders.length) return toast("No tenders to export yet.", true);
    if (type === "quote-excel") { var q = E.buildQuote(state); if (!q.transport.length && !q.warehousing.length) return toast("Nothing flagged for the quote — set Quote? = Y first.", true); }
    save(); toast("Generating export…");
    fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildExportPayload(type)) })
      .then(function (r) { return r.json(); })
      .then(function (res) { toast(res.ok ? "Saved: " + res.filename : (res.error || "Export failed"), !res.ok); })
      .catch(function (e) { toast("Export failed: " + e, true); });
  }
  function bindExport() {
    var dd = el("exportDropdown");
    el("btnExport").addEventListener("click", function (e) { e.stopPropagation(); dd.classList.toggle("open"); });
    document.addEventListener("click", function () { dd.classList.remove("open"); });
    el("exportMenu").addEventListener("click", function (e) { var b = e.target.closest("[data-export]"); if (!b) return; dd.classList.remove("open"); doExport(b.dataset.export); });
  }

  // ---- reset ---------------------------------------------------------------
  function bindReset() {
    el("btnReset").addEventListener("click", function () {
      if (!confirm("Reset the workspace?\n\nThis clears all pricing inputs and restores Settings defaults.\nLane/customer names, tenders, carriers and compliance are kept.")) return;
      var keptLanes = state.lanes.map(function (l) { return { origin: l.origin, dest: l.dest, vehicle: l.vehicle, spaces: "", trips: "", hrs: "", km: "", tolls: "", overnight: "", loadExtras: "", quote: "" }; });
      var keptAccounts = state.accounts.map(function (a) { return Seed.emptyAccount(a.customer); });
      var keepT = state.tenders, keepC = state.carriers, keepCm = state.compliance;
      state = Seed.defaultState(seedLanes);
      state.lanes = keptLanes; state.accounts = keptAccounts; state.tenders = keepT; state.carriers = keepC; state.compliance = keepCm;
      save(); renderActive(currentView); toast("Workspace reset to template.");
    });
  }

  // ---- toast ---------------------------------------------------------------
  var toastTimer;
  function toast(msg, isErr) {
    var t = el("toast"); t.innerHTML = msg; t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = "toast"; }, 4000);
  }

  // ---- boot ----------------------------------------------------------------
  setupTheme();
  load().then(function () {
    setupNav(); setupCmdk();
    bindSettings(); bindLanes(); bindWarehousing(); bindLegBuilder(); bindQuote();
    bindActiveTenders(); bindTenderWorkspace(); bindImport();
    bindCarriers(); bindCompliance(); bindReports(); bindExport(); bindReset();
    gotoView("active-tenders");
  });
})();
