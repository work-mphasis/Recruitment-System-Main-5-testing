"""
Launcher for the packaged Recruitment System executable.
Sets up writable data paths, then starts the FastAPI server.
"""
import sys
import os
import threading
import time
import webbrowser


def _bundle_dir() -> str:
    """Root of the extracted PyInstaller bundle (_MEIPASS when frozen)."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def _exe_dir() -> str:
    """Directory that contains the .exe (or this script in dev mode)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _setup_data_dir():
    """
    Create a writable 'data' folder next to the .exe for user data:
    SQLite DB and uploaded resumes.  Sets env vars so main.py picks up
    the correct paths.
    """
    bundle = _bundle_dir()
    data   = os.path.join(_exe_dir(), "data")
    os.makedirs(data, exist_ok=True)

    # Resumes folder
    resumes_dir = os.path.join(data, "resumes")
    os.makedirs(resumes_dir, exist_ok=True)

    # SQLite database
    db_path = os.path.join(data, "recruitment.db")

    # Expose paths to the app
    os.environ["APP_RESUMES_DIR"] = resumes_dir
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{db_path}")

    # Add bundled backend source to sys.path so 'app.main' is importable
    backend_src = os.path.join(bundle, "backend_src")
    if backend_src not in sys.path:
        sys.path.insert(0, backend_src)


def _open_browser():
    time.sleep(2.5)
    webbrowser.open("http://127.0.0.1:8000")


if __name__ == "__main__":
    _setup_data_dir()

    threading.Thread(target=_open_browser, daemon=True).start()

    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        log_level="warning",
    )
