# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — builds JDT_Pricing_Model.exe (single-file, windowed).

Build from the project root:
    pyinstaller build/JDT_Pricing_Model.spec
"""
import os
from PyInstaller.utils.hooks import collect_all

ROOT = os.path.abspath(os.getcwd())
APP = os.path.join(ROOT, "app")

# Bundle the UI assets (templates + static) under "app/..." so paths.resource_dir() finds them.
datas = [
    (os.path.join(APP, "templates"), "app/templates"),
    (os.path.join(APP, "static"), "app/static"),
]
binaries = []
hiddenimports = ["app", "app.server", "app.main", "app.pdf_quote", "app.paths", "app.exporters", "app.importer"]

# pywebview + its Windows backend (Edge WebView2 via pythonnet) ship extra
# data/binaries and dynamically imported modules — pull them all in.
for pkg in ("webview", "reportlab"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

block_cipher = None

a = Analysis(
    [os.path.join(ROOT, "run.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "scipy", "cryptography"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="JDT_Pricing_Model",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    runtime_tmpdir=None,
    console=False,          # windowed app, no console window
    disable_windowed_traceback=False,
    icon=os.path.join(ROOT, "build", "icon.ico") if os.path.exists(os.path.join(ROOT, "build", "icon.ico")) else None,
)
