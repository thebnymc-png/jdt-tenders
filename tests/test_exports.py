import os, datetime
from app.server import create_app
from app import paths
c = create_app().test_client()
today = datetime.date.today().strftime("%Y%m%d")

# sample computed payloads (mimic what the frontend posts)
lanes=[{"origin":"Acacia Ridge DC","dest":"Sunnybank QLD","vehicle":"Rigid","spaces":6,"trips":5,"hrs":4,"km":60,
        "tolls":0,"overnight":0,"loadExtras":0,"cost":316.67,"base":386.18,"priceFL":432.52,"margin":0.268,
        "annualRev":112455,"annualGP":30130,"decision":"GO","quote":"Y"}]
accounts=[{"customer":"Acme Foods","pallets":100,"inb":50,"outb":60,"cases":200,"vasHrs":5,"other":0,
           "cost":1287.55,"base":1650.71,"margin":0.22,"perPallet":16.51,"annualRev":85837,"annualGP":18887,"decision":"GO","quote":"Y"}]
summary={"transport":{"weekRev":2163,"weekCost":1583,"weekGP":580,"margin":0.268,"annualRev":112476,"annualGP":30160},
         "warehousing":{"weekRev":1650,"weekCost":1287,"weekGP":363,"margin":0.22,"annualRev":85800,"annualGP":18900},
         "combined":{"weekRev":3813,"weekGP":943,"margin":0.247,"annualRev":198276,"annualGP":49060}}
tenders=[{"reference":"Q-1007","customer":"Coles","title":"Heathwood DC","status":"Submitted","dueDate":"2026-06-25",
          "submittedDate":"","value":400000,"probability":60,"owner":"Jordan Brown","notes":"chilled","snapshot":{"x":1},"updatedAt":today},
         {"reference":"Q-1008","customer":"Aldi","title":"","status":"Won","value":300000,"probability":100,"owner":"JB","notes":"","snapshot":None,"updatedAt":today}]
pipeline={"openCount":1,"openValue":400000,"weightedValue":240000,"wonCount":1,"wonValue":300000,"lostCount":0,"lostValue":0,"winRate":1.0,"dueSoon":1,"overdue":0}
settings={"driverBaseHourly":39.44,"otMultiplier":1.0475,"publicHolidayHourly":91.06,"linehaulHourly":42.5,
          "superRate":0.12,"workcoverRate":0.06172,"payrollTaxRate":0.0495,"vehicleRateUte":0.65,"vehicleRateRigid":1.85,
          "vehicleRateSemi":2.4,"vehicleRateBdouble":2.95,"fuelLevyPct":12,"targetMarginPct":18}
warehousing={"storageRate":4.5}

tests = {
 "excel-full": {"type":"excel-full","settings":settings,"warehousing":warehousing,"lanes":lanes,"accounts":accounts,"summary":summary,"tenders":tenders,"pipeline":pipeline},
 "data-pdf": {"type":"data-pdf","lanes":lanes,"accounts":accounts,"summary":summary},
 "quote-excel": {"type":"quote-excel","quote":{"customer":"Coles Group","quoteNumber":"Q-1007","contact":"Jane","reference":"Heathwood","terms":"14 days"},
                 "computed":{"transport":[{"origin":"A","dest":"B","vehicle":"Rigid","spaces":6,"trips":5,"ratePerTrip":432.52,"weekly":2162.6,"annual":112455}],
                             "warehousing":[{"customer":"Acme","pallets":100,"inb":50,"outb":60,"cases":200,"perPallet":16.51,"weekly":1650.71,"annual":85837}],
                             "transportWeekly":2162.6,"transportAnnual":112455,"warehousingWeekly":1650.71,"warehousingAnnual":85837,
                             "totalWeekly":3813.31,"totalAnnual":198292}},
 "tenders-excel": {"type":"tenders-excel","tenders":tenders,"pipeline":pipeline},
 "tenders-pdf": {"type":"tenders-pdf","tenders":tenders,"pipeline":pipeline},
}
for name,payload in tests.items():
    r = c.post("/api/export", json=payload)
    j = r.get_json()
    assert j.get("ok"), (name, j)
    p = j["path"]; sz = os.path.getsize(p)
    assert sz > 1500, (name, sz)
    print(f"  {name:14s} -> {j['filename']:32s} {sz:>7d} bytes  OK")
print("ALL EXPORT TESTS PASSED")
