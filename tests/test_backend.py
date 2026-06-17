import json, os
from app.server import create_app
from app import paths
app = create_app()
c = app.test_client()

# index serves
r = c.get("/"); assert r.status_code==200 and b"JDT Pricing Model" in r.data, "index fail"
print("index OK")
# static engine.js
r = c.get("/static/engine.js"); assert r.status_code==200 and b"computeLane" in r.data; print("static OK")
r = c.get("/static/seed_lanes.json"); assert r.status_code==200; lanes=json.loads(r.data); print("seed lanes:", len(lanes))

# state empty -> 204
r = c.get("/api/state"); print("empty state status", r.status_code)
# save state
state={"settings":{"driverBaseHourly":39.44},"lanes":[],"accounts":[]}
r = c.post("/api/state", json=state); assert r.get_json()["ok"]; print("save OK ->", paths.DATA_FILE, os.path.exists(paths.DATA_FILE))
r = c.get("/api/state"); assert r.get_json()["settings"]["driverBaseHourly"]==39.44; print("load OK")

# PDF generation
payload={
  "quote":{"customer":"Coles Group","contact":"Jane Doe","reference":"Heathwood DC","quoteNumber":"Q-1007","terms":"14 days from invoice"},
  "computed":{
    "transport":[
      {"origin":"Acacia Ridge DC","dest":"Sunnybank QLD","vehicle":"Rigid","spaces":6,"trips":5,"ratePerTrip":432.52,"weekly":2162.6,"annual":112455},
      {"origin":"Heathwood DC","dest":"Toowoomba QLD","vehicle":"Semi","spaces":34,"trips":3,"ratePerTrip":1290.10,"weekly":3870.3,"annual":201255}
    ],
    "warehousing":[
      {"customer":"Acme Foods","pallets":100,"inb":50,"outb":60,"cases":200,"perPallet":16.51,"weekly":1650.71,"annual":85837}
    ],
    "transportWeekly":6032.9,"transportAnnual":313710,
    "warehousingWeekly":1650.71,"warehousingAnnual":85837,
    "totalWeekly":7683.61,"totalAnnual":399547
  }
}
r = c.post("/api/quote/pdf", json=payload)
j = r.get_json(); print("pdf result:", j.get("ok"), j.get("filename"))
assert j["ok"], j
pdf_path = j["path"]; assert os.path.exists(pdf_path) and os.path.getsize(pdf_path)>2000; print("PDF bytes:", os.path.getsize(pdf_path))
print("ALL BACKEND TESTS PASSED")
