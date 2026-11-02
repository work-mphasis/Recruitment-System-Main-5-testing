"""
launcher.py — entry point when running as a PyInstaller exe.
Sets up all writable data paths, mounts the React frontend,
opens the browser, then starts uvicorn.
"""

import sys, os, threading, webbrowser, time, socket

# ── Path setup ────────────────────────────────────────────────────────────────

IS_EXE       = getattr(sys, "frozen", False)
BUNDLE_DIR   = sys._MEIPASS if IS_EXE else os.path.dirname(os.path.abspath(__file__))
EXE_DIR      = os.path.dirname(sys.executable) if IS_EXE else os.path.dirname(os.path.abspath(__file__))

# All user data lives here (writable, next to the exe)
DATA_DIR = os.path.join(EXE_DIR, "ATS_Data")
os.makedirs(os.path.join(DATA_DIR, "resumes"), exist_ok=True)

# ── Environment variables (must be set BEFORE importing app modules) ──────────

os.environ["APP_EXE_MODE"]   = "1"
os.environ["APP_DATA_DIR"]   = DATA_DIR
os.environ["APP_RESUMES_DIR"] = os.path.join(DATA_DIR, "resumes")

# SQLite databases in ATS_Data/
os.environ["SQLITE_URL"]   = f"sqlite:///{os.path.join(DATA_DIR, 'recruitment.db')}"
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(DATA_DIR, 'auth.db')}"

# ── Import app (after env vars are set) ───────────────────────────────────────

from app.main import app as asgi_app
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi import Request

# ── Mount built React frontend ────────────────────────────────────────────────

frontend_dist = os.path.join(BUNDLE_DIR, "frontend_dist")
if os.path.isdir(frontend_dist):
    # Serve compiled assets (JS/CSS bundles)
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.isdir(assets_dir):
        asgi_app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Serve root-level static files (vite.svg, favicon, etc.)
    @asgi_app.get("/vite.svg", include_in_schema=False)
    async def _vite_svg():
        return FileResponse(os.path.join(frontend_dist, "vite.svg"))

    # SPA catch-all: any path not matched by an API route serves index.html
    # so React Router can handle client-side navigation and page refreshes.
    @asgi_app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(request: Request, full_path: str):
        return FileResponse(os.path.join(frontend_dist, "index.html"))

# ── Find a free port ─────────────────────────────────────────────────────────

def _find_free_port(preferred=8000):
    for port in [preferred] + list(range(8001, 8020)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free port found in range 8000-8019")

PORT = _find_free_port()

# ── Open browser after server is ready ───────────────────────────────────────

def _open_browser():
    time.sleep(2.5)
    webbrowser.open(f"http://127.0.0.1:{PORT}")

threading.Thread(target=_open_browser, daemon=True).start()

# ── Start server ──────────────────────────────────────────────────────────────

import uvicorn
uvicorn.run(asgi_app, host="127.0.0.1", port=PORT, log_level="warning")
