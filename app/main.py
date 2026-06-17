"""Entry point for the JDT Pricing Model desktop application.

Starts the local Flask server on a free port, then opens a native desktop
window (Edge WebView2 on Windows, via pywebview). If pywebview is not present
it falls back to opening the user's default web browser, so the app still
works everywhere.
"""
import socket
import threading

from .server import create_app

HOST = "127.0.0.1"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def _run_server(app, port: int) -> None:
    # threaded so PDF generation / saves don't block the UI
    app.run(host=HOST, port=port, threaded=True, use_reloader=False)


def main() -> None:
    app = create_app()
    port = _free_port()
    url = f"http://{HOST}:{port}/"

    server = threading.Thread(target=_run_server, args=(app, port), daemon=True)
    server.start()

    try:
        import webview  # pywebview
        webview.create_window(
            "JDT Pricing Model",
            url,
            width=1320, height=860, min_size=(1024, 680),
        )
        webview.start()
    except Exception:
        # Fallback: open in the default browser and keep the server alive.
        import time
        import webbrowser
        webbrowser.open(url)
        print(f"JDT Pricing Model running at {url}  (press Ctrl+C to quit)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
