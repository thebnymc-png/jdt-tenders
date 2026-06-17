import io, openpyxl
from app.server import create_app
c = create_app().test_client()
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Lanes"
ws.append(["Collection PC", "Delivery PC", "Pallets", "Weight (kg)", "Stackable", "Loading", "Freq/wk"])
ws.append(["4110", "4116", 6, 420, "Yes", "Tail-lift", 5])
ws.append(["4110", "4078", 12, 900, "No", "Dock", 3])
buf = io.BytesIO(); wb.save(buf); buf.seek(0)
r = c.post("/api/import/excel", data={"file": (buf, "tender.xlsx")}, content_type="multipart/form-data")
j = r.get_json(); assert j["ok"], j
s = j["sheets"][0]
assert s["name"] == "Lanes" and s["rowCount"] == 2, s
assert s["headers"][0] == "Collection PC" and s["rows"][0][2] == 6, s
print("IMPORT TEST PASSED")
