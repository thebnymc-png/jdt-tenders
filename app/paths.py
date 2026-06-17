"""Portable filesystem paths.

Everything the user owns (their saved data and generated PDFs) lives next to
the executable, so the app can be carried on a USB stick with no installation.
Bundled read-only resources (templates / static) live inside the PyInstaller
bundle when frozen, or in the source tree during development.
"""
import os
import sys


def app_dir() -> str:
    """Folder the app should read/write user data from.

    When frozen by PyInstaller this is the folder containing the .exe; in
    development it is the project root (one level above this file's package).
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resource_dir() -> str:
    """Folder containing bundled read-only resources (templates, static)."""
    if getattr(sys, "frozen", False):
        # PyInstaller unpacks data files to sys._MEIPASS
        return os.path.join(sys._MEIPASS, "app")  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


DATA_FILE = os.path.join(app_dir(), "jdt_pricing_data.json")


def quote_path(filename: str) -> str:
    return os.path.join(app_dir(), filename)
