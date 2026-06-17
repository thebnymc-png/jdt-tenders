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
    s.tenders.forEach(function (t) { if (!Array.isArray(t.bids)) t.bids = []; });
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

  // ---- navigation ----------------------------------------------------------
  function gotoView(view) {
    currentView = view;
    document.querySelectorAll(".sb-item").forEach(function (b) { b.classList.toggle("active", b.dataset.view === view); });
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
    { key: "route", label: "Route" },
    { key: "volume", label: "Volume", num: true },
    { key: "dueDate", label: "Deadline" },
    { key: "bids", label: "Bids", num: true },
    { key: "value", label: "Value", num: true },
    { key: "status", label: "Status" }
  ];
  var sortState = { key: "dueDate", dir: 1 };
  var tenderFilter = { status: "", q: "" };
  var expanded = {};   // id -> true
  var selectedId = null;

  function sortVal(t, key) {
    if (key === "route") return (t.origin || "") + (t.destination || "");
    if (key === "bids") return (t.bids || []).length;
    if (key === "value" || key === "volume") return E.num(t[key]);
    return (t[key] || "").toString().toLowerCase();
  }
  function visibleTenders() {
    var q = tenderFilter.q.toLowerCase();
    var rows = state.tenders.filter(function (t) {
      if (tenderFilter.status && (t.status || "Draft") !== tenderFilter.status) return false;
      if (q) {
        var hay = [t.reference, t.customer, t.title, t.origin, t.destination].join(" ").toLowerCase();
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
    var route = (t.origin || t.destination) ? (esc(t.origin || "—") + " → " + esc(t.destination || "—")) : '<span style="color:var(--text-3)">—</span>';
    var open = expanded[t.id];
    var h = '<tr data-tid="' + t.id + '" class="' + (selectedId === t.id ? "sel" : "") + (open ? " expanded" : "") + '">' +
      '<td><span class="exp" data-exp="' + t.id + '">' + (t.bids && t.bids.length ? "▸" : "") + "</span></td>" +
      "<td><b>" + (esc(t.reference) || '<span style="color:var(--text-3)">—</span>') + "</b></td>" +
      "<td>" + (esc(t.customer) || '<span style="color:var(--text-3)">—</span>') + "</td>" +
      "<td>" + route + "</td>" +
      '<td class="num">' + (E.num(t.volume) ? fmtNum(t.volume) : "—") + "</td>" +
      '<td class="' + dueCls + '">' + (esc(t.dueDate) || "—") + "</td>" +
      '<td class="num">' + ((t.bids || []).length || "—") + "</td>" +
      '<td class="num">' + (E.num(t.value) ? fmtMoney(t.value) : "—") + "</td>" +
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
      openCtx(edit ? edit.dataset.edit : tr.dataset.tid);
    });
    el("btnCaptureTender").addEventListener("click", function () {
      var t = Seed.newTender({ customer: state.quote.customer || "", reference: state.quote.quoteNumber || "", title: "Captured " + today() });
      captureInto(t); state.tenders.unshift(t); renderActiveTenders(); save(); openCtx(t.id);
      toast("Captured current model as a new tender.");
    });
    el("btnNewTender").addEventListener("click", function () {
      var t = Seed.newTender({ customer: state.quote.customer || "", reference: state.quote.quoteNumber || "" });
      state.tenders.unshift(t); markDirty();
      if (currentView !== "active-tenders") gotoView("active-tenders"); else renderActiveTenders();
      openCtx(t.id);
    });
  }
  function setTenderStatus(id, status) {
    var t = getTender(id); if (!t) return;
    t.status = status; touchTender(t);
    if (currentView === "active-tenders") renderActiveTenders();
    if (selectedId === id) openCtx(id);
    markDirty();
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function touchTender(t) { t.updatedAt = today(); }
  function captureInto(t) {
    t.snapshot = snapshotModel();
    var q = E.buildQuote(state);
    if (q.totalAnnual > 0) t.value = Math.round(q.totalAnnual);
    if (!t.customer) t.customer = state.quote.customer || "";
    if (!t.reference) t.reference = state.quote.quoteNumber || "";
    // seed route from first flagged lane
    var firstLane = (q.transport && q.transport[0]) || null;
    if (firstLane) { if (!t.origin) t.origin = firstLane.origin; if (!t.destination) t.destination = firstLane.dest; }
    touchTender(t);
  }

  // ---- CONTEXTUAL DETAIL PANEL --------------------------------------------
  function openCtx(id) {
    var t = getTender(id); if (!t) return;
    selectedId = id;
    var statusOpts = Seed.TENDER_STATUSES.map(function (s) { return '<option' + (s === t.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
    function f(label, field, type, full) {
      return '<label class="' + (full ? "full" : "") + '">' + label +
        '<input data-cf="' + field + '" type="' + (type || "text") + '" value="' + esc(t[field]) + '"></label>';
    }
    var bids = (t.bids || []).map(bidRowHtml).join("");
    var html =
      '<div class="ctx-head"><div style="flex:1;min-width:0">' +
        '<div class="ref">' + (esc(t.reference) || "TENDER") + "</div>" +
        "<h2>" + (esc(t.customer) || "Untitled tender") + "</h2>" + badge(t.status) +
      '</div><button class="icon-btn" id="ctxClose" title="Close"><svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="ctx-body">' +
        '<div class="ctx-sec"><h4>Details</h4><div class="fgrid">' +
          f("Reference", "reference") + f("Customer", "customer") +
          f("Title", "title", "text", true) +
          f("Origin", "origin") + f("Destination", "destination") +
          f("Volume (pallets/wk)", "volume", "number") +
          '<label>Status<select data-cf="status">' + statusOpts + "</select></label>" +
          f("Deadline", "dueDate", "date") +
          f("Contract value $", "value", "number") + f("Probability %", "probability", "number") +
          f("Owner", "owner") +
          '<label class="full">Notes<textarea data-cf="notes">' + esc(t.notes) + "</textarea></label>" +
        "</div></div>" +
        '<div class="ctx-sec"><h4>Route</h4>' +
          '<div class="route-chip"><span class="dot2"></span>' + (esc(t.origin) || "Origin") + '<span class="line"></span>' + (esc(t.destination) || "Destination") + '<span class="dot2"></span></div>' +
          '<div id="ctxMap"><div class="map-fallback">Loading map…</div></div></div>' +
        '<div class="ctx-sec"><h4>Competing bids</h4><div class="bidlist" id="ctxBids">' + (bids || '<div style="color:var(--text-3);font-size:12px">No bids recorded.</div>') + "</div>" +
          '<button class="btn btn-sm" id="ctxAddBid" style="margin-top:9px">+ Add bid</button></div>' +
        (t.snapshot ? '<div class="ctx-sec"><h4>Snapshot</h4><div style="font-size:12px;color:var(--text-2)">Priced model saved ' + esc(t.updatedAt) + ". Load it to restore the workspace.</div></div>" : "") +
      "</div>" +
      '<div class="ctx-foot">' +
        (t.snapshot ? '<button class="btn" id="ctxLoad">↺ Load snapshot</button>' : "") +
        '<button class="btn" id="ctxCapture">⧉ Save current model</button>' +
        '<button class="btn" id="ctxDelete" style="margin-left:auto;color:var(--nogo)">Delete</button>' +
      "</div>";
    var ctx = el("ctx");
    ctx.innerHTML = html; ctx.classList.add("open"); ctx.setAttribute("aria-hidden", "false");
    el("ctxScrim").hidden = false;
    if (currentView === "active-tenders") renderActiveTenders();
    bindCtx(t);
    renderMap(t);
  }
  function closeCtx() {
    el("ctx").classList.remove("open"); el("ctx").setAttribute("aria-hidden", "true");
    el("ctxScrim").hidden = true; selectedId = null;
    if (currentView === "active-tenders") renderActiveTenders();
  }
  function bidRowHtml(b) {
    var opts = Seed.BID_STATUSES.map(function (s) { return '<option' + (s === b.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
    return '<div class="bidrow" data-bid="' + b.id + '">' +
      '<input class="bcar" data-bf="carrier" placeholder="Carrier" value="' + esc(b.carrier) + '">' +
      '<input class="bamt" data-bf="amount" type="number" placeholder="$" value="' + esc(b.amount) + '">' +
      '<select data-bf="status">' + opts + "</select>" +
      '<button class="btn btn-sm" data-bidaward="1" title="Award this bid">✓</button>' +
      '<button class="btn btn-sm" data-bidremove="1" title="Remove">✕</button></div>';
  }
  function bindCtx(t) {
    el("ctxClose").addEventListener("click", closeCtx);
    el("ctxScrim").onclick = closeCtx;
    el("ctx").querySelectorAll("[data-cf]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        t[inp.dataset.cf] = inp.value; touchTender(t);
        if (inp.dataset.cf === "status") openCtx(t.id);
        if (currentView === "active-tenders") renderActiveTenders();
        if (inp.dataset.cf === "origin" || inp.dataset.cf === "destination") scheduleMap(t);
        markDirty();
      });
    });
    el("ctxAddBid").addEventListener("click", function () {
      t.bids.push(Seed.newBid({})); touchTender(t); refreshBids(t); markDirty();
    });
    el("ctxBids").addEventListener("input", function (e) {
      var row = e.target.closest("[data-bid]"); if (!row || !e.target.dataset.bf) return;
      var b = t.bids.find(function (x) { return x.id === row.dataset.bid; });
      if (b) { b[e.target.dataset.bf] = e.target.value; touchTender(t); if (currentView === "active-tenders") renderActiveTenders(); markDirty(); }
    });
    el("ctxBids").addEventListener("click", function (e) {
      var row = e.target.closest("[data-bid]"); if (!row) return;
      var b = t.bids.find(function (x) { return x.id === row.dataset.bid; }); if (!b) return;
      if (e.target.closest("[data-bidremove]")) { t.bids = t.bids.filter(function (x) { return x.id !== b.id; }); touchTender(t); refreshBids(t); markDirty(); }
      else if (e.target.closest("[data-bidaward]")) {
        t.bids.forEach(function (x) { x.status = x.id === b.id ? "Awarded" : (x.status === "Awarded" ? "Pending" : x.status); });
        t.status = "Won"; if (E.num(b.amount)) t.value = E.num(b.amount); touchTender(t);
        openCtx(t.id); if (currentView === "active-tenders") renderActiveTenders(); markDirty();
        toast("Bid awarded — tender marked Won.");
      }
    });
    var loadBtn = el("ctxLoad");
    if (loadBtn) loadBtn.addEventListener("click", function () {
      if (!confirm("Load this tender's snapshot?\n\nReplaces the current workspace (Settings, Lanes, Warehousing, Quote). The tender register is kept.")) return;
      restoreModel(t.snapshot); save(); toast("Snapshot loaded into workspace."); gotoView("summary");
    });
    el("ctxCapture").addEventListener("click", function () { captureInto(t); openCtx(t.id); if (currentView === "active-tenders") renderActiveTenders(); save(); toast("Saved current model onto tender."); });
    el("ctxDelete").addEventListener("click", function () {
      if (!confirm("Delete this tender? This cannot be undone.")) return;
      state.tenders = state.tenders.filter(function (x) { return x.id !== t.id; });
      closeCtx(); if (currentView === "active-tenders") renderActiveTenders(); markDirty();
    });
  }
  function refreshBids(t) {
    el("ctxBids").innerHTML = (t.bids || []).map(bidRowHtml).join("") || '<div style="color:var(--text-3);font-size:12px">No bids recorded.</div>';
    if (currentView === "active-tenders") renderActiveTenders();
  }

  // ---- route map (Leaflet via CDN, geocode via Nominatim) -----------------
  var leafletPromise = null, geoCache = {}, mapTimer = null;
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
    if (geoCache[q]) return Promise.resolve(geoCache[q]);
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=" + encodeURIComponent(q);
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); })
      .then(function (j) { var hit = j && j[0] ? [parseFloat(j[0].lat), parseFloat(j[0].lon)] : null; geoCache[q] = hit; return hit; })
      .catch(function () { return null; });
  }
  function mapFallback(msg) {
    var m = el("ctxMap"); if (m) m.innerHTML = '<div class="map-fallback"><svg viewBox="0 0 24 24" class="ico" style="width:22px;height:22px"><path d="M9 20l-5 2V6l5-2 6 2 5-2v16l-5 2-6-2zM9 4v16M15 6v16"/></svg>' + msg + "</div>";
  }
  function scheduleMap(t) { clearTimeout(mapTimer); mapTimer = setTimeout(function () { if (selectedId === t.id) renderMap(t); }, 700); }
  function renderMap(t) {
    var holder = el("ctxMap"); if (!holder) return;
    if (!t.origin && !t.destination) { mapFallback("Add an origin and destination to plot the route."); return; }
    mapFallback("Loading map…");
    ensureLeaflet().then(function (L) {
      return Promise.all([geocode(t.origin), geocode(t.destination)]).then(function (pts) {
        if (selectedId !== t.id) return;
        holder.innerHTML = "";
        var map = L.map(holder, { attributionControl: false, zoomControl: false }).setView([-25, 134], 4);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
        var marks = [];
        if (pts[0]) { L.marker(pts[0]).addTo(map).bindTooltip(t.origin); marks.push(pts[0]); }
        if (pts[1]) { L.marker(pts[1]).addTo(map).bindTooltip(t.destination); marks.push(pts[1]); }
        if (pts[0] && pts[1]) L.polyline([pts[0], pts[1]], { color: "#2563EB", weight: 3 }).addTo(map);
        if (marks.length === 2) map.fitBounds(marks, { padding: [30, 30] });
        else if (marks.length === 1) map.setView(marks[0], 9);
        else mapFallback("Couldn't locate those places. Check the spelling.");
        setTimeout(function () { map.invalidateSize(); }, 60);
      });
    }).catch(function () { mapFallback("Map needs an internet connection — unavailable offline."); });
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
    { id: "tenders-pdf", tag: "PDF", title: "Tender Register", desc: "Printable register with pipeline summary." }
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
        items.push({ group: "Tenders", label: label, meta: t.customer || "", run: function () { gotoView("active-tenders"); openCtx(t.id); } });
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
      '<td><input class="qflag" data-acc="' + idx + '" data-f="quote" value="' + esc(acc.quote) + '" maxlength="1"></td></tr>';
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
  }
  function renderLegBuilder() {
    var lb = state.legBuilder;
    document.querySelectorAll("[data-lb]").forEach(function (inp) { inp.value = lb[inp.dataset.lb]; });
    el("legBody").innerHTML = lb.legs.map(function (leg, i) {
      return "<tr><td>" + (i + 1) + "</td>" +
        '<td class="txt"><input class="txt" data-leg="' + i + '" data-f="label" value="' + esc(leg.label) + '"></td>' +
        '<td class="txt"><input class="txt" data-leg="' + i + '" data-f="type" value="' + esc(leg.type) + '"></td>' +
        '<td><input data-leg="' + i + '" data-f="hours" value="' + esc(leg.hours) + '" inputmode="decimal"></td>' +
        '<td><input data-leg="' + i + '" data-f="km" value="' + esc(leg.km) + '" inputmode="decimal"></td></tr>';
    }).join("");
    recalcLegPreview();
  }
  function recalcLegPreview() {
    var r = E.computeLegs(state.legBuilder, state.settings);
    el("legTotHrs").textContent = r.totalHours; el("legTotKm").textContent = r.totalKm;
    var rows = [
      ["Total hours", r.totalHours], ["Total km", r.totalKm], ["Loaded $/hr", fmtMoney2(r.loaded)], ["Vehicle $/km", fmtMoney2(r.veh)],
      ["Labour $", fmtMoney2(r.labour)], ["Fuel &amp; vehicle $", fmtMoney2(r.fuelVeh)], ["Extras $", fmtMoney2(r.extras)], ["Cost / trip", fmtMoney2(r.cost)],
      ["Base price (excl FL)", fmtMoney2(r.base)], ["Price + fuel levy", fmtMoney2(r.priceFL)], ["Margin %", fmtPct(r.margin)],
      ["Per pallet space", fmtMoney2(r.perSpace)], ["Per hour", fmtMoney2(r.perHour)], ["Annual revenue", fmtMoney(r.annualRev)], ["Annual GP", fmtMoney(r.annualGP)]
    ];
    el("legPreview").innerHTML = rows.map(function (x, i) { return "<dt>" + x[0] + "</dt><dd class='" + (i === 9 || i >= 13 ? "big" : "") + "'>" + x[1] + "</dd>"; }).join("");
  }
  function bindLegBuilder() {
    document.querySelectorAll("[data-lb]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var v = inp.value;
        state.legBuilder[inp.dataset.lb] = (inp.tagName === "SELECT") ? v : (v === "" ? "" : (isNaN(parseFloat(v)) ? v : parseFloat(v)));
        recalcLegPreview(); markDirty();
      });
    });
    el("legBody").addEventListener("input", function (e) {
      var i = e.target.dataset.leg; if (i == null) return;
      state.legBuilder.legs[i][e.target.dataset.f] = e.target.value; recalcLegPreview(); markDirty();
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
    bindActiveTenders(); bindCarriers(); bindCompliance(); bindReports(); bindExport(); bindReset();
    gotoView("active-tenders");
  });
})();
