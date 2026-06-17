"""Flask backend for the JDT Pricing Model desktop app.

Responsibilities:
  * serve the single-page UI and its static assets
  * load / save the user's state to jdt_pricing_data.json beside the executable
  * render the quote PDF (from already-computed values posted by the UI)

All calculation lives in the front-end engine (engine.js); this server keeps
no business logic of its own, so the two can never drift.
"""
import json
import os
import sys
import subprocess

from flask import Flask, jsonify, request, send_from_directory, render_template

from . import paths
from .pdf_quote import generate_quote_pdf, build_filename
from .exporters import run_export


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder=os.path.join(paths.resource_dir(), "static"),
        template_folder=os.path.join(paths.resource_dir(), "templates"),
        static_url_path="/static",
    )

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/state", methods=["GET"])
    def get_state():
        if os.path.exists(paths.DATA_FILE):
            try:
                with open(paths.DATA_FILE, "r", encoding="utf-8") as fh:
                    return jsonify(json.load(fh))
            except (ValueError, OSError):
                pass
        return ("", 204)

    @app.route("/api/state", methods=["POST"])
    def save_state():
        data = request.get_json(force=True, silent=True)
        if data is None:
            return jsonify({"ok": False, "error": "invalid payload"}), 400
        tmp = paths.DATA_FILE + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=0)
            os.replace(tmp, paths.DATA_FILE)  # atomic write
        except OSError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 500
        return jsonify({"ok": True})

    @app.route("/api/quote/pdf", methods=["POST"])
    def quote_pdf():
        payload = request.get_json(force=True, silent=True) or {}
        filename = build_filename(payload.get("quote", {}))
        out_path = paths.quote_path(filename)
        try:
            generate_quote_pdf(payload, out_path)
        except Exception as exc:  # noqa: BLE001 - surface any render error to the UI
            return jsonify({"ok": False, "error": str(exc)}), 500
        _open_file(out_path)
        return jsonify({"ok": True, "filename": filename, "path": out_path})

    @app.route("/api/export", methods=["POST"])
    def export():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            filename, out_path = run_export(payload, paths.app_dir())
        except Exception as exc:  # noqa: BLE001 - surface render errors to the UI
            return jsonify({"ok": False, "error": str(exc)}), 500
        _open_file(out_path)
        return jsonify({"ok": True, "filename": filename, "path": out_path})

    @app.route("/api/ping")
    def ping():
        return jsonify({"ok": True})

    return app


def _open_file(path: str) -> None:
    """Open the generated PDF in the OS default viewer (best effort)."""
    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except Exception:
        pass
