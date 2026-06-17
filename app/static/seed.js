/* Default state for the JDT Pricing Model.
 * Mirrors the original workbook's Settings / Warehousing / Leg Builder defaults.
 * The 640 transport lanes are loaded separately from seed_lanes.json.
 */
(function (root) {
  "use strict";

  function defaultSettings() {
    return {
      driverBaseHourly: 39.44,
      otMultiplier: 1.0475,
      publicHolidayHourly: 91.06,
      linehaulHourly: 42.5,
      superRate: 0.12,
      workcoverRate: 0.06172,
      payrollTaxRate: 0.0495,
      vehicleRateUte: 0.65,
      vehicleRateRigid: 1.85,
      vehicleRateSemi: 2.4,
      vehicleRateBdouble: 2.95,
      fuelLevyPct: 12,
      targetMarginPct: 18
    };
  }

  function defaultWarehousing() {
    return {
      storageRate: 4.5,
      inboundRate: 3.2,
      outboundRate: 3.8,
      casePickRate: 0.45,
      labourRate: 49.91,
      overheadRate: 1.1,
      targetMargin: 22
    };
  }

  function emptyAccount(customer) {
    return {
      customer: customer || "", pallets: "", inb: "", outb: "", cases: "",
      vasHrs: "", other: "", notes: "", quote: ""
    };
  }

  // 25 warehousing account rows (Warehousing!17:41); first seeded as the sample.
  function defaultAccounts() {
    var rows = [emptyAccount("Sample — Acme Foods")];
    for (var i = 1; i < 25; i++) rows.push(emptyAccount(""));
    return rows;
  }

  function defaultLegBuilder() {
    return {
      vehicle: "Rigid", spaces: 22, trips: 5,
      tolls: 0, overnight: 0, loadExtras: 0,
      legs: [
        { label: "Yard prep", type: "yard", hours: 0.5, km: 0 },
        { label: "Load", type: "load", hours: 1, km: 0 },
        { label: "Drive out", type: "drive", hours: 1.5, km: 90 },
        { label: "Unload", type: "unload", hours: 1, km: 0 },
        { label: "Return", type: "return", hours: 1.5, km: 90 },
        { label: "", type: "drive", hours: 0, km: 0 },
        { label: "", type: "drive", hours: 0, km: 0 },
        { label: "", type: "drive", hours: 0, km: 0 }
      ]
    };
  }

  function defaultQuote() {
    return { customer: "", contact: "", reference: "", quoteNumber: "", terms: "14 days from invoice" };
  }

  // lanes injected by the caller (from seed_lanes.json)
  function defaultState(seedLanes) {
    return {
      settings: defaultSettings(),
      warehousing: defaultWarehousing(),
      lanes: (seedLanes || []).map(function (l) { return Object.assign({}, l); }),
      accounts: defaultAccounts(),
      legBuilder: defaultLegBuilder(),
      quote: defaultQuote()
    };
  }

  var api = {
    defaultSettings: defaultSettings,
    defaultWarehousing: defaultWarehousing,
    defaultAccounts: defaultAccounts,
    emptyAccount: emptyAccount,
    defaultLegBuilder: defaultLegBuilder,
    defaultQuote: defaultQuote,
    defaultState: defaultState,
    VEHICLES: ["Ute", "Rigid", "Semi", "Bdouble"]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JDTSeed = api;
})(typeof window !== "undefined" ? window : this);
