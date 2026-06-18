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
      vehicle: "Rigid", spaces: 22, trips: 5, tonnes: "",
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

  var TENDER_STATUSES = ["Draft", "Submitted", "Shortlisted", "Won", "Lost", "No-bid"];
  var BID_STATUSES = ["Pending", "Awarded", "Rejected"];
  var COMPLIANCE_STATUSES = ["Compliant", "Due", "Overdue", "N/A"];
  var LOADING_TYPES = ["Tail-lift", "Dock / Ramp", "Forklift", "Hand unload", "Crane", "Side-loader"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function uid(prefix) {
    return (prefix || "id") + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }

  function defaultVolume() {
    return MONTHS.map(function (m) { return { month: m, shipments: "", pallets: "" }; });
  }

  // An operational lane within a tender RFQ: operational descriptors + the
  // inputs the cost engine needs to price it.
  function newOpLane(seed) {
    seed = seed || {};
    function v(k, d) { return seed[k] != null ? seed[k] : (d == null ? "" : d); }
    return {
      id: uid("l"),
      collPostcode: v("collPostcode"), collSuburb: v("collSuburb"),
      delPostcode: v("delPostcode"), delSuburb: v("delSuburb"),
      pallets: v("pallets"), weightKg: v("weightKg"), tonnes: v("tonnes"), dims: v("dims"),
      stackable: v("stackable", "Y"), loadingType: v("loadingType", "Tail-lift"),
      vehicle: v("vehicle", "Rigid"), freq: v("freq"),
      hrs: v("hrs"), km: v("km"), tolls: v("tolls"), overnight: v("overnight"), loadExtras: v("loadExtras")
    };
  }

  function newTender(seed) {
    seed = seed || {};
    return {
      id: uid("t"),
      reference: seed.reference || "",
      customer: seed.customer || "",
      title: seed.title || "",
      status: seed.status || "Draft",
      dueDate: seed.dueDate || "",
      submittedDate: seed.submittedDate || "",
      value: seed.value != null ? seed.value : "",
      probability: seed.probability != null ? seed.probability : 50,
      owner: seed.owner || "Jordan Brown",
      notes: seed.notes || "",
      contract: seed.contract || { duration: "12 months", startDate: "", accessorials: "", disputeRules: "" },
      schedule: seed.schedule || { collectionWindows: "", deliveryTimeframes: "", weekend: "", bookingRules: "" },
      commercial: seed.commercial || { fuelSurcharge: "", paymentTerms: "", claims: "", minInsurance: "", serviceCredits: "" },
      technology: seed.technology || { tracking: "", ediApi: "", pod: "" },
      lanes: Array.isArray(seed.lanes) ? seed.lanes : [],
      volumeHistory: Array.isArray(seed.volumeHistory) ? seed.volumeHistory : defaultVolume(),
      bids: Array.isArray(seed.bids) ? seed.bids : [],
      snapshot: seed.snapshot || null,
      updatedAt: new Date().toISOString().slice(0, 10)
    };
  }

  function newBid(seed) {
    seed = seed || {};
    return {
      id: uid("b"), carrier: seed.carrier || "", amount: seed.amount != null ? seed.amount : "",
      leadTime: seed.leadTime || "", status: seed.status || "Pending", notes: seed.notes || ""
    };
  }

  function newCarrier(seed) {
    seed = seed || {};
    return {
      id: uid("c"), name: seed.name || "", base: seed.base || "", fleet: seed.fleet || "",
      lanes: seed.lanes || "", rating: seed.rating != null ? seed.rating : "",
      compliance: seed.compliance || "Compliant", contact: seed.contact || ""
    };
  }

  function newComplianceItem(seed) {
    seed = seed || {};
    return {
      id: uid("cm"), item: seed.item || "", owner: seed.owner || "", status: seed.status || "Due",
      due: seed.due || "", notes: seed.notes || ""
    };
  }

  // Standard Chain-of-Responsibility / cold-chain compliance register (a scaffold
  // the operator can keep current — statuses are theirs to set).
  function seedCompliance() {
    return [
      "Mass management & axle-load policy",
      "Maintenance management & daily pre-start checks",
      "Fatigue management (BFM / work diary)",
      "Speed management policy",
      "Load restraint compliance",
      "Cold-chain temperature monitoring & calibration",
      "Public liability & goods-in-transit insurance",
      "Driver licensing, inductions & medicals"
    ].map(function (item) { return newComplianceItem({ item: item, owner: "Operations", status: "Due" }); });
  }

  // lanes injected by the caller (from seed_lanes.json)
  function defaultState(seedLanes) {
    return {
      settings: defaultSettings(),
      warehousing: defaultWarehousing(),
      lanes: (seedLanes || []).map(function (l) { return Object.assign({}, l); }),
      accounts: defaultAccounts(),
      legBuilder: defaultLegBuilder(),
      quote: defaultQuote(),
      tenders: [],
      carriers: [],
      compliance: seedCompliance()
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
    newTender: newTender,
    newOpLane: newOpLane,
    defaultVolume: defaultVolume,
    newBid: newBid,
    newCarrier: newCarrier,
    newComplianceItem: newComplianceItem,
    seedCompliance: seedCompliance,
    TENDER_STATUSES: TENDER_STATUSES,
    BID_STATUSES: BID_STATUSES,
    COMPLIANCE_STATUSES: COMPLIANCE_STATUSES,
    LOADING_TYPES: LOADING_TYPES,
    MONTHS: MONTHS,
    VEHICLES: ["Ute", "Rigid", "Semi", "Bdouble"]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JDTSeed = api;
})(typeof window !== "undefined" ? window : this);
