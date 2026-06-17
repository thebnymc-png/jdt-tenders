/* JDT Pricing Model — front-end controller.
 * State lives in memory, is rendered to the tabs, and is auto-saved to the
 * backend (which writes jdt_pricing_data.json next to the executable).
 */
(function () {
  "use strict";
  var E = window.JDTEngine, Seed = window.JDTSeed;
  var state = null, seedLanes = [], saveTimer = null, laneFilter = "";

  // ---- formatting ----------------------------------------------------------
  var fmtMoney = function (v) {
    return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  var fmtMoney2 = function (v) {
    return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var fmtPct = function (v) { return (v * 100).toFixed(1) + "%"; };
  var fmtNum = function (v) { return E.num(v).toLocaleString("en-AU"); };
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  // ---- persistence ---------------------------------------------------------
  function markDirty() {
    var s = el("saveState"); s.textContent = "Saving…"; s.classList.add("dirty");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }
  function save() {
    fetch("/api/state", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    }).then(function (r) {
      var s = el("saveState");
      if (r.ok) { s.textContent = "Saved"; s.classList.remove("dirty"); }
      else { s.textContent = "Save failed"; }
    }).catch(function () { el("saveState").textContent = "Offline"; });
  }

  function load() {
    return fetch("/static/seed_lanes.json").then(function (r) { return r.json(); })
      .then(function (lanes) {
        seedLanes = lanes;
        return fetch("/api/state").then(function (r) { return r.ok ? r.json() : null; });
      })
      .then(function (saved) {
        if (saved && saved.settings) { state = migrate(saved); }
        else { state = Seed.defaultState(seedLanes); }
      })
      .catch(function () { state = Seed.defaultState(seedLanes); });
  }

  // ensure all expected fields exist after loading older/partial saves
  function migrate(s) {
    var base = Seed.defaultState(seedLanes);
    s.settings = Object.assign({}, base.settings, s.settings || {});
    s.warehousing = Object.assign({}, base.warehousing, s.warehousing || {});
    s.quote = Object.assign({}, base.quote, s.quote || {});
    s.legBuilder = Object.assign({}, base.legBuilder, s.legBuilder || {});
    if (!Array.isArray(s.lanes) || !s.lanes.length) s.lanes = base.lanes;
    if (!Array.isArray(s.accounts) || !s.accounts.length) s.accounts = base.accounts;
    return s;
  }

  // ---- tabs ----------------------------------------------------------------
  function setupTabs() {
    el("tabs").addEventListener("click", function (e) {
      var btn = e.target.closest(".tab"); if (!btn) return;
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      el("panel-" + btn.dataset.tab).classList.add("active");
      renderActive(btn.dataset.tab);
    });
  }
  function renderActive(tab) {
    if (tab === "settings") renderSettings();
    else if (tab === "lanes") renderLanes();
    else if (tab === "warehousing") renderWarehousing();
    else if (tab === "legbuilder") renderLegBuilder();
    else if (tab === "summary") renderSummary();
    else if (tab === "quote") renderQuote();
  }

  // ---- settings ------------------------------------------------------------
  function renderSettings() {
    document.querySelectorAll("[data-set]").forEach(function (inp) {
      inp.value = state.settings[inp.dataset.set];
    });
    el("loadedRate").textContent = fmtMoney2(E.loadedHourlyRate(state.settings));
  }
  function bindSettings() {
    document.querySelectorAll("[data-set]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        state.settings[inp.dataset.set] = inp.value === "" ? "" : parseFloat(inp.value);
        el("loadedRate").textContent = fmtMoney2(E.loadedHourlyRate(state.settings));
        markDirty();
      });
    });
  }

  // ---- lanes ---------------------------------------------------------------
  var LANE_INPUTS = ["spaces", "trips", "hrs", "km", "tolls", "overnight", "loadExtras"];
  function laneRowHtml(lane, idx) {
    var r = E.computeLane(lane, state.settings);
    var veh = Seed.VEHICLES.map(function (v) {
      return '<option' + (v === lane.vehicle ? " selected" : "") + ">" + v + "</option>";
    }).join("");
    function inp(field) {
      return '<input data-lane="' + idx + '" data-f="' + field + '" value="' + esc(lane[field]) + '" inputmode="decimal">';
    }
    return '<tr class="row-' + (r.decision || "none") + '" data-row="' + idx + '">' +
      '<td class="txt"><input class="txt" data-lane="' + idx + '" data-f="origin" value="' + esc(lane.origin) + '"></td>' +
      '<td class="txt"><input class="txt" data-lane="' + idx + '" data-f="dest" value="' + esc(lane.dest) + '"></td>' +
      '<td class="txt"><select data-lane="' + idx + '" data-f="vehicle">' + veh + '</select></td>' +
      "<td>" + inp("spaces") + "</td><td>" + inp("trips") + "</td><td>" + inp("hrs") + "</td><td>" + inp("km") + "</td>" +
      "<td>" + inp("tolls") + "</td><td>" + inp("overnight") + "</td><td>" + inp("loadExtras") + "</td>" +
      '<td class="calc">' + fmtMoney2(r.cost) + "</td>" +
      '<td class="calc">' + fmtMoney2(r.base) + "</td>" +
      '<td class="calc">' + fmtMoney2(r.priceFL) + "</td>" +
      '<td class="calc">' + (r.decision ? fmtPct(r.margin) : "—") + "</td>" +
      '<td class="calc">' + fmtMoney(r.annualRev) + "</td>" +
      '<td class="calc">' + fmtMoney(r.annualGP) + "</td>" +
      '<td class="calc cell-dec dec-' + (r.decision || "") + '">' + (r.decision || "—") + "</td>" +
      '<td><input class="qflag" data-lane="' + idx + '" data-f="quote" value="' + esc(lane.quote) + '" maxlength="1"></td>' +
      '<td><button class="rowdel" data-del="' + idx + '" title="Delete lane">×</button></td>' +
      "</tr>";
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
    var tr = el("lanesBody").querySelector('tr[data-row="' + idx + '"]');
    if (!tr) return;
    var lane = state.lanes[idx], r = E.computeLane(lane, state.settings);
    var cells = tr.querySelectorAll("td.calc");
    cells[0].textContent = fmtMoney2(r.cost);
    cells[1].textContent = fmtMoney2(r.base);
    cells[2].textContent = fmtMoney2(r.priceFL);
    cells[3].textContent = r.decision ? fmtPct(r.margin) : "—";
    cells[4].textContent = fmtMoney(r.annualRev);
    cells[5].textContent = fmtMoney(r.annualGP);
    var dec = cells[6];
    dec.textContent = r.decision || "—";
    dec.className = "calc cell-dec dec-" + (r.decision || "");
    tr.className = "row-" + (r.decision || "none");
  }
  function bindLanes() {
    var body = el("lanesBody");
    body.addEventListener("input", function (e) {
      var t = e.target, idx = t.dataset.lane;
      if (idx == null) return;
      var field = t.dataset.f;
      state.lanes[idx][field] = t.value;
      recalcLaneRow(parseInt(idx, 10));
      markDirty();
    });
    body.addEventListener("change", function (e) {
      if (e.target.dataset.f === "vehicle") { recalcLaneRow(parseInt(e.target.dataset.lane, 10)); markDirty(); }
    });
    body.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]"); if (!del) return;
      state.lanes.splice(parseInt(del.dataset.del, 10), 1);
      renderLanes(); markDirty();
    });
    el("laneSearch").addEventListener("input", function () { laneFilter = this.value; renderLanes(); });
    el("btnAddLane").addEventListener("click", function () {
      state.lanes.unshift({ origin: "", dest: "", vehicle: "Rigid", spaces: "", trips: "", hrs: "", km: "", tolls: "", overnight: "", loadExtras: "", quote: "" });
      laneFilter = ""; el("laneSearch").value = ""; renderLanes(); markDirty();
    });
  }

  // ---- warehousing ---------------------------------------------------------
  var WH_INPUTS = ["pallets", "inb", "outb", "cases", "vasHrs", "other"];
  function whRowHtml(acc, idx) {
    var r = E.computeWarehouse(acc, state.warehousing);
    function inp(field) { return '<input data-acc="' + idx + '" data-f="' + field + '" value="' + esc(acc[field]) + '" inputmode="decimal">'; }
    return '<tr class="row-' + (r.decision || "none") + '" data-arow="' + idx + '">' +
      '<td class="txt"><input class="txt" data-acc="' + idx + '" data-f="customer" value="' + esc(acc.customer) + '"></td>' +
      "<td>" + inp("pallets") + "</td><td>" + inp("inb") + "</td><td>" + inp("outb") + "</td>" +
      "<td>" + inp("cases") + "</td><td>" + inp("vasHrs") + "</td><td>" + inp("other") + "</td>" +
      '<td class="calc">' + fmtMoney2(r.cost) + "</td>" +
      '<td class="calc">' + fmtMoney2(r.base) + "</td>" +
      '<td class="calc">' + (r.decision ? fmtPct(r.margin) : "—") + "</td>" +
      '<td class="calc">' + fmtMoney2(r.perPallet) + "</td>" +
      '<td class="calc">' + fmtMoney(r.annualRev) + "</td>" +
      '<td class="calc">' + fmtMoney(r.annualGP) + "</td>" +
      '<td class="calc cell-dec dec-' + (r.decision || "") + '">' + (r.decision || "—") + "</td>" +
      '<td><input class="qflag" data-acc="' + idx + '" data-f="quote" value="' + esc(acc.quote) + '" maxlength="1"></td>' +
      "</tr>";
  }
  function renderWarehousing() {
    document.querySelectorAll("[data-wh]").forEach(function (inp) { inp.value = state.warehousing[inp.dataset.wh]; });
    var html = "";
    state.accounts.forEach(function (a, i) { html += whRowHtml(a, i); });
    el("whBody").innerHTML = html;
  }
  function recalcWhRow(idx) {
    var tr = el("whBody").querySelector('tr[data-arow="' + idx + '"]'); if (!tr) return;
    var r = E.computeWarehouse(state.accounts[idx], state.warehousing);
    var c = tr.querySelectorAll("td.calc");
    c[0].textContent = fmtMoney2(r.cost); c[1].textContent = fmtMoney2(r.base);
    c[2].textContent = r.decision ? fmtPct(r.margin) : "—"; c[3].textContent = fmtMoney2(r.perPallet);
    c[4].textContent = fmtMoney(r.annualRev); c[5].textContent = fmtMoney(r.annualGP);
    c[6].textContent = r.decision || "—"; c[6].className = "calc cell-dec dec-" + (r.decision || "");
    tr.className = "row-" + (r.decision || "none");
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
      state.accounts[idx][e.target.dataset.f] = e.target.value;
      recalcWhRow(parseInt(idx, 10)); markDirty();
    });
  }

  // ---- leg builder ---------------------------------------------------------
  function renderLegBuilder() {
    var lb = state.legBuilder;
    document.querySelectorAll("[data-lb]").forEach(function (inp) { inp.value = lb[inp.dataset.lb]; });
    var html = "";
    lb.legs.forEach(function (leg, i) {
      html += '<tr><td>' + (i + 1) + '</td>' +
        '<td class="txt"><input class="txt" data-leg="' + i + '" data-f="label" value="' + esc(leg.label) + '"></td>' +
        '<td class="txt"><input class="txt" data-leg="' + i + '" data-f="type" value="' + esc(leg.type) + '"></td>' +
        '<td><input data-leg="' + i + '" data-f="hours" value="' + esc(leg.hours) + '" inputmode="decimal"></td>' +
        '<td><input data-leg="' + i + '" data-f="km" value="' + esc(leg.km) + '" inputmode="decimal"></td></tr>';
    });
    el("legBody").innerHTML = html;
    recalcLegPreview();
  }
  function recalcLegPreview() {
    var r = E.computeLegs(state.legBuilder, state.settings);
    el("legTotHrs").textContent = r.totalHours;
    el("legTotKm").textContent = r.totalKm;
    var rows = [
      ["Total hours", r.totalHours], ["Total km", r.totalKm],
      ["Loaded $/hr", fmtMoney2(r.loaded)], ["Vehicle $/km", fmtMoney2(r.veh)],
      ["Labour $", fmtMoney2(r.labour)], ["Fuel &amp; vehicle $", fmtMoney2(r.fuelVeh)],
      ["Extras $", fmtMoney2(r.extras)], ["Cost / trip", fmtMoney2(r.cost)],
      ["Base price (excl FL)", fmtMoney2(r.base)], ["Price + fuel levy", fmtMoney2(r.priceFL)],
      ["Margin %", fmtPct(r.margin)], ["Per pallet space", fmtMoney2(r.perSpace)],
      ["Per hour", fmtMoney2(r.perHour)], ["Annual revenue", fmtMoney(r.annualRev)],
      ["Annual GP", fmtMoney(r.annualGP)]
    ];
    el("legPreview").innerHTML = rows.map(function (x, i) {
      var big = (i >= 13) ? " big" : "";
      return "<dt>" + x[0] + "</dt><dd class='" + (i === 9 || i >= 13 ? "big" : "") + "'>" + x[1] + "</dd>";
    }).join("");
  }
  function bindLegBuilder() {
    document.querySelectorAll("[data-lb]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var v = inp.value;
        state.legBuilder[inp.dataset.lb] = (inp.tagName === "SELECT") ? v : (v === "" ? "" : (isNaN(parseFloat(v)) ? v : parseFloat(v)));
        if (inp.dataset.lb === "vehicle") state.legBuilder.vehicle = v;
        recalcLegPreview(); markDirty();
      });
    });
    el("legBody").addEventListener("input", function (e) {
      var i = e.target.dataset.leg; if (i == null) return;
      state.legBuilder.legs[i][e.target.dataset.f] = e.target.value;
      recalcLegPreview(); markDirty();
    });
  }

  // ---- summary -------------------------------------------------------------
  function dl(rows) {
    return rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("");
  }
  function renderSummary() {
    var s = E.computeSummary(state), t = s.transport, w = s.warehousing, c = s.combined;
    el("sumTransport").innerHTML = dl([
      ["Weekly revenue", fmtMoney(t.weekRev)], ["Weekly cost", fmtMoney(t.weekCost)],
      ["Weekly GP", fmtMoney(t.weekGP)], ["Blended margin %", fmtPct(t.margin)],
      ["Annual revenue", fmtMoney(t.annualRev)], ["Annual GP", fmtMoney(t.annualGP)],
      ["Lanes priced", t.priced], ["GO / REVIEW / NO-GO", t.go + " / " + t.review + " / " + t.nogo]
    ]);
    el("sumWarehouse").innerHTML = dl([
      ["Weekly revenue", fmtMoney(w.weekRev)], ["Weekly cost", fmtMoney(w.weekCost)],
      ["Weekly GP", fmtMoney(w.weekGP)], ["Blended margin %", fmtPct(w.margin)],
      ["Annual revenue", fmtMoney(w.annualRev)], ["Annual GP", fmtMoney(w.annualGP)],
      ["Accounts priced", w.priced], ["GO / REVIEW / NO-GO", w.go + " / " + w.review + " / " + w.nogo]
    ]);
    el("sumCombined").innerHTML = dl([
      ["Weekly revenue", fmtMoney(c.weekRev)], ["Weekly GP", fmtMoney(c.weekGP)],
      ["Blended margin %", fmtPct(c.margin)], ["Annual revenue", fmtMoney(c.annualRev)],
      ["Annual GP", fmtMoney(c.annualGP)]
    ]);
  }

  // ---- quote ---------------------------------------------------------------
  function renderQuote() {
    document.querySelectorAll("[data-q]").forEach(function (inp) { inp.value = state.quote[inp.dataset.q] || ""; });
    var q = E.buildQuote(state), html = "";

    html += '<div class="qsection"><h3>Transport — Linehaul &amp; Metro Lanes</h3>';
    if (q.transport.length) {
      html += '<table><thead><tr><th>Origin</th><th>Destination</th><th>Vehicle</th><th>Spaces</th><th>Trips/wk</th><th>Rate/trip</th><th>Weekly $</th><th>Annual $</th></tr></thead><tbody>';
      q.transport.forEach(function (r) {
        html += "<tr><td>" + esc(r.origin) + "</td><td>" + esc(r.dest) + "</td><td>" + esc(r.vehicle) + "</td><td>" + fmtNum(r.spaces) + "</td><td>" + fmtNum(r.trips) + "</td><td>" + fmtMoney2(r.ratePerTrip) + "</td><td>" + fmtMoney2(r.weekly) + "</td><td>" + fmtMoney(r.annual) + "</td></tr>";
      });
      html += "</tbody><tfoot><tr><td colspan='6'>Transport subtotal</td><td>" + fmtMoney2(q.transportWeekly) + "</td><td>" + fmtMoney(q.transportAnnual) + "</td></tr></tfoot></table>";
    } else { html += '<p class="empty">No transport lanes flagged. Set Quote? = Y on the Lanes tab.</p>'; }
    html += "</div>";

    html += '<div class="qsection"><h3>Warehousing — Storage, Handling &amp; VAS</h3>';
    if (q.warehousing.length) {
      html += '<table><thead><tr><th>Customer</th><th>Pallets</th><th>Inb/wk</th><th>Outb/wk</th><th>Cases/wk</th><th>$/pallet</th><th>Weekly $</th><th>Annual $</th></tr></thead><tbody>';
      q.warehousing.forEach(function (r) {
        html += "<tr><td>" + esc(r.customer) + "</td><td>" + fmtNum(r.pallets) + "</td><td>" + fmtNum(r.inb) + "</td><td>" + fmtNum(r.outb) + "</td><td>" + fmtNum(r.cases) + "</td><td>" + fmtMoney2(r.perPallet) + "</td><td>" + fmtMoney2(r.weekly) + "</td><td>" + fmtMoney(r.annual) + "</td></tr>";
      });
      html += "</tbody><tfoot><tr><td colspan='6'>Warehousing subtotal</td><td>" + fmtMoney2(q.warehousingWeekly) + "</td><td>" + fmtMoney(q.warehousingAnnual) + "</td></tr></tfoot></table>";
    } else { html += '<p class="empty">No warehousing accounts flagged. Set Quote? = Y on the Warehousing tab.</p>'; }
    html += "</div>";

    html += '<div class="qtotal"><span>TOTAL CONTRACT VALUE</span><span>Weekly ' + fmtMoney2(q.totalWeekly) + " &nbsp;·&nbsp; Annual <b>" + fmtMoney(q.totalAnnual) + "</b></span></div>";
    el("quotePreview").innerHTML = html;
  }
  function bindQuote() {
    document.querySelectorAll("[data-q]").forEach(function (inp) {
      inp.addEventListener("input", function () { state.quote[inp.dataset.q] = inp.value; markDirty(); });
    });
    el("btnPdf").addEventListener("click", generatePdf);
  }
  function generatePdf() {
    var q = E.buildQuote(state);
    if (!q.transport.length && !q.warehousing.length) {
      return toast("Nothing flagged for the quote — set Quote? = Y on Lanes or Warehousing.", true);
    }
    save();
    var btn = el("btnPdf"); btn.disabled = true; btn.textContent = "Generating…";
    fetch("/api/quote/pdf", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote: state.quote, computed: q })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        btn.disabled = false; btn.textContent = "▶ Generate Quote PDF";
        if (res.ok) toast("PDF saved: " + res.filename);
        else toast(res.error || "PDF failed", true);
      })
      .catch(function (e) { btn.disabled = false; btn.textContent = "▶ Generate Quote PDF"; toast("PDF failed: " + e, true); });
  }

  // ---- reset ---------------------------------------------------------------
  function bindReset() {
    el("btnReset").addEventListener("click", function () {
      if (!confirm("Reset the workbook?\n\nThis clears all pricing inputs and restores Settings defaults.\nLane and customer names are kept as the template.")) return;
      // Keep names, wipe inputs (mirrors the workbook's Reset macro)
      var keptLanes = state.lanes.map(function (l) {
        return { origin: l.origin, dest: l.dest, vehicle: l.vehicle, spaces: "", trips: "", hrs: "", km: "", tolls: "", overnight: "", loadExtras: "", quote: "" };
      });
      var keptAccounts = state.accounts.map(function (a) { return Seed.emptyAccount(a.customer); });
      state = Seed.defaultState(seedLanes);
      state.lanes = keptLanes;
      state.accounts = keptAccounts;
      save();
      renderActive(document.querySelector(".tab.active").dataset.tab);
      toast("Workbook reset to template.");
    });
  }

  // ---- toast ---------------------------------------------------------------
  var toastTimer;
  function toast(msg, isErr) {
    var t = el("toast"); t.innerHTML = msg; t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = "toast"; }, 4000);
  }

  // ---- boot ----------------------------------------------------------------
  load().then(function () {
    setupTabs(); bindSettings(); bindLanes(); bindWarehousing();
    bindLegBuilder(); bindQuote(); bindReset();
    renderSettings();
  });
})();
