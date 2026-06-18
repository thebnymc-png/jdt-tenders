/* JDT — client-side Excel/PDF generation + Excel parsing.
 * Replaces the Python backend (openpyxl / ReportLab) so the app runs fully in
 * the browser as a static site. Excel via xlsx-js-style, PDF via jsPDF.
 */
(function (root) {
  "use strict";

  // brand palette
  var NAVY = [38, 57, 91], NAVY_HEX = "FF26395B", ICE = [234, 244, 250], ICE_HEX = "FFEAF4FA",
      LINE = [216, 226, 236], MUTED = [107, 118, 134], WHITE = [255, 255, 255];

  function today() { return new Date().toISOString().slice(0, 10).replace(/-/g, ""); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function safe(s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "NA"; }
  function money(v, dp) { v = v || 0; dp = dp == null ? 0 : dp; return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function pct(v) { return (num(v) * 100).toFixed(1) + "%"; }
  function n0(v) { var f = num(v); return f === Math.round(f) ? String(Math.round(f)) : f.toLocaleString("en-AU"); }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---- Excel helpers (xlsx-js-style) --------------------------------------
  function X() { return root.XLSX; }
  var MONEY = '#,##0.00', MONEY0 = '#,##0', PCT = '0.0%';
  var HEAD_STYLE = { font: { bold: true, color: { rgb: "FFFFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: NAVY_HEX } }, alignment: { horizontal: "center", vertical: "center" } };
  var BOLD = { font: { bold: true } };

  function aoaSheet(aoa) { return X().utils.aoa_to_sheet(aoa); }
  function styleHeader(ws, rowIdx) {
    rowIdx = rowIdx || 0;
    var rng = X().utils.decode_range(ws["!ref"]);
    for (var c = rng.s.c; c <= rng.e.c; c++) {
      var ref = X().utils.encode_cell({ r: rowIdx, c: c });
      if (ws[ref]) ws[ref].s = HEAD_STYLE;
    }
  }
  // fmt: map of colIndex -> number format, applied to all body rows
  function applyFormats(ws, fmts, startRow) {
    startRow = startRow == null ? 1 : startRow;
    var rng = X().utils.decode_range(ws["!ref"]);
    for (var r = startRow; r <= rng.e.r; r++) {
      for (var c in fmts) {
        var ref = X().utils.encode_cell({ r: r, c: parseInt(c, 10) });
        if (ws[ref] && ws[ref].t === "n") ws[ref].z = fmts[c];
      }
    }
  }
  function cols(widths) { return widths.map(function (w) { return { wch: w }; }); }
  function workbookBlob(wb) {
    var out = X().write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ---- Excel: full model ---------------------------------------------------
  function excelFull(p) {
    var X_ = X(), wb = X_.utils.book_new(), s = p.settings || {};
    // Settings
    var setAoa = [["JDT Pricing Model — Settings", ""], [],
      ["Driver base hourly ($/hr)", num(s.driverBaseHourly)], ["OT multiplier", num(s.otMultiplier)],
      ["Public holiday hourly ($/hr)", num(s.publicHolidayHourly)], ["Linehaul hourly ($/hr)", num(s.linehaulHourly)],
      ["Superannuation", num(s.superRate)], ["Workcover", num(s.workcoverRate)], ["Payroll tax", num(s.payrollTaxRate)],
      ["Vehicle $/km — Ute", num(s.vehicleRateUte)], ["Vehicle $/km — Rigid", num(s.vehicleRateRigid)],
      ["Vehicle $/km — Semi", num(s.vehicleRateSemi)], ["Vehicle $/km — Bdouble", num(s.vehicleRateBdouble)],
      ["Fuel levy %", num(s.fuelLevyPct)], ["Target margin %", num(s.targetMarginPct)]];
    var wsSet = aoaSheet(setAoa); wsSet["!cols"] = cols([34, 16]);
    if (wsSet["A1"]) wsSet["A1"].s = { font: { bold: true, sz: 14, color: { rgb: NAVY_HEX } } };
    X_.utils.book_append_sheet(wb, wsSet, "Settings");
    // Lanes
    var laneHead = ["Origin", "Destination", "Vehicle", "Spaces", "Trips/wk", "Hrs/trip", "Km/trip", "Tonnes/trip", "Tolls $", "Overnight $", "Load extras $", "Cost/trip $", "Base price $", "Price+FL $", "$/tonne", "Margin %", "Annual rev $", "Annual GP $", "Decision", "Quote?"];
    var laneRows = (p.lanes || []).map(function (L) {
      return [L.origin, L.dest, L.vehicle, num(L.spaces), num(L.trips), num(L.hrs), num(L.km), num(L.tonnes), num(L.tolls), num(L.overnight), num(L.loadExtras), L.cost, L.base, L.priceFL, L.perTonne, L.margin, L.annualRev, L.annualGP, L.decision, L.quote];
    });
    var wsL = aoaSheet([laneHead].concat(laneRows)); styleHeader(wsL);
    applyFormats(wsL, { 11: MONEY, 12: MONEY, 13: MONEY, 14: MONEY, 15: PCT, 16: MONEY0, 17: MONEY0 });
    wsL["!cols"] = cols([18, 18, 9, 8, 8, 8, 8, 9, 9, 10, 11, 11, 11, 11, 9, 9, 12, 12, 9, 7]); wsL["!freeze"] = { ySplit: 1 };
    X_.utils.book_append_sheet(wb, wsL, "Lanes");
    // Warehousing
    var whHead = ["Customer", "Pallets", "Inb/wk", "Outb/wk", "Cases/wk", "VAS hrs/wk", "Other $/wk", "Cost/wk $", "Base $/wk", "Margin %", "$/pallet", "Annual rev $", "Annual GP $", "Decision", "Quote?"];
    var whRows = (p.accounts || []).map(function (A) {
      return [A.customer, num(A.pallets), num(A.inb), num(A.outb), num(A.cases), num(A.vasHrs), num(A.other), A.cost, A.base, A.margin, A.perPallet, A.annualRev, A.annualGP, A.decision, A.quote];
    });
    var wsW = aoaSheet([whHead].concat(whRows)); styleHeader(wsW);
    applyFormats(wsW, { 7: MONEY, 8: MONEY, 9: PCT, 10: MONEY, 11: MONEY0, 12: MONEY0 });
    wsW["!cols"] = cols([20, 9, 8, 8, 9, 10, 10, 11, 11, 9, 9, 12, 12, 9, 7]);
    X_.utils.book_append_sheet(wb, wsW, "Warehousing");
    // Summary
    var sm = p.summary || {};
    function blk(title, d) { return [[title, ""], ["Weekly revenue", num(d.weekRev)], ["Weekly cost", num(d.weekCost)], ["Weekly GP", num(d.weekGP)], ["Blended margin %", num(d.margin)], ["Annual revenue", num(d.annualRev)], ["Annual GP", num(d.annualGP)], []]; }
    var sumAoa = [["Portfolio Summary", ""], []]
      .concat(blk("TRANSPORT", sm.transport || {})).concat(blk("WAREHOUSING", sm.warehousing || {})).concat(blk("COMBINED", sm.combined || {}));
    var wsSum = aoaSheet(sumAoa); wsSum["!cols"] = cols([22, 16]);
    applyFormats(wsSum, { 1: MONEY0 }); X_.utils.book_append_sheet(wb, wsSum, "Summary");
    // Tenders
    tendersSheet(wb, p);
    download(workbookBlob(wb), "JDT_Model_" + today() + ".xlsx");
    return "JDT_Model_" + today() + ".xlsx";
  }

  function tendersSheet(wb, p, title) {
    var X_ = X();
    var head = ["Reference", "Customer", "Title", "Status", "Due date", "Submitted", "Value $", "Probability %", "Weighted $", "Owner", "Lanes", "Updated", "Notes"];
    var rows = (p.tenders || []).map(function (t) {
      var v = num(t.value), pr = num(t.probability);
      return [t.reference, t.customer, t.title, t.status, t.dueDate, t.submittedDate, v, pr / 100, v * pr / 100, t.owner, (t.lanes || []).length, t.updatedAt, t.notes];
    });
    var aoa = [head].concat(rows);
    var pl = p.pipeline;
    if (pl) {
      aoa.push([]); aoa.push(["PIPELINE", ""]);
      [["Open tenders", pl.openCount], ["Open value $", pl.openValue], ["Weighted value $", pl.weightedValue], ["Won value $", pl.wonValue], ["Lost value $", pl.lostValue], ["Win rate %", pl.winRate], ["Due ≤14 days", pl.dueSoon], ["Overdue", pl.overdue]].forEach(function (r) { aoa.push(r); });
    }
    var ws = aoaSheet(aoa); styleHeader(ws);
    applyFormats(ws, { 6: MONEY0, 7: PCT, 8: MONEY0 }, 1);
    ws["!cols"] = cols([16, 20, 22, 12, 11, 11, 13, 11, 13, 14, 7, 11, 30]);
    X_.utils.book_append_sheet(wb, ws, title || "Tenders");
  }

  function tendersExcel(p) {
    var wb = X().utils.book_new();
    tendersSheet(wb, p, "Tender Register");
    download(workbookBlob(wb), "JDT_Tenders_" + today() + ".xlsx");
    return "JDT_Tenders_" + today() + ".xlsx";
  }

  function quoteExcel(p) {
    var X_ = X(), wb = X_.utils.book_new(), q = p.quote || {}, c = p.computed || {};
    var aoa = [["JD Refrigerated Transport — Quotation", ""], [],
      ["Customer", q.customer], ["Contact", q.contact], ["Reference", q.reference], ["Quote #", q.quoteNumber],
      ["Issued", new Date().toLocaleDateString("en-AU")], ["Payment terms", q.terms || "14 days from invoice"], []];
    var trStart = aoa.length;
    if ((c.transport || []).length) {
      aoa.push(["TRANSPORT — LINEHAUL & METRO LANES"]);
      aoa.push(["Origin", "Destination", "Vehicle", "Spaces", "Trips/wk", "Tonnes", "$/tonne", "Rate/trip", "Weekly $", "Annual $"]);
      c.transport.forEach(function (r) { aoa.push([r.origin, r.dest, r.vehicle, num(r.spaces), num(r.trips), num(r.tonnes), num(r.tonnes) > 0 ? r.ratePerTonne : "", r.ratePerTrip, r.weekly, r.annual]); });
      aoa.push(["Transport subtotal", "", "", "", "", "", "", "", c.transportWeekly, c.transportAnnual]); aoa.push([]);
    }
    if ((c.warehousing || []).length) {
      aoa.push(["WAREHOUSING — STORAGE, HANDLING & VAS"]);
      aoa.push(["Customer", "Pallets", "Inb/wk", "Outb/wk", "Cases/wk", "$/pallet", "Weekly $", "Annual $"]);
      c.warehousing.forEach(function (r) { aoa.push([r.customer, num(r.pallets), num(r.inb), num(r.outb), num(r.cases), r.perPallet, r.weekly, r.annual]); });
      aoa.push(["Warehousing subtotal", "", "", "", "", "", c.warehousingWeekly, c.warehousingAnnual]); aoa.push([]);
    }
    aoa.push(["TOTAL CONTRACT VALUE", "", "", "", "", "", c.totalWeekly, c.totalAnnual]);
    var ws = aoaSheet(aoa); ws["!cols"] = cols([24, 16, 12, 10, 10, 9, 12, 9, 12, 12]);
    if (ws["A1"]) ws["A1"].s = { font: { bold: true, sz: 14, color: { rgb: NAVY_HEX } } };
    X_.utils.book_append_sheet(wb, ws, "Quote");
    var cust = safe(q.customer || "Quote");
    var fn = "JDT_Quote_" + cust + "_" + today() + ".xlsx";
    download(workbookBlob(wb), fn);
    return fn;
  }

  function importTemplate() {
    var X_ = X(), wb = X_.utils.book_new();
    var head = ["Collection postcode", "Collection suburb", "Delivery postcode", "Delivery suburb", "Pallets", "Weight (kg)", "Tonnes per trip", "Dimensions (LxWxH)", "Stackable (Y/N)", "Loading type", "Vehicle", "Frequency per week", "Hours per trip", "Km per trip"];
    var ex = [
      ["4110", "Acacia Ridge", "4116", "Sunnybank", 6, 420, 0.42, "1.2x1.0x1.6", "Y", "Tail-lift", "Rigid", 5, 4, 60],
      ["4110", "Acacia Ridge", "4350", "Toowoomba", 22, 9000, 9, "Std pallet", "Y", "Forklift", "Semi", 3, 9, 130]
    ];
    var ws = aoaSheet([head].concat(ex)); styleHeader(ws);
    ws["!cols"] = cols([16, 16, 14, 14, 8, 10, 13, 16, 13, 14, 9, 17, 13, 11]); ws["!freeze"] = { ySplit: 1 };
    X_.utils.book_append_sheet(wb, ws, "Tender Lanes");
    var notes = [["JDT Tender Lane Import Template"], [],
      ["1. One row per lane on 'Tender Lanes' (overwrite or delete the examples)."],
      ["2. Keep the header row so the importer maps columns automatically."],
      ["3. Postcodes/suburbs are used to plot the lane network on the map (needs internet)."],
      ["4. Pricing fields: Pallets, Vehicle, Frequency per week, Hours per trip, Km per trip."],
      ["5. Tonnes per trip is optional — fill it to see a derived $/tonne rate on each lane (falls back to Weight kg ÷ 1000)."],
      ["6. Operational-only: Weight, Dimensions, Stackable, Loading type."],
      ["7. In the app: open a tender → Operational Lanes → Import from Excel → upload this file."],
      [], ["Vehicle options:  Ute, Rigid, Semi, Bdouble"],
      ["Loading options:  Tail-lift, Dock / Ramp, Forklift, Hand unload, Crane, Side-loader"]];
    var wsN = aoaSheet(notes); wsN["!cols"] = cols([100]);
    if (wsN["A1"]) wsN["A1"].s = { font: { bold: true, sz: 14, color: { rgb: NAVY_HEX } } };
    X_.utils.book_append_sheet(wb, wsN, "How to use");
    download(workbookBlob(wb), "JDT_Tender_Import_Template_" + today() + ".xlsx");
    return "JDT_Tender_Import_Template_" + today() + ".xlsx";
  }

  // ---- PDF helpers (jsPDF + autotable) ------------------------------------
  function newDoc(landscape) { var J = root.jspdf.jsPDF; return new J({ orientation: landscape ? "l" : "p", unit: "mm", format: "a4" }); }
  function band(doc, x, y, w, h, color) { doc.setFillColor(color[0], color[1], color[2]); doc.rect(x, y, w, h, "F"); }
  function txt(doc, s, x, y, opts) {
    opts = opts || {};
    doc.setTextColor.apply(doc, opts.color || [20, 30, 45]);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 10);
    doc.text(String(s), x, y, { align: opts.align || "left" });
  }

  function quotePdf(p) {
    var doc = newDoc(false), q = p.quote || {}, c = p.computed || {};
    var L = 15, R = 195, W = R - L, today2 = new Date();
    var valid = new Date(today2.getTime() + 30 * 86400000);
    // header band
    band(doc, L, 14, W, 16, NAVY);
    txt(doc, "JD Refrigerated Transport", L + 4, 24, { color: WHITE, bold: true, size: 15 });
    txt(doc, "QUOTATION", R - 4, 24.5, { color: WHITE, bold: true, size: 17, align: "right" });
    band(doc, L, 30, W, 6, [52, 80, 122]);
    txt(doc, "Brisbane, Queensland · CoR-compliant cold-chain carrier", L + 4, 34.2, { color: WHITE, size: 8.5 });
    // meta
    var y = 46;
    function meta(x, label, val) { txt(doc, label, x, y, { color: MUTED, size: 8 }); txt(doc, val || "", x, y + 5, { size: 10 }); }
    meta(L, "PREPARED FOR", q.customer); meta(L + 70, "QUOTE #", q.quoteNumber); meta(L + 125, "ISSUED", today2.toLocaleDateString("en-AU"));
    y += 13; meta(L, "CONTACT", q.contact); meta(L + 70, "VALID UNTIL", valid.toLocaleDateString("en-AU")); meta(L + 125, "PAYMENT TERMS", q.terms || "14 days from invoice");
    y += 13; meta(L, "REFERENCE", q.reference);
    var startY = y + 12;
    // transport
    if ((c.transport || []).length) {
      doc.autoTable({
        startY: startY, margin: { left: L, right: 15 },
        head: [["Origin", "Destination", "Vehicle", "Spaces", "Trips/wk", "Tonnes", "$/tonne", "Rate/trip", "Weekly $", "Annual $"]],
        body: c.transport.map(function (r) { return [r.origin, r.dest, r.vehicle, n0(r.spaces), n0(r.trips), num(r.tonnes) > 0 ? n0(r.tonnes) : "—", num(r.tonnes) > 0 ? money(r.ratePerTonne, 2) : "—", money(r.ratePerTrip, 2), money(r.weekly, 2), money(r.annual)]; }),
        foot: [["Transport subtotal", "", "", "", "", "", "", "", money(c.transportWeekly, 2), money(c.transportAnnual)]],
        theme: "grid", styles: { fontSize: 8, cellPadding: 1.6, lineColor: LINE }, headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
        footStyles: { fillColor: [240, 244, 248], textColor: [20, 30, 45], fontStyle: "bold" }, alternateRowStyles: { fillColor: ICE },
        columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } }
      });
      startY = doc.lastAutoTable.finalY + 6;
    }
    if ((c.warehousing || []).length) {
      doc.autoTable({
        startY: startY, margin: { left: L, right: 15 },
        head: [["Customer", "Pallets", "Inb/wk", "Outb/wk", "Cases/wk", "$/pallet", "Weekly $", "Annual $"]],
        body: c.warehousing.map(function (r) { return [r.customer, n0(r.pallets), n0(r.inb), n0(r.outb), n0(r.cases), money(r.perPallet, 2), money(r.weekly, 2), money(r.annual)]; }),
        foot: [["Warehousing subtotal", "", "", "", "", "", money(c.warehousingWeekly, 2), money(c.warehousingAnnual)]],
        theme: "grid", styles: { fontSize: 8, cellPadding: 1.6, lineColor: LINE }, headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
        footStyles: { fillColor: [240, 244, 248], textColor: [20, 30, 45], fontStyle: "bold" }, alternateRowStyles: { fillColor: ICE },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } }
      });
      startY = doc.lastAutoTable.finalY + 6;
    }
    // total band
    band(doc, L, startY, W, 12, NAVY);
    txt(doc, "TOTAL CONTRACT VALUE", L + 4, startY + 7.6, { color: WHITE, bold: true, size: 12 });
    txt(doc, "Weekly " + money(c.totalWeekly, 2) + "   ·   Annual " + money(c.totalAnnual), R - 4, startY + 7.6, { color: WHITE, bold: true, size: 12, align: "right" });
    startY += 20;
    txt(doc, "TERMS & CONDITIONS", L, startY, { color: NAVY, bold: true, size: 11 }); startY += 6;
    ["Pricing valid for 30 days from quote date and indexed to current diesel pump prices.",
     "Fuel levy adjusts monthly with national average diesel price; current levy embedded in rates above.",
     "Rates exclude GST. Payment terms 14 days from invoice unless otherwise agreed in writing.",
     "Demurrage, after-hours, stand-down and detention charged separately per CoR carriage agreement.",
     "Warehousing assumes ambient/chilled at customer-specified temperature; cold-store handling on quotation."
    ].forEach(function (t) { txt(doc, "•  " + t, L, startY, { color: MUTED, size: 8.5 }); startY += 5; });
    startY += 8;
    txt(doc, "ACCEPTED BY (CUSTOMER)", L, startY, { color: MUTED, size: 8 });
    txt(doc, "ISSUED BY (JDT)", L + 95, startY, { color: MUTED, size: 8 }); startY += 8;
    txt(doc, "_______________________________", L, startY, { size: 10 });
    txt(doc, "Jordan Brown · Director, JD Refrigerated Transport", L + 95, startY, { size: 9 });
    var fn = "JDT_Quote_" + safe(q.customer || "Quote") + "_" + safe(q.quoteNumber || "") + "_" + today() + ".pdf";
    doc.save(fn);
    return fn;
  }

  function dataPdf(p) {
    var doc = newDoc(true), L = 12;
    txt(doc, "JDT Pricing Model — Working Data", L, 16, { color: NAVY, bold: true, size: 16 });
    txt(doc, "Generated " + new Date().toLocaleDateString("en-AU"), L, 22, { color: MUTED, size: 8 });
    var y = 28;
    if ((p.lanes || []).length) {
      txt(doc, "TRANSPORT LANES", L, y, { color: NAVY, bold: true, size: 11 });
      doc.autoTable({
        startY: y + 2, margin: { left: L, right: L },
        head: [["Origin", "Destination", "Veh", "Sp", "Trips", "Hrs", "Km", "Tonnes", "Cost", "Base", "Price+FL", "$/tonne", "Marg", "Ann rev", "Ann GP", "Dec"]],
        body: p.lanes.map(function (L2) { return [L2.origin, L2.dest, L2.vehicle, n0(L2.spaces), n0(L2.trips), n0(L2.hrs), n0(L2.km), num(L2.tonnes) > 0 ? n0(L2.tonnes) : "—", money(L2.cost, 2), money(L2.base, 2), money(L2.priceFL, 2), num(L2.tonnes) > 0 ? money(L2.perTonne, 2) : "—", pct(L2.margin), money(L2.annualRev), money(L2.annualGP), L2.decision]; }),
        theme: "grid", styles: { fontSize: 7.2, cellPadding: 1.2, lineColor: LINE }, headStyles: { fillColor: NAVY, textColor: 255 }, alternateRowStyles: { fillColor: ICE }
      });
      y = doc.lastAutoTable.finalY + 8;
    }
    if ((p.accounts || []).length) {
      txt(doc, "WAREHOUSING ACCOUNTS", L, y, { color: NAVY, bold: true, size: 11 });
      doc.autoTable({
        startY: y + 2, margin: { left: L, right: L },
        head: [["Customer", "Pallets", "Inb", "Outb", "Cases", "VAS h", "Cost/wk", "Base/wk", "Marg", "$/pallet", "Ann rev", "Ann GP", "Dec"]],
        body: p.accounts.map(function (A) { return [A.customer, n0(A.pallets), n0(A.inb), n0(A.outb), n0(A.cases), n0(A.vasHrs), money(A.cost, 2), money(A.base, 2), pct(A.margin), money(A.perPallet, 2), money(A.annualRev), money(A.annualGP), A.decision]; }),
        theme: "grid", styles: { fontSize: 7.2, cellPadding: 1.2, lineColor: LINE }, headStyles: { fillColor: NAVY, textColor: 255 }, alternateRowStyles: { fillColor: ICE }
      });
    }
    doc.save("JDT_Data_" + today() + ".pdf");
    return "JDT_Data_" + today() + ".pdf";
  }

  function tendersPdf(p) {
    var doc = newDoc(true), L = 12, pl = p.pipeline || {};
    txt(doc, "JDT Tender Register", L, 16, { color: NAVY, bold: true, size: 16 });
    txt(doc, "Generated " + new Date().toLocaleDateString("en-AU"), L, 22, { color: MUTED, size: 8 });
    var cards = [["Open", String(pl.openCount || 0)], ["Open value", money(pl.openValue)], ["Weighted", money(pl.weightedValue)], ["Won", money(pl.wonValue)], ["Win rate", pct(pl.winRate)], ["Due ≤14d", String(pl.dueSoon || 0)], ["Overdue", String(pl.overdue || 0)]];
    var cw = 38, x = L, cy = 28;
    cards.forEach(function (c) { band(doc, x, cy, cw - 3, 14, NAVY); txt(doc, c[0], x + 3, cy + 5.5, { color: WHITE, size: 7.5, bold: true }); txt(doc, c[1], x + 3, cy + 11, { color: WHITE, size: 9.5, bold: true }); x += cw; });
    doc.autoTable({
      startY: cy + 20, margin: { left: L, right: L },
      head: [["Reference", "Customer", "Title", "Status", "Due", "Value", "Prob", "Weighted", "Owner"]],
      body: (p.tenders || []).map(function (t) { var v = num(t.value), pr = num(t.probability); return [t.reference, t.customer, t.title, t.status, t.dueDate, money(v), pct(pr / 100), money(v * pr / 100), t.owner]; }),
      theme: "grid", styles: { fontSize: 8, cellPadding: 1.6, lineColor: LINE }, headStyles: { fillColor: NAVY, textColor: 255 }, alternateRowStyles: { fillColor: ICE }
    });
    doc.save("JDT_Tenders_" + today() + ".pdf");
    return "JDT_Tenders_" + today() + ".pdf";
  }

  // ---- Excel parse (import) -----------------------------------------------
  function parseWorkbook(arrayBuffer) {
    var X_ = X(), wb = X_.read(arrayBuffer, { type: "array" });
    var sheets = wb.SheetNames.map(function (name) {
      var ws = wb.Sheets[name];
      var aoa = ws ? X_.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) : [];
      var headers = (aoa[0] || []).map(function (h, i) { return (h === "" || h == null) ? ("Column " + String.fromCharCode(65 + i)) : String(h); });
      var rows = aoa.slice(1).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); })
        .map(function (r) { var o = []; for (var i = 0; i < headers.length; i++) o.push(r[i] == null ? "" : r[i]); return o; });
      return { name: name, headers: headers, rows: rows, rowCount: rows.length };
    });
    return { sheets: sheets };
  }

  // ---- dispatch ------------------------------------------------------------
  function runExport(type, payload) {
    switch (type) {
      case "excel-full": return excelFull(payload);
      case "quote-excel": return quoteExcel(payload);
      case "tenders-excel": return tendersExcel(payload);
      case "import-template": return importTemplate();
      case "data-pdf": return dataPdf(payload);
      case "tenders-pdf": return tendersPdf(payload);
      case "quote-pdf": return quotePdf(payload);
      default: throw new Error("unknown export: " + type);
    }
  }

  root.JDTExport = {
    runExport: runExport, quotePdf: quotePdf, parseWorkbook: parseWorkbook, download: download,
    excelFull: excelFull, quoteExcel: quoteExcel, tendersExcel: tendersExcel, importTemplate: importTemplate,
    dataPdf: dataPdf, tendersPdf: tendersPdf
  };
})(typeof window !== "undefined" ? window : this);
