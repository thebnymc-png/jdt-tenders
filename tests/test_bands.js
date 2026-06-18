/* Per-tonne banded pricing — validated against the Simplot workbook.
 * Sources: "Methodology" §4-§5, "Per-Tonne Analysis" §3, "Rate Response",
 * and "Sanity Check" tabs of JDT_Simplot_Rate_Response_v3.xlsx.
 */
const path = require('path');
const STATIC = path.join(__dirname, '..', 'app', 'static');
const E = require(path.join(STATIC, 'engine.js'));
let fail = 0;
function approx(a, b, eps, msg) {
  if (Math.abs(a - b) > (eps || 0.01)) { console.error("FAIL", msg, a, "!=", b); fail++; }
  else console.log("ok  ", msg, "=", Math.round(a * 100) / 100);
}
function eq(a, b, msg) {
  if (a !== b) { console.error("FAIL", msg, a, "!=", b); fail++; }
  else console.log("ok  ", msg, "=", a);
}

// --- 1. bandRates() vs the published Rate Response card (Method A) ----------
// Gold Coast: FTL Single (Semi) 805, FTL Rigid 687.
const gc = E.bandRates(805, 687, "A");
eq(gc.minCharge, 584, "GC Method A min charge");      // ROUND(687*0.85)
approx(gc.t0_5,  137.4, 0.005, "GC Method A 0-5t");   // 687/5
approx(gc.t5_10, 68.7,  0.005, "GC Method A 5-10t");  // 687/10
approx(gc.t10_14, 49.07, 0.005, "GC Method A 10-14t"); // 687/14
approx(gc.t14,   36.59, 0.005, "GC Method A 14t+");   // 805/22

// Toowoomba: FTL Single 1523, FTL Rigid 1309.
const tw = E.bandRates(1523, 1309, "A");
eq(tw.minCharge, 1113, "Toowoomba Method A min charge");
approx(tw.t0_5, 261.8, 0.005, "Toowoomba Method A 0-5t");
approx(tw.t14,  69.23, 0.005, "Toowoomba Method A 14t+");

// --- 2. Method B (midpoint) vs Per-Tonne Analysis §3 -----------------------
const gcB = E.bandRates(805, 687, "B");
approx(gcB.t0_5,  274.8, 0.005, "GC Method B 0-5t");   // 687/2.5
approx(gcB.t5_10, 91.6,  0.005, "GC Method B 5-10t");  // 687/7.5
approx(gcB.t10_14, 57.25, 0.005, "GC Method B 10-14t"); // 687/12
approx(gcB.t14,   44.72, 0.005, "GC Method B 14t+");   // 805/18

const twB = E.bandRates(1523, 1309, "B");
approx(twB.t0_5, 523.6, 0.005, "Toowoomba Method B 0-5t"); // 1309/2.5
approx(twB.t14,  84.61, 0.005, "Toowoomba Method B 14t+"); // 1523/18

// --- 3. Billing rule: MAX(Min Charge, $/t × tonnes) ------------------------
// Brisbane Metro rate card (Sanity Check tab, live from Rate Response).
const metro = { minCharge: 382, t0_5: 38.86, t5_10: 28.64, t10_14: 23.52, t14: 20.45 };

// Sub-tonne load hits the Min Charge floor (consignment 1843861: 184kg).
const q1 = E.quoteTonnage(0.184, metro);
eq(q1.band, "0-5t", "metro 0.184t band");
approx(q1.tierCalc, 7.15024, 1e-5, "metro 0.184t tier calc");
eq(q1.quoted, 382, "metro 0.184t quoted (floor)");
eq(q1.minChargeApplied, true, "metro 0.184t min charge applied");

// A load where the band rate bites past the floor.
const q2 = E.quoteTonnage(12, metro);  // 10-14t band: 23.52*12 = 282.24 < 382 → floor
eq(q2.band, "10-14t", "metro 12t band");
eq(q2.minChargeApplied, true, "metro 12t still under floor");
const q3 = E.quoteTonnage(20, metro);  // 14t+ band: 20.45*20 = 409 > 382 → rate bites
eq(q3.band, "14t+", "metro 20t band");
approx(q3.tierCalc, 409, 0.001, "metro 20t tier calc");
eq(q3.quoted, 409, "metro 20t quoted (rate bites)");
eq(q3.minChargeApplied, false, "metro 20t floor not applied");

// Band edges: 5, 10, 14 fall in the lower band; just over moves up.
eq(E.bandForTonnes(5, metro).band, "0-5t", "edge 5t -> 0-5t");
eq(E.bandForTonnes(5.01, metro).band, "5-10t", "edge 5.01t -> 5-10t");
eq(E.bandForTonnes(14, metro).band, "10-14t", "edge 14t -> 10-14t");
eq(E.bandForTonnes(14.01, metro).band, "14t+", "edge 14.01t -> 14t+");

// --- 4. computeLaneBands(): live build reproduces the FTL prices -----------
// Settings matching the workbook's Day Rate build at 40% margin.
const s = {
  driverBaseHourly: 39.44, otMultiplier: 1.0475, superRate: 0.12,
  workcoverRate: 0.06172, payrollTaxRate: 0.0495,
  vehicleRateRigid: 1.35, vehicleRateSemi: 1.85,
  targetMarginPct: 40, fuelLevyPct: 19.91
};
approx(E.loadedHourlyRate(s), 51.41726950976, 1e-9, "workbook loaded day $/hr");

// Gold Coast lane: RT 142km, 3.7 total hrs, $30 tolls (Methodology §4).
const gcLane = { origin: "Brisbane", dest: "Gold Coast", spaces: 14, trips: 1, hrs: 3.7, km: 142, tolls: 30 };
const gcBands = E.computeLaneBands(gcLane, s, "A");
eq(gcBands.ftlSingle, 805, "GC live FTL Single (Semi)");
eq(gcBands.ftlRigid, 687, "GC live FTL Rigid");
eq(gcBands.minCharge, 584, "GC live min charge");
approx(gcBands.t0_5, 137.4, 0.005, "GC live 0-5t");
approx(gcBands.t14, 36.59, 0.005, "GC live 14t+");

// Same lane, Method B toggle, off the same live FTL prices.
const gcBandsB = E.computeLaneBands(gcLane, s, "B");
approx(gcBandsB.t0_5, 274.8, 0.005, "GC live Method B 0-5t");
approx(gcBandsB.t14, 44.72, 0.005, "GC live Method B 14t+");

// Sunshine Coast lane: RT 202km, 4.7 total hrs, $20 tolls.
const scLane = { origin: "Brisbane", dest: "Sunshine Coast", spaces: 14, trips: 1, hrs: 4.7, km: 202, tolls: 20 };
const scBands = E.computeLaneBands(scLane, s, "A");
eq(scBands.ftlSingle, 1059, "SC live FTL Single (Semi)");
eq(scBands.ftlRigid, 891, "SC live FTL Rigid");
approx(scBands.t14, 48.14, 0.005, "SC live 14t+"); // 1059/22

console.log(fail ? ("\n" + fail + " FAILURES") : "\nALL BAND TESTS PASSED");
process.exit(fail ? 1 : 0);
