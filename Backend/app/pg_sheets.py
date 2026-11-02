"""
pg_sheets.py
PostgreSQL-backed read_sheet / write_sheet with per-account data isolation.
Each account's rows are stored in shared tables tagged with account_name.
"""

import os
import pandas as pd
from contextlib import contextmanager
from contextvars import ContextVar
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ats:ats123@localhost:5432/atsdb")
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5, max_overflow=10)

def _is_sqlite():
    return DATABASE_URL.lower().startswith("sqlite")

# Set by AccountContextMiddleware on every request
_current_account:  ContextVar[str]  = ContextVar("current_account",  default="Admin")
_current_accounts: ContextVar       = ContextVar("current_accounts", default=None)

SHEET_TABLE_MAP = {
    "Dashboard":        "dashboard",
    "New requirements": "requirements",
    "Stage History":    "stage_history",
}


def _table(sheet_name: str) -> str:
    t = SHEET_TABLE_MAP.get(sheet_name)
    if not t:
        raise HTTPException(status_code=500, detail=f"Unknown sheet: {sheet_name}")
    return t


def init_data_tables():
    """
    Add account_name / lob_name columns to any existing data tables that
    predate account isolation. Safe to call repeatedly.
    """
    for table in SHEET_TABLE_MAP.values():
        try:
            with engine.begin() as conn:
                if _is_sqlite():
                    existing = [r[1] for r in conn.execute(text(f'PRAGMA table_info("{table}")')).fetchall()]
                    if not existing:
                        continue  # table doesn't exist yet — created on first write
                    if "account_name" not in existing:
                        conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN account_name TEXT DEFAULT \'Admin\''))
                    conn.execute(text(f'UPDATE "{table}" SET account_name = \'Admin\' WHERE account_name IS NULL'))
                    if "lob_name" not in existing:
                        conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN lob_name TEXT DEFAULT \'\''))
                else:
                    conn.execute(text(
                        f"ALTER TABLE IF EXISTS \"{table}\" "
                        f"ADD COLUMN IF NOT EXISTS account_name TEXT DEFAULT 'Admin'"
                    ))
                    conn.execute(text(
                        f"UPDATE \"{table}\" SET account_name = 'Admin' WHERE account_name IS NULL"
                    ))
                    conn.execute(text(
                        f"ALTER TABLE IF EXISTS \"{table}\" "
                        f"ADD COLUMN IF NOT EXISTS lob_name TEXT DEFAULT ''"
                    ))
        except Exception:
            pass  # unexpected error — table will be created correctly on first write


@contextmanager
def single_account_scope(account: str = None):
    """Force read_sheet + write_sheet to operate on exactly one account.
    Prevents _current_accounts (multi-read) from contaminating a single-account write."""
    act   = account or _current_account.get()
    tok_s = _current_account.set(act)
    tok_m = _current_accounts.set(None)
    try:
        yield act
    finally:
        _current_account.reset(tok_s)
        _current_accounts.reset(tok_m)


def read_sheet(sheet_name: str, explicit_account: str = None) -> pd.DataFrame:
    table    = _table(sheet_name)
    # explicit_account bypasses ContextVars entirely — used when ContextVar
    # propagation to thread-pool workers is unreliable (e.g. add_position)
    if explicit_account is not None:
        try:
            with engine.connect() as conn:
                result = conn.execute(
                    text(f'SELECT * FROM "{table}" WHERE account_name = :acc'),
                    {"acc": explicit_account},
                )
                rows = result.fetchall()
                cols = list(result.keys())
            df = pd.DataFrame(rows, columns=cols)
            df.columns = df.columns.map(str).str.strip()
            if "account_name" in df.columns:
                df = df.drop(columns=["account_name"])
            return df
        except Exception as e:
            if "no such table" in str(e).lower():
                return pd.DataFrame()
            print(f"PG READ ERROR ({sheet_name}): {e}")
            raise HTTPException(status_code=500, detail=str(e))
    account  = _current_account.get()
    accounts = _current_accounts.get()
    try:
        with engine.connect() as conn:
            if accounts == "__ALL__":
                result = conn.execute(text(f'SELECT * FROM "{table}"'))
            elif isinstance(accounts, list) and accounts:
                placeholders = ",".join([f":a{i}" for i in range(len(accounts))])
                params = {f"a{i}": acc for i, acc in enumerate(accounts)}
                result = conn.execute(
                    text(f'SELECT * FROM "{table}" WHERE account_name IN ({placeholders})'),
                    params,
                )
            else:
                result = conn.execute(
                    text(f'SELECT * FROM "{table}" WHERE account_name = :acc'),
                    {"acc": account},
                )
            rows = result.fetchall()
            cols = list(result.keys())
        df = pd.DataFrame(rows, columns=cols)
        df.columns = df.columns.map(str).str.strip()
        # Drop the internal column so upstream code never sees it
        if "account_name" in df.columns:
            df = df.drop(columns=["account_name"])
        return df
    except Exception as e:
        if "no such table" in str(e).lower():
            return pd.DataFrame()
        print(f"PG READ ERROR ({sheet_name}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


def write_sheet(df: pd.DataFrame, sheet_name: str) -> None:
    table = _table(sheet_name)
    account = _current_account.get()
    try:
        df = df.copy()
        df["account_name"] = account
        for col in df.columns:
            if df[col].dtype == object:
                df[col] = df[col].where(df[col].notna(), None)

        with engine.begin() as conn:
            if _is_sqlite():
                exists = conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
                    {"t": table},
                ).fetchone() is not None
            else:
                exists = conn.execute(
                    text("SELECT to_regclass(:t) IS NOT NULL"),
                    {"t": table},
                ).scalar()
            if exists:
                if _is_sqlite():
                    # Add any columns the DataFrame has that the table is missing
                    cur_cols = {r[1] for r in conn.execute(text(f'PRAGMA table_info("{table}")')).fetchall()}
                    for col in df.columns:
                        if col not in cur_cols:
                            conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{col}" TEXT'))
                # Delete only this account's rows, then re-insert
                conn.execute(
                    text(f'DELETE FROM "{table}" WHERE account_name = :acc'),
                    {"acc": account},
                )
                df.to_sql(table, conn, if_exists="append", index=False, method="multi", chunksize=500)
            else:
                # Brand-new table — create it (account_name column included)
                df.to_sql(table, conn, if_exists="replace", index=False, method="multi", chunksize=500)
    except Exception as e:
        print(f"PG WRITE ERROR ({sheet_name}): {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save to database: {str(e)}")


def migrate_from_excel(excel_path: str) -> dict:
    """
    One-time migration from Excel → PostgreSQL.
    Migrated rows are tagged with account_name='Admin'.
    Skips sheets that already have data.
    """
    results = {}
    for sheet_name, table_name in SHEET_TABLE_MAP.items():
        try:
            with engine.connect() as conn:
                try:
                    count = conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar()
                    if count and count > 0:
                        results[sheet_name] = f"skipped ({count} rows already present)"
                        continue
                except Exception:
                    pass

            df = pd.read_excel(excel_path, sheet_name=sheet_name)
            df.columns = df.columns.map(str).str.strip()
            df["account_name"] = "Admin"
            with engine.begin() as conn:
                df.to_sql(table_name, conn, if_exists="replace", index=False, method="multi", chunksize=500)
            results[sheet_name] = f"migrated {len(df)} rows"
            print(f"Migrated '{sheet_name}' -> '{table_name}' ({len(df)} rows)")
        except Exception as e:
            results[sheet_name] = f"ERROR: {e}"
            print(f"Migration failed for '{sheet_name}': {e}")
    return results
