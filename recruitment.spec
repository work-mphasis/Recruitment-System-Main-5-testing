# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Recruitment System.
Build with:  pyinstaller recruitment.spec
"""

import os

ROOT    = os.path.abspath(".")
BACKEND = os.path.join(ROOT, "Backend")
APP_DIR = os.path.join(BACKEND, "app")

# ── Data files bundled into the exe ───────────────────────────────────────────
datas = [
    # Backend source (keeps 'app' package importable at runtime)
    (os.path.join(BACKEND, "app"), os.path.join("backend_src", "app")),

    # Compiled React frontend → served at / by FastAPI
    (os.path.join(ROOT, "frontend", "dist"),
     os.path.join("backend_src", "app", "frontend_dist")),

    # Mphasis logo (used by the DOCX formatter)
    (os.path.join(APP_DIR, "mphasis_formatter", "mphasis_logo.png"),
     os.path.join("backend_src", "app", "mphasis_formatter")),
]

# ── Hidden imports (uvicorn/fastapi internals not auto-detected) ──────────────
hidden_imports = [
    "uvicorn.loops",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.logging",
    "uvicorn.main",
    "uvicorn.config",
    "uvicorn.supervisors",
    "uvicorn.supervisors.statreload",
    "anyio",
    "anyio._backends._asyncio",
    "anyio.abc",
    "starlette.routing",
    "starlette.staticfiles",
    "starlette.responses",
    "starlette.middleware.cors",
    "fastapi.staticfiles",
    "fastapi.responses",
    "multipart",
    "python_multipart",
    "email.mime.text",
    "email.mime.multipart",
    "docx",
    "docx.oxml",
    "docx.oxml.ns",
    "openpyxl",
    "pdfplumber",
    "pdfplumber.page",
    "PIL",
    "PIL.Image",
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.pool",
    "passlib.handlers.bcrypt",
    "passlib.handlers.sha2_crypt",
    "jose",
    "jose.jwt",
    "reportlab.platypus",
    "reportlab.lib.pagesizes",
    "mammoth",
    "pandas",
    "requests",
    "dotenv",
]

a = Analysis(
    ["launcher.py"],
    pathex=[ROOT, BACKEND],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "IPython", "notebook"],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="RecruitmentSystem",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,   # keep console so startup errors are visible
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="RecruitmentSystem",
)
