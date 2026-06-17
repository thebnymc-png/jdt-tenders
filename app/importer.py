"""Excel import — parse an uploaded workbook into sheets/headers/rows so the
front-end can map arbitrary supplier columns onto JDT tender lane fields.
"""
from io import BytesIO

import openpyxl

MAX_ROWS = 5000
MAX_COLS = 40


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Y" if v else "N"
    if isinstance(v, (int, float)):
        return v
    return str(v).strip()


def parse_workbook(file_bytes):
    wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True, read_only=True)
    sheets = []
    try:
        for ws in wb.worksheets:
            headers, rows = [], []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                vals = [_cell(c) for c in (row[:MAX_COLS] if row else [])]
                if i == 0:
                    headers = [str(v) if str(v) != "" else ("Column " + chr(65 + j))
                               for j, v in enumerate(vals)]
                    continue
                # pad/truncate to header width
                vals = (vals + [""] * len(headers))[:len(headers)]
                if any(str(x) != "" for x in vals):
                    rows.append(vals)
                if len(rows) >= MAX_ROWS:
                    break
            sheets.append({"name": ws.title, "headers": headers,
                           "rows": rows, "rowCount": len(rows)})
    finally:
        wb.close()
    return {"sheets": sheets}
