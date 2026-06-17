"""Customer-facing quote PDF, rendered with ReportLab (pure Python, bundles
cleanly into the executable with no system dependencies).

The numbers are computed by the front-end engine and posted in; this module
only lays them out — so the PDF always matches exactly what the user sees.
"""
import datetime
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

NAVY = colors.HexColor("#26395b")
ICE = colors.HexColor("#eaf4fa")
LINE = colors.HexColor("#d8e2ec")
MUTED = colors.HexColor("#6b7686")


def _money(v, dp=2):
    v = v or 0
    return ("-$" if v < 0 else "$") + f"{abs(v):,.{dp}f}"


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return f"{int(f):,}" if f == int(f) else f"{f:,.2f}"


def safe_filename(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", (s or "").strip())
    return re.sub(r"-+", "-", s).strip("-") or "NA"


def build_filename(quote: dict) -> str:
    cust = safe_filename(quote.get("customer") or "Customer")
    num = safe_filename(quote.get("quoteNumber") or "Quote")
    date = datetime.date.today().strftime("%Y%m%d")
    return f"JDT_Quote_{cust}_{num}_{date}.pdf"


def _styles():
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=ss["Title"], fontSize=22, textColor=NAVY, spaceAfter=2),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, textColor=NAVY, spaceBefore=10, spaceAfter=4),
        "label": ParagraphStyle("l", parent=ss["Normal"], fontSize=8, textColor=MUTED),
        "val": ParagraphStyle("v", parent=ss["Normal"], fontSize=10, textColor=colors.black),
        "small": ParagraphStyle("s", parent=ss["Normal"], fontSize=8.5, textColor=MUTED, leading=12),
        "right": ParagraphStyle("r", parent=ss["Normal"], fontSize=9, alignment=TA_RIGHT),
        "center": ParagraphStyle("c", parent=ss["Normal"], fontSize=8, textColor=colors.white, alignment=TA_CENTER),
    }


def _section_table(headers, rows, foot, align_from=3, col_widths=None):
    data = [headers] + rows + [foot]
    widths = [w * mm for w in col_widths] if col_widths else _colwidths(len(headers))
    t = Table(data, repeatRows=1, hAlign="LEFT", colWidths=widths)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("ALIGN", (align_from, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (align_from - 1, -1), "LEFT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, ICE]),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
        ("LINEABOVE", (0, -1), (-1, -1), 1, NAVY),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    t.setStyle(TableStyle(style))
    return t


def _colwidths(n):
    # First column wide (name), rest even across an A4 content width (~180mm)
    total = 180 * mm
    first = 42 * mm
    rest = (total - first) / (n - 1)
    return [first] + [rest] * (n - 1)


def generate_quote_pdf(payload: dict, out_path: str) -> None:
    quote = payload.get("quote", {})
    comp = payload.get("computed", {})
    st = _styles()
    today = datetime.date.today()
    valid_until = today + datetime.timedelta(days=30)

    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
        title="JDT Quotation",
    )
    story = []

    # Header band
    header = Table([[
        Paragraph("JD Refrigerated Transport", ParagraphStyle("b", fontSize=15, textColor=colors.white, fontName="Helvetica-Bold")),
        Paragraph("QUOTATION", ParagraphStyle("q", fontSize=17, textColor=colors.white, fontName="Helvetica-Bold", alignment=TA_RIGHT)),
    ]], colWidths=[105 * mm, 75 * mm])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(header)
    sub = Table([[Paragraph("Brisbane, Queensland &middot; CoR-compliant cold-chain carrier",
                            ParagraphStyle("sb", fontSize=8.5, textColor=colors.white))]],
                colWidths=[180 * mm])
    sub.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#34507a")),
                             ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 3),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story.append(sub)
    story.append(Spacer(1, 8))

    # Meta block: prepared for / quote details
    def field(label, value):
        return [Paragraph(label, st["label"]), Paragraph(value or "&nbsp;", st["val"])]
    meta = Table([
        [field("PREPARED FOR", quote.get("customer")), field("QUOTE #", quote.get("quoteNumber")), field("ISSUED", today.strftime("%d %b %Y"))],
        [field("CONTACT", quote.get("contact")), field("VALID UNTIL", valid_until.strftime("%d %b %Y")), field("PAYMENT TERMS", quote.get("terms") or "14 days from invoice")],
        [field("REFERENCE", quote.get("reference")), "", ""],
    ], colWidths=[70 * mm, 55 * mm, 55 * mm])
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(meta)
    story.append(Spacer(1, 4))

    # Transport
    tr = comp.get("transport", [])
    if tr:
        story.append(Paragraph("TRANSPORT — LINEHAUL &amp; METRO LANES", st["h2"]))
        rows = [[
            r.get("origin", ""), r.get("dest", ""), r.get("vehicle", ""),
            _num(r.get("spaces")), _num(r.get("trips")),
            _money(r.get("ratePerTrip")), _money(r.get("weekly")), _money(r.get("annual"), 0),
        ] for r in tr]
        foot = ["Transport subtotal", "", "", "", "", "", _money(comp.get("transportWeekly")), _money(comp.get("transportAnnual"), 0)]
        story.append(_section_table(
            ["Origin", "Destination", "Vehicle", "Spaces", "Trips/wk", "Rate/trip", "Weekly $", "Annual $"],
            rows, foot, align_from=3,
            col_widths=[30, 34, 18, 16, 18, 22, 22, 20]))

    # Warehousing
    wh = comp.get("warehousing", [])
    if wh:
        story.append(Paragraph("WAREHOUSING — STORAGE, HANDLING &amp; VAS", st["h2"]))
        rows = [[
            r.get("customer", ""), _num(r.get("pallets")), _num(r.get("inb")), _num(r.get("outb")),
            _num(r.get("cases")), _money(r.get("perPallet")), _money(r.get("weekly")), _money(r.get("annual"), 0),
        ] for r in wh]
        foot = ["Warehousing subtotal", "", "", "", "", "", _money(comp.get("warehousingWeekly")), _money(comp.get("warehousingAnnual"), 0)]
        story.append(_section_table(
            ["Customer", "Pallets", "Inb/wk", "Outb/wk", "Cases/wk", "$/pallet", "Weekly $", "Annual $"],
            rows, foot, align_from=1,
            col_widths=[38, 18, 16, 16, 18, 22, 26, 26]))

    # Total contract value
    story.append(Spacer(1, 8))
    total = Table([[
        Paragraph("TOTAL CONTRACT VALUE", ParagraphStyle("tcv", fontSize=12, textColor=colors.white, fontName="Helvetica-Bold")),
        Paragraph("Weekly " + _money(comp.get("totalWeekly")) + "&nbsp;&nbsp;&middot;&nbsp;&nbsp;Annual <b>" + _money(comp.get("totalAnnual"), 0) + "</b>",
                  ParagraphStyle("tcv2", fontSize=12, textColor=colors.white, alignment=TA_RIGHT)),
    ]], colWidths=[80 * mm, 100 * mm])
    total.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(total)

    # Terms
    story.append(Paragraph("TERMS &amp; CONDITIONS", st["h2"]))
    terms = [
        "Pricing valid for 30 days from quote date and indexed to current diesel pump prices.",
        "Fuel levy adjusts monthly with national average diesel price; current levy embedded in rates above.",
        "Rates exclude GST. Payment terms 14 days from invoice unless otherwise agreed in writing.",
        "Demurrage, after-hours, stand-down and detention charged separately per CoR carriage agreement.",
        "Warehousing assumes ambient/chilled at customer-specified temperature; cold-store handling on quotation.",
    ]
    for t in terms:
        story.append(Paragraph("•&nbsp;&nbsp;" + t, st["small"]))

    story.append(Spacer(1, 14))
    sign = Table([
        [Paragraph("ACCEPTED BY (CUSTOMER)", st["label"]), Paragraph("ISSUED BY (JDT)", st["label"])],
        [Paragraph("_______________________________", st["val"]), Paragraph("Jordan Brown · Director, JD Refrigerated Transport", st["val"])],
        [Paragraph("Name &amp; title", st["small"]), Paragraph(today.strftime("%d %b %Y"), st["small"])],
    ], colWidths=[90 * mm, 90 * mm])
    sign.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story.append(sign)

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "JD Refrigerated Transport  ·  Brisbane, Queensland  ·  Cold-chain linehaul &amp; metro distribution",
        ParagraphStyle("foot", fontSize=8, textColor=MUTED, alignment=TA_CENTER)))

    doc.build(story)
