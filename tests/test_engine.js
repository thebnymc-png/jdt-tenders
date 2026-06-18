const path = require('path');
const STATIC = path.join(__dirname, '..', 'app', 'static');
const E = require(path.join(STATIC, 'engine.js'));
const S = require(path.join(STATIC, 'seed.js'));
let fail=0;
function approx(a,b,eps,msg){ if(Math.abs(a-b)>(eps||0.01)){console.error("FAIL",msg,a,"!=",b);fail++;} else console.log("ok  ",msg,"=",Math.round(a*100)/100);}

const s = S.defaultSettings();
approx(E.loadedHourlyRate(s), 51.41726950976, 1e-9, "loaded $/hr");

// Leg Builder regression (known Excel values)
const lb = S.defaultLegBuilder();
const r = E.computeLegs(lb, s);
approx(r.totalHours,5.5,1e-9,"legs total hours");
approx(r.totalKm,180,1e-9,"legs total km");
approx(r.cost,615.79498230368,1e-6,"legs cost/trip");
approx(r.base,750.969490614244,1e-6,"legs base price");
approx(r.priceFL,841.085829487953,1e-6,"legs price+FL");
approx(r.margin,0.267857142857143,1e-9,"legs margin");
approx(r.perSpace,34.134976846102,1e-6,"legs per pallet");
approx(r.perHour,136.539907384408,1e-6,"legs per hour");
approx(r.annualRev,218682.315666868,1e-3,"legs annual rev");
approx(r.annualGP,58575.620267911,1e-3,"legs annual GP");

// Lane: replicate a Rigid lane with sample inputs to sanity-check decision logic
const lane = {origin:"A",dest:"B",vehicle:"Rigid",spaces:6,trips:5,hrs:4,km:60,tolls:0,overnight:0,loadExtras:0,quote:"Y"};
const lr = E.computeLane(lane, s);
// cost = 4*51.417 + 60*1.85 = 205.669 + 111 = 316.669
approx(lr.cost, 4*E.loadedHourlyRate(s)+60*1.85, 1e-6, "lane cost");
approx(lr.base, lr.cost/(1-0.18), 1e-6, "lane base");
approx(lr.priceFL, lr.base*1.12, 1e-6, "lane price+FL");
console.log("lane decision:", lr.decision, "(margin", Math.round(lr.margin*1000)/10+"%)");

// Unit rate equivalents — per kg / per km derived from base & price+FL
const laneU = {origin:"A",dest:"B",vehicle:"Semi",spaces:14,trips:1,hrs:4,km:200,tonnes:10};
const ur = E.computeLane(laneU, s);
approx(ur.perKg, ur.base/(10*1000), 1e-9, "per kg = base/(t*1000)");
approx(ur.perKgFL, ur.priceFL/(10*1000), 1e-9, "per kg +FL");
approx(ur.perKg, ur.perTonne/1000, 1e-9, "per kg == per tonne / 1000");
approx(ur.perKm, ur.base/200, 1e-9, "per km = base/km");

// Warehouse account
const w = S.defaultWarehousing();
const acc = {customer:"Acme",pallets:100,inb:50,outb:60,cases:200,vasHrs:5,other:0,quote:"Y"};
const wr = E.computeWarehouse(acc, w);
// cost = 100*4.5 + 50*3.2 + 60*3.8 + 200*0.45 + 5*49.91 + 100*1.1
const expCost = 100*4.5+50*3.2+60*3.8+200*0.45+5*49.91+100*1.1;
approx(wr.cost, expCost, 1e-6, "wh cost/wk");
approx(wr.base, expCost/(1-0.22), 1e-6, "wh base price");
console.log("wh decision:", wr.decision);

// Summary + Quote on full seed
const seedLanes = require(path.join(STATIC, 'seed_lanes.json'));
const state = S.defaultState(seedLanes);
state.lanes[0]=Object.assign(state.lanes[0],{spaces:6,trips:5,hrs:4,km:60,quote:"Y"});
state.accounts[0]=acc;
const sum = E.computeSummary(state);
console.log("summary transport weekRev:", Math.round(sum.transport.weekRev), "GO:",sum.transport.go);
const q = E.buildQuote(state);
console.log("quote transport lines:", q.transport.length, "wh lines:", q.warehousing.length, "totalWeekly:", Math.round(q.totalWeekly));

console.log(fail? ("\n"+fail+" FAILURES") : "\nALL ENGINE TESTS PASSED");
process.exit(fail?1:0);
