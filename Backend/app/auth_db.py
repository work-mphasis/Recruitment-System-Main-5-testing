"""
auth_db.py
Hierarchy: Cluster → Cohort → Account → LOB
Users are global; access is assigned separately per level.
"""

import os, json
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ats:ats123@localhost:5432/atsdb")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

def _is_sqlite():
    return DATABASE_URL.lower().startswith("sqlite")

ALL_PAGES = ["dashboard", "position-management", "candidates", "resumes", "client-report"]


def init_auth_tables():
    with engine.begin() as conn:
        # ── Clusters ──────────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS auth_clusters (
                name TEXT PRIMARY KEY
            )
        """))

        # ── Cohorts ───────────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS auth_cohorts (
                name         TEXT NOT NULL,
                cluster_name TEXT NOT NULL,
                PRIMARY KEY (name, cluster_name),
                FOREIGN KEY (cluster_name) REFERENCES auth_clusters(name) ON DELETE CASCADE
            )
        """))

        # ── Accounts ──────────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS auth_accounts (
                name TEXT PRIMARY KEY
            )
        """))
        if _is_sqlite():
            existing = {r[1] for r in conn.execute(text("PRAGMA table_info(auth_accounts)")).fetchall()}
            if "cluster_name" not in existing:
                conn.execute(text("ALTER TABLE auth_accounts ADD COLUMN cluster_name TEXT"))
            if "cohort_name" not in existing:
                conn.execute(text("ALTER TABLE auth_accounts ADD COLUMN cohort_name TEXT"))
        else:
            conn.execute(text("ALTER TABLE auth_accounts ADD COLUMN IF NOT EXISTS cluster_name TEXT"))
            conn.execute(text("ALTER TABLE auth_accounts ADD COLUMN IF NOT EXISTS cohort_name  TEXT"))

        # ── LOBs (4th tier) ───────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS auth_lobs (
                name         TEXT NOT NULL,
                account_name TEXT NOT NULL,
                PRIMARY KEY (name, account_name),
                FOREIGN KEY (account_name) REFERENCES auth_accounts(name) ON DELETE CASCADE
            )
        """))

        # ── Global Users (migrate old account-scoped schema if present) ─
        if _is_sqlite():
            has_old_schema = conn.execute(text(
                "SELECT 1 FROM pragma_table_info('auth_users') WHERE name='account_name'"
            )).fetchone()
        else:
            has_old_schema = conn.execute(text("""
                SELECT 1 FROM information_schema.columns
                WHERE table_name='auth_users' AND column_name='account_name'
            """)).fetchone()

        if has_old_schema:
            # Migrate old rows → new global table
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS auth_users_new (
                    username TEXT PRIMARY KEY,
                    password TEXT NOT NULL,
                    role     TEXT NOT NULL DEFAULT 'user'
                )
            """))
            if _is_sqlite():
                conn.execute(text("""
                    INSERT OR IGNORE INTO auth_users_new (username, password, role)
                    SELECT username, password, COALESCE(role, 'user')
                    FROM auth_users
                    GROUP BY LOWER(username)
                """))
                conn.execute(text("DROP TABLE auth_users"))
            else:
                conn.execute(text("""
                    INSERT INTO auth_users_new (username, password, role)
                    SELECT DISTINCT ON (LOWER(username))
                        username,
                        password,
                        COALESCE(role, 'user')
                    FROM auth_users
                    ORDER BY LOWER(username), account_name
                    ON CONFLICT DO NOTHING
                """))
                conn.execute(text("DROP TABLE auth_users CASCADE"))
            conn.execute(text("ALTER TABLE auth_users_new RENAME TO auth_users"))
        else:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS auth_users (
                    username TEXT PRIMARY KEY,
                    password TEXT NOT NULL,
                    role     TEXT NOT NULL DEFAULT 'user'
                )
            """))

        # ── User Access Assignments ────────────────────────────────────
        if _is_sqlite():
            # Migrate if the table was created with PostgreSQL SERIAL syntax (id = NULL for all rows)
            ddl_row = conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='auth_user_access'"
            )).fetchone()
            if ddl_row and "SERIAL" in (ddl_row[0] or "").upper():
                conn.execute(text("""
                    CREATE TABLE auth_user_access_new (
                        id           INTEGER PRIMARY KEY AUTOINCREMENT,
                        username     TEXT NOT NULL,
                        access_level TEXT NOT NULL,
                        cluster_name TEXT,
                        cohort_name  TEXT,
                        account_name TEXT,
                        lob_name     TEXT,
                        permission   TEXT NOT NULL DEFAULT 'read'
                    )
                """))
                conn.execute(text("""
                    INSERT INTO auth_user_access_new
                        (username, access_level, cluster_name, cohort_name, account_name, lob_name, permission)
                    SELECT username, access_level, cluster_name, cohort_name, account_name, lob_name, permission
                    FROM auth_user_access
                """))
                conn.execute(text("DROP TABLE auth_user_access"))
                conn.execute(text("ALTER TABLE auth_user_access_new RENAME TO auth_user_access"))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS auth_user_access (
                        id           INTEGER PRIMARY KEY AUTOINCREMENT,
                        username     TEXT NOT NULL,
                        access_level TEXT NOT NULL,
                        cluster_name TEXT,
                        cohort_name  TEXT,
                        account_name TEXT,
                        lob_name     TEXT,
                        permission   TEXT NOT NULL DEFAULT 'read'
                    )
                """))
        else:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS auth_user_access (
                    id           SERIAL PRIMARY KEY,
                    username     TEXT NOT NULL,
                    access_level TEXT NOT NULL,
                    cluster_name TEXT,
                    cohort_name  TEXT,
                    account_name TEXT,
                    lob_name     TEXT,
                    permission   TEXT NOT NULL DEFAULT 'read'
                )
            """))

        # ── Seed Admin ────────────────────────────────────────────────
        conn.execute(text("INSERT INTO auth_accounts (name) VALUES ('Admin') ON CONFLICT DO NOTHING"))
        conn.execute(text("""
            INSERT INTO auth_users (username, password, role)
            VALUES ('Admin', '123456', 'admin')
            ON CONFLICT (username) DO UPDATE SET role = 'admin'
        """))


# ──────────────────────────────────────────────────────────────────────
# Full data fetch
# ──────────────────────────────────────────────────────────────────────

def get_all_data() -> dict:
    with engine.connect() as conn:
        clusters = conn.execute(text("SELECT name FROM auth_clusters ORDER BY name")).fetchall()
        cohorts  = conn.execute(text("SELECT name, cluster_name FROM auth_cohorts ORDER BY cluster_name, name")).fetchall()
        accs     = conn.execute(text("SELECT name, cluster_name, cohort_name FROM auth_accounts ORDER BY name")).fetchall()
        lobs     = conn.execute(text("SELECT name, account_name FROM auth_lobs ORDER BY account_name, name")).fetchall()
        users    = conn.execute(text("SELECT username, role FROM auth_users ORDER BY username")).fetchall()
        accesses = conn.execute(text("""
            SELECT id, username, access_level, cluster_name, cohort_name, account_name, lob_name, permission
            FROM auth_user_access ORDER BY username
        """)).fetchall()

    lob_map = {}
    for r in lobs:
        lob_map.setdefault(r.account_name, []).append(r.name)

    clusters_dict = {r.name: {"cohorts": {}} for r in clusters}
    for r in cohorts:
        if r.cluster_name in clusters_dict:
            clusters_dict[r.cluster_name]["cohorts"][r.name] = {"accounts": {}}

    accounts_flat = {}
    ungrouped     = {}

    for r in accs:
        acc_data = {
            "cluster_name": r.cluster_name,
            "cohort_name":  r.cohort_name,
            "lobs":         lob_map.get(r.name, []),
        }
        accounts_flat[r.name] = acc_data

        if r.cluster_name and r.cohort_name:
            cl = clusters_dict.get(r.cluster_name, {})
            co = cl.get("cohorts", {}).get(r.cohort_name)
            if co is not None:
                co["accounts"][r.name] = acc_data
        else:
            ungrouped[r.name] = acc_data

    users_list = [{"username": r.username, "role": r.role} for r in users]

    access_map = {}
    for r in accesses:
        access_map.setdefault(r.username, []).append({
            "id":           r.id,
            "access_level": r.access_level,
            "cluster_name": r.cluster_name,
            "cohort_name":  r.cohort_name,
            "account_name": r.account_name,
            "lob_name":     r.lob_name,
            "permission":   r.permission,
        })

    return {
        "clusters":   clusters_dict,
        "accounts":   accounts_flat,
        "ungrouped":  ungrouped,
        "users":      users_list,
        "access_map": access_map,
    }


# ──────────────────────────────────────────────────────────────────────
# Clusters
# ──────────────────────────────────────────────────────────────────────

def cluster_exists(name: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(text("SELECT 1 FROM auth_clusters WHERE name=:n"), {"n": name}).fetchone() is not None

def add_cluster(name: str):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO auth_clusters (name) VALUES (:n)"), {"n": name})

def delete_cluster(name: str):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM auth_clusters WHERE name=:n"), {"n": name})


# ──────────────────────────────────────────────────────────────────────
# Cohorts
# ──────────────────────────────────────────────────────────────────────

def cohort_exists(name: str, cluster_name: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT 1 FROM auth_cohorts WHERE name=:n AND cluster_name=:c"),
            {"n": name, "c": cluster_name}
        ).fetchone() is not None

def add_cohort(name: str, cluster_name: str):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO auth_cohorts (name, cluster_name) VALUES (:n, :c)"),
            {"n": name, "c": cluster_name}
        )

def delete_cohort(name: str, cluster_name: str):
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM auth_cohorts WHERE name=:n AND cluster_name=:c"),
            {"n": name, "c": cluster_name}
        )


# ──────────────────────────────────────────────────────────────────────
# Accounts
# ──────────────────────────────────────────────────────────────────────

def account_exists(name: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(text("SELECT 1 FROM auth_accounts WHERE name=:n"), {"n": name}).fetchone() is not None

def add_account(name: str, cluster_name: str = None, cohort_name: str = None):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO auth_accounts (name, cluster_name, cohort_name) VALUES (:n, :c, :co)"),
            {"n": name, "c": cluster_name, "co": cohort_name}
        )

def delete_account(name: str):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM auth_accounts WHERE name=:n"), {"n": name})


# ──────────────────────────────────────────────────────────────────────
# LOBs
# ──────────────────────────────────────────────────────────────────────

def lob_exists(name: str, account_name: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT 1 FROM auth_lobs WHERE name=:n AND account_name=:a"),
            {"n": name, "a": account_name}
        ).fetchone() is not None

def add_lob(name: str, account_name: str):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO auth_lobs (name, account_name) VALUES (:n, :a)"),
            {"n": name, "a": account_name}
        )

def delete_lob(name: str, account_name: str):
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM auth_lobs WHERE name=:n AND account_name=:a"),
            {"n": name, "a": account_name}
        )

def get_lobs_in_account(account_name: str) -> list:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT name FROM auth_lobs WHERE account_name=:a ORDER BY name"),
            {"a": account_name}
        ).fetchall()
    return [r.name for r in rows]


# ──────────────────────────────────────────────────────────────────────
# Global Users
# ──────────────────────────────────────────────────────────────────────

def user_exists(username: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT 1 FROM auth_users WHERE LOWER(username)=LOWER(:u)"),
            {"u": username}
        ).fetchone() is not None

def add_user(username: str, password: str, role: str = "user"):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO auth_users (username, password, role) VALUES (:u, :p, :r)"),
            {"u": username, "p": password, "r": role}
        )

def delete_user(username: str):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM auth_users WHERE username=:u"), {"u": username})

def update_password(username: str, password: str):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE auth_users SET password=:p WHERE username=:u"),
            {"p": password, "u": username}
        )


# ──────────────────────────────────────────────────────────────────────
# User Access Assignments
# ──────────────────────────────────────────────────────────────────────

def add_user_access(username: str, access_level: str,
                    cluster_name: str = None, cohort_name: str = None,
                    account_name: str = None, lob_name: str = None,
                    permission: str = "read"):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO auth_user_access
                (username, access_level, cluster_name, cohort_name, account_name, lob_name, permission)
            VALUES (:u, :al, :cl, :co, :ac, :lb, :pm)
        """), {"u": username, "al": access_level, "cl": cluster_name,
               "co": cohort_name, "ac": account_name, "lb": lob_name, "pm": permission})

def remove_user_access(access_id: int):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM auth_user_access WHERE id=:id"), {"id": access_id})

def get_user_access(username: str) -> list:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, access_level, cluster_name, cohort_name, account_name, lob_name, permission FROM auth_user_access WHERE username=:u"),
            {"u": username}
        ).fetchall()
    return [{"id": r.id, "access_level": r.access_level, "cluster_name": r.cluster_name,
             "cohort_name": r.cohort_name, "account_name": r.account_name,
             "lob_name": r.lob_name, "permission": r.permission} for r in rows]


def _resolve_accessible_workspaces(username: str) -> list:
    """Resolve all (account, lob, permission) tuples a user can access."""
    accesses = get_user_access(username)
    result   = []
    seen     = set()

    for a in accesses:
        level = a["access_level"]
        perm  = a["permission"]

        if level == "cluster":
            with engine.connect() as conn:
                accs = conn.execute(
                    text("SELECT name FROM auth_accounts WHERE cluster_name=:c ORDER BY name"),
                    {"c": a["cluster_name"]}
                ).fetchall()
            for acc in accs:
                _add_account_workspaces(acc.name, perm, result, seen)

        elif level == "cohort":
            with engine.connect() as conn:
                accs = conn.execute(
                    text("SELECT name FROM auth_accounts WHERE cohort_name=:co AND cluster_name=:cl ORDER BY name"),
                    {"co": a["cohort_name"], "cl": a["cluster_name"]}
                ).fetchall()
            for acc in accs:
                _add_account_workspaces(acc.name, perm, result, seen)

        elif level == "account":
            _add_account_workspaces(a["account_name"], perm, result, seen)

        elif level == "lob":
            key = (a["account_name"], a["lob_name"])
            if key not in seen:
                seen.add(key)
                result.append({"account": a["account_name"], "lob": a["lob_name"], "permission": perm})

    return result


def _add_account_workspaces(account_name: str, perm: str, result: list, seen: set):
    lobs = get_lobs_in_account(account_name)
    if lobs:
        for lob in lobs:
            key = (account_name, lob)
            if key not in seen:
                seen.add(key)
                result.append({"account": account_name, "lob": lob, "permission": perm})
    else:
        key = (account_name, None)
        if key not in seen:
            seen.add(key)
            result.append({"account": account_name, "lob": None, "permission": perm})


# ──────────────────────────────────────────────────────────────────────
# Login
# ──────────────────────────────────────────────────────────────────────

def validate_login(username: str, password: str):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT username, role FROM auth_users WHERE LOWER(username)=LOWER(:u) AND password=:p"),
            {"u": username, "p": password}
        ).fetchone()
    if not row:
        return None

    if row.role == "admin":
        return {
            "username":    row.username,
            "role":        "admin",
            "workspaces":  [],   # admin sees everything via special flag
        }

    workspaces = _resolve_accessible_workspaces(row.username)
    return {
        "username":   row.username,
        "role":       row.role,
        "workspaces": workspaces,
    }
