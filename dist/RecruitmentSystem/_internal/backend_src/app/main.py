import sys, io
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try: sys.stderr.reconfigure(encoding="utf-8")
    except Exception: pass

from fastapi import FastAPI, HTTPException, Query, Body, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional
import pandas as pd
import json
import os
import re
import shutil
import tempfile
import threading
from datetime import datetime, date
import traceback
import openpyxl
from xml.sax.saxutils import escape as xml_escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.mphasis_formatter import (
    detect_sanitization_log_actions,
    format_pipeline_resume_docx,
    format_sanitized_resume_docx,
    sanitize_resume_content,
    transform_resume_pipeline,
    transform_docx_resume,
)
from app.resume_parser import extract_resume_text, create_summary_pdf
from app.summary_generator import generate_summary
from app.ai_scorer import score_with_ollama, list_ollama_models, ollama_is_running
from app.auth_db import (
    init_auth_tables, get_all_data, account_exists,
    add_account, delete_account, user_exists,
    add_user, delete_user, update_password, validate_login,
    cluster_exists, add_cluster, delete_cluster,
    cohort_exists, add_cohort, delete_cohort,
    lob_exists, add_lob, delete_lob,
    add_user_access, remove_user_access, get_user_access,
)
from app.talentnext_catalog import catalog as talentnext_catalog
from app.rubrics import (
    activate_rubric,
    compute_skill_gap,
    create_draft_rubric,
    get_active_rubric,
    get_rubric,
    init_rubric_tables,
    list_candidate_scores,
    list_rubrics,
    rubric_score_for_resume,
    save_candidate_score,
    update_rubric,
    validate_rubric,
)

# -------------------------------------------------
# Directory Setup
# -------------------------------------------------

BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
RESUME_FOLDER  = os.environ.get("APP_RESUMES_DIR") or os.path.join(BASE_DIR, "resumes")
os.makedirs(RESUME_FOLDER, exist_ok=True)
SUPPORTED_RESUME_EXTENSIONS = [".docx", ".pdf"]
ORIGINAL_RESUME_SUFFIX = "__original"
TRANSFORMED_RESUME_SUFFIX = "__transformed"
FORMATTING_PENDING = "pending"
FORMATTING_RUNNING = "running"
FORMATTING_VALIDATING = "validating"
FORMATTING_COMPLETED = "ready"
FORMATTING_NEEDS_REVIEW = "needs_review"
FORMATTING_FAILED = "failed"
resume_formatting_status = {}
resume_formatting_lock = threading.Lock()

HISTORY_FILE        = os.path.join(BASE_DIR, "stage_history.json")
SKILLS_FILE         = os.path.join(BASE_DIR, "position_skills.json")
SCORES_FILE         = os.path.join(BASE_DIR, "ai_scores.json")
SUMMARIES_FILE      = os.path.join(BASE_DIR, "summaries_cache.json")
ROLE_SUGGESTIONS_FILE    = os.path.join(BASE_DIR, "role_suggestions.json")
DELETED_POSITIONS_FILE   = os.path.join(BASE_DIR, "deleted_positions.json")
RESUME_VALIDATION_FILE   = os.path.join(BASE_DIR, "resume_validation.json")
RESUME_AUDIT_FILE        = os.path.join(BASE_DIR, "resume_audit.json")

# -------------------------------------------------
# App Setup
# -------------------------------------------------

app = FastAPI(title="Enterprise Excel Hiring Analytics System", version="18.0.0")

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5176",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AccountContextMiddleware:
    """Sets _current_account (single) and _current_accounts (multi) from request headers."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = {k.lower(): v for k, v in scope.get("headers", [])}

            raw = headers.get(b"x-account", b"Admin")
            account = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            token_single = _current_account.set(account or "Admin")

            raw_multi = headers.get(b"x-accounts", b"")
            accs_str  = raw_multi.decode("utf-8") if isinstance(raw_multi, bytes) else raw_multi
            if accs_str == "__ALL__":
                token_multi = _current_accounts.set("__ALL__")
            elif accs_str:
                token_multi = _current_accounts.set(
                    [a.strip() for a in accs_str.split(",") if a.strip()]
                )
            else:
                token_multi = None

            try:
                await self.app(scope, receive, send)
            finally:
                _current_account.reset(token_single)
                if token_multi is not None:
                    _current_accounts.reset(token_multi)
        else:
            await self.app(scope, receive, send)


app.add_middleware(AccountContextMiddleware)

# -------------------------------------------------
# Data Configuration (Postgres — Excel kept as migration source)
# -------------------------------------------------

EXCEL_FILE       = os.environ.get("APP_EXCEL_FILE") or os.path.join(BASE_DIR, "WIPPx NEW REQ Jul 29_Copy.xlsx")
DASHBOARD_SHEET  = "Dashboard"
CANDIDATES_SHEET = "New requirements"
HISTORY_SHEET    = "Stage History"

from app.pg_sheets import read_sheet, write_sheet, migrate_from_excel, _current_account, _current_accounts, init_data_tables, engine, single_account_scope
from sqlalchemy import text

# -------------------------------------------------
# Pipeline Stages
# -------------------------------------------------

STAGE_COUNTER_MAP = {
    "L1 Scheduled":               "# Profiles Scheduled",
    "Client Interview Scheduled": "# Profiles Pending with Client",
    "DM Interview Scheduled":     "# Profiles Pending with Client",
    "Selected":                   "# Positions Fulfilled",
    "L1 Reject":                  "# Profiles Rejected",
    "Client Reject":              "# Profiles Rejected",
    "DM Reject":                  "# Profiles Rejected",
    "Rejected":                   "# Profiles Rejected",
    "Submitted":                  None,
    "Scheduled":                  "# Profiles Scheduled",
    "Pending feedback":           "# Profiles Pending feedback",
    "Pending with Client":        "# Profiles Pending with Client",
    "Selection":                  "# Positions Fulfilled",
}

ALL_COUNTER_COLS = [
    "# Profiles Submitted",
    "# Profiles Rejected",
    "# Profiles Pending feedback",
    "# Profiles Scheduled",
    "# Profiles Pending with Client",
    "# Positions Fulfilled",
]

# -------------------------------------------------
# Aging Helpers
# -------------------------------------------------

AGING_BUCKETS = [
    (14,   "Fresh",    1.0),
    (30,   "Aging",    1.5),
    (60,   "Stale",    2.0),
    (9999, "Critical", 3.0),
]


def get_aging_bucket(days_open: int) -> tuple:
    for threshold, label, multiplier in AGING_BUCKETS:
        if days_open <= threshold:
            return label, multiplier
    return "Critical", 3.0


def get_days_open_for_role(role: str, candidates_df=None) -> int:
    try:
        df = candidates_df if candidates_df is not None else read_sheet(CANDIDATES_SHEET)
        if df.empty or "Role" not in df.columns:
            return 0
        role_rows = df[
            (df["Role"].astype(str).str.strip().str.lower() == role.strip().lower()) &
            (df["Candidate Name"].notna()) &
            (df["Candidate Name"].astype(str).str.strip() != "") &
            (df["Candidate Name"].astype(str).str.strip().str.lower() != "nan")
        ]
        if role_rows.empty:
            return 0
        dates = []
        for col in ["Profile Shared on", "Assessment on/To be scheduled"]:
            if col in role_rows.columns:
                parsed = pd.to_datetime(role_rows[col], errors="coerce", format="mixed").dropna()
                dates.extend(parsed.tolist())
        if not dates:
            history = get_all_history()
            for _, row in role_rows.iterrows():
                name    = str(row.get("Candidate Name", "")).strip()
                entries = history.get(name, [])
                for entry in entries:
                    try:
                        d = pd.to_datetime(entry.get("date", ""), errors="coerce")
                        if pd.notna(d):
                            dates.append(d)
                    except Exception:
                        pass
        if not dates:
            return 0
        earliest = min(dates)
        delta    = date.today() - earliest.date()
        return max(0, delta.days)
    except Exception as e:
        print(f"⚠️  get_days_open_for_role error: {e}")
        return 0


# -------------------------------------------------
# Stage History — Excel Sheet Helpers
# -------------------------------------------------

HISTORY_COLUMNS = ["Candidate Name", "Stage", "Date", "Logged At", "Interviewer"]


def _ensure_history_sheet():
    try:
        with engine.begin() as conn:
            if engine.dialect.name == "sqlite":
                existing = [r[1] for r in conn.execute(text('PRAGMA table_info(stage_history)')).fetchall()]
                if existing and "Interviewer" not in existing:
                    conn.execute(text('ALTER TABLE stage_history ADD COLUMN "Interviewer" TEXT DEFAULT \'\''))
            else:
                conn.execute(text(
                    'ALTER TABLE IF EXISTS stage_history '
                    'ADD COLUMN IF NOT EXISTS "Interviewer" TEXT DEFAULT \'\''
                ))
    except Exception:
        pass


def _read_history_sheet() -> pd.DataFrame:
    """Read ALL stage history rows — not account-filtered."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text('SELECT * FROM stage_history'))
            rows = result.fetchall()
            cols = list(result.keys())
        df = pd.DataFrame(rows, columns=cols)
        df.columns = df.columns.map(str).str.strip()
        for col in HISTORY_COLUMNS:
            if col not in df.columns:
                df[col] = ""
        return df
    except Exception:
        return pd.DataFrame(columns=HISTORY_COLUMNS)


def _write_history_sheet(df: pd.DataFrame):
    """Write ALL stage history rows — not account-filtered."""
    try:
        df = df.copy()
        if "account_name" not in df.columns:
            df["account_name"] = "Admin"
        if "lob_name" not in df.columns:
            df["lob_name"] = ""
        with engine.begin() as conn:
            conn.execute(text('DELETE FROM stage_history'))
            if not df.empty:
                df.to_sql("stage_history", conn, if_exists="append", index=False, method="multi", chunksize=500)
    except Exception as e:
        print(f"⚠️ _write_history_sheet error: {e}")


# -------------------------------------------------
# Stage History — JSON Helpers (backup)
# -------------------------------------------------

def load_history() -> dict:
    if not os.path.exists(HISTORY_FILE):
        return {}
    try:
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_history(history: dict):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)


# -------------------------------------------------
# Stage History — Unified Read
# -------------------------------------------------

def get_history_for_candidate(candidate_name: str) -> list:
    df  = _read_history_sheet()
    if df.empty:
        return []
    key  = candidate_name.strip()
    rows = df[df["Candidate Name"].astype(str).str.strip() == key]
    entries = []
    for _, row in rows.iterrows():
        entries.append({
            "stage":       str(row.get("Stage", "")),
            "date":        str(row.get("Date", "")),
            "logged_at":   str(row.get("Logged At", "")),
            "interviewer": str(row.get("Interviewer", "")),
        })
    return sorted(entries, key=lambda x: x.get("logged_at", ""))


def get_all_history() -> dict:
    df = _read_history_sheet()
    if df.empty:
        return {}
    result = {}
    for _, row in df.iterrows():
        key = str(row.get("Candidate Name", "")).strip()
        if not key or key == "nan":
            continue
        if key not in result:
            result[key] = []
        result[key].append({
            "stage":       str(row.get("Stage", "")),
            "date":        str(row.get("Date", "")),
            "logged_at":   str(row.get("Logged At", "")),
            "interviewer": str(row.get("Interviewer", "")),
        })
    for key in result:
        result[key] = sorted(result[key], key=lambda x: x.get("logged_at", ""))
    return result


# -------------------------------------------------
# Stage History — Unified Write
# -------------------------------------------------

def log_stage_entry(candidate_name: str, stage: str, date_str: str, interviewer: str = ""):
    key       = candidate_name.strip()
    logged_at = datetime.now().isoformat()
    _ensure_history_sheet()
    try:
        with engine.begin() as conn:
            # Remove ALL existing entries for this candidate+stage (any account)
            conn.execute(
                text('DELETE FROM stage_history WHERE "Candidate Name" = :cn AND "Stage" = :s'),
                {"cn": key, "s": stage.strip()},
            )
            # Insert the new entry
            conn.execute(
                text(
                    'INSERT INTO stage_history ("Candidate Name", "Stage", "Date", "Logged At", "Interviewer", account_name, lob_name) '
                    'VALUES (:cn, :s, :d, :la, :iv, :acc, :lob)'
                ),
                {"cn": key, "s": stage, "d": date_str, "la": logged_at, "iv": interviewer, "acc": "Admin", "lob": ""},
            )
    except Exception as e:
        print(f"⚠️ log_stage_entry DB error: {e}")
    history = load_history()
    if key not in history:
        history[key] = []
    history[key] = [e for e in history[key] if e.get("stage") != stage]
    history[key].append({"stage": stage, "date": date_str, "logged_at": logged_at, "interviewer": interviewer})
    save_history(history)


def delete_candidate_history(candidate_name: str):
    key = candidate_name.strip()
    _ensure_history_sheet()
    try:
        with engine.begin() as conn:
            conn.execute(
                text('DELETE FROM stage_history WHERE "Candidate Name" = :cn'),
                {"cn": key},
            )
    except Exception as e:
        print(f"⚠️ delete_candidate_history DB error: {e}")
    history = load_history()
    if key in history:
        del history[key]
        save_history(history)


def delete_last_stage_entry(candidate_name: str, stage: str):
    key = candidate_name.strip()
    _ensure_history_sheet()
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text('SELECT "Stage", "Logged At" FROM stage_history WHERE "Candidate Name" = :cn ORDER BY "Logged At" DESC'),
                {"cn": key},
            )
            rows = result.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not rows:
        raise HTTPException(status_code=404, detail="No history found for this candidate")
    last_stage, last_logged_at = str(rows[0][0]).strip(), str(rows[0][1])
    if last_stage != stage.strip():
        raise HTTPException(
            status_code=400,
            detail=f"Can only delete the most recent stage ('{last_stage}'). Requested: '{stage}'"
        )
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    'DELETE FROM stage_history WHERE "Candidate Name" = :cn AND "Stage" = :s AND "Logged At" = :la'
                ),
                {"cn": key, "s": stage.strip(), "la": last_logged_at},
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    history = load_history()
    if key in history:
        entries = sorted(history[key], key=lambda x: x.get("logged_at", ""))
        if entries and entries[-1].get("stage") == stage:
            history[key] = entries[:-1]
            save_history(history)


# -------------------------------------------------
# Migration: stage_history.json → Excel
# -------------------------------------------------

def migrate_json_history_to_excel():
    if not os.path.exists(HISTORY_FILE):
        return
    json_history = load_history()
    if not json_history:
        return
    _ensure_history_sheet()
    df       = _read_history_sheet()
    existing = set()
    if not df.empty:
        for _, row in df.iterrows():
            existing.add((
                str(row.get("Candidate Name", "")).strip(),
                str(row.get("Stage", "")).strip(),
            ))
    new_rows = []
    for candidate_name, entries in json_history.items():
        key = candidate_name.strip()
        for entry in entries:
            stage = str(entry.get("stage", "")).strip()
            if (key, stage) not in existing:
                new_rows.append({
                    "Candidate Name": key,
                    "Stage":          stage,
                    "Date":           entry.get("date", ""),
                    "Logged At":      entry.get("logged_at", datetime.now().isoformat()),
                    "Interviewer":    entry.get("interviewer", ""),
                    "account_name":   "Admin",
                    "lob_name":       "",
                })
                existing.add((key, stage))
    if new_rows:
        try:
            with engine.begin() as conn:
                pd.DataFrame(new_rows).to_sql("stage_history", conn, if_exists="append", index=False, method="multi", chunksize=500)
            print(f"✅ Migrated {len(new_rows)} stage history entries from JSON → PostgreSQL")
        except Exception as e:
            print(f"⚠️ Migration error: {e}")
    else:
        print("ℹ️  Migration: no new entries to migrate")


# -------------------------------------------------
# Position Skills Helpers
# -------------------------------------------------

def load_position_skills() -> dict:
    if not os.path.exists(SKILLS_FILE):
        return {}
    try:
        with open(SKILLS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_position_skills(data: dict):
    with open(SKILLS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def store_position_skills(position_code: str, role: str, skills: list, job_description: str):
    data = load_position_skills()
    data[position_code.strip()] = {
        "role":            role.strip(),
        "skills":          skills,
        "job_description": job_description,
        "updated_at":      datetime.now().isoformat()
    }
    save_position_skills(data)


def get_skills_for_role(role: str) -> list:
    data       = load_position_skills()
    role_lower = role.strip().lower()
    for entry in data.values():
        if entry.get("role", "").strip().lower() == role_lower:
            return entry.get("skills", [])
    return []


def get_jd_for_role(role: str) -> str:
    data       = load_position_skills()
    role_lower = role.strip().lower()
    for entry in data.values():
        if entry.get("role", "").strip().lower() == role_lower:
            return entry.get("job_description", "")
    return ""


# -------------------------------------------------
# Role Suggestions Cache Helpers
# -------------------------------------------------

def load_role_suggestions() -> dict:
    if not os.path.exists(ROLE_SUGGESTIONS_FILE):
        return {}
    try:
        with open(ROLE_SUGGESTIONS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_role_suggestions(data: dict):
    with open(ROLE_SUGGESTIONS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_cached_role_suggestions(filename: str):
    return load_role_suggestions().get(filename)


def delete_role_suggestions_cache(filename: str):
    data = load_role_suggestions()
    if filename in data:
        del data[filename]
        save_role_suggestions(data)


def score_all_roles_keyword(resume_text: str, exclude_role: str = "") -> list:
    """
    Score resume against every role in position_skills.json using fast keyword matching.
    Called during upload so results are ready instantly when Track is clicked.
    Returns list of {role, position_code, overall, matched, missing} sorted descending.
    """
    import re as _re
    data        = load_position_skills()
    exclude_low = exclude_role.strip().lower()
    stop = {
        "the","and","for","with","that","this","are","will","have","from",
        "you","our","they","all","any","can","has","been","more","also",
        "must","able","work","role","team","skills","experience","ability",
        "strong","good","well","high","key","new","use","used","other",
    }
    exp_match = _re.search(r"(\d+)\+?\s*(years?|yrs?)", resume_text, _re.IGNORECASE)
    exp_years = int(exp_match.group(1)) if exp_match else None
    exp_score = min(20, (exp_years or 0) * 2)

    results = []
    for position_code, entry in data.items():
        role   = entry.get("role", "").strip()
        skills = entry.get("skills", [])
        jd     = entry.get("job_description", "")
        if role.lower() == exclude_low:
            continue
        if not skills and not jd:
            continue

        matched = [s for s in skills if _re.search(_re.escape(s), resume_text, _re.IGNORECASE)]
        missing = [s for s in skills if s not in matched]
        skill_score = round((len(matched) / max(len(skills), 1)) * 60) if skills else 0

        ctx_score = 0
        if jd:
            jd_tokens = list({
                w for w in _re.sub(r"[^a-z0-9\s]", " ", jd.lower()).split()
                if len(w) > 2 and w not in stop
            })
            jd_hit    = [w for w in jd_tokens if _re.search(r"\b" + _re.escape(w) + r"\b", resume_text, _re.IGNORECASE)]
            ctx_score = min(20, round((len(jd_hit) / max(len(jd_tokens), 1)) * 40))

        overall = min(100, skill_score + exp_score + ctx_score)
        if overall < 30:
            continue

        results.append({
            "role":          role,
            "position_code": position_code,
            "overall":       overall,
            "matched":       matched,
            "missing":       missing,
        })

    results.sort(key=lambda x: x["overall"], reverse=True)
    # Deduplicate by role name (case-insensitive) — multiple position codes may share the same role
    seen_roles: dict = {}
    deduped = []
    for r in results:
        key = r["role"].strip().lower()
        if key not in seen_roles:
            seen_roles[key] = True
            deduped.append(r)
    return deduped


# -------------------------------------------------
# Summary Cache Helpers
# -------------------------------------------------

def load_summaries() -> dict:
    if not os.path.exists(SUMMARIES_FILE):
        return {}
    try:
        with open(SUMMARIES_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_summary_to_cache(filename: str, role: str, summary: str):
    cache = load_summaries()
    key   = f"{filename}::{role.strip()}" if role and role.strip() else filename
    cache[key] = {
        "role":      role,
        "summary":   summary,
        "generated": datetime.now().isoformat(),
    }
    with open(SUMMARIES_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def delete_summary_cache(filename: str):
    cache        = load_summaries()
    prefix       = f"{filename}::"
    keys_to_del  = [k for k in cache if k == filename or k.startswith(prefix)]
    if keys_to_del:
        for k in keys_to_del:
            del cache[k]
        with open(SUMMARIES_FILE, "w") as f:
            json.dump(cache, f, indent=2)


def clear_all_summary_cache():
    with open(SUMMARIES_FILE, "w") as f:
        json.dump({}, f)


# -------------------------------------------------
# AI Score Cache Helpers
# -------------------------------------------------

def load_ai_scores() -> dict:
    if not os.path.exists(SCORES_FILE):
        return {}
    try:
        with open(SCORES_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_ai_score(filename: str, role: str, score_data: dict):
    scores = load_ai_scores()
    key    = f"{filename}::{role.strip()}" if role and role.strip() else filename
    scores[key] = {
        "role":      role,
        "score":     score_data,
        "scored_at": datetime.now().isoformat(),
    }
    with open(SCORES_FILE, "w") as f:
        json.dump(scores, f, indent=2)


def delete_ai_score(filename: str):
    scores       = load_ai_scores()
    prefix       = f"{filename}::"
    keys_to_del  = [k for k in scores if k == filename or k.startswith(prefix)]
    if keys_to_del:
        for k in keys_to_del:
            del scores[k]
        with open(SCORES_FILE, "w") as f:
            json.dump(scores, f, indent=2)


# -------------------------------------------------
# Background AI Scoring
# -------------------------------------------------

def run_ai_scoring_background(filename: str, role: str):
    try:
        file_path, filename = _resolve_resume_file(filename)
        if not os.path.exists(file_path):
            return
        resume_text          = extract_resume_text(file_path)
        data                 = load_position_skills()
        jd_text              = ""
        position_skills_list = []
        role_lower           = role.strip().lower()
        for entry in data.values():
            if entry.get("role", "").strip().lower() == role_lower:
                jd_text              = entry.get("job_description", "")
                position_skills_list = entry.get("skills", [])
                break
        if not jd_text.strip() and not position_skills_list:
            print(f"⚠️  No JD/skills for role '{role}' — skipping scoring for {filename}")
            return
        if not jd_text.strip() and position_skills_list:
            jd_text = "Required skills: " + ", ".join(position_skills_list)
        if ollama_is_running():
            result = score_with_ollama(resume_text, jd_text)
            if result:
                result["source"] = "ollama"
                save_ai_score(filename, role, result)
                print(f"✅ Ollama score cached for {filename}")
                return
        import re as _re
        skills_matched = []
        skills_missing = []
        for skill in position_skills_list:
            pattern = _re.compile(_re.escape(skill), _re.IGNORECASE)
            if pattern.search(resume_text):
                skills_matched.append(skill)
            else:
                skills_missing.append(skill)
        skill_score = round((len(skills_matched) / max(len(position_skills_list), 1)) * 60)
        exp_match   = _re.search(r"(\d+)\+?\s*(years?|yrs?)", resume_text, _re.IGNORECASE)
        exp_years   = int(exp_match.group(1)) if exp_match else None
        exp_score   = min(20, (exp_years or 0) * 2)
        stop = {
            "the","and","for","with","that","this","are","will","have","from",
            "you","our","they","all","any","can","has","been","more","also",
            "must","able","work","role","team","skills","experience","ability",
            "strong","good","well","high","key","new","use","used","other",
        }
        jd_tokens = list({
            w for w in _re.sub(r"[^a-z0-9\s]", " ", jd_text.lower()).split()
            if len(w) > 2 and w not in stop
        })
        jd_hit    = [w for w in jd_tokens if _re.search(r"\b" + _re.escape(w) + r"\b", resume_text, _re.IGNORECASE)]
        ctx_score = min(20, round((len(jd_hit) / max(len(jd_tokens), 1)) * 40))
        overall   = min(100, skill_score + exp_score + ctx_score)
        result = {
            "source":  "keyword_fallback",
            "overall": overall,
            "skills": {
                "score":     skill_score,
                "matched":   skills_matched,
                "missing":   skills_missing,
                "reasoning": f"{len(skills_matched)} of {len(position_skills_list)} required skills found in resume.",
            },
            "experience": {
                "score":          exp_score,
                "years_detected": exp_years,
                "reasoning":      f"{exp_years} years detected." if exp_years else "No explicit years of experience found.",
            },
            "context": {
                "score":     ctx_score,
                "reasoning": f"{len(jd_hit)} JD keywords matched in resume context.",
            },
            "summary": "Keyword-based score. Ollama unavailable at time of scoring.",
        }
        save_ai_score(filename, role, result)
        print(f"✅ Keyword score cached for {filename}")
    except Exception as e:
        print(f"⚠️  Background scoring error for {filename}: {e}")


# -------------------------------------------------
# Background Score + Summary
# -------------------------------------------------

def _score_and_summarise_background(filename: str, role: str):
    """
    Step 1 : Score the resume against the JD  → saved to ai_scores.json
    Step 2 : Generate full summary via Ollama → saved to summaries_cache.json

    After this, every click on AI Analysis is instant — no waiting.
    """
    try:
        # Step 1 — Scoring
        run_ai_scoring_background(filename, role)

        # Step 2 — Summary
        file_path, filename = _resolve_resume_file(filename)
        if not os.path.exists(file_path):
            return
        resume_text = extract_resume_text(file_path)
        jd          = get_jd_for_role(role)
        summary     = generate_summary(resume_text, jd)
        save_summary_to_cache(filename, role, summary)
        print(f"✅ Summary cached for {filename}")

        # Step 3 — Cross-role suggestions (keyword-only, fast, no Ollama needed)
        suggestions = score_all_roles_keyword(resume_text, exclude_role=role)
        suggestions_data = load_role_suggestions()
        suggestions_data[filename] = {
            "suggestions":  suggestions,
            "computed_at":  datetime.now().isoformat(),
            "source_role":  role,
        }
        save_role_suggestions(suggestions_data)
        print(f"✅ Role suggestions cached for {filename} ({len(suggestions)} roles)")

    except Exception as e:
        print(f"⚠️  _score_and_summarise_background error for {filename}: {e}")


# -------------------------------------------------
# Bulk background summary generation
# -------------------------------------------------

def _generate_summary_for_one(filename: str, role: str, jd: str):
    try:
        file_path, filename = _resolve_resume_file(filename)
        if not os.path.exists(file_path):
            return
        resume_text = extract_resume_text(file_path)
        summary     = generate_summary(resume_text, jd)
        save_summary_to_cache(filename, role, summary)
        print(f"✅ Summary cached for {filename}")
    except Exception as e:
        print(f"⚠️  Summary generation error for {filename}: {e}")


def regenerate_all_summaries_background():
    try:
        clear_all_summary_cache()
        print("🗑️  Summary cache cleared — regenerating all summaries...")
        role_lookup = {}
        try:
            df = read_sheet(CANDIDATES_SHEET)
            for _, row in df.iterrows():
                name = str(row.get("Candidate Name", "")).strip()
                role = str(row.get("Role", "")).strip()
                if name and name.lower() != "nan" and role and role.lower() != "nan":
                    role_lookup[name] = role
        except Exception as e:
            print(f"⚠️  Could not read candidates sheet: {e}")
            return
        resume_files = [f for f in os.listdir(RESUME_FOLDER) if f.endswith(".docx")]
        if not resume_files:
            print("ℹ️  No resumes found.")
            return
        print(f"📄 Regenerating summaries for {len(resume_files)} resume(s)...")
        for filename in resume_files:
            name = candidate_name_from_resume_file(filename)
            role = role_lookup.get(name, "")
            jd   = get_jd_for_role(role) if role else ""
            _generate_summary_for_one(filename, role, jd)
        print(f"✅ All {len(resume_files)} summaries regenerated.")
    except Exception as e:
        print(f"⚠️  regenerate_all_summaries_background error: {e}")


# -------------------------------------------------
# Startup pre-scoring
# -------------------------------------------------

def rescore_all_existing_resumes():
    try:
        scores      = load_ai_scores()
        role_lookup = {}
        try:
            df = read_sheet(CANDIDATES_SHEET)
            for _, row in df.iterrows():
                name = str(row.get("Candidate Name", "")).strip()
                role = str(row.get("Role", "")).strip()
                if name and name.lower() != "nan" and role and role.lower() != "nan":
                    role_lookup[name] = role
        except Exception as e:
            print(f"⚠️  Could not read candidates sheet for pre-scoring: {e}")
            return
        resume_files = [f for f in os.listdir(RESUME_FOLDER) if f.endswith(".docx")]
        pending      = []
        for filename in resume_files:
            if filename not in scores:
                name = candidate_name_from_resume_file(filename)
                role = role_lookup.get(name, "")
                if role:
                    pending.append((filename, role))
        if not pending:
            print("ℹ️  All resumes already scored ✅")
            return
        print(f"🔄 {len(pending)} unscored resume(s) — background scoring started...")
        for filename, role in pending:
            thread = threading.Thread(
                target=run_ai_scoring_background,
                args=(filename, role),
                daemon=True
            )
            thread.start()
    except Exception as e:
        print(f"⚠️  rescore_all_existing_resumes error: {e}")


# -------------------------------------------------
# Startup: build missing role suggestions for existing resumes
# -------------------------------------------------

def build_missing_role_suggestions():
    """
    Runs once at startup. For every .docx resume that has no cached role
    suggestions yet, score it against all known roles (keyword-only, fast)
    and write the result to role_suggestions.json.
    """
    try:
        cached       = load_role_suggestions()
        resume_files = [f for f in os.listdir(RESUME_FOLDER) if f.endswith(".docx")]
        pending      = [f for f in resume_files if f not in cached]
        if not pending:
            print("ℹ️  Role suggestions already built for all resumes ✅")
            return
        print(f"🔄 Building role suggestions for {len(pending)} resume(s)...")
        role_lookup = {}
        try:
            df = read_sheet(CANDIDATES_SHEET)
            for _, row in df.iterrows():
                name = str(row.get("Candidate Name", "")).strip()
                role = str(row.get("Role", "")).strip()
                if name and name.lower() != "nan" and role and role.lower() != "nan":
                    role_lookup[name] = role
        except Exception:
            pass
        for filename in pending:
            try:
                file_path   = os.path.join(RESUME_FOLDER, filename)
                resume_text = extract_resume_text(file_path)
                source_role = role_lookup.get(candidate_name_from_resume_file(filename), "")
                suggestions = score_all_roles_keyword(resume_text, exclude_role=source_role)
                data        = load_role_suggestions()
                data[filename] = {
                    "suggestions": suggestions,
                    "computed_at": datetime.now().isoformat(),
                    "source_role": source_role,
                }
                save_role_suggestions(data)
            except Exception as e:
                print(f"⚠️  Could not build suggestions for {filename}: {e}")
        print(f"✅ Role suggestions built for {len(pending)} resume(s)")
    except Exception as e:
        print(f"⚠️  build_missing_role_suggestions error: {e}")


# -------------------------------------------------
# Startup
# -------------------------------------------------

@app.on_event("startup")
def on_startup():
    init_auth_tables()
    init_data_tables()
    results = migrate_from_excel(EXCEL_FILE)
    for sheet, status in results.items():
        print(f"ℹ️  Migration [{sheet}]: {status}")
    try:
        init_rubric_tables()
        print("Rubric tables ready")
    except Exception as e:
        print(f"Rubric table initialization failed: {e}")
    try:
        status = talentnext_catalog.refresh()
        print(f"TalentNext catalog refresh: {status.get('file_name') or status.get('error')}")
    except Exception as e:
        print(f"TalentNext catalog refresh failed: {e}")
    migrate_json_history_to_excel()
    _deduplicate_stage_history()
    thread = threading.Thread(target=rescore_all_existing_resumes, daemon=True)
    thread.start()
    thread2 = threading.Thread(target=build_missing_role_suggestions, daemon=True)
    thread2.start()


def _deduplicate_stage_history():
    """Remove duplicate (Candidate Name, Stage) rows, keeping only the most recent."""
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                DELETE FROM stage_history
                WHERE rowid NOT IN (
                    SELECT rowid FROM (
                        SELECT rowid,
                               ROW_NUMBER() OVER (
                                   PARTITION BY "Candidate Name", "Stage"
                                   ORDER BY "Logged At" DESC
                               ) AS rn
                        FROM stage_history
                    ) ranked WHERE rn = 1
                )
            """))
        print("✅ Stage history deduplicated")
    except Exception as e:
        print(f"⚠️  Stage history dedup error: {e}")


# -------------------------------------------------
# Pydantic Models
# -------------------------------------------------

class PositionCreate(BaseModel):
    position_code:   str
    wippx:           str
    category:        str
    pod_name:        str
    manager:         str
    replacement_new: str
    role:            str
    location:        str
    positions:       int
    job_description: str          = ""
    skills:          list         = []
    account_name:    Optional[str] = None
    lob_name:        Optional[str] = None


class StageLogRequest(BaseModel):
    candidate_name: str
    stage:          str
    date:           str


class SummaryRequest(BaseModel):
    job_description: Optional[str] = ""
    force_refresh:   Optional[bool] = False
    role:            Optional[str]  = ""


class CopilotRequest(BaseModel):
    message: Optional[str] = ""
    action: Optional[str] = ""
    page: Optional[str] = ""
    role: Optional[str] = ""
    candidate: Optional[str] = ""


# -------------------------------------------------
# Utility Functions
# -------------------------------------------------



def ensure_numeric(df, columns):
    for col in columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df


# -------------------------------------------------
# Dashboard Counter Update
# -------------------------------------------------

def update_dashboard_counters(role: str, old_status: str, new_status: str):
    dash      = read_sheet(DASHBOARD_SHEET)
    dash_mask = dash["Role"].astype(str).str.strip().str.lower() == role.strip().lower()
    if not dash_mask.any():
        return
    dash = ensure_numeric(dash, ALL_COUNTER_COLS + ["# Positions", "# Positions Fulfilled"])
    if old_status is None:
        if "# Profiles Submitted" in dash.columns:
            dash.loc[dash_mask, "# Profiles Submitted"] += 1
    if old_status and old_status in STAGE_COUNTER_MAP:
        old_col = STAGE_COUNTER_MAP[old_status]
        if old_col and old_col in dash.columns:
            dash.loc[dash_mask, old_col] = (dash.loc[dash_mask, old_col] - 1).clip(lower=0)
    if new_status and new_status in STAGE_COUNTER_MAP:
        new_col = STAGE_COUNTER_MAP[new_status]
        if new_col and new_col in dash.columns:
            dash.loc[dash_mask, new_col] += 1
    try:
        candidates_df = read_sheet(CANDIDATES_SHEET)
        for idx in dash[dash_mask].index:
            row_role        = str(dash.at[idx, "Role"]).strip()
            fulfilled_count = len(candidates_df[
                (candidates_df["Role"].astype(str).str.strip().str.lower() == row_role.lower()) &
                (candidates_df["Candidate Name"].notna()) &
                (candidates_df["Candidate Name"].astype(str).str.strip() != "") &
                (candidates_df["Candidate Name"].astype(str).str.strip().str.lower() != "nan") &
                (candidates_df["Status"].astype(str).str.strip().isin(["Selected", "Selection"]))
            ])
            dash.at[idx, "# Positions Fulfilled"] = fulfilled_count
    except Exception as e:
        print(f"⚠️  Fulfilled recalc error: {e}")
    if "# Positions" in dash.columns and "# Positions Fulfilled" in dash.columns:
        dash.loc[dash_mask, "Gap"] = (
            dash.loc[dash_mask, "# Positions"] - dash.loc[dash_mask, "# Positions Fulfilled"]
        ).clip(lower=0)
    if "# Positions Net Open" in dash.columns:
        dash.loc[dash_mask, "# Positions Net Open"] = (
            dash.loc[dash_mask, "# Positions"] - dash.loc[dash_mask, "# Positions Fulfilled"]
        ).clip(lower=0)
    try:
        days_open                = get_days_open_for_role(role)
        bucket_label, multiplier = get_aging_bucket(days_open)
        gap_val                  = float(dash.loc[dash_mask, "Gap"].iloc[0])
        weighted_gap             = round(gap_val * multiplier, 1)
        if "Days Open"    not in dash.columns: dash["Days Open"]    = 0
        if "Aging Bucket" not in dash.columns: dash["Aging Bucket"] = ""
        if "Weighted Gap" not in dash.columns: dash["Weighted Gap"] = 0.0
        dash.loc[dash_mask, "Days Open"]    = days_open
        dash.loc[dash_mask, "Aging Bucket"] = bucket_label
        dash.loc[dash_mask, "Weighted Gap"] = weighted_gap
    except Exception as e:
        print(f"⚠️  Aging write error: {e}")
    # Safety: deduplicate before writing to avoid perpetuating DB contamination
    if "Position Code" in dash.columns:
        dash = dash.drop_duplicates(subset=["Position Code"], keep="first")
    write_sheet(dash, DASHBOARD_SHEET)


# -------------------------------------------------
# Resume Transformation Helpers
# -------------------------------------------------

def resume_stem(candidate_name: str) -> str:
    return candidate_name.replace(" ", "_")


def get_legacy_resume_path(candidate_name: str, extension: str) -> str:
    return os.path.join(RESUME_FOLDER, f"{resume_stem(candidate_name)}{extension}")


def get_original_resume_path(candidate_name: str, extension: str) -> str:
    return os.path.join(
        RESUME_FOLDER,
        f"{resume_stem(candidate_name)}{ORIGINAL_RESUME_SUFFIX}{extension}",
    )


def get_transformed_resume_path(candidate_name: str) -> str:
    return os.path.join(
        RESUME_FOLDER,
        f"{resume_stem(candidate_name)}{TRANSFORMED_RESUME_SUFFIX}.docx",
    )


def find_original_resume_path(candidate_name: str):
    for extension in SUPPORTED_RESUME_EXTENSIONS:
        file_path = get_original_resume_path(candidate_name, extension)
        if os.path.exists(file_path):
            return file_path

    for extension in SUPPORTED_RESUME_EXTENSIONS:
        file_path = get_legacy_resume_path(candidate_name, extension)
        if os.path.exists(file_path):
            return file_path

    return None


def find_transformed_resume_path(candidate_name: str):
    file_path = get_transformed_resume_path(candidate_name)
    if os.path.exists(file_path):
        return file_path
    # Glob fallback: handles name variants with extra underscores (e.g. trailing space in name)
    import glob as _glob
    stem = resume_stem(candidate_name.strip())
    matches = _glob.glob(os.path.join(RESUME_FOLDER, f"{stem}*{TRANSFORMED_RESUME_SUFFIX}.docx"))
    if matches:
        return matches[0]
    return None


def list_candidate_resume_paths(candidate_name: str):
    paths = []
    for extension in SUPPORTED_RESUME_EXTENSIONS:
        paths.append(get_original_resume_path(candidate_name, extension))
        paths.append(get_legacy_resume_path(candidate_name, extension))
    paths.append(get_transformed_resume_path(candidate_name))
    return paths


def delete_candidate_resume_files(candidate_name: str, keep_paths=None):
    keep_paths = keep_paths or []
    keep_paths = {os.path.abspath(path) for path in keep_paths if path}
    for extension in SUPPORTED_RESUME_EXTENSIONS:
        for file_path in (
            get_original_resume_path(candidate_name, extension),
            get_legacy_resume_path(candidate_name, extension),
        ):
            if not os.path.exists(file_path):
                continue
            if os.path.abspath(file_path) in keep_paths:
                continue
            try:
                os.remove(file_path)
            except OSError:
                pass

    transformed_path = get_transformed_resume_path(candidate_name)
    if os.path.exists(transformed_path) and os.path.abspath(transformed_path) not in keep_paths:
        try:
            os.remove(transformed_path)
        except OSError:
            pass

    with resume_formatting_lock:
        resume_formatting_status.pop(candidate_name, None)
    delete_resume_validation_report(candidate_name)
    delete_resume_audit_report(candidate_name)


def build_resume_url(file_name: str) -> str:
    return f"http://127.0.0.1:8000/resumes/{file_name}"


def candidate_name_from_resume_file(file_name: str) -> str:
    stem = os.path.splitext(file_name)[0]
    for suffix in (ORIGINAL_RESUME_SUFFIX, TRANSFORMED_RESUME_SUFFIX):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem.replace("_", " ")


def load_resume_validation_reports() -> dict:
    if not os.path.exists(RESUME_VALIDATION_FILE):
        return {}
    try:
        with open(RESUME_VALIDATION_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_resume_validation_report(candidate_name: str, report: dict):
    reports = load_resume_validation_reports()
    reports[candidate_name.strip()] = report
    with open(RESUME_VALIDATION_FILE, "w") as f:
        json.dump(reports, f, indent=2)


def get_resume_validation_report(candidate_name: str) -> dict:
    return load_resume_validation_reports().get(candidate_name.strip(), {})


def delete_resume_validation_report(candidate_name: str):
    reports = load_resume_validation_reports()
    key = candidate_name.strip()
    if key in reports:
        del reports[key]
        with open(RESUME_VALIDATION_FILE, "w") as f:
            json.dump(reports, f, indent=2)


def load_resume_audit_reports() -> dict:
    if not os.path.exists(RESUME_AUDIT_FILE):
        return {}
    try:
        with open(RESUME_AUDIT_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_resume_audit_report(candidate_name: str, report: dict):
    reports = load_resume_audit_reports()
    reports[candidate_name.strip()] = report
    with open(RESUME_AUDIT_FILE, "w") as f:
        json.dump(reports, f, indent=2)


def get_resume_audit_report(candidate_name: str) -> dict:
    return load_resume_audit_reports().get(candidate_name.strip(), {})


def delete_resume_audit_report(candidate_name: str):
    reports = load_resume_audit_reports()
    key = candidate_name.strip()
    if key in reports:
        del reports[key]
        with open(RESUME_AUDIT_FILE, "w") as f:
            json.dump(reports, f, indent=2)


def transform_resume_to_mphasis(candidate_name: str):
    source_path = find_original_resume_path(candidate_name)
    if not source_path:
        return

    started_at = datetime.now()
    source_extension = os.path.splitext(source_path)[1].lower() or ".docx"
    versioned_original_path = get_original_resume_path(candidate_name, source_extension)
    legacy_path = get_legacy_resume_path(candidate_name, source_extension)
    final_docx_path = get_transformed_resume_path(candidate_name)
    transformed_temp_path = None
    method = "docx_preserve"
    pipeline = None
    sanitization_log = set()

    try:
        print("Resume sanitization started")
        if os.path.abspath(source_path) != os.path.abspath(versioned_original_path):
            shutil.copyfile(source_path, versioned_original_path)
            source_path = versioned_original_path

        fd, transformed_temp_path = tempfile.mkstemp(suffix=".docx")
        os.close(fd)
        if source_extension == ".docx":
            sanitization_log = transform_docx_resume(source_path, transformed_temp_path, candidate_name) or set()
        else:
            resume_text = extract_resume_text(source_path)
            sanitized_resume = sanitize_resume_content(resume_text, candidate_name)
            inside_education_section = False
            for raw_line in resume_text.splitlines():
                line = str(raw_line or "").strip()
                if not line:
                    continue
                if _contains_education_text(line):
                    inside_education_section = True
                sanitization_log.update(
                    detect_sanitization_log_actions(
                        line,
                        in_education_section=inside_education_section,
                    )
                )
                if inside_education_section and _looks_like_company_or_title_line(line):
                    inside_education_section = False
            method = "sanitized_pdf"
            format_sanitized_resume_docx(
                sanitized_resume["name"],
                sanitized_resume["body_blocks"],
                transformed_temp_path,
                sanitization_log=sanitization_log,
            )
        if os.path.exists(final_docx_path):
            os.remove(final_docx_path)
        shutil.move(transformed_temp_path, final_docx_path)

        if legacy_path and os.path.exists(legacy_path):
            legacy_abs = os.path.abspath(legacy_path)
            original_abs = os.path.abspath(versioned_original_path)
            final_abs = os.path.abspath(final_docx_path)
            if legacy_abs not in {original_abs, final_abs}:
                try:
                    os.remove(legacy_path)
                except OSError:
                    pass

        set_resume_formatting_status(candidate_name, FORMATTING_VALIDATING)
        validation_report = validate_transformed_resume(
            candidate_name,
            source_path,
            final_docx_path,
            method,
            pipeline=pipeline,
        )
        completed_at = datetime.now()
        save_resume_audit_report(candidate_name, {
            "candidate": candidate_name,
            "original_file": os.path.basename(source_path),
            "transformed_file": os.path.basename(final_docx_path),
            "method": method,
            "removed_categories": sorted(sanitization_log),
            "preserved_categories": [
                "professional_summary",
                "technical_skills",
                "professional_experience",
                "company_names",
                "job_titles",
                "employment_dates",
                "projects_and_work_highlights",
            ],
            "validation_confidence": validation_report.get("confidence", ""),
            "validation_score": validation_report.get("score", None),
            "validation_issues": validation_report.get("issues", []),
            "critical_passed": validation_report.get("critical_passed", False),
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "processing_seconds": round((completed_at - started_at).total_seconds(), 2),
        })
        print(
            "Resume validation completed: "
            f"{validation_report['confidence']} ({validation_report['score']}%)"
        )
        print("Resume sanitization completed")
        return True
    except Exception as e:
        print(f"Resume transformation error: {e}")
        completed_at = datetime.now()
        save_resume_audit_report(candidate_name, {
            "candidate": candidate_name,
            "original_file": os.path.basename(source_path) if source_path else "",
            "transformed_file": "",
            "method": method,
            "removed_categories": sorted(sanitization_log),
            "validation_confidence": "",
            "validation_score": None,
            "validation_issues": [str(e)],
            "critical_passed": False,
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "processing_seconds": round((completed_at - started_at).total_seconds(), 2),
        })
        return False
    finally:
        if transformed_temp_path and os.path.exists(transformed_temp_path):
            try:
                os.remove(transformed_temp_path)
            except OSError:
                pass


def _canonical_resume_fragment(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _build_pipeline_search_text(final_output: dict) -> str:
    pieces = [final_output.get("name", ""), final_output.get("summary", "")]
    for entry in final_output.get("experience", []) or []:
        if not isinstance(entry, dict):
            continue
        pieces.extend(
            [
                entry.get("company", ""),
                entry.get("role", ""),
                entry.get("duration", ""),
                entry.get("location", ""),
            ]
        )
        pieces.extend(entry.get("bullets", []) or [])
    pieces.extend(final_output.get("skills", []) or [])
    return " ".join(_canonical_resume_fragment(piece) for piece in pieces if _canonical_resume_fragment(piece))


def _line_is_preserved_in_pipeline(line: str, pipeline_text: str, block_type: str = "paragraph") -> bool:
    canonical_line = _canonical_resume_fragment(line)
    if not canonical_line:
        return True
    if canonical_line in pipeline_text:
        return True

    tokens = [token for token in canonical_line.split() if len(token) > 2]
    if not tokens:
        return canonical_line in pipeline_text

    if block_type == "title" or len(tokens) <= 8:
        return False

    matched = sum(1 for token in tokens if token in pipeline_text)
    return matched / len(tokens) >= 0.8


def _pipeline_preservation_details(final_output: dict, sanitized_resume: dict) -> dict:
    pipeline_text = _build_pipeline_search_text(final_output)
    if not pipeline_text:
        return {
            "preserved": False,
            "preserved_lines": 0,
            "total_lines": 0,
            "missing_lines": ["Pipeline output did not contain searchable content."],
            "score": 0,
        }

    blocks = sanitized_resume.get("body_blocks", []) if isinstance(sanitized_resume, dict) else []
    content_blocks = [
        block
        for block in blocks
        if isinstance(block, dict)
        and str(block.get("text", "")).strip()
        and block.get("type") != "heading"
    ]
    if not content_blocks:
        return {
            "preserved": True,
            "preserved_lines": 0,
            "total_lines": 0,
            "missing_lines": [],
            "score": 100,
        }

    missing_lines = []
    for block in content_blocks:
        line = str(block.get("text", "")).strip()
        block_type = str(block.get("type", "paragraph"))
        if not _line_is_preserved_in_pipeline(line, pipeline_text, block_type):
            missing_lines.append(line)

    title_missing = any(
        str(block.get("type", "")) == "title" and str(block.get("text", "")).strip() in missing_lines
        for block in content_blocks
    )
    allowed_missing = max(1, len(content_blocks) // 8)
    preserved_lines = len(content_blocks) - len(missing_lines)
    score = round((preserved_lines / max(len(content_blocks), 1)) * 100)
    return {
        "preserved": not title_missing and len(missing_lines) <= allowed_missing,
        "preserved_lines": preserved_lines,
        "total_lines": len(content_blocks),
        "missing_lines": missing_lines[:8],
        "score": score,
    }


def _should_use_pipeline_output(final_output: dict, sanitized_resume: dict) -> bool:
    return _pipeline_preservation_details(final_output, sanitized_resume)["preserved"]


def _contains_contact_info_text(text: str) -> bool:
    patterns = [
        r"\b[\w\.-]+@[\w\.-]+\.\w+\b",
        r"(?:https?://\S+|www\.\S+)",
        r"\b(?:linkedin|github|portfolio|behance)\b",
        r"(?:\+?\d[\d\-\s\(\)]{7,}\d)",
    ]
    return any(re.search(pattern, text or "", flags=re.IGNORECASE) for pattern in patterns)


def _contains_education_text(text: str) -> bool:
    lowered = (text or "").lower()
    compact = re.sub(r"\s+", " ", lowered).strip(" :-")
    if not compact:
        return False
    if compact in {"education", "educational details", "education details", "academic qualifications", "academics"}:
        return True
    degree_patterns = (
        r"\bbachelor(?:'s)?\b",
        r"\bmaster(?:'s)?\s+(?:of|degree|science|arts|business|computer|information)\b",
        r"\bdegree\b",
        r"\bdiploma\b",
        r"\bgpa\b",
        r"\bcgpa\b",
        r"\bb\.?\s*tech\b",
        r"\bm\.?\s*tech\b",
        r"\bmba\b",
        r"\bmca\b",
        r"\bphd\b",
    )
    if any(re.search(pattern, compact) for pattern in degree_patterns):
        return True
    school_terms = ("university", "college", "institute")
    return any(term in compact for term in school_terms) and any(
        hint in compact
        for hint in ("bachelor", "master", "degree", "education", "academic", "gpa", "cgpa")
    )


def _extract_resume_dates(text: str) -> list[str]:
    patterns = [
        r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b",
        r"\b\d{1,2}[/-]\d{4}\b",
        r"\b(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:present|current|now|(?:19|20)\d{2})\b",
        r"\b(?:19|20)\d{2}\b",
    ]
    values = []
    for pattern in patterns:
        values.extend(re.findall(pattern, text or "", flags=re.IGNORECASE))
    cleaned = []
    seen = set()
    for value in values:
        normalized = re.sub(r"\s+", " ", str(value)).strip()
        key = normalized.lower()
        if normalized and key not in seen:
            seen.add(key)
            cleaned.append(normalized)
    return cleaned


def _line_has_date(text: str) -> bool:
    return bool(_extract_resume_dates(text))


def _looks_like_company_or_title_line(text: str) -> bool:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    if not cleaned or len(cleaned) > 140:
        return False
    lowered = cleaned.lower()
    if _contains_contact_info_text(cleaned) or _contains_education_text(cleaned):
        return False
    company_terms = (
        "inc",
        "llc",
        "ltd",
        "limited",
        "corp",
        "corporation",
        "company",
        "technologies",
        "technology",
        "systems",
        "solutions",
        "consulting",
        "services",
        "software",
        "group",
        "bank",
        "insurance",
        "health",
        "labs",
        "mphasis",
    )
    title_terms = (
        "developer",
        "engineer",
        "architect",
        "consultant",
        "analyst",
        "manager",
        "lead",
        "administrator",
        "specialist",
        "designer",
        "scientist",
    )
    if any(term in lowered for term in company_terms + title_terms):
        return True
    if _line_has_date(cleaned) and len(cleaned.split()) <= 14:
        return True
    if "|" in cleaned and len(cleaned.split()) <= 16:
        return True
    words = [word for word in cleaned.replace("|", " ").split() if word]
    if 2 <= len(words) <= 8:
        title_case = sum(1 for word in words if word[:1].isupper() or word.isupper())
        return title_case / len(words) >= 0.75
    return False


def _extract_critical_experience_lines(source_text: str, sanitized_resume: dict) -> list[str]:
    critical = []
    seen = set()
    for block in sanitized_resume.get("body_blocks", []) if isinstance(sanitized_resume, dict) else []:
        if not isinstance(block, dict):
            continue
        text = str(block.get("text", "")).strip()
        if not text:
            continue
        if _contains_contact_info_text(text) or _contains_education_text(text):
            continue
        if block.get("type") == "title" or _looks_like_company_or_title_line(text):
            key = _canonical_resume_fragment(text)
            if key and key not in seen:
                seen.add(key)
                critical.append(text)
            for date_value in _extract_resume_dates(text):
                date_key = _canonical_resume_fragment(date_value)
                if date_key and date_key not in seen:
                    seen.add(date_key)
                    critical.append(date_value)
    return critical


def _critical_line_preserved(line: str, transformed_search: str) -> bool:
    canonical_line = _canonical_resume_fragment(line)
    if not canonical_line:
        return True
    if canonical_line in transformed_search:
        return True
    if _line_has_date(line):
        return all(
            _canonical_resume_fragment(date_value) in transformed_search
            for date_value in _extract_resume_dates(line)
            if _canonical_resume_fragment(date_value)
        )
    tokens = [token for token in canonical_line.split() if len(token) > 2]
    if not tokens:
        return True
    matched = sum(1 for token in tokens if token in transformed_search)
    return matched / len(tokens) >= 0.9


def _strip_sanitization_log_text(text: str) -> str:
    return re.split(r"\bMphasis Sanitization Log\b", text or "", maxsplit=1, flags=re.IGNORECASE)[0]


def validate_transformed_resume(
    candidate_name: str,
    source_path: str,
    transformed_path: str,
    method: str,
    pipeline: dict | None = None,
) -> dict:
    issues = []
    source_text = extract_resume_text(source_path)
    transformed_text = extract_resume_text(transformed_path)
    transformed_content_text = _strip_sanitization_log_text(transformed_text)
    sanitized_resume = sanitize_resume_content(source_text, candidate_name)

    transformed_search = _canonical_resume_fragment(transformed_content_text)
    content_blocks = [
        block for block in sanitized_resume.get("body_blocks", [])
        if isinstance(block, dict)
        and str(block.get("text", "")).strip()
        and block.get("type") != "heading"
    ]

    missing_lines = []
    for block in content_blocks:
        line = str(block.get("text", "")).strip()
        block_type = str(block.get("type", "paragraph"))
        if not _line_is_preserved_in_pipeline(line, transformed_search, block_type):
            missing_lines.append(line)

    critical_lines = _extract_critical_experience_lines(source_text, sanitized_resume)
    critical_missing_lines = [
        line for line in critical_lines
        if not _critical_line_preserved(line, transformed_search)
    ]

    preserved_lines = len(content_blocks) - len(missing_lines)
    preservation_score = round((preserved_lines / max(len(content_blocks), 1)) * 100) if content_blocks else 100
    title_missing = any(
        str(block.get("type", "")) == "title" and str(block.get("text", "")).strip() in missing_lines
        for block in content_blocks
    )

    if missing_lines:
        issues.append(f"{len(missing_lines)} sanitized source line(s) were not verified in the transformed resume.")
    if critical_missing_lines:
        issues.append(
            f"Critical company/title/date content missing: {', '.join(critical_missing_lines[:3])}"
        )
    if title_missing:
        issues.append("A title or role line may be missing from the transformed resume.")
    if _contains_contact_info_text(transformed_content_text):
        issues.append("Contact or link information may still be present.")
    if _contains_education_text(transformed_content_text):
        issues.append("Education content may still be present.")

    if pipeline:
        pipeline_issues = pipeline.get("step_5_validation", {}).get("issues", []) or []
        issues.extend(str(issue) for issue in pipeline_issues if str(issue).strip())

    unique_issues = list(dict.fromkeys(issues))
    if critical_missing_lines:
        confidence = "Needs review"
    elif preservation_score >= 92 and not unique_issues:
        confidence = "High"
    elif preservation_score >= 82 and not title_missing:
        confidence = "Medium"
    else:
        confidence = "Needs review"

    report = {
        "candidate": candidate_name,
        "confidence": confidence,
        "score": preservation_score,
        "method": method,
        "preserved_lines": preserved_lines,
        "total_lines": len(content_blocks),
        "missing_lines": missing_lines[:8],
        "critical_lines": critical_lines[:20],
        "critical_missing_lines": critical_missing_lines[:10],
        "critical_passed": not critical_missing_lines,
        "issues": unique_issues[:10],
        "validated_at": datetime.now().isoformat(),
    }
    save_resume_validation_report(candidate_name, report)
    return report


_SENIORITY_KEYWORDS = [
    ("principal", "Principal"),
    ("staff", "Staff"),
    ("senior", "Senior"),
    (r"sr\.", "Senior"),
    ("sr", "Senior"),
    ("lead", "Lead"),
    ("associate", "Associate"),
    ("junior", "Junior"),
    (r"jr\.", "Junior"),
    ("jr", "Junior"),
]


def _build_mphasis_download_filename(candidate_name: str) -> str:
    """Return Name_Role_Seniority_Location.docx from the candidate's DB row."""

    def _slug(text: str) -> str:
        text = re.sub(r"[^\w\s]", "", text).strip()
        return "".join(w.capitalize() for w in text.split())

    role = ""
    location = ""
    try:
        df = read_sheet(CANDIDATES_SHEET)
        mask = df["Candidate Name"].astype(str).str.strip().str.lower() == candidate_name.strip().lower()
        if mask.any():
            row = df[mask].iloc[0]
            role     = str(row.get("Role", "")).strip()
            location = str(row.get("Location", "")).strip()
            if location.lower() in ("", "nan"):
                location = ""
    except Exception:
        pass

    seniority = ""
    clean_role = role
    for kw_pattern, label in _SENIORITY_KEYWORDS:
        m = re.search(rf"(?i)\b{kw_pattern}\b\.?\s*", clean_role)
        if m:
            seniority = label
            clean_role = (clean_role[: m.start()] + clean_role[m.end():]).strip()
            break

    first_name = candidate_name.strip().split()[0] if candidate_name.strip() else "Resume"
    parts = [first_name]
    if clean_role:
        parts.append(_slug(clean_role))
    if seniority:
        parts.append(seniority)
    if location:
        parts.append(_slug(location))
    return "_".join(parts) + ".docx"


def get_resume_versions(candidate_name: str):
    original_path = find_original_resume_path(candidate_name)
    transformed_path = find_transformed_resume_path(candidate_name)
    formatting_status = get_resume_formatting_status(candidate_name)
    validation_report = get_resume_validation_report(candidate_name)
    audit_report = get_resume_audit_report(candidate_name)

    return {
        "candidate": candidate_name,
        "original_filename": os.path.basename(original_path) if original_path else "",
        "original_url": build_resume_url(os.path.basename(original_path)) if original_path else "",
        "transformed_filename": os.path.basename(transformed_path) if transformed_path else "",
        "transformed_url": f"http://127.0.0.1:8000/download-resume/{os.path.basename(transformed_path)}" if transformed_path else "",
        "mphasis_download_filename": _build_mphasis_download_filename(candidate_name) if transformed_path else "",
        "analysis_filename": (
            os.path.basename(transformed_path)
            if transformed_path
            else (os.path.basename(original_path) if original_path else "")
        ),
        "url": (
            build_resume_url(os.path.basename(transformed_path))
            if transformed_path
            else (build_resume_url(os.path.basename(original_path)) if original_path else "")
        ),
        "formatting_status": formatting_status,
        "formatting_error": get_resume_formatting_error(candidate_name) if formatting_status == FORMATTING_FAILED else "",
        "validation": validation_report,
        "validation_confidence": validation_report.get("confidence", ""),
        "validation_score": validation_report.get("score", None),
        "audit": audit_report,
    }


def set_resume_formatting_status(candidate_name: str, status: str, error: str = ""):
    with resume_formatting_lock:
        resume_formatting_status[candidate_name.strip()] = {
            "status": status,
            "error": error,
            "updated_at": datetime.now().isoformat(),
        }


def get_resume_formatting_status(candidate_name: str):
    transformed_path = find_transformed_resume_path(candidate_name)
    if transformed_path:
        validation_report = get_resume_validation_report(candidate_name)
        if validation_report.get("confidence") == "Needs review" or validation_report.get("issues"):
            return FORMATTING_NEEDS_REVIEW
        return FORMATTING_COMPLETED

    with resume_formatting_lock:
        entry = resume_formatting_status.get(candidate_name.strip())

    if entry:
        status = entry.get("status", FORMATTING_PENDING)
        if status == "completed":
            return FORMATTING_COMPLETED
        return status

    if find_original_resume_path(candidate_name):
        return FORMATTING_FAILED

    return ""


def get_resume_formatting_error(candidate_name: str):
    with resume_formatting_lock:
        entry = resume_formatting_status.get(candidate_name.strip(), {})
    if entry:
        return entry.get("error", "")
    if find_original_resume_path(candidate_name) and not find_transformed_resume_path(candidate_name):
        return "Mphasis resume has not been generated. Retry sanitization."
    return ""


def run_resume_transformation(candidate_name: str):
    set_resume_formatting_status(candidate_name, FORMATTING_RUNNING)
    succeeded = transform_resume_to_mphasis(candidate_name)
    if succeeded and find_transformed_resume_path(candidate_name):
        validation_report = get_resume_validation_report(candidate_name)
        status = FORMATTING_NEEDS_REVIEW if validation_report.get("confidence") == "Needs review" or validation_report.get("issues") else FORMATTING_COMPLETED
        set_resume_formatting_status(candidate_name, status)
        return True

    validation_report = get_resume_validation_report(candidate_name)
    validation_issues = validation_report.get("issues", []) if validation_report else []
    error_message = (
        validation_issues[0]
        if validation_issues
        else "Resume sanitization failed. Please retry the upload."
    )
    set_resume_formatting_status(
        candidate_name,
        FORMATTING_FAILED,
        error_message,
    )
    return False


def start_resume_transformation_job(candidate_name: str, role: str = ""):
    set_resume_formatting_status(candidate_name, FORMATTING_PENDING)
    target = run_resume_transformation_and_intelligence if role.strip() else run_resume_transformation
    args = (candidate_name, role.strip()) if role.strip() else (candidate_name,)
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    return thread


def run_resume_transformation_and_intelligence(candidate_name: str, role: str = ""):
    run_resume_transformation(candidate_name)

    if not role.strip():
        return

    transformed_path = find_transformed_resume_path(candidate_name)
    original_path = find_original_resume_path(candidate_name)
    analysis_path = transformed_path or original_path
    if not analysis_path:
        return

    _score_and_summarise_background(os.path.basename(analysis_path), role.strip())


def _resume_candidate_from_filename(filename: str) -> str:
    return candidate_name_from_resume_file(filename)


def _resolve_resume_file(filename: str) -> tuple[str, str]:
    direct_path = os.path.join(RESUME_FOLDER, filename)
    if os.path.exists(direct_path):
        return direct_path, filename

    candidate_name = _resume_candidate_from_filename(filename)
    transformed_path = find_transformed_resume_path(candidate_name)
    if transformed_path:
        return transformed_path, os.path.basename(transformed_path)

    original_path = find_original_resume_path(candidate_name)
    if original_path:
        return original_path, os.path.basename(original_path)

    return direct_path, filename


# -------------------------------------------------
# Root
# -------------------------------------------------

@app.get("/")
def root():
    return {"message": "ATS Enterprise Mode Running 🚀"}


# -------------------------------------------------
# Stage History Endpoints
# -------------------------------------------------

@app.post("/log-stage")
def log_stage(payload: StageLogRequest):
    try:
        log_stage_entry(payload.candidate_name, payload.stage, payload.date)
        return {"message": f"Stage '{payload.stage}' logged for '{payload.candidate_name}' ✅"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/get-stage-history")
def get_stage_history(candidate_name: str):
    entries = get_history_for_candidate(candidate_name)
    return {"candidate_name": candidate_name.strip(), "history": entries}


@app.get("/all-stage-history")
def get_all_stage_history():
    return get_all_history()


@app.delete("/delete-last-stage")
def delete_last_stage(candidate_name: str, stage: str):
    delete_last_stage_entry(candidate_name, stage)
    return {"message": f"Stage '{stage}' removed from '{candidate_name}' history ✅"}


# -------------------------------------------------
# ADD POSITION
# -------------------------------------------------

@app.post("/positions")
def add_position(position: PositionCreate):
    account = position.account_name or _current_account.get()
    with single_account_scope(account):
        dashboard_df  = read_sheet(DASHBOARD_SHEET, explicit_account=account)
        # Guard against duplicate Position Code
        pc = str(position.position_code or "").strip()
        if pc and "Position Code" in dashboard_df.columns:
            exists_mask = dashboard_df["Position Code"].astype(str).str.strip() == pc
            if exists_mask.any():
                raise HTTPException(status_code=409, detail=f"Position Code '{pc}' already exists.")
        dashboard_row = {
            "WIPPX": position.wippx, "Position Code": position.position_code,
            "Category": position.category, "POD Name": position.pod_name,
            "Manager": position.manager, "Replacement/ New": position.replacement_new,
            "Role": position.role, "Location": position.location,
            "# Positions": position.positions, "# Positions Fulfilled": 0,
            "# Positions Net Open": position.positions, "# Profiles Submitted": 0,
            "# Profiles Rejected": 0, "# Profiles Pending feedback": 0,
            "# Profiles Scheduled": 0, "# Profiles Pending with Client": 0,
            "Gap": position.positions, "Days Open": 0,
            "Aging Bucket": "Fresh", "Weighted Gap": float(position.positions),
            "lob_name": position.lob_name or "",
        }
        dashboard_df = pd.concat([dashboard_df, pd.DataFrame([dashboard_row])], ignore_index=True)
        if "Position Code" in dashboard_df.columns:
            dashboard_df = dashboard_df.drop_duplicates(subset=["Position Code"], keep="last")
        write_sheet(dashboard_df, DASHBOARD_SHEET)
        new_req_df          = read_sheet(CANDIDATES_SHEET, explicit_account=account)
        new_requirement_row = {col: "" for col in new_req_df.columns}
        new_requirement_row.update({
            "WIPPX": position.wippx, "Position Code": position.position_code,
            "Category": position.category, "Proposed POD Name": position.pod_name,
            "Manager": position.manager, "New/Replacement": position.replacement_new,
            "Role": position.role, "Location": position.location,
            "# of Position": position.positions,
            "lob_name": position.lob_name or "",
        })
        new_req_df = pd.concat([new_req_df, pd.DataFrame([new_requirement_row])], ignore_index=True)
        write_sheet(new_req_df, CANDIDATES_SHEET)
        if position.skills or position.job_description:
            store_position_skills(
                position.position_code, position.role,
                position.skills, position.job_description
            )
        return {"message": "Position added successfully ✅"}


@app.get("/positions")
def get_positions(account_name: Optional[str] = None):
    if account_name:
        token = _current_account.set(account_name)
        try:
            df = read_sheet(DASHBOARD_SHEET)
        finally:
            _current_account.reset(token)
    else:
        df = read_sheet(DASHBOARD_SHEET)
    records = df.fillna("").to_dict(orient="records")
    # Attach _account_name so the frontend can route writes to the right account
    try:
        with engine.connect() as conn:
            rows = conn.execute(text('SELECT "Position Code", account_name FROM dashboard')).fetchall()
            acc_map = {str(pc).strip(): acc for pc, acc in rows if pc and str(pc).strip() != "nan"}
        for rec in records:
            pc = str(rec.get("Position Code", "")).strip()
            rec["_account_name"] = acc_map.get(pc, "")
    except Exception:
        pass
    return records


# -------------------------------------------------
# Dashboard Summary
# -------------------------------------------------

@app.get("/dashboard")
def get_dashboard():
    df            = read_sheet(DASHBOARD_SHEET)
    candidates_df = read_sheet(CANDIDATES_SHEET)
    numeric_columns = [
        "# Positions", "# Positions Fulfilled", "# Positions Net Open",
        "# Profiles Submitted", "# Profiles Rejected",
        "# Profiles Pending feedback", "# Profiles Scheduled",
        "# Profiles Pending with Client", "Gap"
    ]
    df         = ensure_numeric(df, numeric_columns)
    for col in numeric_columns:
        if col not in df.columns:
            df[col] = 0
    roles_data = []
    if "Role" in df.columns:
        for role_name in df["Role"].dropna().astype(str).str.strip().unique():
            if role_name and role_name.lower() != "nan":
                days         = get_days_open_for_role(role_name, candidates_df)
                bucket, mult = get_aging_bucket(days)
                role_gap     = float(df[df["Role"].astype(str).str.strip() == role_name]["Gap"].sum()) if "Gap" in df.columns else 0
                roles_data.append({
                    "role":         role_name,
                    "days_open":    days,
                    "bucket":       bucket,
                    "weighted_gap": round(role_gap * mult, 1),
                })
    critical_roles = [r for r in roles_data if r["bucket"] == "Critical"]
    stale_roles    = [r for r in roles_data if r["bucket"] == "Stale"]
    return {
        "total_positions":           int(df["# Positions"].sum()),
        "total_fulfilled":           int(df["# Positions Fulfilled"].sum()),
        "total_open":                int(df["# Positions Net Open"].sum()),
        "profiles_submitted":        int(df["# Profiles Submitted"].sum()),
        "profiles_rejected":         int(df["# Profiles Rejected"].sum()),
        "profiles_pending_feedback": int(df["# Profiles Pending feedback"].sum()),
        "profiles_scheduled":        int(df["# Profiles Scheduled"].sum()),
        "profiles_pending_client":   int(df["# Profiles Pending with Client"].sum()),
        "total_gap":                 int(df["Gap"].sum()) if "Gap" in df.columns else 0,
        "critical_roles_count":      len(critical_roles),
        "stale_roles_count":         len(stale_roles),
        "aging_breakdown":           roles_data,
    }


# -------------------------------------------------
# Role Summary
# -------------------------------------------------

@app.get("/role-summary")
def role_summary():
    df         = read_sheet(DASHBOARD_SHEET)
    new_req_df = read_sheet(CANDIDATES_SHEET)
    new_req_roles = []
    if "Role" in new_req_df.columns:
        new_req_roles = (
            new_req_df["Role"].dropna().astype(str).str.strip()
            .replace("", float("nan")).dropna().unique().tolist()
        )
    if not new_req_roles:
        return []
    position_counts = {}
    if "Role" in df.columns:
        df = ensure_numeric(df, ["# Positions"])
        for _, r in df.iterrows():
            role_key = str(r["Role"]).strip()
            position_counts[role_key] = position_counts.get(role_key, 0) + r.get("# Positions", 0)
    return [
        {"Role": role, "# Positions": int(position_counts.get(role, 0))}
        for role in new_req_roles
        if role and role.lower() != "nan"
    ]


# -------------------------------------------------
# Positions by Role
# -------------------------------------------------

@app.get("/positions-by-role")
def get_positions_by_role(role: str):
    df = read_sheet(DASHBOARD_SHEET)
    if df.empty or "Role" not in df.columns:
        return {}
    df["Role"]  = df["Role"].astype(str).str.strip().str.lower()
    role_clean  = role.strip().lower()
    filtered    = df[df["Role"].str.contains(role_clean, na=False, regex=False)]
    if filtered.empty:
        return {}
    numeric_cols = [
        "# Positions", "# Positions Fulfilled", "# Positions Net Open",
        "# Profiles Submitted", "# Profiles Rejected",
        "# Profiles Pending feedback", "# Profiles Scheduled",
        "# Profiles Pending with Client", "Gap"
    ]
    filtered     = ensure_numeric(filtered, numeric_cols)
    gap_val      = int(filtered["Gap"].sum()) if "Gap" in filtered.columns else 0
    days_open    = get_days_open_for_role(role)
    bucket_label, multiplier = get_aging_bucket(days_open)
    weighted_gap = round(gap_val * multiplier, 1)
    return {
        "role": role, "total_positions": int(filtered["# Positions"].sum()),
        "fulfilled": int(filtered["# Positions Fulfilled"].sum()),
        "net_open": int(filtered["# Positions Net Open"].sum()),
        "submitted": int(filtered["# Profiles Submitted"].sum()),
        "rejected": int(filtered["# Profiles Rejected"].sum()),
        "pending_feedback": int(filtered["# Profiles Pending feedback"].sum()),
        "scheduled": int(filtered["# Profiles Scheduled"].sum()),
        "pending_client": int(filtered["# Profiles Pending with Client"].sum()),
        "gap": gap_val, "days_open": days_open,
        "aging_bucket": bucket_label, "aging_multiplier": multiplier,
        "weighted_gap": weighted_gap, "on_hold": 0,
        "profile_aging": f"{days_open}d", "profile_aging_bucket": bucket_label,
    }


# -------------------------------------------------
# Submit Candidate
# -------------------------------------------------

@app.post("/submit-candidate")
def submit_candidate(payload: dict = Body(...)):
    account = payload.get("account_name") or _current_account.get()
    # When Admin context is the only option, find the actual account that owns this requirement
    if not account or account == "Admin":
        role          = payload.get("role", "").strip()
        position_code = payload.get("positionCode", "").strip()
        try:
            with engine.connect() as conn:
                row = None
                if position_code:
                    row = conn.execute(text(
                        'SELECT account_name FROM requirements WHERE "Position Code" = :pc AND account_name != \'Admin\' LIMIT 1'
                    ), {"pc": position_code}).fetchone()
                if not row:
                    row = conn.execute(text(
                        """SELECT account_name FROM requirements
                           WHERE "Role" = :r
                           AND ("Candidate Name" IS NULL OR trim("Candidate Name") = '' OR lower(trim("Candidate Name")) = 'nan')
                           AND account_name != 'Admin' LIMIT 1"""
                    ), {"r": role}).fetchone()
                if row:
                    account = row[0]
        except Exception as ex:
            print(f"⚠️  Account lookup error in submit_candidate: {ex}")
    with single_account_scope(account):
        try:
            df                = read_sheet(CANDIDATES_SHEET)
            role              = payload.get("role", "").strip()
            position_code     = payload.get("positionCode", "").strip()
            candidate_name    = payload.get("candidateName", "").strip()
            profile_shared_on = payload.get("profileSharedOn", "")
            assessed_by       = payload.get("assessedBy", "")
            assessment_date   = payload.get("assessmentDate", "")
            status            = payload.get("status", "")
            if not role or not candidate_name:
                raise HTTPException(status_code=400, detail="Role and Candidate Name required")
            if df.empty:
                raise HTTPException(status_code=404, detail=f"No open requirement found for role '{role}'. Please add a position first.")
            # "Candidate Name" column only exists after the first submission; absent means all rows are open requirements
            if "Candidate Name" not in df.columns:
                is_requirement_row = pd.Series([True] * len(df), index=df.index)
            else:
                is_requirement_row = (
                    df["Candidate Name"].isna() |
                    (df["Candidate Name"].astype(str).str.strip() == "") |
                    (df["Candidate Name"].astype(str).str.strip().str.lower() == "nan")
                )
            if position_code and "Position Code" in df.columns:
                req_mask = (df["Position Code"].astype(str).str.strip() == position_code) & is_requirement_row
            else:
                req_mask = (df["Role"].astype(str).str.strip().str.lower() == role.lower()) & is_requirement_row
            if not req_mask.any():
                fallback_mask = df["Role"].astype(str).str.strip().str.lower() == role.lower()
                if fallback_mask.any():
                    req_mask = fallback_mask & is_requirement_row
            if not req_mask.any():
                raise HTTPException(status_code=404, detail=f"No open requirement found for role '{role}'.")
            req_row = df[req_mask].iloc[0]
            new_row = {col: "" for col in df.columns}
            for col in df.columns:
                new_row[col] = req_row[col]
            new_row["Candidate Name"]                = candidate_name
            new_row["Profile Shared on"]             = profile_shared_on
            new_row["Assessed By"]                   = assessed_by
            new_row["Assessment on/To be scheduled"] = assessment_date
            new_row["Status"]                        = status
            df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
            write_sheet(df, CANDIDATES_SHEET)
            stage_date = payload.get("stageDate", "")
            if status and stage_date:
                log_stage_entry(candidate_name, status, stage_date)
            elif status and profile_shared_on:
                log_stage_entry(candidate_name, status, profile_shared_on)
            update_dashboard_counters(role, old_status=None, new_status=status)
            return {"message": "Candidate submitted successfully ✅"}
        except HTTPException:
            raise
        except Exception as e:
            print("🔥 SUBMIT ERROR:", str(e))
            raise HTTPException(status_code=500, detail=str(e))


# -------------------------------------------------
# Get Candidates
# -------------------------------------------------

@app.get("/candidates")
def get_candidates(status: str = Query(None)):
    df = read_sheet(CANDIDATES_SHEET)
    if status and "Status" in df.columns:
        df = df[df["Status"].astype(str).str.lower() == status.lower()]
    records = df.fillna("").to_dict(orient="records")
    # Attach account_name via raw SQL (read_sheet strips it)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text('SELECT "Candidate Name", "WIPPX", account_name FROM requirements WHERE "Candidate Name" IS NOT NULL AND "Candidate Name" != \'\'')
            ).fetchall()
        acct_map = {(str(r[0]).strip().lower(), str(r[1]).strip().lower()): str(r[2]) for r in rows}
        for rec in records:
            key = (str(rec.get("Candidate Name","")).strip().lower(), str(rec.get("WIPPX","")).strip().lower())
            rec["account_name"] = acct_map.get(key, "")
    except Exception:
        pass
    return records


@app.get("/new-requirements")
def get_new_requirements():
    df = read_sheet(CANDIDATES_SHEET)
    return df.fillna("").to_dict(orient="records")


@app.get("/view-candidates")
def view_candidates():
    df            = read_sheet(CANDIDATES_SHEET)
    candidates_df = df[df["Candidate Name"].notna() & (df["Candidate Name"] != "")]
    records = candidates_df.fillna("").to_dict(orient="records")
    # Attach account_name via raw SQL (read_sheet strips it)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text('SELECT "Candidate Name", "WIPPX", account_name FROM requirements WHERE "Candidate Name" IS NOT NULL AND "Candidate Name" != \'\'')
            ).fetchall()
        acct_map = {(str(r[0]).strip().lower(), str(r[1]).strip().lower()): str(r[2]) for r in rows}
        for rec in records:
            key = (str(rec.get("Candidate Name","")).strip().lower(), str(rec.get("WIPPX","")).strip().lower())
            rec["account_name"] = acct_map.get(key, "")
    except Exception:
        pass
    return records


# -------------------------------------------------
# Update Candidate Status
# -------------------------------------------------

@app.put("/update-candidate-status")
def update_candidate_status(wippx: str, candidate_name: str, status: str, stage_date: str = "", interviewer: str = ""):
    account = _current_account.get()
    if not account or account == "Admin":
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    text('SELECT account_name FROM requirements WHERE LOWER("Candidate Name") = LOWER(:cn) AND account_name != \'Admin\' LIMIT 1'),
                    {"cn": candidate_name.strip()},
                ).fetchone()
                if row:
                    account = row[0]
        except Exception:
            pass
    df = read_sheet(CANDIDATES_SHEET, explicit_account=account)
    mask = (
        df["WIPPX"].astype(str).str.strip() == wippx.strip()
    ) & (
        df["Candidate Name"].astype(str).str.strip() == candidate_name.strip()
    )
    if not mask.any():
        return {"error": "Candidate not found"}
    old_status  = str(df.loc[mask, "Status"].iloc[0]).strip()
    role        = str(df.loc[mask, "Role"].iloc[0]).strip() if "Role" in df.columns else ""
    df.loc[mask, "Status"] = status
    date_to_log = stage_date if stage_date else datetime.now().strftime("%Y-%m-%d")
    tok = _current_account.set(account)
    try:
        write_sheet(df, CANDIDATES_SHEET)
        log_stage_entry(candidate_name.strip(), status, date_to_log, interviewer)
        update_dashboard_counters(role, old_status=old_status, new_status=status)
    finally:
        _current_account.reset(tok)
    return {"message": f"Stage updated to '{status}' ✅"}


# -------------------------------------------------
# Update Full Candidate Row
# -------------------------------------------------

@app.put("/update-candidate")
def update_candidate(payload: dict = Body(...)):
    with single_account_scope():
        df             = read_sheet(CANDIDATES_SHEET)
        candidate_name = payload.get("Candidate Name")
        mask           = df["Candidate Name"].astype(str).str.strip() == str(candidate_name).strip()
        if not mask.any():
            raise HTTPException(status_code=404, detail="Candidate not found")
        old_status = str(df.loc[mask, "Status"].iloc[0]).strip()
        new_status = payload.get("Status", old_status)
        role       = str(df.loc[mask, "Role"].iloc[0]).strip() if "Role" in df.columns else ""
        for key, value in payload.items():
            if key not in df.columns:
                continue
            if value == "":
                value = None
            if pd.api.types.is_numeric_dtype(df[key]):
                try:
                    value = float(value) if value is not None else None
                except:
                    value = None
            df.loc[mask, key] = value
        write_sheet(df, CANDIDATES_SHEET)
        if new_status != old_status:
            stage_date   = payload.get("stageDate", datetime.now().strftime("%Y-%m-%d"))
            interviewer  = payload.get("interviewer", "")
            log_stage_entry(str(candidate_name).strip(), new_status, stage_date, interviewer)
            update_dashboard_counters(role, old_status=old_status, new_status=new_status)
        return {"message": "Candidate updated successfully ✅"}


# -------------------------------------------------
# Delete Candidate
# -------------------------------------------------

@app.delete("/delete-candidate")
def delete_candidate(wippx: str, candidate_name: str, role: str = ""):
    try:
        cn = candidate_name.strip()
        wx = wippx.strip()
        rl = role.strip()

        # Fetch row info via direct SQL (bypasses account filter)
        old_status = ""
        actual_role = ""
        try:
            with engine.connect() as conn:
                if rl:
                    row = conn.execute(
                        text('SELECT "Status", "Role" FROM requirements WHERE LOWER("Candidate Name") = LOWER(:cn) AND LOWER("WIPPX") = LOWER(:wx) AND LOWER("Role") = LOWER(:rl) AND "Candidate Name" != \'\' LIMIT 1'),
                        {"cn": cn, "wx": wx, "rl": rl},
                    ).fetchone()
                else:
                    row = conn.execute(
                        text('SELECT "Status", "Role" FROM requirements WHERE LOWER("Candidate Name") = LOWER(:cn) AND LOWER("WIPPX") = LOWER(:wx) AND "Candidate Name" != \'\' LIMIT 1'),
                        {"cn": cn, "wx": wx},
                    ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Candidate not found")
            old_status  = str(row[0] or "").strip()
            actual_role = str(row[1] or "").strip()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lookup failed: {e}")

        # Delete only the specific row (name + wippx + role)
        with engine.begin() as conn:
            if rl:
                conn.execute(
                    text('DELETE FROM requirements WHERE LOWER("Candidate Name") = LOWER(:cn) AND LOWER("WIPPX") = LOWER(:wx) AND LOWER("Role") = LOWER(:rl) AND "Candidate Name" != \'\''),
                    {"cn": cn, "wx": wx, "rl": rl},
                )
            else:
                conn.execute(
                    text('DELETE FROM requirements WHERE rowid IN (SELECT rowid FROM requirements WHERE LOWER("Candidate Name") = LOWER(:cn) AND LOWER("WIPPX") = LOWER(:wx) AND "Candidate Name" != \'\' LIMIT 1)'),
                    {"cn": cn, "wx": wx},
                )

        # Check if other submissions still exist for this candidate
        remaining = 0
        try:
            with engine.connect() as conn:
                remaining = conn.execute(
                    text("SELECT COUNT(*) FROM requirements WHERE LOWER(\"Candidate Name\") = LOWER(:cn) AND \"Candidate Name\" != ''"),
                    {"cn": cn},
                ).scalar() or 0
        except Exception:
            pass

        # Only delete stage history and resume files if this was the last submission
        if remaining == 0:
            try:
                delete_candidate_history(cn)
            except Exception as e:
                print(f"⚠️ History deletion failed (non-fatal): {e}")

        # Update dashboard counters
        if old_status and actual_role:
            try:
                with engine.begin() as conn:
                    if old_status in STAGE_COUNTER_MAP:
                        old_col = STAGE_COUNTER_MAP[old_status]
                        if old_col:
                            conn.execute(
                                text(f'UPDATE dashboard SET "{old_col}" = GREATEST(0, COALESCE("{old_col}", 0) - 1) WHERE LOWER("Role") = LOWER(:role)'),
                                {"role": actual_role},
                            )
                    conn.execute(
                        text('UPDATE dashboard SET "# Profiles Submitted" = GREATEST(0, COALESCE("# Profiles Submitted", 0) - 1) WHERE LOWER("Role") = LOWER(:role)'),
                        {"role": actual_role},
                    )
            except Exception as e:
                print(f"⚠️ Dashboard update failed (non-fatal): {e}")

        return {"message": "Candidate deleted successfully ✅", "resume_deleted": remaining == 0}
    except HTTPException:
        raise
    except Exception as e:
        print(f"🔥 delete_candidate error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")


# -------------------------------------------------
# Delete Resume
# -------------------------------------------------

@app.delete("/delete-resume")
def delete_resume(candidate_name: str):
    for file_path in list_candidate_resume_paths(candidate_name):
        filename = os.path.basename(file_path)
        delete_ai_score(filename)
        delete_summary_cache(filename)
        delete_role_suggestions_cache(filename)
    delete_candidate_resume_files(candidate_name)
    return {"message": f"Resume for '{candidate_name}' deleted ✅"}


# -------------------------------------------------
# Upload Resume
# -------------------------------------------------

@app.post("/upload-resume")
async def upload_resume(
    candidate_name: str = Form(...),
    file: UploadFile = File(...),
):
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in SUPPORTED_RESUME_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only .docx and .pdf resumes are supported.")

    delete_candidate_resume_files(candidate_name)

    file_path = get_original_resume_path(candidate_name, extension)
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())

    set_resume_formatting_status(candidate_name, FORMATTING_PENDING)
    start_resume_transformation_job(candidate_name)

    return {
        "message": "Resume uploaded successfully. Mphasis sanitization is running in the background.",
        "formatting_status": FORMATTING_PENDING,
    }


@app.post("/reformat-resume")
def reformat_resume(candidate_name: str = Body(..., embed=True)):
    if not find_original_resume_path(candidate_name):
        raise HTTPException(status_code=404, detail="Original resume not found")
    start_resume_transformation_job(candidate_name)
    return {
        "message": "Mphasis sanitization started.",
        "candidate": candidate_name,
        "formatting_status": FORMATTING_PENDING,
    }


@app.post("/reformat-all-resumes")
def reformat_all_resumes():
    candidates = []
    seen = set()
    for file_name in os.listdir(RESUME_FOLDER):
        extension = os.path.splitext(file_name)[1].lower()
        if extension not in SUPPORTED_RESUME_EXTENSIONS:
            continue
        candidate_name = candidate_name_from_resume_file(file_name)
        key = candidate_name.strip().lower()
        if not key or key in seen:
            continue
        if not find_original_resume_path(candidate_name):
            continue
        seen.add(key)
        candidates.append(candidate_name)

    for candidate_name in candidates:
        start_resume_transformation_job(candidate_name)

    return {
        "message": f"Mphasis sanitization started for {len(candidates)} resume(s).",
        "candidates": candidates,
        "formatting_status": FORMATTING_PENDING,
    }


@app.get("/download-resume/{filename}")
def download_resume_file(filename: str):
    file_path, resolved_filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")
    if resolved_filename.endswith(TRANSFORMED_RESUME_SUFFIX + ".docx"):
        candidate_name = candidate_name_from_resume_file(resolved_filename)
        download_name = _build_mphasis_download_filename(candidate_name) if candidate_name else "Resume.docx"
    else:
        download_name = resolved_filename
    return FileResponse(file_path, filename=download_name)


app.mount("/resumes", StaticFiles(directory=RESUME_FOLDER), name="resumes")

# Serve compiled React frontend when running as packaged .exe
_FRONTEND_DIST = os.path.join(BASE_DIR, "frontend_dist")
if os.path.isdir(_FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")


# -------------------------------------------------
# Role Suggestions
# -------------------------------------------------

@app.get("/role-suggestions/{filename}")
def get_role_suggestions(filename: str, current_role: str = ""):
    # Get roles that currently exist as open positions in the dashboard
    # Read open roles from ALL accounts via direct SQL so the filter is
    # never empty due to account-scoping (read_sheet filters by current account)
    try:
        with engine.connect() as _conn:
            _rows = _conn.execute(text('SELECT DISTINCT "Role" FROM dashboard WHERE "Role" IS NOT NULL')).fetchall()
        open_roles = {str(r[0]).strip().lower() for r in _rows if str(r[0]).strip() and str(r[0]).strip().lower() != "nan"}
    except Exception:
        open_roles = set()

    def _apply_filters(suggestions, exclude_role_low: str) -> list:
        seen: dict = {}
        for s in suggestions:
            role_low = s.get("role", "").strip().lower()
            # Exclude current role
            if exclude_role_low and role_low == exclude_role_low:
                continue
            # Only show roles that exist as open positions (filters out stale position_skills entries)
            if open_roles and role_low not in open_roles:
                continue
            # Only show ≥30% matches
            if s.get("overall", 0) < 30:
                continue
            # Deduplicate by role name, keep highest score
            if role_low not in seen or s.get("overall", 0) > seen[role_low].get("overall", 0):
                seen[role_low] = s
        return sorted(seen.values(), key=lambda x: x["overall"], reverse=True)

    # Use explicitly passed role, or fall back to source_role in cache
    exclude_low = (current_role or "").strip().lower()

    cached = get_cached_role_suggestions(filename)
    if cached:
        if not exclude_low:
            exclude_low = (cached.get("source_role", "") or "").strip().lower()
        cached["suggestions"] = _apply_filters(cached.get("suggestions", []), exclude_low)
        return cached
    # Fallback: compute on-the-fly (for resumes uploaded before this feature)
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        return {"suggestions": [], "computed_at": None, "source_role": ""}
    try:
        resume_text = extract_resume_text(file_path)
        suggestions = _apply_filters(score_all_roles_keyword(resume_text, exclude_role=exclude_low), exclude_low)
        return {"suggestions": suggestions, "computed_at": None, "source_role": ""}
    except Exception:
        return {"suggestions": [], "computed_at": None, "source_role": ""}


# -------------------------------------------------
# Deleted Positions Helpers
# -------------------------------------------------

def load_deleted_positions() -> dict:
    if not os.path.exists(DELETED_POSITIONS_FILE):
        return {}
    try:
        with open(DELETED_POSITIONS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_deleted_positions(data: dict):
    with open(DELETED_POSITIONS_FILE, "w") as f:
        json.dump(data, f, indent=2)


# -------------------------------------------------
# Requirements with Candidates  ← all roles from Dashboard + their submissions
# -------------------------------------------------

@app.get("/requirements-with-candidates")
def get_requirements_with_candidates():
    dashboard_df  = read_sheet(DASHBOARD_SHEET)
    candidates_df = read_sheet(CANDIDATES_SHEET)

    # Build Position Code → account_name map via raw SQL (read_sheet strips account_name)
    account_by_pc: dict[str, str] = {}
    try:
        with engine.connect() as conn:
            for pc, acc in conn.execute(text('SELECT "Position Code", account_name FROM dashboard')).fetchall():
                key = str(pc).strip()
                if key and key.lower() != "nan":
                    account_by_pc[key] = acc
    except Exception:
        pass

    # Deduplicate dashboard by Position Code — one row per position code shown
    if "Position Code" in dashboard_df.columns:
        dashboard_df = dashboard_df.drop_duplicates(subset=["Position Code"], keep="first")

    # Candidate rows (Candidate Name filled)
    if "Candidate Name" in candidates_df.columns:
        is_cand = (
            candidates_df["Candidate Name"].notna() &
            (candidates_df["Candidate Name"].astype(str).str.strip() != "") &
            (candidates_df["Candidate Name"].astype(str).str.strip().str.lower() != "nan")
        )
    else:
        is_cand = pd.Series([False] * len(candidates_df))

    cand_rows = candidates_df[is_cand].copy()

    # Requirement rows (no Candidate Name) — for extra detail fields
    req_rows_df = candidates_df[~is_cand].copy()
    req_by_role = {}
    if "Role" in req_rows_df.columns:
        for _, row in req_rows_df.iterrows():
            role = str(row.get("Role", "")).strip()
            if role and role.lower() != "nan":
                req_by_role[role] = row.fillna("").to_dict()

    # Fetch candidate account_name via raw SQL (read_sheet strips it)
    cand_account_map: dict[tuple, str] = {}
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text('SELECT "Candidate Name", "WIPPX", "Role", account_name FROM requirements WHERE "Candidate Name" IS NOT NULL AND "Candidate Name" != \'\'')
            ).fetchall()
        for cn, wx, rl, acc in rows:
            key = (str(cn).strip().lower(), str(wx).strip().lower(), str(rl).strip().lower())
            cand_account_map[key] = str(acc or "")
    except Exception:
        pass

    # Group candidates by (role, account_name) — so same-name roles across accounts don't bleed into each other
    cand_by_role_account: dict[tuple, list] = {}
    if "Role" in cand_rows.columns:
        for _, row in cand_rows.iterrows():
            role = str(row.get("Role", "")).strip()
            if not role or role.lower() == "nan":
                continue
            d = row.fillna("").to_dict()
            cn  = str(d.get("Candidate Name", "")).strip().lower()
            wx  = str(d.get("WIPPX", "")).strip().lower()
            acc = cand_account_map.get((cn, wx, role.lower()), "")
            cand_by_role_account.setdefault((role.lower(), acc.lower()), []).append(d)

    def parse_date(val):
        try:
            d = pd.to_datetime(val, errors="coerce")
            return d if pd.notna(d) else pd.Timestamp.min
        except Exception:
            return pd.Timestamp.min

    result = []
    if "Role" not in dashboard_df.columns:
        return result

    for _, dash_row in dashboard_df.iterrows():
        role = str(dash_row.get("Role", "")).strip()
        if not role or role.lower() == "nan":
            continue

        row_dict = dash_row.fillna("").to_dict()

        # Normalise Dashboard column names → Candidates sheet names (frontend expects these)
        if "Replacement/ New" in row_dict:
            row_dict["New/Replacement"] = row_dict.pop("Replacement/ New")
        if "# Positions" in row_dict and "# of Position" not in row_dict:
            row_dict["# of Position"] = row_dict.pop("# Positions")
        if "POD Name" in row_dict and "Proposed POD Name" not in row_dict:
            row_dict["Proposed POD Name"] = row_dict.pop("POD Name")

        # Fill missing detail fields from the requirement row in Candidates sheet
        req_row = req_by_role.get(role, {})
        for k, v in req_row.items():
            if k.startswith("_"):
                continue
            if k not in row_dict or str(row_dict[k]).strip() in ("", "nan"):
                row_dict[k] = v

        pc_key   = str(dash_row.get("Position Code", "")).strip()
        pos_acct = account_by_pc.get(pc_key, "")

        # Look up candidates scoped to this position's account — prevents cross-account bleed
        lookup_key = (role.lower(), pos_acct.lower())
        candidates = list(cand_by_role_account.get(lookup_key, []))
        candidates.sort(key=lambda c: parse_date(c.get("Profile Shared on", "")), reverse=True)

        row_dict["_account_name"]       = pos_acct
        row_dict["_candidates"]         = candidates
        row_dict["_candidate_count"]    = len(candidates)
        row_dict["_latest_submission"]  = candidates[0].get("Profile Shared on", "") if candidates else ""
        result.append(row_dict)

    # Sort: roles with most recent candidate activity first, then roles with no candidates
    result.sort(
        key=lambda r: parse_date(r["_latest_submission"]) if r["_latest_submission"] else pd.Timestamp.min,
        reverse=True,
    )
    return result


# -------------------------------------------------
# Delete Position
# -------------------------------------------------

@app.delete("/delete-position")
def delete_position(role: str):
    role_stripped = role.strip()
    accounts = _current_accounts.get()
    account  = _current_account.get()

    # Build an account-scoped WHERE fragment + params dict
    def _acct_where(params: dict, prefix: str = "") -> tuple:
        if accounts == "__ALL__":
            return "", params
        if isinstance(accounts, list) and accounts:
            phs = ", ".join(f":{prefix}a{i}" for i in range(len(accounts)))
            params.update({f"{prefix}a{i}": acc for i, acc in enumerate(accounts)})
            return f" AND account_name IN ({phs})", params
        params[f"{prefix}acc"] = account
        return f" AND account_name = :{prefix}acc", params

    # 1. Verify role exists (read is safe with any account scope)
    dashboard_df = read_sheet(DASHBOARD_SHEET)
    if "Role" not in dashboard_df.columns:
        raise HTTPException(status_code=404, detail="Dashboard has no Role column")
    dash_mask = dashboard_df["Role"].astype(str).str.strip() == role_stripped
    if not dash_mask.any():
        raise HTTPException(status_code=404, detail=f"Role '{role_stripped}' not found")

    # 2. Delete from dashboard via direct SQL (avoids write_sheet account-scope confusion)
    p1 = {"role": role_stripped}
    acw1, p1 = _acct_where(p1, "d")
    with engine.begin() as conn:
        conn.execute(text(f'DELETE FROM "dashboard" WHERE "Role" = :role{acw1}'), p1)

    # 3. Determine which candidates to retain vs auto-delete
    candidates_df = read_sheet(CANDIDATES_SHEET)
    retained     = []
    auto_deleted = []

    if "Role" in candidates_df.columns:
        role_mask = candidates_df["Role"].astype(str).str.strip() == role_stripped
        for _, cand_row in candidates_df[role_mask].iterrows():
            cname   = str(cand_row.get("Candidate Name", "")).strip()
            is_cand = cname and cname.lower() not in ("", "nan")
            if not is_cand:
                continue
            filename  = cname.replace(" ", "_") + ".docx"
            file_path, filename = _resolve_resume_file(filename)
            if os.path.exists(file_path):
                retained.append(cname)
            else:
                auto_deleted.append(cname)
                delete_ai_score(filename)
                delete_summary_cache(filename)
                delete_role_suggestions_cache(filename)

        # Delete requirement header rows (no candidate name) via direct SQL
        p2 = {"role": role_stripped}
        acw2, p2 = _acct_where(p2, "r")
        with engine.begin() as conn:
            conn.execute(text(
                f"""DELETE FROM "requirements"
                    WHERE "Role" = :role
                    AND (  "Candidate Name" IS NULL
                        OR TRIM("Candidate Name") = ''
                        OR LOWER(TRIM("Candidate Name")) = 'nan'
                    ){acw2}"""
            ), p2)

        # Delete auto-deleted candidates via direct SQL
        for cname in auto_deleted:
            p3 = {"role": role_stripped, "cname": cname}
            acw3, p3 = _acct_where(p3, "c")
            with engine.begin() as conn:
                conn.execute(text(
                    f'DELETE FROM "requirements" WHERE "Role" = :role AND "Candidate Name" = :cname{acw3}'
                ), p3)

    # 4. Track deleted position
    deleted = load_deleted_positions()
    deleted[role_stripped] = {
        "deleted_at":              datetime.now().isoformat(),
        "candidates_retained":     retained,
        "candidates_auto_deleted": auto_deleted,
    }
    save_deleted_positions(deleted)

    return {
        "message":                 f"Position '{role_stripped}' deleted ✅",
        "candidates_retained":     len(retained),
        "candidates_auto_deleted": len(auto_deleted),
    }


@app.get("/deleted-positions")
def get_deleted_positions():
    return load_deleted_positions()


# -------------------------------------------------
# Resumes List
# -------------------------------------------------

@app.get("/resumes-list")
def get_resumes():
    role_lookup = {}
    try:
        df = read_sheet(CANDIDATES_SHEET)
        for _, row in df.iterrows():
            name = str(row.get("Candidate Name", "")).strip()
            role = str(row.get("Role", "")).strip()
            if name and name.lower() != "nan" and role and role.lower() != "nan":
                role_lookup[name] = role
    except Exception:
        pass
    files = {}
    for file in os.listdir(RESUME_FOLDER):
        extension = os.path.splitext(file)[1].lower()
        if extension not in SUPPORTED_RESUME_EXTENSIONS:
            continue

        candidate_name = candidate_name_from_resume_file(file)
        entry = files.setdefault(candidate_name, {
            **get_resume_versions(candidate_name),
            "role": role_lookup.get(candidate_name, ""),
        })

        stem = os.path.splitext(file)[0]
        if stem.endswith(TRANSFORMED_RESUME_SUFFIX):
            entry["transformed_filename"] = file
            entry["transformed_url"] = build_resume_url(file)
            entry["analysis_filename"] = file
            entry["url"] = build_resume_url(file)
            entry["formatting_status"] = get_resume_formatting_status(candidate_name)
            entry["formatting_error"] = get_resume_formatting_error(candidate_name) if entry["formatting_status"] == FORMATTING_FAILED else ""
        elif stem.endswith(ORIGINAL_RESUME_SUFFIX):
            entry["original_filename"] = file
            entry["original_url"] = build_resume_url(file)
            if not entry["analysis_filename"]:
                entry["analysis_filename"] = file
            if not entry["url"]:
                entry["url"] = build_resume_url(file)
            entry["formatting_status"] = get_resume_formatting_status(candidate_name)
            entry["formatting_error"] = get_resume_formatting_error(candidate_name)
        else:
            entry["original_filename"] = file
            entry["original_url"] = build_resume_url(file)
            if not entry["analysis_filename"]:
                entry["analysis_filename"] = file
            if not entry["url"]:
                entry["url"] = build_resume_url(file)
            entry["formatting_status"] = get_resume_formatting_status(candidate_name)
            entry["formatting_error"] = get_resume_formatting_error(candidate_name)

    return sorted(files.values(), key=lambda item: item["candidate"].lower())


@app.get("/resume-versions/{candidate_name}")
def get_candidate_resume_versions(candidate_name: str):
    return get_resume_versions(candidate_name)


@app.get("/resume-audit/{candidate_name}")
def get_candidate_resume_audit(candidate_name: str):
    audit = get_resume_audit_report(candidate_name)
    if not audit:
        raise HTTPException(status_code=404, detail="Resume audit not found")
    return audit


# -------------------------------------------------
# Generate Summary — GET (legacy / backward compat)
# -------------------------------------------------

@app.get("/generate-summary/{filename}")
def generate_resume_summary_get(filename: str):
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        return {"error": "Resume not found"}
    # Return from cache if available
    cache = load_summaries()
    if filename in cache:
        return {
            "candidate": candidate_name_from_resume_file(filename),
            "summary":   cache[filename]["summary"],
            "cached":    True,
        }
    resume_text = extract_resume_text(file_path)
    summary     = generate_summary(resume_text)
    return {"candidate": candidate_name_from_resume_file(filename), "summary": summary}


# -------------------------------------------------
# Generate Summary — POST  ← cache-first, JD-aware
# -------------------------------------------------

@app.post("/generate-summary/{filename}")
def generate_resume_summary_post(
    filename: str,
    payload: SummaryRequest = Body(default=SummaryRequest())
):
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        return {"error": "Resume not found"}

    force_refresh = payload.force_refresh or False

    # Determine role — prefer explicitly passed role, then DB lookup
    role = (payload.role or "").strip()
    if not role:
        try:
            df             = read_sheet(CANDIDATES_SHEET)
            candidate_name = candidate_name_from_resume_file(filename)
            row            = df[df["Candidate Name"].astype(str).str.strip() == candidate_name]
            if not row.empty:
                role = str(row.iloc[0].get("Role", "")).strip()
        except Exception:
            pass

    cache_key = f"{filename}::{role}" if role else filename

    # ── Always serve from cache unless user forces refresh ──
    cache = load_summaries()
    if cache_key in cache and not force_refresh:
        return {
            "candidate": candidate_name_from_resume_file(filename),
            "summary":   cache[cache_key]["summary"],
            "cached":    True,
        }

    # ── Cache miss or forced refresh — generate now ──
    job_description = get_jd_for_role(role) if role else (payload.job_description or "").strip()

    resume_text = extract_resume_text(file_path)
    summary     = generate_summary(resume_text, job_description)
    save_summary_to_cache(filename, role, summary)

    return {
        "candidate": candidate_name_from_resume_file(filename),
        "summary":   summary,
        "cached":    False,
    }


# -------------------------------------------------
# Regenerate ALL summaries
# -------------------------------------------------

@app.post("/regenerate-all-summaries")
def regenerate_all_summaries():
    thread = threading.Thread(
        target=regenerate_all_summaries_background,
        daemon=True
    )
    thread.start()
    resume_count = len([f for f in os.listdir(RESUME_FOLDER) if f.endswith(".docx")])
    return {
        "message": f"Regenerating summaries for {resume_count} resume(s) in background ✅"
    }


# -------------------------------------------------
# Summary cache status
# -------------------------------------------------

@app.get("/summary-cache-status")
def summary_cache_status(filename: str = "", role: str = ""):
    cache = load_summaries()
    if filename:
        _, resolved = _resolve_resume_file(filename)
        for fn in ([resolved, filename] if resolved != filename else [filename]):
            key = f"{fn}::{role.strip()}" if role and role.strip() else fn
            if key in cache or fn in cache:
                return {"ready": True}
        return {"ready": False}
    resume_files = [f for f in os.listdir(RESUME_FOLDER) if f.endswith(".docx")]
    def _is_done(f):
        if f in cache:
            return True
        prefix = f"{f}::"
        return any(k.startswith(prefix) for k in cache)
    done    = [f for f in resume_files if _is_done(f)]
    pending = [f for f in resume_files if not _is_done(f)]
    return {
        "total":         len(resume_files),
        "done":          len(done),
        "pending":       len(pending),
        "pending_files": pending,
    }


# -------------------------------------------------
# Download Summary PDF
# -------------------------------------------------

@app.get("/download-summary/{filename}")
def download_summary(filename: str):
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")
    # Use cached summary for PDF if available (check composite keys too)
    cache  = load_summaries()
    prefix = f"{filename}::"
    entry  = cache.get(filename) or next((v for k, v in cache.items() if k.startswith(prefix)), None)
    if entry:
        summary = entry["summary"]
    else:
        resume_text = extract_resume_text(file_path)
        summary     = generate_summary(resume_text)
    candidate = candidate_name_from_resume_file(filename)
    pdf_path  = create_summary_pdf(candidate, summary)
    return FileResponse(pdf_path, media_type="application/pdf", filename=f"{candidate}_summary.pdf")


def _pdf_text(value, fallback=""):
    text = str(value if value is not None else fallback).strip()
    return xml_escape(text) if text else fallback


def _match_percent(value) -> int:
    try:
        numeric = float(value or 0)
    except Exception:
        numeric = 0
    return max(0, min(100, round(numeric * 100)))


def _match_color(percent: int):
    if percent >= 85:
        return colors.HexColor("#10b981")
    if percent >= 65:
        return colors.HexColor("#84cc16")
    if percent >= 40:
        return colors.HexColor("#f59e0b")
    return colors.HexColor("#f87171")


def _bar_table(percent: int, color):
    filled = max(1, min(100, percent))
    empty = max(0, 100 - filled)
    data = [["", ""]] if empty else [[""]]
    widths = [filled * 1.45, empty * 1.45] if empty else [145]
    table = Table(data, colWidths=widths, rowHeights=[5])
    style = [
        ("BACKGROUND", (0, 0), (0, 0), color),
        ("BOX", (0, 0), (-1, -1), 0, colors.transparent),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]
    if empty:
        style.append(("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#e5e7eb")))
    table.setStyle(TableStyle(style))
    return table


def _score_block(title, score, reason, style):
    try:
        numeric = int(round(float(score or 0)))
    except Exception:
        numeric = 0
    tone = _match_color(numeric)
    return [
        Paragraph(f"<b>{_pdf_text(title)}</b> <font color='{tone.hexval()}'>{numeric}/100</font>", style["metric"]),
        _bar_table(numeric, tone),
        Paragraph(_pdf_text(reason, "No reasoning available."), style["small"]),
    ]


def _create_ai_report_pdf(candidate: str, role: str, summary: str, ai_result: dict, source_filename: str) -> str:
    safe_candidate = re.sub(r"[^A-Za-z0-9_.-]+", "_", candidate).strip("_") or "candidate"
    pdf_path = os.path.join(RESUME_FOLDER, f"{safe_candidate}_ai_report.pdf")
    styles = getSampleStyleSheet()
    report_styles = {
        "title": ParagraphStyle("AiReportTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=colors.HexColor("#111827"), spaceAfter=8),
        "subtitle": ParagraphStyle("AiReportSubtitle", parent=styles["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#475569"), spaceAfter=12),
        "section": ParagraphStyle("AiReportSection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=colors.HexColor("#1f2937"), spaceBefore=12, spaceAfter=8),
        "normal": ParagraphStyle("AiReportNormal", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#1f2937")),
        "small": ParagraphStyle("AiReportSmall", parent=styles["Normal"], fontSize=7.5, leading=10.5, textColor=colors.HexColor("#475569")),
        "metric": ParagraphStyle("AiReportMetric", parent=styles["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#111827"), spaceAfter=4),
        "courseTitle": ParagraphStyle("AiReportCourseTitle", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=colors.HexColor("#111827")),
    }
    overall = ai_result.get("overall")
    try:
        overall = int(round(float(overall or 0)))
    except Exception:
        overall = 0
    overall_color = _match_color(overall)
    story = [
        Paragraph("AI Candidate Fit Report", report_styles["title"]),
        Paragraph(
            f"<b>{_pdf_text(candidate)}</b>{' · ' + _pdf_text(role) if role else ''}<br/>"
            f"Source resume: {_pdf_text(source_filename)} · Generated {datetime.now().strftime('%d %b %Y %I:%M %p')}",
            report_styles["subtitle"],
        ),
        Table(
            [[
                Paragraph(f"<font size='26' color='{overall_color.hexval()}'><b>{overall}</b></font><font color='#64748b'> /100</font>", report_styles["normal"]),
                Paragraph(_pdf_text(ai_result.get("summary"), "AI score generated from resume and role context."), report_styles["normal"]),
            ]],
            colWidths=[1.25 * inch, 5.65 * inch],
            style=[
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#dbeafe")),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ],
        ),
        Paragraph("Score Breakdown", report_styles["section"]),
    ]
    for title, key in [("Skills", "skills"), ("Experience", "experience"), ("Context", "context")]:
        block = ai_result.get(key) or {}
        story.extend(_score_block(title, block.get("score"), block.get("reasoning"), report_styles))
        story.append(Spacer(1, 8))
    story.extend([
        Paragraph("Full Summary", report_styles["section"]),
        Paragraph(_pdf_text(summary, "No summary available.").replace("\n", "<br/>"), report_styles["normal"]),
    ])
    rubric_gap = ai_result.get("rubric_gap") or {}
    recommendations = rubric_gap.get("ai_course_recommendations") or rubric_gap.get("recommendations") or []
    if recommendations:
        catalog = rubric_gap.get("catalog_status") or {}
        catalog_label = f"{catalog.get('file_name', 'TalentNext catalog')} · {catalog.get('row_count', 0)} rows" if catalog else "TalentNext catalog"
        story.extend([
            Paragraph("TalentNext Courses To Take", report_styles["section"]),
            Paragraph(_pdf_text(catalog_label), report_styles["small"]),
            Spacer(1, 6),
        ])
        for rec in recommendations[:10]:
            rec_percent = _match_percent(rec.get("match_confidence"))
            rec_color = _match_color(rec_percent)
            story.append(Table(
                [[
                    Paragraph(f"<b>{_pdf_text(rec.get('skill'), 'Skill gap')}</b><br/><font color='#475569'>{_pdf_text('Below required level' if rec.get('gap_type') == 'below_level' else 'Missing skill')} · required {_pdf_text(rec.get('required_level'), 'level')}{', observed ' + _pdf_text(rec.get('observed_level')) if rec.get('observed_level') else ''}</font>", report_styles["normal"]),
                    Paragraph(f"<font color='{rec_color.hexval()}'><b>{rec_percent}% match</b></font>", report_styles["metric"]),
                ]],
                colWidths=[5.35 * inch, 1.55 * inch],
                style=[
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                    ("BOX", (0, 0), (-1, -1), 0.6, rec_color),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ],
            ))
            course_rows = []
            for course in (rec.get("recommendations") or [])[:3]:
                course_percent = _match_percent(course.get("ai_filter_score", course.get("match_confidence", rec.get("match_confidence"))))
                course_color = _match_color(course_percent)
                tags = " · ".join([str(v) for v in [course.get("proficiency"), course.get("nomination_type"), course.get("category")] if v])
                reason = course.get("ai_filter_reason") or course.get("match_reason") or "Catalog match"
                target = f" · target {course.get('target_proficiency')}" if course.get("target_proficiency") else ""
                course_rows.append([
                    Paragraph(f"<b>{_pdf_text(course.get('sub_skill'), 'Course')}</b><br/><font color='#64748b'>{_pdf_text(tags)}</font><br/><font color='#64748b'>{_pdf_text(reason)}{_pdf_text(target)}</font>", report_styles["small"]),
                    Paragraph(f"<font color='{course_color.hexval()}'><b>{course_percent}%</b></font><br/>{_bar_table(course_percent, course_color)._cellvalues[0][0] if False else ''}", report_styles["courseTitle"]),
                ])
            if course_rows:
                story.append(Table(
                    course_rows,
                    colWidths=[5.65 * inch, 1.25 * inch],
                    style=[
                        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#dbe4ef")),
                        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e5e7eb")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 9),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                        ("TOPPADDING", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ],
                ))
            story.append(Spacer(1, 10))
    doc = SimpleDocTemplate(pdf_path, pagesize=letter, rightMargin=0.55 * inch, leftMargin=0.55 * inch, topMargin=0.55 * inch, bottomMargin=0.55 * inch)
    doc.build(story)
    return pdf_path


@app.post("/download-ai-report/{filename}")
def download_ai_report(filename: str, payload: dict = Body(default_factory=dict)):
    file_path, resolved = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")
    role = str(payload.get("role") or "")
    summary = str(payload.get("summary") or "")
    ai_result = payload.get("ai_result") if isinstance(payload.get("ai_result"), dict) else None
    if not summary:
        cache = load_summaries()
        summary = cache.get(resolved, {}).get("summary", "")
    if not summary:
        summary = generate_summary(extract_resume_text(file_path))
    if not ai_result:
        ai_result = ai_profile_score(resolved, role=role)
    candidate = candidate_name_from_resume_file(resolved)
    pdf_path = _create_ai_report_pdf(candidate, role, summary, ai_result or {}, resolved)
    return FileResponse(pdf_path, media_type="application/pdf", filename=f"{candidate}_ai_report.pdf")


# -------------------------------------------------
# Raw Text
# -------------------------------------------------

@app.get("/get-raw-text/{filename}")
def get_raw_text(filename: str):
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")
    raw_text = extract_resume_text(file_path)
    return {"filename": filename, "raw_text": raw_text}


# -------------------------------------------------
# Resume HTML Preview
# -------------------------------------------------

@app.get("/get-resume-html/{filename}")
def get_resume_html(filename: str):
    import mammoth
    from fastapi.responses import HTMLResponse
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")
    try:
        style_map = """
            p[style-name='Heading 1'] => h1:fresh
            p[style-name='Heading 2'] => h2:fresh
            p[style-name='Heading 3'] => h3:fresh
            p[style-name='Heading 4'] => h4:fresh
            b => strong
            i => em
            u => u
        """
        with open(file_path, "rb") as f:
            result = mammoth.convert_to_html(f, style_map=style_map)
        html_body = result.value
        full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #1a1a1a;
    background: #ffffff;
    padding: 40px 48px;
    max-width: 860px;
    margin: 0 auto;
  }}
  h1 {{ font-size: 22pt; font-weight: 700; margin-bottom: 4px; color: #111; }}
  h2 {{ font-size: 13pt; font-weight: 700; margin: 18px 0 6px; color: #1a1a1a; border-bottom: 1.5px solid #d0d0d0; padding-bottom: 3px; text-transform: uppercase; letter-spacing: 0.5px; }}
  h3 {{ font-size: 11.5pt; font-weight: 700; margin: 12px 0 4px; color: #222; }}
  h4 {{ font-size: 11pt; font-weight: 600; margin: 8px 0 3px; color: #333; }}
  p {{ margin-bottom: 5px; }}
  ul, ol {{ margin: 4px 0 6px 22px; }}
  li {{ margin-bottom: 3px; }}
  strong {{ font-weight: 700; }}
  em {{ font-style: italic; }}
  u {{ text-decoration: underline; }}
  table {{ width: 100%; border-collapse: collapse; margin: 10px 0; }}
  td, th {{ padding: 5px 8px; border: 1px solid #ccc; font-size: 10.5pt; }}
  a {{ color: #2563eb; text-decoration: none; }}
</style>
</head>
<body>{html_body}</body>
</html>"""
        return HTMLResponse(content=full_html)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to convert resume: {str(e)}")


# -------------------------------------------------
# JD Match Score
# -------------------------------------------------

@app.get("/jd-match-score/{filename}")
def jd_match_score(filename: str, role: str = ""):
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")
    resume_text = extract_resume_text(file_path)
    jd = ""
    if role:
        data       = load_position_skills()
        role_lower = role.strip().lower()
        for entry in data.values():
            if entry.get("role", "").strip().lower() == role_lower:
                jd = entry.get("job_description", "")
                break
    if not jd.strip():
        return {"score": None, "reason": "No job description found for this role.", "has_jd": False}
    prompt = f"""You are an expert recruiter. Compare the candidate resume against the job description and return ONLY a JSON object with exactly two keys:
- "score": an integer from 0 to 100
- "reason": a single sentence (max 20 words) explaining the score

Job Description:
{jd[:3000]}

Resume:
{resume_text[:3000]}

Respond with ONLY valid JSON. Example: {{"score": 72, "reason": "Strong backend skills but lacks required cloud experience."}}"""
    raw = generate_summary(prompt)
    import re, json as _json
    try:
        clean  = re.sub(r"```[a-z]*", "", raw).strip()
        parsed = _json.loads(clean)
        score  = max(0, min(100, int(parsed.get("score", 0))))
        reason = str(parsed.get("reason", "")).strip()
        return {"score": score, "reason": reason, "has_jd": True}
    except Exception:
        nums  = re.findall(r"\b(\d{1,3})\b", raw)
        score = int(nums[0]) if nums else 0
        return {"score": score, "reason": raw[:120], "has_jd": True}


# -------------------------------------------------
# Position Skills
# -------------------------------------------------

@app.get("/position-skills")
def get_position_skills(role: str = "", position_code: str = ""):
    data = load_position_skills()
    if position_code:
        code = position_code.strip()
        if code in data:
            return {"position_code": code, **data[code]}
        return {"position_code": code, "skills": [], "job_description": ""}
    if role:
        role_lower = role.strip().lower()
        for code, entry in data.items():
            if entry.get("role", "").strip().lower() == role_lower:
                return {"position_code": code, **entry}
        return {"role": role, "skills": [], "job_description": ""}
    return data


@app.get("/all-position-skills")
def get_all_position_skills():
    return load_position_skills()


# -------------------------------------------------
# TalentNext Catalog
# -------------------------------------------------

@app.get("/talentnext-catalog/status")
def talentnext_catalog_status():
    return talentnext_catalog.status()


@app.post("/talentnext-catalog/refresh")
def refresh_talentnext_catalog():
    return talentnext_catalog.refresh()


@app.post("/job-description/upload")
async def upload_job_description(file: UploadFile = File(...)):
    extension = os.path.splitext(file.filename or "")[1].lower()
    allowed = {".txt", ".md", ".docx", ".pdf"}
    if extension not in allowed:
        raise HTTPException(status_code=400, detail="Upload a .txt, .md, .docx, or .pdf job description.")
    try:
        content = await file.read()
        if extension in {".txt", ".md"}:
            text_value = content.decode("utf-8", errors="ignore")
        else:
            fd, temp_path = tempfile.mkstemp(suffix=extension)
            try:
                with os.fdopen(fd, "wb") as tmp:
                    tmp.write(content)
                text_value = extract_resume_text(temp_path)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        text_value = re.sub(r"\s+", " ", text_value or "").strip()
        if not text_value:
            raise HTTPException(status_code=400, detail="No readable text found in uploaded job description.")
        return {"filename": file.filename, "text": text_value}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read job description: {exc}")


@app.get("/talentnext-catalog/search")
def search_talentnext_catalog(
    query: str = "",
    category: str = "",
    proficiency: str = "",
    limit: int = 25,
):
    return {
        "results": talentnext_catalog.search(
            query=query,
            category=category,
            proficiency=proficiency,
            limit=limit,
        ),
        "catalog_status": talentnext_catalog.status(),
    }


# -------------------------------------------------
# Scoring Rubrics
# -------------------------------------------------

@app.get("/rubrics")
def get_rubrics(role: str = "", position_code: str = ""):
    return list_rubrics(role=role, position_code=position_code)


@app.post("/rubrics/draft")
def draft_rubric(payload: dict = Body(...)):
    return create_draft_rubric(payload)


@app.get("/rubrics/active")
def active_rubric(role: str = "", position_code: str = ""):
    return get_active_rubric(role=role, position_code=position_code)


@app.get("/rubrics/{rubric_id}")
def rubric_by_id(rubric_id: int):
    return get_rubric(rubric_id)


@app.put("/rubrics/{rubric_id}")
def put_rubric(rubric_id: int, payload: dict = Body(...)):
    return update_rubric(rubric_id, payload)


@app.post("/rubrics/{rubric_id}/validate")
def post_rubric_validation(rubric_id: int, payload: dict = Body(...)):
    return validate_rubric(rubric_id, payload)


@app.post("/rubrics/{rubric_id}/activate")
def post_rubric_activation(rubric_id: int):
    return activate_rubric(rubric_id)


@app.post("/candidate-rubric-score")
def post_candidate_rubric_score(payload: dict = Body(...)):
    return save_candidate_score(payload)


@app.get("/candidate-rubric-score")
def get_candidate_rubric_score(candidate_name: str = "", role: str = "", stage: str = ""):
    return list_candidate_scores(candidate_name=candidate_name, role=role, stage=stage)


@app.get("/skill-gap-analysis/{filename}")
def skill_gap_analysis(filename: str, role: str = "", position_code: str = ""):
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")
    resume_text = extract_resume_text(file_path)
    rubric = get_active_rubric(role=role, position_code=position_code)
    return compute_skill_gap(
        resume_text,
        rubric,
        position_context=_position_context_for_learning(role or rubric.get("role", ""), position_code or rubric.get("position_code", "")),
    )


@app.put("/update-position-skills")
def update_position_skills(payload: dict = Body(...)):
    position_code   = (payload.get("position_code") or "").strip()
    role            = (payload.get("role") or "").strip()
    skills          = payload.get("skills", [])
    job_description = (payload.get("job_description") or "").strip()
    if not position_code and not role:
        raise HTTPException(status_code=400, detail="position_code or role is required")
    data       = load_position_skills()
    target_key = None
    if position_code and position_code in data:
        target_key = position_code
    else:
        for key, entry in data.items():
            if entry.get("role", "").strip().lower() == role.lower():
                target_key = key
                break
    if target_key:
        data[target_key]["skills"]          = skills
        data[target_key]["job_description"] = job_description
        data[target_key]["updated_at"]      = datetime.now().isoformat()
        if role:
            data[target_key]["role"] = role
    else:
        key = position_code if position_code else role
        data[key] = {
            "role": role, "skills": skills,
            "job_description": job_description,
            "updated_at": datetime.now().isoformat(),
        }
    save_position_skills(data)
    return {"message": "Position skills updated successfully ✅"}


# -------------------------------------------------
# Update New Requirement
# -------------------------------------------------

@app.put("/update-new-requirement")
def update_new_requirement(row: dict = Body(...)):
    def _norm(s):
        s = str(s).strip()
        return s[:-2] if s.endswith(".0") else s
    try:
        df                     = read_sheet(CANDIDATES_SHEET)
        position_code          = row.get("Position Code") or row.get("position_code")
        original_position_code = row.get("_original_position_code", "").strip()
        if not position_code:
            raise HTTPException(status_code=400, detail="Position Code is required")
        if "Position Code" not in df.columns:
            raise HTTPException(status_code=500, detail="Position Code column missing")
        if not original_position_code:
            mask = df["Position Code"].isna() | (df["Position Code"].astype(str).str.strip() == "") | (df["Position Code"].astype(str).str.strip() == "nan")
            if "Role" in row and "Role" in df.columns:
                mask = mask & (df["Role"].astype(str).str.strip() == str(row["Role"]).strip())
            if "Manager" in row and "Manager" in df.columns:
                mask = mask & (df["Manager"].astype(str).str.strip() == str(row["Manager"]).strip())
        else:
            mask = df["Position Code"].apply(_norm) == _norm(original_position_code)
        if not mask.any():
            raise HTTPException(status_code=404, detail="Requirement row not found.")
        old_role_name = df.loc[mask, "Role"].iloc[0] if "Role" in df.columns else None
        for key, value in row.items():
            if key.startswith("_") or key not in df.columns:
                continue
            if value == "" or value is None:
                value = None
            else:
                col_dtype = df[key].dtype
                try:
                    dtype_str = str(col_dtype).lower()
                    if key == "Position Code":
                        # Always keep position codes as strings
                        value = str(value).rstrip(".0") if str(value).endswith(".0") else str(value)
                    elif dtype_str.startswith("float"):
                        value = float(str(value)) if value is not None else None
                    elif dtype_str.startswith("int"):
                        value = int(float(str(value))) if value is not None else None
                    else:
                        value = str(value)
                except Exception:
                    value = str(value) if value is not None else None
            df.loc[mask, key] = value
        write_sheet(df, CANDIDATES_SHEET)
        df_fresh       = read_sheet(CANDIDATES_SHEET)
        candidate_mask = (
            df_fresh["Position Code"].apply(_norm) == _norm(str(position_code))
        ) & (
            df_fresh["Candidate Name"].notna() &
            (df_fresh["Candidate Name"].astype(str).str.strip() != "") &
            (df_fresh["Candidate Name"].astype(str).str.strip() != "nan")
        )
        SYNC_COLUMNS = ["Role", "Manager", "Location", "WIPPX", "Category", "Proposed POD Name", "New/Replacement"]
        if candidate_mask.any():
            for col in SYNC_COLUMNS:
                if col in df_fresh.columns and col in row and row[col] != "":
                    df_fresh.loc[candidate_mask, col] = row[col]
            write_sheet(df_fresh, CANDIDATES_SHEET)
        dash = read_sheet(DASHBOARD_SHEET)
        if "Position Code" in dash.columns:
            lookup_code = original_position_code if original_position_code else str(position_code).strip()
            dash_mask   = dash["Position Code"].apply(_norm) == _norm(lookup_code)
            if not dash_mask.any() and old_role_name and "Role" in dash.columns:
                dash_mask = dash["Role"].astype(str).str.strip().str.lower() == str(old_role_name).strip().lower()
            if dash_mask.any():
                if "Role" in row and row["Role"]:
                    dash.loc[dash_mask, "Role"] = row["Role"]
                if position_code:
                    dash.loc[dash_mask, "Position Code"] = position_code
                if "# of Position" in row:
                    dash.loc[dash_mask, "# Positions"] = row["# of Position"]
                    dash = ensure_numeric(dash, ["# Positions", "# Positions Fulfilled"])
                    dash.loc[dash_mask, "Gap"] = (
                        dash.loc[dash_mask, "# Positions"] - dash.loc[dash_mask, "# Positions Fulfilled"]
                    ).clip(lower=0)
                    dash.loc[dash_mask, "# Positions Net Open"] = (
                        dash.loc[dash_mask, "# Positions"] - dash.loc[dash_mask, "# Positions Fulfilled"]
                    ).clip(lower=0)
        write_sheet(dash, DASHBOARD_SHEET)

        # Update account_name / lob_name directly in the DB (write_sheet strips account_name)
        new_account = (row.get("account_name") or "").strip()
        new_lob     = row.get("lob_name", None)
        lookup_pc   = (original_position_code or str(position_code)).strip()
        if new_account or new_lob is not None:
            try:
                with engine.begin() as conn:
                    if new_account and new_lob is not None:
                        conn.execute(
                            text('UPDATE dashboard SET account_name = :acc, lob_name = :lob WHERE "Position Code" = :pc'),
                            {"acc": new_account, "lob": new_lob, "pc": lookup_pc},
                        )
                    elif new_account:
                        conn.execute(
                            text('UPDATE dashboard SET account_name = :acc WHERE "Position Code" = :pc'),
                            {"acc": new_account, "pc": lookup_pc},
                        )
                    elif new_lob is not None:
                        conn.execute(
                            text('UPDATE dashboard SET lob_name = :lob WHERE "Position Code" = :pc'),
                            {"lob": new_lob, "pc": lookup_pc},
                        )
            except Exception as e2:
                print(f"⚠️ account/lob update error: {e2}")

        return {"message": "Requirement updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        print("🔥 UPDATE ERROR:", str(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# -------------------------------------------------
# Recalculate All Gaps
# -------------------------------------------------

@app.post("/recalculate-all-gaps")
def recalculate_all_gaps():
    try:
        dash          = read_sheet(DASHBOARD_SHEET)
        candidates_df = read_sheet(CANDIDATES_SHEET)
        dash          = ensure_numeric(dash, ["# Positions", "# Positions Fulfilled", "# Positions Net Open", "Gap"])
        fixed         = 0
        for idx, row in dash.iterrows():
            role = str(row.get("Role", "")).strip()
            if not role or role.lower() == "nan":
                continue
            total_positions = int(row.get("# Positions", 0))
            fulfilled = len(candidates_df[
                (candidates_df["Role"].astype(str).str.strip().str.lower() == role.lower()) &
                (candidates_df["Candidate Name"].notna()) &
                (candidates_df["Candidate Name"].astype(str).str.strip() != "") &
                (candidates_df["Candidate Name"].astype(str).str.strip().str.lower() != "nan") &
                (candidates_df["Status"].astype(str).str.strip().isin(["Selected", "Selection"]))
            ])
            gap      = max(0, total_positions - fulfilled)
            net_open = max(0, total_positions - fulfilled)
            dash.at[idx, "# Positions Fulfilled"] = fulfilled
            dash.at[idx, "# Positions Net Open"]  = net_open
            dash.at[idx, "Gap"]                   = gap
            days_open    = get_days_open_for_role(role, candidates_df)
            bucket, mult = get_aging_bucket(days_open)
            if "Days Open"    not in dash.columns: dash["Days Open"]    = 0
            if "Aging Bucket" not in dash.columns: dash["Aging Bucket"] = ""
            if "Weighted Gap" not in dash.columns: dash["Weighted Gap"] = 0.0
            dash.at[idx, "Days Open"]    = days_open
            dash.at[idx, "Aging Bucket"] = bucket
            dash.at[idx, "Weighted Gap"] = round(gap * mult, 1)
            fixed += 1
        write_sheet(dash, DASHBOARD_SHEET)
        return {"message": f"Recalculated Gap for {fixed} role(s) ✅", "fixed": fixed}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# -------------------------------------------------
# ATS Copilot
# -------------------------------------------------

def _safe_str(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def _candidate_filename(candidate_name: str) -> str:
    return candidate_name.replace(" ", "_") + ".docx"


def _status_rank(status: str) -> int:
    order = {
        "Selected": 6,
        "Selection": 6,
        "DM Interview Scheduled": 5,
        "Client Interview Scheduled": 4,
        "L1 Scheduled": 3,
        "Scheduled": 3,
        "Pending with Client": 2,
        "Pending feedback": 2,
        "Submitted": 1,
    }
    return order.get(_safe_str(status), 0)


def _is_inactive_status(status: str) -> bool:
    return _safe_str(status).lower() in {
        "rejected",
        "l1 reject",
        "client reject",
        "dm reject",
        "dropped",
        "joined",
    }


def _score_for_candidate(candidate_name: str) -> Optional[int]:
    filename = _candidate_filename(candidate_name)
    cached = load_ai_scores().get(filename, {})
    score = cached.get("score", {}).get("overall")
    try:
        return int(score) if score is not None else None
    except Exception:
        return None


def _copilot_roles() -> list:
    rows = role_summary()
    roles = [_safe_str(r.get("Role")) for r in rows]
    return [r for r in roles if r]


def _copilot_candidates() -> list:
    try:
        rows = view_candidates()
    except Exception:
        return []
    result = []
    for row in rows:
        name = _safe_str(row.get("Candidate Name"))
        if not name:
            continue
        result.append({
            "name": name,
            "role": _safe_str(row.get("Role")),
            "status": _safe_str(row.get("Status")),
            "wippx": _safe_str(row.get("WIPPX")),
            "shared_on": _safe_str(row.get("Profile Shared on")),
            "manager": _safe_str(row.get("Manager")),
            "location": _safe_str(row.get("Location")),
            "score": _score_for_candidate(name),
        })
    return result


def _find_role(text: str, explicit_role: str = "") -> str:
    if explicit_role:
        return explicit_role
    low = text.lower()
    for role in _copilot_roles():
        if role.lower() in low:
            return role
    return ""


def _find_candidate(text: str, explicit_candidate: str = "") -> str:
    if explicit_candidate:
        return explicit_candidate
    low = text.lower()
    for candidate in _copilot_candidates():
        if candidate["name"].lower() in low:
            return candidate["name"]
    return ""


def _option_actions(labels: list, action: str, key: str) -> list:
    return [{"label": label, "action": action, key: label} for label in labels[:8]]


def _base_sources(extra=None) -> list:
    sources = ["Dashboard sheet", "New requirements sheet", "Stage history", "AI score cache"]
    if extra:
        sources.extend(extra)
    return list(dict.fromkeys(sources))


def _page_key(page: str) -> str:
    normalized = _safe_str(page).lower()
    if "position" in normalized or "requirement" in normalized:
        return "positions"
    if "candidate" in normalized:
        return "candidates"
    if "resume" in normalized:
        return "resumes"
    if "client" in normalized:
        return "client"
    if "dashboard" in normalized:
        return "dashboard"
    return "ats"


def _page_questions(page: str) -> list:
    questions = {
        "dashboard": [
            {"label": "Which positions are open?", "action": "open_roles"},
            {"label": "Which roles have the biggest gap?", "action": "hiring_risks"},
            {"label": "How many profiles were submitted?", "action": "explain_dashboard"},
            {"label": "Which positions are aging?", "action": "hiring_risks"},
        ],
        "positions": [
            {"label": "Which positions have open roles?", "action": "open_roles"},
            {"label": "Which roles are fulfilled?", "action": "fulfilled_roles"},
            {"label": "Which positions have zero submissions?", "action": "roles_no_candidates"},
            {"label": "What is the gap by role?", "action": "open_roles"},
        ],
        "candidates": [
            {"label": "Which candidates are in pipeline?", "action": "candidate_pipeline"},
            {"label": "Which candidates are selected?", "action": "selected_candidates"},
            {"label": "Which candidates are rejected?", "action": "rejected_candidates"},
            {"label": "Which candidates are pending feedback?", "action": "stuck_candidates"},
        ],
        "resumes": [
            {"label": "Which resumes are ready?", "action": "resume_ready"},
            {"label": "Which resumes are still formatting?", "action": "resume_formatting"},
            {"label": "Which resumes failed formatting?", "action": "resume_failed"},
            {"label": "Who has both original and Mphasis resume?", "action": "resume_versions"},
        ],
        "client": [
            {"label": "What should I report to the client?", "action": "client_update"},
            {"label": "Which roles need attention?", "action": "hiring_risks"},
            {"label": "Which candidates are ready to share?", "action": "client_report"},
            {"label": "What are the hiring risks?", "action": "hiring_risks"},
        ],
    }
    return questions.get(_page_key(page), questions["dashboard"])


def _with_page_questions(result: dict, page: str) -> dict:
    result = dict(result or {})
    quick_actions = result.get("quick_actions") or []
    if any("role" in action or "candidate" in action for action in quick_actions):
        return result
    result["quick_actions"] = _page_questions(page)
    return result


def _role_rollups() -> list:
    rows = get_requirements_with_candidates()
    grouped = {}
    for row in rows:
        role = _safe_str(row.get("Role"))
        if not role:
            continue
        item = grouped.setdefault(role, {
            "role": role,
            "positions": 0,
            "fulfilled": 0,
            "gap": 0,
            "candidates": 0,
            "days": 0,
            "bucket": "",
        })
        item["positions"] += int(float(row.get("# of Position") or row.get("# Positions") or 0))
        item["fulfilled"] += int(float(row.get("# Positions Fulfilled") or 0))
        item["gap"] += int(float(row.get("Gap") or row.get("# Positions Net Open") or 0))
        item["candidates"] = max(item["candidates"], int(float(row.get("_candidate_count") or 0)))
        days = int(float(row.get("Days Open") or get_days_open_for_role(role) or 0))
        if days > item["days"]:
            item["days"] = days
            item["bucket"] = _safe_str(row.get("Aging Bucket")) or get_aging_bucket(days)[0]
    return list(grouped.values())


def _answer_open_roles() -> dict:
    roles = [r for r in _role_rollups() if r["gap"] > 0]
    roles.sort(key=lambda r: (r["gap"], r["days"]), reverse=True)
    cards = [
        {
            "title": r["role"],
            "subtitle": f"{r['gap']} open role(s)" + (f", {r['days']} days open" if r["days"] else ""),
            "meta": [
                {"label": "Positions", "value": str(r["positions"])},
                {"label": "Fulfilled", "value": str(r["fulfilled"])},
                {"label": "Gap", "value": str(r["gap"])},
                {"label": "Candidates", "value": str(r["candidates"])},
            ],
        }
        for r in roles[:8]
    ]
    total_gap = sum(r["gap"] for r in roles)
    return {
        "reply": f"{len(roles)} position(s) have open roles, with a total gap of {total_gap}." if roles else "No open position gaps are showing right now.",
        "cards": cards,
        "confidence": "High",
        "sources": ["Dashboard sheet", "New requirements sheet"],
    }


def _answer_fulfilled_roles() -> dict:
    roles = [r for r in _role_rollups() if r["positions"] > 0 and r["gap"] <= 0]
    roles.sort(key=lambda r: r["role"].lower())
    cards = [
        {
            "title": r["role"],
            "subtitle": "Role is fulfilled against current position count.",
            "meta": [
                {"label": "Positions", "value": str(r["positions"])},
                {"label": "Fulfilled", "value": str(r["fulfilled"])},
                {"label": "Gap", "value": str(r["gap"])},
            ],
        }
        for r in roles[:8]
    ]
    return {
        "reply": f"{len(roles)} role(s) are fulfilled." if roles else "I do not see fulfilled roles in the current position data.",
        "cards": cards,
        "confidence": "High",
        "sources": ["Dashboard sheet"],
    }


def _answer_candidates_by_status(statuses: set[str], empty_text: str, label: str) -> dict:
    cards = []
    normalized = {status.lower() for status in statuses}
    for c in _copilot_candidates():
        if c["status"].lower() not in normalized:
            continue
        cards.append({
            "title": c["name"],
            "subtitle": f"{c['status']} for {c['role']}",
            "meta": [
                {"label": "Role", "value": c["role"] or "Unknown"},
                {"label": "Shared", "value": c["shared_on"] or "Unknown"},
                {"label": "AI score", "value": str(c["score"]) if c["score"] is not None else "Not scored"},
            ],
        })
    return {
        "reply": f"{len(cards)} candidate(s) are {label}." if cards else empty_text,
        "cards": cards[:8],
        "confidence": "High",
        "sources": ["New requirements sheet", "Candidate stage history"],
    }


def _answer_candidate_pipeline() -> dict:
    active = [c for c in _copilot_candidates() if not _is_inactive_status(c["status"])]
    counts = {}
    for c in active:
        stage = c["status"] or "Not set"
        counts[stage] = counts.get(stage, 0) + 1
    cards = [
        {
            "title": stage,
            "subtitle": f"{count} active candidate(s)",
            "meta": [{"label": "Candidates", "value": str(count)}],
        }
        for stage, count in sorted(counts.items(), key=lambda item: item[0].lower())[:8]
    ]
    return {
        "reply": f"{len(active)} candidate(s) are currently in the active pipeline." if active else "I do not see active pipeline candidates right now.",
        "cards": cards,
        "confidence": "High",
        "sources": ["New requirements sheet"],
    }


def _resume_entries() -> list:
    try:
        return get_resumes()
    except Exception:
        return []


def _answer_resume_status(action: str) -> dict:
    entries = _resume_entries()
    if action == "resume_ready":
        matches = [r for r in entries if r.get("formatting_status") == FORMATTING_COMPLETED and r.get("transformed_filename")]
        reply = f"{len(matches)} resume(s) are ready with Mphasis versions." if matches else "No Mphasis resumes are ready yet."
    elif action == "resume_formatting":
        matches = [r for r in entries if r.get("formatting_status") in {FORMATTING_PENDING, FORMATTING_RUNNING, FORMATTING_VALIDATING}]
        reply = f"{len(matches)} resume(s) are still being sanitized or validated." if matches else "No resumes are currently being sanitized."
    elif action == "resume_failed":
        matches = [r for r in entries if r.get("formatting_status") == FORMATTING_FAILED]
        reply = f"{len(matches)} resume(s) failed formatting." if matches else "No resume formatting failures are showing right now."
    elif action == "resume_versions":
        matches = [r for r in entries if r.get("original_filename") and r.get("transformed_filename")]
        reply = f"{len(matches)} candidate(s) have both original and Mphasis resumes." if matches else "No candidate has both resume versions yet."
    elif action == "resume_missing_mphasis":
        matches = [r for r in entries if r.get("original_filename") and not r.get("transformed_filename")]
        reply = f"{len(matches)} candidate(s) have no Mphasis resume yet." if matches else "Every uploaded original resume has a Mphasis resume."
    else:
        matches = entries
        reply = f"I found {len(matches)} resume record(s)."

    cards = []
    for r in matches[:8]:
        cards.append({
            "title": r.get("candidate", "Unknown candidate"),
            "subtitle": r.get("formatting_error") or r.get("role") or "Resume record",
            "meta": [
                {"label": "Original", "value": "Yes" if r.get("original_filename") else "No"},
                {"label": "Mphasis", "value": "Yes" if r.get("transformed_filename") else "No"},
                {"label": "Status", "value": r.get("formatting_status") or "Unknown"},
                {"label": "Preservation", "value": str(r.get("validation_score")) if r.get("validation_score") is not None else "-"},
            ],
        })
    return {
        "reply": reply,
        "cards": cards,
        "confidence": "High",
        "sources": ["Resume folder", "Resume validation report"],
    }


def _answer_resume_preservation() -> dict:
    entries = [
        r for r in _resume_entries()
        if r.get("validation_score") is not None and r.get("transformed_filename")
    ]
    entries.sort(key=lambda r: int(r.get("validation_score") or 0), reverse=True)
    cards = [
        {
            "title": r.get("candidate", "Unknown candidate"),
            "subtitle": f"{r.get('validation_confidence') or 'Validated'} preservation",
            "meta": [
                {"label": "Score", "value": str(r.get("validation_score"))},
                {"label": "Role", "value": r.get("role") or "Unknown"},
                {"label": "Status", "value": r.get("formatting_status") or "Unknown"},
            ],
        }
        for r in entries[:8]
    ]
    return {
        "reply": f"{cards[0]['title']} has the best preservation score at {cards[0]['meta'][0]['value']}%." if cards else "No preservation scores are available yet.",
        "cards": cards,
        "confidence": "High" if cards else "Medium",
        "sources": ["Resume validation report"],
    }


def _risk_cards(limit: int = 5) -> list:
    rows = get_requirements_with_candidates()
    cards = []
    for row in rows:
        role = _safe_str(row.get("Role"))
        if not role:
            continue
        gap = int(float(row.get("Gap") or row.get("# Positions Net Open") or 0))
        days = int(float(row.get("Days Open") or get_days_open_for_role(role) or 0))
        candidate_count = int(float(row.get("_candidate_count") or 0))
        bucket = _safe_str(row.get("Aging Bucket")) or get_aging_bucket(days)[0]
        positions = int(float(row.get("# of Position") or row.get("# Positions") or 0))
        risk = (gap * 4) + min(days / 10, 8) + (5 if candidate_count == 0 else 0) + (3 if bucket in ["Stale", "Critical"] else 0)
        if gap <= 0 and candidate_count > 0:
            continue
        reasons = []
        if gap > 0:
            reasons.append(f"Gap {gap}")
        if days > 30:
            reasons.append(f"{days} days open")
        if candidate_count == 0:
            reasons.append("No submitted candidates")
        if bucket:
            reasons.append(bucket)
        cards.append({
            "title": role,
            "subtitle": ", ".join(reasons) if reasons else "Monitor role health",
            "meta": [
                {"label": "Open positions", "value": str(positions)},
                {"label": "Gap", "value": str(gap)},
                {"label": "Candidates", "value": str(candidate_count)},
                {"label": "Aging", "value": bucket or "Fresh"},
            ],
            "score": round(risk, 1),
        })
    cards.sort(key=lambda x: x["score"], reverse=True)
    return cards[:limit]


def _answer_hiring_risks() -> dict:
    cards = _risk_cards()
    if not cards:
        return {
            "reply": "I do not see a high-risk role right now. Gaps and aging look manageable from the current data.",
            "cards": [],
            "confidence": "Medium",
            "sources": _base_sources(),
            "quick_actions": [
                {"label": "Explain dashboard", "action": "explain_dashboard"},
                {"label": "Roles with no candidates", "action": "roles_no_candidates"},
            ],
        }
    top = cards[0]["title"]
    return {
        "reply": f"{top} is the highest-risk role right now. I ranked risk using gap, days open, aging bucket, and candidate coverage.",
        "cards": cards,
        "confidence": "High",
        "sources": _base_sources(),
        "quick_actions": [
            {"label": "Show candidates", "action": "find_best_candidates", "role": top},
            {"label": "Roles with no candidates", "action": "roles_no_candidates"},
            {"label": "Create action plan", "action": "next_actions"},
            {"label": "Client shortlist", "action": "client_report", "role": top},
        ],
    }


def _answer_roles_no_candidates() -> dict:
    rows = get_requirements_with_candidates()
    cards = []
    for row in rows:
        role = _safe_str(row.get("Role"))
        if not role:
            continue
        count = int(float(row.get("_candidate_count") or 0))
        gap = int(float(row.get("Gap") or row.get("# Positions Net Open") or 0))
        if count == 0 and gap > 0:
            days = int(float(row.get("Days Open") or get_days_open_for_role(role) or 0))
            bucket = _safe_str(row.get("Aging Bucket")) or get_aging_bucket(days)[0]
            cards.append({
                "title": role,
                "subtitle": "Open role with no submitted candidates",
                "meta": [
                    {"label": "Gap", "value": str(gap)},
                    {"label": "Days open", "value": str(days)},
                    {"label": "Aging", "value": bucket},
                ],
            })
    return {
        "reply": f"I found {len(cards)} role(s) with no submitted candidates." if cards else "Every open role appears to have at least one submitted candidate.",
        "cards": cards[:8],
        "confidence": "High",
        "sources": _base_sources(),
        "quick_actions": [
            {"label": "Show hiring risks", "action": "hiring_risks"},
            {"label": "Find reusable resumes", "action": "next_actions"},
        ],
    }


def _answer_best_candidates(role: str) -> dict:
    if not role:
        roles = _copilot_roles()
        return {
            "reply": "Which role should I review?",
            "cards": [],
            "confidence": "High",
            "sources": ["Role summary"],
            "quick_actions": _option_actions(roles, "find_best_candidates", "role"),
        }
    all_candidates = [c for c in _copilot_candidates() if c["role"].lower() == role.lower()]
    active_candidates = [c for c in all_candidates if not _is_inactive_status(c["status"])]
    candidates = active_candidates if active_candidates else all_candidates
    for c in candidates:
        c["rank_value"] = (c["score"] if c["score"] is not None else 0) + (_status_rank(c["status"]) * 5)
    candidates.sort(key=lambda c: c["rank_value"], reverse=True)
    cards = []
    for c in candidates[:5]:
        score = c["score"]
        cards.append({
            "title": c["name"],
            "subtitle": f"{c['status'] or 'No stage'} for {role}",
            "meta": [
                {"label": "AI score", "value": str(score) if score is not None else "Not scored"},
                {"label": "Stage", "value": c["status"] or "Not set"},
                {"label": "Shared", "value": c["shared_on"] or "Unknown"},
            ],
        })
    if cards and active_candidates:
        reply = f"Here are the strongest active candidates I found for {role}."
    elif cards:
        reply = f"I only found inactive candidates for {role}. Review them as historical profiles, not as a current shortlist."
    else:
        reply = f"I do not see submitted candidates for {role} yet."
    return {
        "reply": reply,
        "cards": cards,
        "confidence": "High" if cards else "Medium",
        "sources": _base_sources(["Resume summaries"]),
        "quick_actions": [
            {"label": "Create client shortlist", "action": "client_report", "role": role},
            {"label": "Show role risk", "action": "hiring_risks"},
            {"label": "Roles with no candidates", "action": "roles_no_candidates"},
        ],
    }


def _answer_candidate_status(candidate_name: str) -> dict:
    if not candidate_name:
        names = [c["name"] for c in _copilot_candidates()]
        return {
            "reply": "Which candidate should I check?",
            "cards": [],
            "confidence": "High",
            "sources": ["New requirements sheet"],
            "quick_actions": _option_actions(names, "candidate_status", "candidate"),
        }
    matches = [c for c in _copilot_candidates() if c["name"].lower() == candidate_name.lower()]
    if not matches:
        return {
            "reply": f"I could not find {candidate_name} in submitted candidates.",
            "cards": [],
            "confidence": "Medium",
            "sources": ["New requirements sheet"],
            "quick_actions": [{"label": "Check another candidate", "action": "candidate_status"}],
        }
    c = matches[0]
    history = get_history_for_candidate(c["name"])
    history_text = " -> ".join([_safe_str(h.get("stage")) for h in history if _safe_str(h.get("stage"))])
    card = {
        "title": c["name"],
        "subtitle": f"{c['status'] or 'No stage'} for {c['role']}",
        "meta": [
            {"label": "Role", "value": c["role"] or "Unknown"},
            {"label": "Current stage", "value": c["status"] or "Not set"},
            {"label": "AI score", "value": str(c["score"]) if c["score"] is not None else "Not scored"},
            {"label": "History", "value": history_text or "No history logged"},
        ],
    }
    return {
        "reply": f"{c['name']} is currently at {c['status'] or 'an unset stage'}.",
        "cards": [card],
        "confidence": "High",
        "sources": _base_sources(["Candidate stage history"]),
        "quick_actions": [
            {"label": "Find best for role", "action": "find_best_candidates", "role": c["role"]},
            {"label": "Create client shortlist", "action": "client_report", "role": c["role"]},
        ],
    }


def _answer_client_report(role: str) -> dict:
    if not role:
        return {
            "reply": "Which role should I create a client shortlist for?",
            "cards": [],
            "confidence": "High",
            "sources": ["Role summary"],
            "quick_actions": _option_actions(_copilot_roles(), "client_report", "role"),
        }
    active_candidates = [
        c for c in _copilot_candidates()
        if c["role"].lower() == role.lower() and not _is_inactive_status(c["status"])
    ]
    for c in active_candidates:
        c["rank_value"] = (c["score"] if c["score"] is not None else 0) + (_status_rank(c["status"]) * 5)
    active_candidates.sort(key=lambda c: c["rank_value"], reverse=True)
    cards = [
        {
            "title": c["name"],
            "subtitle": f"{c['status'] or 'No stage'} for {role}",
            "meta": [
                {"label": "AI score", "value": str(c["score"]) if c["score"] is not None else "Not scored"},
                {"label": "Stage", "value": c["status"] or "Not set"},
                {"label": "Shared", "value": c["shared_on"] or "Unknown"},
            ],
        }
        for c in active_candidates[:3]
    ]
    if not cards:
        return {
            "reply": f"I cannot create a client-ready shortlist for {role} yet because there are no active submitted candidates.",
            "cards": [],
            "confidence": "Medium",
            "sources": _base_sources(),
            "quick_actions": [{"label": "Show no-candidate roles", "action": "roles_no_candidates"}],
        }
    return {
        "reply": f"Client-ready shortlist for {role}: use the top {len(cards)} candidate(s) below. Include AI scores where available and validate missing skills before submission.",
        "cards": cards,
        "confidence": "High",
        "sources": _base_sources(["Resume summaries", "AI score cache"]),
        "quick_actions": [
            {"label": "Compare candidates", "action": "find_best_candidates", "role": role},
            {"label": "Show hiring risks", "action": "hiring_risks"},
        ],
    }


def _answer_next_actions() -> dict:
    risk_cards = _risk_cards(3)
    pending = [c for c in _copilot_candidates() if c["status"] in ["Pending feedback", "Pending with Client", "Client Interview Scheduled"]]
    cards = []
    for r in risk_cards:
        cards.append({
            "title": f"Prioritize {r['title']}",
            "subtitle": r["subtitle"],
            "meta": r["meta"],
        })
    for c in pending[:3]:
        cards.append({
            "title": f"Follow up: {c['name']}",
            "subtitle": f"{c['status']} for {c['role']}",
            "meta": [
                {"label": "Role", "value": c["role"]},
                {"label": "Shared", "value": c["shared_on"] or "Unknown"},
            ],
        })
    return {
        "reply": "Here are the next actions I would take based on risk, stage, and candidate coverage.",
        "cards": cards[:6],
        "confidence": "Medium",
        "sources": _base_sources(),
        "quick_actions": [
            {"label": "Show hiring risks", "action": "hiring_risks"},
            {"label": "Roles with no candidates", "action": "roles_no_candidates"},
        ],
    }


def _answer_requirement_health() -> dict:
    rows = get_requirements_with_candidates()
    skills_data = load_position_skills()
    cards = []
    seen_roles = {}

    for row in rows:
        role = _safe_str(row.get("Role"))
        if not role:
            continue
        seen_roles[role] = seen_roles.get(role, 0) + 1
        code = _safe_str(row.get("Position Code"))
        position_data = skills_data.get(code, {})
        if not position_data:
            for entry in skills_data.values():
                if _safe_str(entry.get("role")).lower() == role.lower():
                    position_data = entry
                    break

        skills = position_data.get("skills", []) if position_data else []
        jd = _safe_str(position_data.get("job_description")) if position_data else ""
        candidate_count = int(float(row.get("_candidate_count") or 0))
        gap = int(float(row.get("Gap") or row.get("# Positions Net Open") or 0))
        issues = []
        if not jd:
            issues.append("Missing JD")
        if not skills:
            issues.append("Missing skills")
        if gap > 0 and candidate_count == 0:
            issues.append("No pipeline")
        if not code:
            issues.append("Missing position code")

        if issues:
            cards.append({
                "title": role,
                "subtitle": ", ".join(issues),
                "meta": [
                    {"label": "Position code", "value": code or "Missing"},
                    {"label": "Skills", "value": str(len(skills))},
                    {"label": "Candidates", "value": str(candidate_count)},
                    {"label": "Gap", "value": str(gap)},
                ],
            })

    for role, count in seen_roles.items():
        if count > 1:
            cards.append({
                "title": role,
                "subtitle": "Possible duplicate role rows",
                "meta": [
                    {"label": "Occurrences", "value": str(count)},
                    {"label": "Review", "value": "Merge or clarify"},
                ],
            })

    return {
        "reply": f"I found {len(cards)} requirement setup issue(s)." if cards else "Requirement setup looks healthy: roles have enough structure for tracking and matching.",
        "cards": cards[:8],
        "confidence": "High",
        "sources": _base_sources(["Position skills JSON"]),
        "quick_actions": [
            {"label": "Roles with no candidates", "action": "roles_no_candidates"},
            {"label": "Show hiring risks", "action": "hiring_risks"},
            {"label": "Create sourcing plan", "action": "sourcing_plan"},
        ],
    }


def _answer_deleted_position_impact() -> dict:
    deleted = load_deleted_positions()
    cards = []
    for role, info in deleted.items():
        retained = info.get("candidates_retained", []) or []
        auto_deleted = info.get("candidates_auto_deleted", []) or []
        cards.append({
            "title": role,
            "subtitle": "Deleted position with retained candidate context",
            "meta": [
                {"label": "Retained", "value": str(len(retained))},
                {"label": "Auto removed", "value": str(len(auto_deleted))},
                {"label": "Deleted at", "value": _safe_str(info.get("deleted_at"))[:10] or "Unknown"},
            ],
        })
    return {
        "reply": f"I found {len(cards)} deleted position record(s)." if cards else "I do not see deleted-position impact records right now.",
        "cards": cards[:8],
        "confidence": "High",
        "sources": ["Deleted positions JSON", "Resume folder"],
        "quick_actions": [
            {"label": "Find reusable resumes", "action": "reusable_resumes"},
            {"label": "Show hiring risks", "action": "hiring_risks"},
        ],
    }


def _answer_stuck_candidates() -> dict:
    cards = []
    today = pd.Timestamp(date.today())
    stuck_statuses = {
        "Pending feedback",
        "Pending with Client",
        "Client Interview Scheduled",
        "L1 Scheduled",
        "DM Interview Scheduled",
    }
    for c in _copilot_candidates():
        if c["status"] not in stuck_statuses:
            continue
        parsed = pd.to_datetime(c["shared_on"], errors="coerce")
        days = int((today - parsed).days) if pd.notna(parsed) else None
        if days is None or days >= 7 or c["status"] in ["Pending feedback", "Pending with Client"]:
            cards.append({
                "title": c["name"],
                "subtitle": f"{c['status']} for {c['role']}",
                "meta": [
                    {"label": "Days since shared", "value": str(days) if days is not None else "Unknown"},
                    {"label": "Role", "value": c["role"] or "Unknown"},
                    {"label": "AI score", "value": str(c["score"]) if c["score"] is not None else "Not scored"},
                ],
            })
    cards.sort(key=lambda card: int(card["meta"][0]["value"]) if card["meta"][0]["value"].isdigit() else 0, reverse=True)
    return {
        "reply": f"I found {len(cards)} candidate(s) that may need follow-up." if cards else "I do not see obvious stuck candidates from the current stage data.",
        "cards": cards[:8],
        "confidence": "Medium",
        "sources": _base_sources(["Candidate stage history"]),
        "quick_actions": [
            {"label": "Check candidate status", "action": "candidate_status"},
            {"label": "Today priorities", "action": "next_actions"},
        ],
    }


def _answer_missing_resumes() -> dict:
    cards = []
    for c in _copilot_candidates():
        file_path = os.path.join(RESUME_FOLDER, _candidate_filename(c["name"]))
        if not os.path.exists(file_path):
            cards.append({
                "title": c["name"],
                "subtitle": f"Missing resume for {c['role']}",
                "meta": [
                    {"label": "Stage", "value": c["status"] or "Not set"},
                    {"label": "Shared", "value": c["shared_on"] or "Unknown"},
                ],
            })
    return {
        "reply": f"I found {len(cards)} candidate(s) without uploaded resumes." if cards else "Every submitted candidate appears to have a matching resume file.",
        "cards": cards[:8],
        "confidence": "High",
        "sources": ["New requirements sheet", "Resume folder"],
        "quick_actions": [
            {"label": "Candidates stuck", "action": "stuck_candidates"},
            {"label": "Find best candidates", "action": "find_best_candidates"},
        ],
    }


def _answer_resumes_need_scoring() -> dict:
    scores = load_ai_scores()
    summaries = load_summaries()
    cards = []
    for file in os.listdir(RESUME_FOLDER):
        if not file.endswith(".docx"):
            continue
        missing = []
        if file not in scores:
            missing.append("AI score")
        if file not in summaries:
            missing.append("Summary")
        if missing:
            candidate = file.replace("_", " ").replace(".docx", "")
            cards.append({
                "title": candidate,
                "subtitle": "Missing " + " and ".join(missing),
                "meta": [
                    {"label": "Resume", "value": file},
                    {"label": "Needed", "value": ", ".join(missing)},
                ],
            })
    return {
        "reply": f"I found {len(cards)} resume(s) that need scoring or summary work." if cards else "Resume intelligence looks complete: scores and summaries are available.",
        "cards": cards[:8],
        "confidence": "High",
        "sources": ["Resume folder", "AI score cache", "Summary cache"],
        "quick_actions": [
            {"label": "Find strongest resumes", "action": "find_best_candidates"},
            {"label": "Create client shortlist", "action": "client_report"},
        ],
    }


def _answer_client_update() -> dict:
    stats = get_dashboard()
    risks = _risk_cards(3)
    cards = [
        {
            "title": "Client update snapshot",
            "subtitle": "Use this as the opening status summary.",
            "meta": [
                {"label": "Open positions", "value": str(stats.get("total_open", 0))},
                {"label": "Submitted", "value": str(stats.get("profiles_submitted", 0))},
                {"label": "Scheduled", "value": str(stats.get("profiles_scheduled", 0))},
                {"label": "Total gap", "value": str(stats.get("total_gap", 0))},
            ],
        }
    ] + risks
    return {
        "reply": "Client update draft: hiring activity is active, but the highest-risk roles should be called out with gap, aging, and candidate coverage.",
        "cards": cards[:5],
        "confidence": "Medium",
        "sources": ["Dashboard sheet", "New requirements sheet"],
        "quick_actions": [
            {"label": "Create client shortlist", "action": "client_report"},
            {"label": "Show active candidates", "action": "find_best_candidates"},
            {"label": "Show risks", "action": "hiring_risks"},
        ],
    }


def _answer_sourcing_plan(role: str) -> dict:
    if not role:
        risks = _risk_cards(1)
        role = risks[0]["title"] if risks else ""
    if not role:
        return {
            "reply": "Choose a role first and I can outline a sourcing plan.",
            "cards": [],
            "confidence": "Medium",
            "sources": ["Role summary"],
            "quick_actions": _option_actions(_copilot_roles(), "sourcing_plan", "role"),
        }
    skills = get_skills_for_role(role)
    jd = get_jd_for_role(role)
    card = {
        "title": f"Sourcing plan for {role}",
        "subtitle": "Focus outreach on must-have skills, role fit, and fast pipeline movement.",
        "meta": [
            {"label": "Known skills", "value": str(len(skills))},
            {"label": "JD available", "value": "Yes" if jd else "No"},
            {"label": "First screen", "value": ", ".join(skills[:3]) if skills else "Clarify must-haves"},
        ],
    }
    return {
        "reply": f"For {role}, start by validating the must-have skills, then prioritize candidates with direct evidence in the resume and recent pipeline activity.",
        "cards": [card],
        "confidence": "Medium",
        "sources": ["Position skills JSON", "Dashboard sheet"],
        "quick_actions": [
            {"label": "Find best candidates", "action": "find_best_candidates", "role": role},
            {"label": "Requirement health", "action": "requirement_health"},
        ],
    }


def _answer_dashboard() -> dict:
    stats = get_dashboard()
    cards = [
        {
            "title": "Dashboard snapshot",
            "subtitle": "Current hiring funnel totals",
            "meta": [
                {"label": "Total positions", "value": str(stats.get("total_positions", 0))},
                {"label": "Open positions", "value": str(stats.get("total_open", 0))},
                {"label": "Submitted", "value": str(stats.get("profiles_submitted", 0))},
                {"label": "Total gap", "value": str(stats.get("total_gap", 0))},
            ],
        },
        {
            "title": "Aging risk",
            "subtitle": "Roles needing attention",
            "meta": [
                {"label": "Critical roles", "value": str(stats.get("critical_roles_count", 0))},
                {"label": "Stale roles", "value": str(stats.get("stale_roles_count", 0))},
            ],
        },
    ]
    return {
        "reply": "The dashboard combines position demand, pipeline activity, and aging. The fastest risk signal is total gap plus critical or stale roles.",
        "cards": cards,
        "confidence": "High",
        "sources": ["Dashboard sheet", "New requirements sheet"],
        "quick_actions": [
            {"label": "Show hiring risks", "action": "hiring_risks"},
            {"label": "Today priorities", "action": "next_actions"},
        ],
    }


def _infer_copilot_action(text: str, requested_action: str, page: str = "") -> str:
    if requested_action:
        return requested_action
    low = text.lower()
    page_key = _page_key(page)

    if page_key in {"dashboard", "positions"}:
        if any(w in low for w in ["open role", "open position", "positions are open", "gap by role", "total hiring gap"]):
            return "open_roles"
        if any(w in low for w in ["fulfilled", "closed role", "filled role"]):
            return "fulfilled_roles"
        if any(w in low for w in ["zero submission", "no submission", "no candidate"]):
            return "roles_no_candidates"

    if page_key == "candidates":
        if any(w in low for w in ["pipeline", "active candidate", "in process"]):
            return "candidate_pipeline"
        if any(w in low for w in ["selected", "selection"]):
            return "selected_candidates"
        if any(w in low for w in ["rejected", "reject"]):
            return "rejected_candidates"
        if any(w in low for w in ["pending feedback", "pending with client", "follow"]):
            return "stuck_candidates"

    if page_key == "resumes":
        if any(w in low for w in ["ready", "formatted", "completed", "available"]):
            return "resume_ready"
        if any(w in low for w in ["still formatting", "formatting", "pending"]):
            return "resume_formatting"
        if any(w in low for w in ["failed", "failure", "error"]):
            return "resume_failed"
        if any(w in low for w in ["both", "original and mphasis", "versions"]):
            return "resume_versions"
        if any(w in low for w in ["no mphasis", "missing mphasis", "without mphasis"]):
            return "resume_missing_mphasis"
        if any(w in low for w in ["preservation", "preserved", "content preservation", "best preservation"]):
            return "resume_preservation"

    if page_key == "client":
        if any(w in low for w in ["report", "client", "update", "changed"]):
            return "client_update"
        if any(w in low for w in ["ready to share", "active candidate", "strongest"]):
            return "client_report"

    if any(w in low for w in ["missing jd", "missing skills", "poorly defined", "requirement health", "role setup", "duplicated"]):
        return "requirement_health"
    if any(w in low for w in ["deleted position", "deleted role", "retained candidate"]):
        return "deleted_position_impact"
    if any(w in low for w in ["stuck", "no movement", "pending feedback", "pending client"]):
        return "stuck_candidates"
    if "missing resume" in low or "without resume" in low:
        return "missing_resumes"
    if any(w in low for w in ["need scoring", "missing score", "missing summary", "resumes need"]):
        return "resumes_need_scoring"
    if any(w in low for w in ["weekly client", "client update", "management update", "leadership update"]):
        return "client_update"
    if any(w in low for w in ["sourcing plan", "source candidates", "more sourcing"]):
        return "sourcing_plan"
    if any(w in low for w in ["risk", "critical", "aging", "stale", "gap"]):
        return "hiring_risks"
    if any(w in low for w in ["open role", "open position"]):
        return "open_roles"
    if "no candidate" in low or "no submission" in low:
        return "roles_no_candidates"
    if any(w in low for w in ["best", "rank", "compare", "shortlist"]):
        return "find_best_candidates"
    if "client" in low or "report" in low:
        return "client_report"
    if any(w in low for w in ["status", "stage", "where is"]):
        return "candidate_status"
    if any(w in low for w in ["follow", "today", "next action", "priority"]):
        return "next_actions"
    if "dashboard" in low or "explain" in low:
        return "explain_dashboard"
    return "overview"


@app.post("/copilot/chat")
def copilot_chat(payload: CopilotRequest):
    text = payload.message or ""
    action = _infer_copilot_action(text, payload.action or "", payload.page or "")
    role = _find_role(text, payload.role or "")
    candidate = _find_candidate(text, payload.candidate or "")

    if action == "hiring_risks":
        return _with_page_questions(_answer_hiring_risks(), payload.page or "")
    if action == "open_roles":
        return _with_page_questions(_answer_open_roles(), payload.page or "")
    if action == "fulfilled_roles":
        return _with_page_questions(_answer_fulfilled_roles(), payload.page or "")
    if action == "roles_no_candidates":
        return _with_page_questions(_answer_roles_no_candidates(), payload.page or "")
    if action == "find_best_candidates":
        return _with_page_questions(_answer_best_candidates(role), payload.page or "")
    if action == "candidate_status":
        return _with_page_questions(_answer_candidate_status(candidate), payload.page or "")
    if action == "candidate_pipeline":
        return _with_page_questions(_answer_candidate_pipeline(), payload.page or "")
    if action == "selected_candidates":
        return _with_page_questions(_answer_candidates_by_status({"Selected", "Selection"}, "No selected candidates are showing right now.", "selected"), payload.page or "")
    if action == "rejected_candidates":
        return _with_page_questions(_answer_candidates_by_status({"Rejected", "L1 Reject", "Client Reject", "DM Reject"}, "No rejected candidates are showing right now.", "rejected"), payload.page or "")
    if action == "client_report":
        return _with_page_questions(_answer_client_report(role), payload.page or "")
    if action == "next_actions":
        return _with_page_questions(_answer_next_actions(), payload.page or "")
    if action == "explain_dashboard":
        return _with_page_questions(_answer_dashboard(), payload.page or "")
    if action == "requirement_health":
        return _with_page_questions(_answer_requirement_health(), payload.page or "")
    if action == "deleted_position_impact":
        return _with_page_questions(_answer_deleted_position_impact(), payload.page or "")
    if action == "stuck_candidates":
        return _with_page_questions(_answer_stuck_candidates(), payload.page or "")
    if action == "missing_resumes":
        return _with_page_questions(_answer_missing_resumes(), payload.page or "")
    if action == "resumes_need_scoring":
        return _with_page_questions(_answer_resumes_need_scoring(), payload.page or "")
    if action in {"resume_ready", "resume_formatting", "resume_failed", "resume_versions", "resume_missing_mphasis"}:
        return _with_page_questions(_answer_resume_status(action), payload.page or "")
    if action == "resume_preservation":
        return _with_page_questions(_answer_resume_preservation(), payload.page or "")
    if action == "client_update":
        return _with_page_questions(_answer_client_update(), payload.page or "")
    if action == "sourcing_plan":
        return _with_page_questions(_answer_sourcing_plan(role), payload.page or "")
    if action == "reusable_resumes":
        return _with_page_questions(_answer_resumes_need_scoring(), payload.page or "")

    return _with_page_questions({
        "reply": "I answer read-only questions about the current ATS page. Choose a suggested question below or ask in your own words.",
        "cards": [],
        "confidence": "High",
        "sources": ["ATS data"],
    }, payload.page or "")


# -------------------------------------------------
# Ollama Status
# -------------------------------------------------

@app.get("/ollama-status")
def ollama_status():
    running = ollama_is_running()
    models  = list_ollama_models() if running else []
    return {"running": running, "models": models}


def _position_context_for_learning(role: str = "", position_code: str = "") -> str:
    data = load_position_skills()
    role_lower = (role or "").strip().lower()
    code_lower = (position_code or "").strip().lower()
    for key, entry in data.items():
        key_lower = str(key or "").strip().lower()
        entry_code = str(entry.get("position_code") or key or "").strip().lower()
        entry_role = str(entry.get("role") or "").strip().lower()
        if (code_lower and code_lower in {key_lower, entry_code}) or (role_lower and role_lower == entry_role):
            return "\n".join([
                str(entry.get("role") or role or ""),
                str(entry.get("job_description") or ""),
                "Required skills: " + ", ".join(str(skill) for skill in entry.get("skills", []) if str(skill).strip()),
            ])
    return role or position_code or ""


def _attach_rubric_gap(result: dict, file_path: str, role: str = "", position_code: str = "") -> dict:
    if not role and not position_code:
        return result
    try:
        resume_text = extract_resume_text(file_path)
        rubric_gap = rubric_score_for_resume(
            resume_text,
            role=role,
            position_code=position_code,
            position_context=_position_context_for_learning(role, position_code),
        )
        if rubric_gap:
            result["rubric_gap"] = rubric_gap
            result["rubric_available"] = True
    except Exception:
        result["rubric_available"] = False
    return result


# -------------------------------------------------
# AI Profile Score
# -------------------------------------------------

@app.get("/ai-profile-score/{filename}")
def ai_profile_score(filename: str, role: str = "", model: str = "llama3"):
    import re as _re
    file_path, filename = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume not found")

    # Return cached score instantly (composite key: filename::role)
    scores    = load_ai_scores()
    cache_key = f"{filename}::{role.strip()}" if role and role.strip() else filename
    cached    = scores.get(cache_key)
    if cached is None and cache_key != filename:
        # Fall back to legacy key only if role matches
        legacy = scores.get(filename)
        if legacy and legacy.get("role", "").strip().lower() == role.strip().lower():
            cached = legacy
    if cached is not None:
        result              = cached["score"]
        result["cached"]    = True
        result["scored_at"] = cached.get("scored_at", "")
        return _attach_rubric_gap(result, file_path, role)

    resume_text          = extract_resume_text(file_path)
    jd_text              = ""
    position_skills_list = []
    if role:
        data       = load_position_skills()
        role_lower = role.strip().lower()
        for entry in data.values():
            if entry.get("role", "").strip().lower() == role_lower:
                jd_text              = entry.get("job_description", "")
                position_skills_list = entry.get("skills", [])
                break
    if not jd_text.strip() and not position_skills_list:
        return {
            "source":  "none",
            "error":   "No job description or skills found for this role. Add a JD via Edit Requirement.",
            "overall": None,
        }
    if not jd_text.strip() and position_skills_list:
        jd_text = "Required skills: " + ", ".join(position_skills_list)
    if ollama_is_running():
        result = score_with_ollama(resume_text, jd_text, model=model)
        if result:
            result["source"] = "ollama"
            result["model"]  = result.get("_model_used", model)
            save_ai_score(filename, role, result)
            return _attach_rubric_gap(result, file_path, role)
    skills_matched = []
    skills_missing = []
    for skill in position_skills_list:
        pattern = _re.compile(_re.escape(skill), _re.IGNORECASE)
        if pattern.search(resume_text):
            skills_matched.append(skill)
        else:
            skills_missing.append(skill)
    skill_score = round((len(skills_matched) / max(len(position_skills_list), 1)) * 60)
    exp_match   = _re.search(r"(\d+)\+?\s*(years?|yrs?)", resume_text, _re.IGNORECASE)
    exp_years   = int(exp_match.group(1)) if exp_match else None
    exp_score   = min(20, (exp_years or 0) * 2)
    stop = {
        "the","and","for","with","that","this","are","will","have","from",
        "you","our","they","all","any","can","has","been","more","also",
        "must","able","work","role","team","skills","experience","ability",
        "strong","good","well","high","key","new","use","used","other",
    }
    jd_tokens = list({
        w for w in _re.sub(r"[^a-z0-9\s]", " ", jd_text.lower()).split()
        if len(w) > 2 and w not in stop
    })
    jd_hit    = [w for w in jd_tokens if _re.search(r"\b" + _re.escape(w) + r"\b", resume_text, _re.IGNORECASE)]
    ctx_score = min(20, round((len(jd_hit) / max(len(jd_tokens), 1)) * 40))
    overall   = min(100, skill_score + exp_score + ctx_score)
    result = {
        "source":  "keyword_fallback",
        "overall": overall,
        "skills": {
            "score":     skill_score,
            "matched":   skills_matched,
            "missing":   skills_missing,
            "reasoning": f"{len(skills_matched)} of {len(position_skills_list)} required skills found in resume.",
        },
        "experience": {
            "score":          exp_score,
            "years_detected": exp_years,
            "reasoning":      f"{exp_years} years detected." if exp_years else "No explicit years of experience found.",
        },
        "context": {
            "score":     ctx_score,
            "reasoning": f"{len(jd_hit)} JD keywords matched in resume context.",
        },
        "summary": "Keyword-based score. Ollama unavailable at time of scoring.",
    }
    save_ai_score(filename, role, result)
    return _attach_rubric_gap(result, file_path, role)


# -------------------------------------------------
# Re-score Resume
# -------------------------------------------------

@app.post("/rescore-resume")
def rescore_resume(filename: str, role: str):
    import re as _re
    delete_ai_score(filename)
    file_path, resolved = _resolve_resume_file(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume file not found")

    resume_text          = extract_resume_text(file_path)
    data                 = load_position_skills()
    jd_text              = ""
    position_skills_list = []
    role_lower           = role.strip().lower()
    for entry in data.values():
        if entry.get("role", "").strip().lower() == role_lower:
            jd_text              = entry.get("job_description", "")
            position_skills_list = entry.get("skills", [])
            break

    if not jd_text.strip() and not position_skills_list:
        raise HTTPException(status_code=400, detail=f"No JD/skills found for role '{role}'")
    if not jd_text.strip():
        jd_text = "Required skills: " + ", ".join(position_skills_list)

    if ollama_is_running():
        result = score_with_ollama(resume_text, jd_text)
        if result:
            result["source"] = "ollama"
            result["model"] = result.get("_model_used", "")
            save_ai_score(resolved, role, result)
            result["cached"] = False
            return result

    # Keyword fallback
    skills_matched = [s for s in position_skills_list if _re.search(_re.escape(s), resume_text, _re.IGNORECASE)]
    skills_missing = [s for s in position_skills_list if s not in skills_matched]
    skill_score = round((len(skills_matched) / max(len(position_skills_list), 1)) * 60)
    exp_match   = _re.search(r"(\d+)\+?\s*(years?|yrs?)", resume_text, _re.IGNORECASE)
    exp_score   = min(20, (int(exp_match.group(1)) if exp_match else 0) * 2)
    stop = {"the","and","for","with","that","this","are","will","have","from","you","our","they","all","any","can","has","been","more","also","must","able","work","role","team","skills","experience","ability","strong","good","well","high","key","new","use","used","other"}
    jd_tokens = list({w for w in _re.sub(r"[^a-z0-9\s]", " ", jd_text.lower()).split() if len(w) > 2 and w not in stop})
    jd_hit    = [w for w in jd_tokens if _re.search(r"\b" + _re.escape(w) + r"\b", resume_text, _re.IGNORECASE)]
    ctx_score = min(20, round((len(jd_hit) / max(len(jd_tokens), 1)) * 40))
    overall   = min(100, skill_score + exp_score + ctx_score)
    result = {
        "source":     "keyword_fallback",
        "overall":    overall,
        "skills":     {"score": skill_score, "matched": skills_matched, "missing": skills_missing, "reasoning": f"{len(skills_matched)} of {len(position_skills_list)} required skills found."},
        "experience": {"score": exp_score,   "reasoning": f"{int(exp_match.group(1)) if exp_match else 0} years detected."},
        "context":    {"score": ctx_score,   "reasoning": f"{len(jd_hit)} JD keywords matched."},
        "cached":     False,
    }
    save_ai_score(resolved, role, result)
    return result


# -------------------------------------------------
# AI Score Status
# -------------------------------------------------

@app.get("/ai-score-status/{filename}")
def ai_score_status(filename: str, role: str = ""):
    _, resolved = _resolve_resume_file(filename)
    scores      = load_ai_scores()
    for fn in ([resolved, filename] if resolved != filename else [filename]):
        cache_key = f"{fn}::{role.strip()}" if role and role.strip() else fn
        entry     = scores.get(cache_key) or (scores.get(fn) if fn == resolved else None)
        if entry:
            if cache_key == fn and role.strip():
                cached_role = entry.get("role", "").strip().lower()
                if cached_role and cached_role != role.strip().lower():
                    continue
            return {
                "ready":     True,
                "scored_at": entry.get("scored_at", ""),
                "source":    entry.get("score", {}).get("source", ""),
            }
    return {"ready": False}


# -------------------------------------------------
# Auth Endpoints
# -------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

class AddClusterRequest(BaseModel):
    name: str

class AddCohortRequest(BaseModel):
    name:         str
    cluster_name: str

class AddAccountRequest(BaseModel):
    name:         str
    cluster_name: str = None
    cohort_name:  str = None

class AddLobRequest(BaseModel):
    name:         str
    account_name: str

class AddUserRequest(BaseModel):
    username: str
    password: str
    role:     str = "user"

class UpdatePasswordRequest(BaseModel):
    username: str
    password: str

class DeleteUserRequest(BaseModel):
    username: str

class AddAccessRequest(BaseModel):
    username:     str
    access_level: str
    cluster_name: Optional[str] = None
    cohort_name:  Optional[str] = None
    account_name: Optional[str] = None
    lob_name:     Optional[str] = None
    permission:   str = "read"



@app.post("/auth/login")
def auth_login(req: LoginRequest):
    result = validate_login(req.username, req.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    return result


@app.get("/auth/data")
def auth_get_data():
    return get_all_data()


@app.post("/auth/clusters")
def auth_add_cluster(req: AddClusterRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Cluster name cannot be empty.")
    if cluster_exists(name):
        raise HTTPException(status_code=400, detail="Cluster already exists.")
    add_cluster(name)
    return {"ok": True}


@app.delete("/auth/clusters/{name}")
def auth_delete_cluster(name: str):
    if not cluster_exists(name):
        raise HTTPException(status_code=404, detail="Cluster not found.")
    delete_cluster(name)
    return {"ok": True}


@app.post("/auth/cohorts")
def auth_add_cohort(req: AddCohortRequest):
    name         = req.name.strip()
    cluster_name = req.cluster_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Cohort name cannot be empty.")
    if not cluster_exists(cluster_name):
        raise HTTPException(status_code=404, detail="Cluster not found.")
    if cohort_exists(name, cluster_name):
        raise HTTPException(status_code=400, detail="Cohort already exists in this cluster.")
    add_cohort(name, cluster_name)
    return {"ok": True}


@app.delete("/auth/cohorts")
def auth_delete_cohort(name: str = Query(...), cluster_name: str = Query(...)):
    if not cohort_exists(name, cluster_name):
        raise HTTPException(status_code=404, detail="Cohort not found.")
    delete_cohort(name, cluster_name)
    return {"ok": True}


@app.post("/auth/accounts")
def auth_add_account(req: AddAccountRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Account name cannot be empty.")
    if account_exists(name):
        raise HTTPException(status_code=400, detail="Account already exists.")
    add_account(name, req.cluster_name, req.cohort_name)
    return {"ok": True}


@app.delete("/auth/accounts/{name}")
def auth_delete_account(name: str):
    if name == "Admin":
        raise HTTPException(status_code=400, detail="Cannot delete Admin account.")
    if not account_exists(name):
        raise HTTPException(status_code=404, detail="Account not found.")
    delete_account(name)
    return {"ok": True}


@app.post("/auth/lobs")
def auth_add_lob(req: AddLobRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="LOB name cannot be empty.")
    if not account_exists(req.account_name):
        raise HTTPException(status_code=404, detail="Account not found.")
    if lob_exists(name, req.account_name):
        raise HTTPException(status_code=400, detail="LOB already exists in this account.")
    add_lob(name, req.account_name)
    return {"ok": True}


@app.delete("/auth/lobs")
def auth_delete_lob(name: str = Query(...), account_name: str = Query(...)):
    if not lob_exists(name, account_name):
        raise HTTPException(status_code=404, detail="LOB not found.")
    delete_lob(name, account_name)
    return {"ok": True}


@app.post("/auth/users")
def auth_add_user(req: AddUserRequest):
    if not req.username.strip():
        raise HTTPException(status_code=400, detail="Username cannot be empty.")
    if not req.password.strip():
        raise HTTPException(status_code=400, detail="Password cannot be empty.")
    if user_exists(req.username):
        raise HTTPException(status_code=400, detail="Username already exists.")
    role = req.role if req.role in ("user", "admin") else "user"
    add_user(req.username, req.password, role)
    return {"ok": True}


@app.delete("/auth/users")
def auth_delete_user(username: str = Query(...)):
    if username == "Admin":
        raise HTTPException(status_code=400, detail="Cannot delete the Admin user.")
    delete_user(username)
    return {"ok": True}


@app.put("/auth/password")
def auth_update_password(req: UpdatePasswordRequest):
    if not req.password.strip():
        raise HTTPException(status_code=400, detail="Password cannot be empty.")
    update_password(req.username, req.password)
    return {"ok": True}


@app.post("/auth/access")
def auth_add_access(req: AddAccessRequest):
    if not user_exists(req.username):
        raise HTTPException(status_code=404, detail="User not found.")
    valid_levels = ("cluster", "cohort", "account", "lob")
    if req.access_level not in valid_levels:
        raise HTTPException(status_code=400, detail="Invalid access level.")
    add_user_access(
        req.username, req.access_level,
        req.cluster_name, req.cohort_name,
        req.account_name, req.lob_name,
        req.permission,
    )
    return {"ok": True}


@app.delete("/auth/access")
def auth_remove_access(access_id: int = Query(...)):
    remove_user_access(access_id)
    return {"ok": True}


@app.get("/auth/access/{username}")
def auth_get_user_access(username: str):
    return {"access": get_user_access(username)}
