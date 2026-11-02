# ats.spec — PyInstaller spec for ATS exe
# Run from the Backend/ folder:
#   pyinstaller ats.spec

import os, sys
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# ── Collect packages with dynamic imports ────────────────────────────────────

datas_uvicorn,   binaries_uvicorn,   hiddenimports_uvicorn   = collect_all("uvicorn")
datas_fastapi,   binaries_fastapi,   hiddenimports_fastapi   = collect_all("fastapi")
datas_starlette, binaries_starlette, hiddenimports_starlette = collect_all("starlette")
datas_pydantic,  binaries_pydantic,  hiddenimports_pydantic  = collect_all("pydantic")
datas_multipart, binaries_multipart, hiddenimports_multipart = collect_all("multipart")

# ── Extra data files ──────────────────────────────────────────────────────────

added_datas = [
    # Mphasis logo
    (os.path.join("app", "mphasis_formatter", "mphasis_logo.png"), os.path.join("app", "mphasis_formatter")),
    # Built React frontend (must exist before running pyinstaller)
    (os.path.join("..", "frontend", "dist"), "frontend_dist"),
]

added_datas += datas_uvicorn + datas_fastapi + datas_starlette + datas_pydantic + datas_multipart

# ── Hidden imports ────────────────────────────────────────────────────────────

hidden = [
    "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto",
    "uvicorn.protocols", "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl", "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan", "uvicorn.lifespan.on",
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.dialects.postgresql",
    "pdfminer", "pdfminer.high_level", "pdfminer.layout",
    "pdfminer.pdfinterp", "pdfminer.pdfdevice", "pdfminer.converter",
    "docx", "docx.oxml", "docx.oxml.ns",
    "openpyxl",
    "reportlab", "reportlab.lib", "reportlab.platypus",
    "aiofiles",
    "passlib", "passlib.handlers", "passlib.handlers.bcrypt",
    "dotenv",
    "requests",
    "pandas",
    "multipart",
    "email_validator",
]

hidden += hiddenimports_uvicorn + hiddenimports_fastapi + hiddenimports_starlette
hidden += hiddenimports_pydantic + hiddenimports_multipart
hidden += collect_submodules("app")

# ── Analysis ──────────────────────────────────────────────────────────────────

a = Analysis(
    ["launcher.py"],
    pathex=[os.path.abspath(".")],
    binaries=binaries_uvicorn + binaries_fastapi + binaries_starlette + binaries_pydantic + binaries_multipart,
    datas=added_datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "notebook", "IPython"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ATS",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="ATS",
)
