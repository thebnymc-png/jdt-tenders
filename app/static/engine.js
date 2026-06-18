/* JDT Pricing Model — calculation engine.
 * Ported 1:1 from the original Excel workbook formulas.
 * Pure functions, no DOM access, so it can be unit-tested under Node.
 */
(function (root) {
  "use strict";

  // ---- helpers -------------------------------------------------------------
  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function isBlank(v) {
    return v === null || v === undefined || String(v).trim() === "";
  }

  // Vehicle running cost $/km  (Excel: CHOOSE/MATCH, default Rigid)
  function vehicleRate(vehicle, s) {
    switch (String(vehicle || "").trim().toLowerCase()) {
      case "ute": return num(s.vehicleRateUte);
      case "rigid": return num(s.vehicleRateRigid);
      case "semi": return num(s.vehicleRateSemi);
      case "bdouble": return num(s.vehicleRateBdouble);
      default: return num(s.vehicleRateRigid);
    }
  }

  // Loaded $/hr = base * OT * (1+super) * (1 + workcover + payroll)
  function loadedFromBase(base, s) {
    return num(base) * num(s.otMultiplier) *
      (1 + num(s.superRate)) *
      (1 + num(s.workcoverRate) + num(s.payrollTaxRate));
  }
  // Day Rate (short/metro runs) and LineHaul (long runs) loaded $/hr.
  function loadedDayRate(s) { return loadedFromBase(s.driverBaseHourly, s); }
  function loadedLineHaulRate(s) {
    var lh = num(s.linehaulHourly);
    return lh > 0 ? loadedFromBase(lh, s) : loadedDayRate(s);  // fall back to day rate
  }
  // Day Rate for RT ≤ threshold km, else LineHaul (workbook: 250km cutoff).
  function rateForKm(km, s) {
    var thr = num(s.linehaulThresholdKm) || 250;
    return num(km) > thr ? loadedLineHaulRate(s) : loadedDayRate(s);
  }
  // Back-compat alias — the Day Rate (Settings view + legacy callers).
  function loadedHourlyRate(s) { return loadedDayRate(s); }

  // Base price from cost + target margin (guard: margin >= 100% => price = cost)
  function pricedUp(cost, targetPct) {
    var t = num(targetPct) / 100;
    return t >= 1 ? cost : cost / (1 - t);
  }

  function decision(marginFrac, targetPct) {
    var t = num(targetPct) / 100;
    if (marginFrac >= t) return "GO";
    if (marginFrac >= (num(targetPct) - 8) / 100) return "REVIEW";
    return "NO-GO";
  }

  // ---- transport lane ------------------------------------------------------
  function computeLane(lane, s) {
    var hrs = num(lane.hrs), km = num(lane.km);
    var loaded = rateForKm(km, s);            // Day Rate ≤250km RT, else LineHaul
    var veh = vehicleRate(lane.vehicle, s);
    var labour = hrs * loaded;
    var fuelVeh = km * veh;
    var extras = num(lane.tolls) + num(lane.overnight) + num(lane.loadExtras);
    var cost = labour + fuelVeh + extras;
    var base = pricedUp(cost, s.targetMarginPct);
    var priceFL = base * (1 + num(s.fuelLevyPct) / 100);
    var margin = priceFL > 0 ? (priceFL - cost) / priceFL : 0;
    var spaces = num(lane.spaces), trips = num(lane.trips);
    var perSpace = spaces > 0 ? base / spaces : 0;
    var perHour = hrs > 0 ? base / hrs : 0;
    var tonnes = num(lane.tonnes);
    var perTonne = tonnes > 0 ? base / tonnes : 0;
    var perTonneFL = tonnes > 0 ? priceFL / tonnes : 0;
    var annualRev = priceFL * trips * 52;
    var annualGP = (priceFL - cost) * trips * 52;

    // Decision blank unless origin/dest/spaces/trips all present & non-zero
    var dec = "";
    if (!(isBlank(lane.origin) || isBlank(lane.dest) ||
          isBlank(lane.spaces) || isBlank(lane.trips) ||
          spaces === 0 || trips === 0)) {
      dec = decision(margin, s.targetMarginPct);
    }
    return {
      loaded: loaded, veh: veh, labour: labour, fuelVeh: fuelVeh,
      extras: extras, cost: cost, base: base, priceFL: priceFL,
      margin: margin, perSpace: perSpace, perHour: perHour,
      tonnes: tonnes, perTonne: perTonne, perTonneFL: perTonneFL,
      annualRev: annualRev, annualGP: annualGP, decision: dec
    };
  }

  // ---- per-tonne banded pricing -------------------------------------------
  // Ported from the workbook "Methodology" §5 and the "Per-Tonne Analysis" tab.
  // Per-tonne rates are derived from a lane's FTL prices, then a load is billed
  // at MAX(Min Charge, band $/t × actual tonnes).
  //
  // Two anchoring methods (selectable):
  //   A — ceiling-anchored (current Simplot v3 rate card): FTL ÷ band ceiling.
  //   B — midpoint-anchored (proposed): FTL ÷ band midpoint. Defensible because
  //       real median loads cluster near band midpoints, not ceilings.
  // 0-5 / 5-10 / 10-14 bands ride a Rigid; the 14t+ band rides a Semi.
  var BAND_DIVISORS = {
    A: { t0_5: 5,   t5_10: 10,  t10_14: 14, t14: 22 },  // FTL ÷ band ceiling
    B: { t0_5: 2.5, t5_10: 7.5, t10_14: 12, t14: 18 }   // FTL ÷ band midpoint
  };

  function round2(n) { return Math.round(num(n) * 100) / 100; }

  // Min Charge + four band $/t from a lane's FTL Single (Semi) and FTL Rigid.
  // FTL values round to whole dollars (rate-card convention); $/t to 2dp.
  function bandRates(ftlSemi, ftlRigid, method) {
    var m = String(method || "A").toUpperCase();
    var d = BAND_DIVISORS[m] || BAND_DIVISORS.A;
    var semi = Math.round(num(ftlSemi)), rigid = Math.round(num(ftlRigid));
    return {
      method: m, ftlSingle: semi, ftlRigid: rigid,
      minCharge: Math.round(rigid * 0.85),   // floor for sub-tonne loads
      t0_5: round2(rigid / d.t0_5),
      t5_10: round2(rigid / d.t5_10),
      t10_14: round2(rigid / d.t10_14),
      t14: round2(semi / d.t14)
    };
  }

  // Which band a load falls in, and its $/t. Edges: (0,5], (5,10], (10,14], (14,∞).
  function bandForTonnes(tonnes, rates) {
    var t = num(tonnes);
    if (t <= 5)  return { band: "0-5t",   rate: num(rates.t0_5) };
    if (t <= 10) return { band: "5-10t",  rate: num(rates.t5_10) };
    if (t <= 14) return { band: "10-14t", rate: num(rates.t10_14) };
    return { band: "14t+", rate: num(rates.t14) };
  }

  // Quote one load: billed = MAX(Min Charge, band $/t × tonnes).
  function quoteTonnage(tonnes, rates) {
    var t = num(tonnes), b = bandForTonnes(t, rates);
    var tierCalc = b.rate * t;
    var min = num(rates.minCharge);
    var quoted = Math.max(min, tierCalc);
    return {
      tonnes: t, band: b.band, bandRate: b.rate,
      tierCalc: tierCalc, quoted: quoted,
      // true when the Min Charge floor is what's actually billed (band rate didn't bite)
      minChargeApplied: tierCalc < min
    };
  }

  // Full band table for a lane, computed live from settings. FTL Semi and FTL
  // Rigid are the same trip priced on each vehicle (matches the workbook build).
  function computeLaneBands(lane, s, method) {
    var semi  = computeLane(Object.assign({}, lane, { vehicle: "semi" }),  s).base;
    var rigid = computeLane(Object.assign({}, lane, { vehicle: "rigid" }), s).base;
    return bandRates(semi, rigid, method);
  }

  // ---- shipment-level analysis (Per-Tonne Analysis §3-§4) -----------------
  // Groups raw shipments by the lane that serves their destination, buckets
  // them into bands, and simulates billed revenue under Method A vs B.
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; }), m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function normKey(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function shipTonnes(sh) { return num(sh.tonnes) || num(sh.weightKg) / 1000; }

  function analyseShipments(shipments, lanes, s) {
    var bySuburb = {}, byPc = {};
    (lanes || []).forEach(function (l) {
      var su = normKey(l.delSuburb), pc = normKey(l.delPostcode);
      if (su && !bySuburb[su]) bySuburb[su] = l;
      if (pc && !byPc[pc]) byPc[pc] = l;
    });
    function matchLane(sh) {
      var d = normKey(sh.dest), pc = normKey(sh.postcode);
      if (pc && byPc[pc]) return byPc[pc];
      if (d && bySuburb[d]) return bySuburb[d];
      if (d) { for (var k in bySuburb) { if (k && (d.indexOf(k) >= 0 || k.indexOf(d) >= 0)) return bySuburb[k]; } }
      return null;
    }
    var groups = {}, order = [], unmatched = { n: 0, tonnes: 0 };
    (shipments || []).forEach(function (sh) {
      var t = shipTonnes(sh);
      if (t <= 0) return;
      var lane = matchLane(sh);
      if (!lane) { unmatched.n++; unmatched.tonnes += t; return; }
      var key = lane.id || (normKey(lane.delSuburb) + "|" + normKey(lane.delPostcode));
      if (!groups[key]) {
        groups[key] = { lane: lane, tonnes: [], bandsA: computeLaneBands(lane, s, "A"), bandsB: computeLaneBands(lane, s, "B") };
        order.push(key);
      }
      groups[key].tonnes.push(t);
    });
    var rows = order.map(function (key) {
      var g = groups[key], revA = 0, revB = 0, bands = { "0-5t": 0, "5-10t": 0, "10-14t": 0, "14t+": 0 };
      g.tonnes.forEach(function (t) {
        revA += quoteTonnage(t, g.bandsA).quoted;
        revB += quoteTonnage(t, g.bandsB).quoted;
        bands[bandForTonnes(t, g.bandsA).band]++;
      });
      return {
        dest: g.lane.delSuburb || g.lane.delPostcode || "—",
        n: g.tonnes.length,
        totalTonnes: g.tonnes.reduce(function (a, x) { return a + x; }, 0),
        median: median(g.tonnes), bands: bands, minCharge: g.bandsA.minCharge,
        revA: revA, revB: revB, uplift: revA > 0 ? (revB - revA) / revA : 0
      };
    });
    var totA = rows.reduce(function (a, r) { return a + r.revA; }, 0);
    var totB = rows.reduce(function (a, r) { return a + r.revB; }, 0);
    return {
      rows: rows, unmatched: unmatched,
      totals: {
        n: rows.reduce(function (a, r) { return a + r.n; }, 0),
        totalTonnes: rows.reduce(function (a, r) { return a + r.totalTonnes; }, 0),
        revA: totA, revB: totB, uplift: totA > 0 ? (totB - totA) / totA : 0
      }
    };
  }

  // ---- warehousing account -------------------------------------------------
  function computeWarehouse(acc, w) {
    var pallets = num(acc.pallets);
    var storage = pallets * num(w.storageRate);
    var inbound = num(acc.inb) * num(w.inboundRate);
    var outbound = num(acc.outb) * num(w.outboundRate);
    var casePick = num(acc.cases) * num(w.casePickRate);
    var vas = num(acc.vasHrs) * num(w.labourRate);
    var overhead = pallets * num(w.overheadRate);
    var cost = storage + inbound + outbound + casePick + vas + overhead + num(acc.other);
    var base = pricedUp(cost, w.targetMargin);
    var margin = base > 0 ? (base - cost) / base : 0;
    var perPallet = pallets > 0 ? base / pallets : 0;
    var annualRev = base * 52;
    var annualGP = (base - cost) * 52;
    var dec = "";
    if (!(isBlank(acc.customer) || isBlank(acc.pallets) || pallets === 0)) {
      dec = decision(margin, w.targetMargin);
    }
    return {
      storage: storage, inbound: inbound, outbound: outbound,
      casePick: casePick, vas: vas, overhead: overhead, cost: cost,
      base: base, margin: margin, perPallet: perPallet,
      annualRev: annualRev, annualGP: annualGP, decision: dec
    };
  }

  // ---- leg builder ---------------------------------------------------------
  function computeLegs(lb, s) {
    var totalHours = 0, totalKm = 0;
    (lb.legs || []).forEach(function (leg) {
      totalHours += num(leg.hours);
      totalKm += num(leg.km);
    });
    var loaded = rateForKm(totalKm, s);       // Day Rate ≤250km, else LineHaul
    var veh = vehicleRate(lb.vehicle, s);
    var labour = totalHours * loaded;
    var fuelVeh = totalKm * veh;
    var extras = num(lb.tolls) + num(lb.overnight) + num(lb.loadExtras);
    var cost = labour + fuelVeh + extras;
    var base = pricedUp(cost, s.targetMarginPct);
    var priceFL = base * (1 + num(s.fuelLevyPct) / 100);
    var margin = priceFL > 0 ? (priceFL - cost) / priceFL : 0;
    var spaces = num(lb.spaces), trips = num(lb.trips), tonnes = num(lb.tonnes);
    return {
      totalHours: totalHours, totalKm: totalKm, loaded: loaded, veh: veh,
      labour: labour, fuelVeh: fuelVeh, extras: extras, cost: cost,
      base: base, priceFL: priceFL, margin: margin,
      perSpace: spaces > 0 ? base / spaces : 0,
      perHour: totalHours > 0 ? base / totalHours : 0,
      tonnes: tonnes, perTonne: tonnes > 0 ? base / tonnes : 0, perTonneFL: tonnes > 0 ? priceFL / tonnes : 0,
      annualRev: priceFL * trips * 52,
      annualGP: (priceFL - cost) * trips * 52
    };
  }

  // ---- portfolio summary ---------------------------------------------------
  function computeSummary(state) {
    var s = state.settings, w = state.warehousing;
    var tWeekRev = 0, tWeekCost = 0, go = 0, review = 0, nogo = 0, priced = 0;
    (state.lanes || []).forEach(function (lane) {
      var r = computeLane(lane, s);
      var trips = num(lane.trips);
      tWeekRev += r.priceFL * trips;     // SUMPRODUCT(S, F)
      tWeekCost += r.cost * trips;        // SUMPRODUCT(Q, F)
      if (r.decision === "GO") { go++; priced++; }
      else if (r.decision === "REVIEW") { review++; priced++; }
      else if (r.decision === "NO-GO") { nogo++; priced++; }
    });
    var tWeekGP = tWeekRev - tWeekCost;

    var hWeekRev = 0, hWeekCost = 0, hgo = 0, hreview = 0, hnogo = 0, hpriced = 0;
    (state.accounts || []).forEach(function (acc) {
      var r = computeWarehouse(acc, w);
      hWeekRev += r.base;   // SUM(P)
      hWeekCost += r.cost;  // SUM(O)
      if (r.decision === "GO") { hgo++; hpriced++; }
      else if (r.decision === "REVIEW") { hreview++; hpriced++; }
      else if (r.decision === "NO-GO") { hnogo++; hpriced++; }
    });
    var hWeekGP = hWeekRev - hWeekCost;

    return {
      transport: {
        weekRev: tWeekRev, weekCost: tWeekCost, weekGP: tWeekGP,
        margin: tWeekRev > 0 ? tWeekGP / tWeekRev : 0,
        annualRev: tWeekRev * 52, annualGP: tWeekGP * 52,
        priced: priced, go: go, review: review, nogo: nogo
      },
      warehousing: {
        weekRev: hWeekRev, weekCost: hWeekCost, weekGP: hWeekGP,
        margin: hWeekRev > 0 ? hWeekGP / hWeekRev : 0,
        annualRev: hWeekRev * 52, annualGP: hWeekGP * 52,
        priced: hpriced, go: hgo, review: hreview, nogo: hnogo
      },
      combined: {
        weekRev: tWeekRev + hWeekRev,
        weekGP: tWeekGP + hWeekGP,
        margin: (tWeekRev + hWeekRev) > 0 ? (tWeekGP + hWeekGP) / (tWeekRev + hWeekRev) : 0,
        annualRev: (tWeekRev + hWeekRev) * 52,
        annualGP: (tWeekGP + hWeekGP) * 52
      }
    };
  }

  // ---- quote builder -------------------------------------------------------
  // Pulls flagged lanes (quote === "Y") up to 20 and accounts up to 10,
  // in sheet order, mirroring the Quote sheet's INDEX/MATCH sequence.
  function buildQuote(state) {
    var s = state.settings, w = state.warehousing;
    var transport = [];
    (state.lanes || []).forEach(function (lane) {
      if (String(lane.quote || "").trim().toUpperCase() === "Y" && transport.length < 20) {
        var r = computeLane(lane, s);
        transport.push({
          origin: lane.origin || "", dest: lane.dest || "",
          vehicle: lane.vehicle || "", spaces: num(lane.spaces),
          trips: num(lane.trips), tonnes: num(lane.tonnes), ratePerTonne: r.perTonneFL,
          ratePerTrip: r.priceFL,
          weekly: r.priceFL * num(lane.trips),
          annual: r.priceFL * num(lane.trips) * 52
        });
      }
    });
    var warehousing = [];
    (state.accounts || []).forEach(function (acc) {
      if (String(acc.quote || "").trim().toUpperCase() === "Y" && warehousing.length < 10) {
        var r = computeWarehouse(acc, w);
        warehousing.push({
          customer: acc.customer || "", pallets: num(acc.pallets),
          inb: num(acc.inb), outb: num(acc.outb), cases: num(acc.cases),
          perPallet: r.perPallet, weekly: r.base, annual: r.annualRev
        });
      }
    });
    var tW = transport.reduce(function (a, x) { return a + x.weekly; }, 0);
    var tA = transport.reduce(function (a, x) { return a + x.annual; }, 0);
    var hW = warehousing.reduce(function (a, x) { return a + x.weekly; }, 0);
    var hA = warehousing.reduce(function (a, x) { return a + x.annual; }, 0);
    return {
      transport: transport, warehousing: warehousing,
      transportWeekly: tW, transportAnnual: tA,
      warehousingWeekly: hW, warehousingAnnual: hA,
      totalWeekly: tW + hW, totalAnnual: tA + hA
    };
  }

  // ---- operational lane pricing (within a tender) --------------------------
  // Maps a tender's operational lane onto the lane shape the cost engine needs.
  function priceOpLane(l, s) {
    // tonnes per trip: explicit field, else derived from operational weight (kg)
    var tonnes = num(l.tonnes) || num(l.weightKg) / 1000;
    return computeLane({
      origin: l.collPostcode || l.collSuburb, dest: l.delPostcode || l.delSuburb,
      vehicle: l.vehicle, spaces: l.pallets, trips: l.freq, tonnes: tonnes,
      hrs: l.hrs, km: l.km, tolls: l.tolls, overnight: l.overnight, loadExtras: l.loadExtras
    }, s);
  }
  function computeTender(t, s) {
    var wr = 0, wc = 0, go = 0, review = 0, nogo = 0, pallets = 0, tonnes = 0;
    (t.lanes || []).forEach(function (l) {
      var r = priceOpLane(l, s), freq = num(l.freq);
      wr += r.priceFL * freq; wc += r.cost * freq; pallets += num(l.pallets) * freq; tonnes += r.tonnes * freq;
      if (r.decision === "GO") go++; else if (r.decision === "REVIEW") review++; else if (r.decision === "NO-GO") nogo++;
    });
    return {
      weeklyRev: wr, weeklyCost: wc, weeklyGP: wr - wc, annualRev: wr * 52, annualGP: (wr - wc) * 52,
      margin: wr > 0 ? (wr - wc) / wr : 0, laneCount: (t.lanes || []).length,
      go: go, review: review, nogo: nogo, totalPalletsWk: pallets, totalTonnesWk: tonnes
    };
  }

  // ---- tender pipeline -----------------------------------------------------
  var OPEN_STATUSES = { "Draft": 1, "Submitted": 1, "Shortlisted": 1 };

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var d = new Date(dateStr); if (isNaN(d)) return null;
    d.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  // Row state for due-date highlighting (open tenders only).
  function tenderDueState(t) {
    if (!t || !OPEN_STATUSES[t.status || "Draft"]) return "";
    var days = daysUntil(t.dueDate);
    if (days === null) return "";
    if (days < 0) return "overdue";
    if (days <= 14) return "soon";
    return "";
  }

  function computePipeline(tenders) {
    var s = {
      total: 0, byStatus: {}, openCount: 0, openValue: 0, weightedValue: 0,
      wonCount: 0, wonValue: 0, lostCount: 0, lostValue: 0,
      winRate: 0, dueSoon: 0, overdue: 0
    };
    (tenders || []).forEach(function (t) {
      s.total++;
      var st = t.status || "Draft";
      s.byStatus[st] = (s.byStatus[st] || 0) + 1;
      var v = num(t.value);
      if (OPEN_STATUSES[st]) {
        s.openCount++;
        s.openValue += v;
        s.weightedValue += v * num(t.probability) / 100;
        var ds = tenderDueState(t);
        if (ds === "overdue") s.overdue++;
        else if (ds === "soon") s.dueSoon++;
      }
      if (st === "Won") { s.wonCount++; s.wonValue += v; }
      else if (st === "Lost") { s.lostCount++; s.lostValue += v; }
    });
    s.winRate = (s.wonCount + s.lostCount) > 0 ? s.wonCount / (s.wonCount + s.lostCount) : 0;
    return s;
  }

  var api = {
    num: num, isBlank: isBlank, vehicleRate: vehicleRate,
    loadedHourlyRate: loadedHourlyRate, loadedDayRate: loadedDayRate,
    loadedLineHaulRate: loadedLineHaulRate, rateForKm: rateForKm,
    pricedUp: pricedUp, decision: decision,
    computeLane: computeLane, computeWarehouse: computeWarehouse,
    computeLegs: computeLegs, computeSummary: computeSummary,
    buildQuote: buildQuote,
    computePipeline: computePipeline, tenderDueState: tenderDueState, daysUntil: daysUntil,
    priceOpLane: priceOpLane, computeTender: computeTender,
    BAND_DIVISORS: BAND_DIVISORS, round2: round2, bandRates: bandRates,
    bandForTonnes: bandForTonnes, quoteTonnage: quoteTonnage,
    computeLaneBands: computeLaneBands, median: median, analyseShipments: analyseShipments
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JDTEngine = api;
})(typeof window !== "undefined" ? window : this);
