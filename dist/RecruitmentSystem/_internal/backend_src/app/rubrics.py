from __future__ import annotations

from datetime import datetime
from difflib import SequenceMatcher
import hashlib
import json
import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from app.pg_sheets import engine
from app.talentnext_catalog import catalog, normalize_text


VALID_STATUSES = {"draft", "active", "archived", "needs_changes"}
VALID_REVIEWER_TYPES = {"L1", "L2", "Client"}
VALID_DECISIONS = {"approved", "needs_changes"}
VALID_LEVELS = {"Beginner", "Competent", "Expert"}
VALID_CATEGORIES = {"technical", "non_technical", "competency"}

JD_SKILL_ALIASES = [
    ("Python", ["python"]),
    ("SQL", ["sql"]),
    ("AWS", ["aws", "amazon web services"]),
    ("AWS Glue", ["aws glue", "glue"]),
    ("AWS Lambda", ["aws lambda", "lambda"]),
    ("Amazon S3", ["amazon s3", "s3"]),
    ("Amazon Redshift", ["amazon redshift", "redshift"]),
    ("IAM", ["iam", "identity and access management"]),
    ("Apache Spark", ["apache spark", "spark", "pyspark"]),
    ("Apache Airflow", ["apache airflow", "airflow"]),
    ("Docker", ["docker", "containerization", "containers"]),
    ("CI/CD", ["ci/cd", "ci cd", "continuous integration", "continuous delivery", "continuous deployment"]),
    ("ETL Development", ["etl", "data pipeline", "data pipelines"]),
    ("Data Quality", ["data quality", "quality practices", "reliable pipelines"]),
    ("Machine Learning", ["machine learning", "ml", "model deployment", "feature pipelines"]),
    ("Stakeholder Communication", ["stakeholder communication", "stakeholders", "communication"]),
    ("Technical Documentation", ["technical documentation", "documentation"]),
    ("Production Troubleshooting", ["production troubleshooting", "troubleshooting", "incident response"]),
    ("Mentoring", ["mentoring", "mentor junior", "mentor"]),
    ("Architecture Decision-Making", ["architecture decision", "architecture decision-making", "tradeoff analysis", "architecture"]),
    ("Ownership", ["ownership", "delivery risks", "delivery risk"]),
]


def init_rubric_tables() -> None:
    if engine.dialect.name == "sqlite":
        id_column = "INTEGER PRIMARY KEY AUTOINCREMENT"
        number_column = "REAL"
    else:
        id_column = "SERIAL PRIMARY KEY"
        number_column = "DOUBLE PRECISION"
    statements = [
        f"""
        CREATE TABLE IF NOT EXISTS scoring_rubrics (
            id {id_column},
            position_code TEXT,
            role TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'draft',
            source_jd_hash TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS scoring_rubric_items (
            id {id_column},
            rubric_id INTEGER NOT NULL REFERENCES scoring_rubrics(id) ON DELETE CASCADE,
            category TEXT NOT NULL,
            skill TEXT NOT NULL,
            required_level TEXT NOT NULL,
            weight {number_column} NOT NULL DEFAULT 0,
            beginner_benchmark TEXT,
            competent_benchmark TEXT,
            expert_benchmark TEXT,
            evidence_guidance TEXT,
            created_at TEXT NOT NULL
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS rubric_validations (
            id {id_column},
            rubric_id INTEGER NOT NULL REFERENCES scoring_rubrics(id) ON DELETE CASCADE,
            reviewer_type TEXT NOT NULL,
            reviewer_name TEXT,
            decision TEXT NOT NULL,
            comments TEXT,
            recalibration TEXT,
            created_at TEXT NOT NULL
        )
        """,
        f"""
        CREATE TABLE IF NOT EXISTS candidate_rubric_scores (
            id {id_column},
            candidate_name TEXT NOT NULL,
            role TEXT NOT NULL,
            position_code TEXT,
            stage TEXT,
            scorer TEXT,
            reviewer_type TEXT,
            rubric_id INTEGER NOT NULL REFERENCES scoring_rubrics(id),
            rubric_version INTEGER NOT NULL,
            overall_score {number_column} NOT NULL DEFAULT 0,
            recommendation TEXT,
            item_scores TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
    ]
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def create_draft_rubric(payload: dict) -> dict:
    role = clean(payload.get("role"))
    position_code = clean(payload.get("position_code"))
    job_description = clean(payload.get("job_description"))
    skills = payload.get("skills") or []
    if not role:
        raise HTTPException(status_code=400, detail="role is required")

    items = payload.get("items")
    if not items:
        items = _items_from_skills(skills, job_description)
    items = _normalize_items(items)
    now = datetime.now().isoformat()
    source_hash = hashlib.sha256(f"{role}|{position_code}|{job_description}|{json.dumps(skills, sort_keys=True)}".encode()).hexdigest()

    with engine.begin() as conn:
        version = _next_version(conn, role, position_code)
        rubric_id = conn.execute(
            text(
                """
                INSERT INTO scoring_rubrics (position_code, role, version, status, source_jd_hash, created_at, updated_at)
                VALUES (:position_code, :role, :version, 'draft', :source_jd_hash, :created_at, :updated_at)
                RETURNING id
                """
            ),
            {
                "position_code": position_code,
                "role": role,
                "version": version,
                "source_jd_hash": source_hash,
                "created_at": now,
                "updated_at": now,
            },
        ).scalar_one()
        _insert_items(conn, rubric_id, items, now)
    return get_rubric(rubric_id)


def list_rubrics(role: str = "", position_code: str = "") -> list[dict]:
    where, params = _role_position_filter(role, position_code)
    sql = "SELECT * FROM scoring_rubrics"
    if where:
        sql += " WHERE " + where
    sql += " ORDER BY role, position_code, version DESC, id DESC"
    with engine.connect() as conn:
        rows = [dict(row._mapping) for row in conn.execute(text(sql), params)]
    return [hydrate_rubric(row["id"]) for row in rows]


def get_rubric(rubric_id: int) -> dict:
    rubric = hydrate_rubric(rubric_id)
    if not rubric:
        raise HTTPException(status_code=404, detail="Rubric not found")
    return rubric


def get_active_rubric(role: str = "", position_code: str = "") -> dict:
    where, params = _role_position_filter(role, position_code)
    if not where:
        raise HTTPException(status_code=400, detail="role or position_code is required")
    sql = f"SELECT id FROM scoring_rubrics WHERE status = 'active' AND {where} ORDER BY version DESC, id DESC LIMIT 1"
    with engine.connect() as conn:
        rubric_id = conn.execute(text(sql), params).scalar()
    if not rubric_id:
        raise HTTPException(status_code=404, detail="No active rubric found")
    return get_rubric(int(rubric_id))


def update_rubric(rubric_id: int, payload: dict) -> dict:
    rubric = get_rubric(rubric_id)
    if rubric["status"] == "archived":
        raise HTTPException(status_code=400, detail="Archived rubrics cannot be edited")

    role = clean(payload.get("role", rubric["role"]))
    position_code = clean(payload.get("position_code", rubric.get("position_code", "")))
    status = clean(payload.get("status", rubric["status"])) or rubric["status"]
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid rubric status")
    items = _normalize_items(payload.get("items", rubric["items"]))
    now = datetime.now().isoformat()

    with engine.begin() as conn:
        conn.execute(
            text("UPDATE scoring_rubrics SET role=:role, position_code=:position_code, status=:status, updated_at=:updated_at WHERE id=:id"),
            {"id": rubric_id, "role": role, "position_code": position_code, "status": status, "updated_at": now},
        )
        conn.execute(text("DELETE FROM scoring_rubric_items WHERE rubric_id=:rubric_id"), {"rubric_id": rubric_id})
        _insert_items(conn, rubric_id, items, now)
    return get_rubric(rubric_id)


def validate_rubric(rubric_id: int, payload: dict) -> dict:
    get_rubric(rubric_id)
    reviewer_type = clean(payload.get("reviewer_type"))
    decision = clean(payload.get("decision"))
    if reviewer_type not in VALID_REVIEWER_TYPES:
        raise HTTPException(status_code=400, detail="reviewer_type must be L1, L2, or Client")
    if decision not in VALID_DECISIONS:
        raise HTTPException(status_code=400, detail="decision must be approved or needs_changes")
    now = datetime.now().isoformat()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO rubric_validations (rubric_id, reviewer_type, reviewer_name, decision, comments, recalibration, created_at)
                VALUES (:rubric_id, :reviewer_type, :reviewer_name, :decision, :comments, :recalibration, :created_at)
                """
            ),
            {
                "rubric_id": rubric_id,
                "reviewer_type": reviewer_type,
                "reviewer_name": clean(payload.get("reviewer_name")),
                "decision": decision,
                "comments": clean(payload.get("comments")),
                "recalibration": json.dumps(payload.get("recalibration") or {}),
                "created_at": now,
            },
        )
        if decision == "needs_changes":
            conn.execute(
                text("UPDATE scoring_rubrics SET status='needs_changes', updated_at=:updated_at WHERE id=:id"),
                {"id": rubric_id, "updated_at": now},
            )
    return get_rubric(rubric_id)


def activate_rubric(rubric_id: int) -> dict:
    rubric = get_rubric(rubric_id)
    now = datetime.now().isoformat()
    with engine.begin() as conn:
        where, params = _role_position_filter(rubric["role"], rubric.get("position_code", ""))
        params["id"] = rubric_id
        params["updated_at"] = now
        conn.execute(
            text(f"UPDATE scoring_rubrics SET status='archived', updated_at=:updated_at WHERE status='active' AND id<>:id AND {where}"),
            params,
        )
        conn.execute(
            text("UPDATE scoring_rubrics SET status='active', updated_at=:updated_at WHERE id=:id"),
            {"id": rubric_id, "updated_at": now},
        )
    return get_rubric(rubric_id)


def save_candidate_score(payload: dict) -> dict:
    candidate_name = clean(payload.get("candidate_name"))
    role = clean(payload.get("role"))
    if not candidate_name or not role:
        raise HTTPException(status_code=400, detail="candidate_name and role are required")
    rubric_id = int(payload.get("rubric_id") or 0)
    rubric = get_rubric(rubric_id) if rubric_id else get_active_rubric(role, clean(payload.get("position_code")))
    item_scores = _normalized_item_scores(payload.get("item_scores") or [], rubric["items"])
    overall = _overall_from_item_scores(item_scores, rubric["items"])
    now = datetime.now().isoformat()
    with engine.begin() as conn:
        values = {
            "candidate_name": candidate_name,
            "role": role,
            "position_code": clean(payload.get("position_code")),
            "stage": clean(payload.get("stage")),
            "scorer": clean(payload.get("scorer")),
            "reviewer_type": clean(payload.get("reviewer_type")),
            "rubric_id": rubric["id"],
            "rubric_version": rubric["version"],
            "overall_score": overall,
            "recommendation": clean(payload.get("recommendation")),
            "item_scores": json.dumps(item_scores),
            "notes": clean(payload.get("notes")),
            "created_at": now,
            "updated_at": now,
        }
        existing_id = conn.execute(
            text(
                """
                SELECT id FROM candidate_rubric_scores
                WHERE LOWER(candidate_name)=LOWER(:candidate_name)
                  AND LOWER(role)=LOWER(:role)
                  AND LOWER(COALESCE(stage,''))=LOWER(:stage)
                  AND rubric_id=:rubric_id
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """
            ),
            values,
        ).scalar()
        if existing_id:
            values["id"] = int(existing_id)
            conn.execute(
                text(
                    """
                    UPDATE candidate_rubric_scores
                    SET position_code=:position_code, scorer=:scorer, reviewer_type=:reviewer_type,
                        rubric_version=:rubric_version, overall_score=:overall_score,
                        recommendation=:recommendation, item_scores=:item_scores, notes=:notes,
                        updated_at=:updated_at
                    WHERE id=:id
                    """
                ),
                values,
            )
            score_id = int(existing_id)
        else:
            score_id = conn.execute(
                text(
                    """
                    INSERT INTO candidate_rubric_scores (
                        candidate_name, role, position_code, stage, scorer, reviewer_type, rubric_id, rubric_version,
                        overall_score, recommendation, item_scores, notes, created_at, updated_at
                    )
                    VALUES (
                        :candidate_name, :role, :position_code, :stage, :scorer, :reviewer_type, :rubric_id, :rubric_version,
                        :overall_score, :recommendation, :item_scores, :notes, :created_at, :updated_at
                    )
                    RETURNING id
                    """
                ),
                values,
            ).scalar_one()
    return get_candidate_score_by_id(int(score_id))


def list_candidate_scores(candidate_name: str = "", role: str = "", stage: str = "") -> list[dict]:
    clauses = []
    params = {}
    if clean(candidate_name):
        clauses.append("LOWER(candidate_name)=LOWER(:candidate_name)")
        params["candidate_name"] = clean(candidate_name)
    if clean(role):
        clauses.append("LOWER(role)=LOWER(:role)")
        params["role"] = clean(role)
    if clean(stage):
        clauses.append("LOWER(stage)=LOWER(:stage)")
        params["stage"] = clean(stage)
    sql = "SELECT * FROM candidate_rubric_scores"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY created_at DESC, id DESC"
    with engine.connect() as conn:
        rows = [serialize_score(dict(row._mapping)) for row in conn.execute(text(sql), params)]
    return rows


def rubric_score_for_resume(resume_text: str, role: str = "", position_code: str = "", position_context: str = "") -> dict | None:
    try:
        rubric = get_active_rubric(role, position_code)
    except HTTPException:
        return None
    return compute_skill_gap(resume_text, rubric, position_context=position_context)


def compute_skill_gap(resume_text: str, rubric: dict, position_context: str = "") -> dict:
    text_norm = normalize_text(resume_text)
    context_terms = _learning_context_terms(position_context, rubric)
    groups = {"technical": [], "non_technical": [], "competency": []}
    total_weight = 0.0
    earned = 0.0
    for item in rubric["items"]:
        skill = item["skill"]
        category = item["category"]
        required_level = item["required_level"]
        weight = float(item.get("weight") or 0)
        total_weight += weight
        evidence = _evidence_for_skill(resume_text, skill)
        observed_level = _observed_level(text_norm, skill, evidence)
        score_ratio = _level_ratio(required_level, observed_level)
        item_score = round(weight * score_ratio, 2)
        earned += item_score
        gap_type = "met" if score_ratio >= 1 else "below_level" if evidence else "missing"
        recommendations = []
        if gap_type != "met":
            raw_recommendations = catalog.recommend(
                skill=skill,
                category=_catalog_category_hint(item),
                required_level=required_level,
                gap_type=gap_type,
                limit=10,
            )
            recommendations = _ai_filter_catalog_courses(
                item=item,
                courses=raw_recommendations,
                gap_type=gap_type,
                resume_text=resume_text,
                context_terms=context_terms,
                limit=3,
            )
        gap = {
            "rubric_item_id": item["id"],
            "skill": skill,
            "category": category,
            "required_level": required_level,
            "observed_level": observed_level,
            "weight": weight,
            "score": item_score,
            "gap_type": gap_type,
            "evidence": evidence[:3],
            "recommendations": recommendations,
        }
        groups.setdefault(category, []).append(gap)
    overall = round((earned / total_weight) * 100, 1) if total_weight else 0
    all_items = [item for values in groups.values() for item in values]
    missing = [item for item in all_items if item["gap_type"] != "met"]
    recommendations = sorted([
        {
            "skill": item["skill"],
            "category": item["category"],
            "gap_type": item["gap_type"],
            "required_level": item["required_level"],
            "observed_level": item["observed_level"],
            "priority_score": _gap_priority(item),
            "match_confidence": max((rec.get("match_confidence", 0) for rec in item["recommendations"]), default=0),
            "recommendations": item["recommendations"],
        }
        for item in missing
        if item["recommendations"]
    ], key=lambda item: (item["priority_score"], item["match_confidence"]), reverse=True)
    return {
        "rubric": {
            "id": rubric["id"],
            "role": rubric["role"],
            "position_code": rubric.get("position_code", ""),
            "version": rubric["version"],
            "status": rubric["status"],
        },
        "overall": overall,
        "groups": groups,
        "gaps": missing,
        "recommendations": recommendations,
        "ai_course_recommendations": recommendations,
        "course_filter": {
            "method": "skill_gap_position_context_ranker",
            "inputs": ["resume evidence", "active rubric gaps", "position job description", "TalentNext catalog"],
        },
        "catalog_status": catalog.status(),
        "summary": _gap_summary(overall, missing),
    }


def hydrate_rubric(rubric_id: int) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM scoring_rubrics WHERE id=:id"), {"id": rubric_id}).first()
        if not row:
            return {}
        rubric = dict(row._mapping)
        items = [
            dict(item._mapping)
            for item in conn.execute(
                text("SELECT * FROM scoring_rubric_items WHERE rubric_id=:rubric_id ORDER BY id"),
                {"rubric_id": rubric_id},
            )
        ]
        validations = [
            serialize_validation(dict(item._mapping))
            for item in conn.execute(
                text("SELECT * FROM rubric_validations WHERE rubric_id=:rubric_id ORDER BY created_at DESC, id DESC"),
                {"rubric_id": rubric_id},
            )
        ]
    rubric["items"] = items
    rubric["validations"] = validations
    return rubric


def get_candidate_score_by_id(score_id: int) -> dict:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM candidate_rubric_scores WHERE id=:id"), {"id": score_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Candidate rubric score not found")
    return serialize_score(dict(row._mapping))


def serialize_validation(row: dict) -> dict:
    row["recalibration"] = parse_json(row.get("recalibration"), {})
    return row


def serialize_score(row: dict) -> dict:
    raw_scores = parse_json(row.get("item_scores"), [])
    try:
        rubric = get_rubric(int(row.get("rubric_id") or 0))
        row["item_scores"] = _normalized_item_scores(raw_scores, rubric.get("items", []))
    except Exception:
        row["item_scores"] = raw_scores
    return row


def parse_json(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value or "")
    except Exception:
        return fallback


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _items_from_skills(skills: list, job_description: str = "") -> list[dict]:
    clean_skills = [clean(skill) for skill in skills if clean(skill)]
    if not clean_skills and job_description:
        clean_skills = _extract_skill_candidates(job_description)
    if not clean_skills:
        clean_skills = ["Role fundamentals", "Communication", "Problem solving"]
    weights = _percentage_weights(len(clean_skills))
    return [
        {
            "category": _infer_category(skill),
            "skill": skill,
            "required_level": _infer_required_level(skill, job_description),
            "weight": weights[index],
            "beginner_benchmark": f"Has basic exposure to {skill}.",
            "competent_benchmark": f"Can apply {skill} independently in delivery work.",
            "expert_benchmark": f"Can design, optimize, or mentor others on {skill}.",
            "evidence_guidance": f"Look for concrete resume or interview evidence of {skill}.",
        }
        for index, skill in enumerate(clean_skills)
    ]


def _extract_skill_candidates(job_description: str) -> list[str]:
    jd_norm = normalize_text(job_description)
    candidates: list[str] = []

    def add(value: str) -> None:
        value = clean(value).strip(" .,-")
        if not value:
            return
        key = normalize_text(value)
        if key and all(normalize_text(existing) != key for existing in candidates):
            candidates.append(value)

    for canonical, aliases in JD_SKILL_ALIASES:
        if any(_phrase_in_text(alias, jd_norm) for alias in aliases):
            add(canonical)

    for row in catalog.rows:
        skill = clean(row.sub_skill)
        skill_norm = normalize_text(skill)
        if not _catalog_skill_is_jd_metric(skill_norm):
            continue
        if _phrase_in_text(skill_norm, jd_norm):
            add(skill)

    if candidates:
        return _trim_skill_candidates(candidates)

    phrases = re.findall(r"\b(?:[A-Z][A-Za-z0-9+#.]*(?:\s+|$)){1,4}", job_description)
    blocked = {"the", "and", "for", "with", "role", "experience", "candidate", "skills", "required"}
    for phrase in phrases:
        value = clean(phrase).strip(" .,-")
        if len(value) < 3 or value.lower() in blocked:
            continue
        add(value)
        if len(candidates) >= 8:
            break
    return candidates


def _trim_skill_candidates(candidates: list[str], limit: int = 22) -> list[str]:
    technical = [skill for skill in candidates if _infer_category(skill) == "technical"]
    behavioral = [skill for skill in candidates if _infer_category(skill) != "technical"]
    if len(candidates) <= limit:
        return candidates
    behavioral_limit = min(len(behavioral), 6)
    technical_limit = max(limit - behavioral_limit, 0)
    selected = technical[:technical_limit] + behavioral[:behavioral_limit]
    return selected[:limit]


def _normalize_items(items: list[dict]) -> list[dict]:
    normalized = []
    for raw in items or []:
        item = {
            "category": clean(raw.get("category") or "technical"),
            "skill": clean(raw.get("skill") or raw.get("name")),
            "required_level": clean(raw.get("required_level") or "Competent"),
            "weight": float(raw.get("weight") or 0),
            "beginner_benchmark": clean(raw.get("beginner_benchmark")),
            "competent_benchmark": clean(raw.get("competent_benchmark")),
            "expert_benchmark": clean(raw.get("expert_benchmark")),
            "evidence_guidance": clean(raw.get("evidence_guidance")),
        }
        if item["category"] not in VALID_CATEGORIES:
            item["category"] = _infer_category(item["skill"])
        if item["required_level"] not in VALID_LEVELS:
            item["required_level"] = "Competent"
        if not item["skill"]:
            continue
        normalized.append(item)
    if not normalized:
        raise HTTPException(status_code=400, detail="At least one rubric item is required")
    total = sum(float(item["weight"] or 0) for item in normalized)
    if total <= 0:
        for item, weight in zip(normalized, _percentage_weights(len(normalized))):
            item["weight"] = weight
    elif abs(total - 100) > 0.01:
        raise HTTPException(status_code=400, detail=f"Rubric weights must total 100%. Current total is {round(total, 2)}%.")
    return normalized


def _percentage_weights(count: int) -> list[float]:
    if count <= 0:
        return []
    base = round(100 / count, 2)
    weights = [base for _ in range(count)]
    weights[-1] = round(100 - sum(weights[:-1]), 2)
    return weights


def _insert_items(conn, rubric_id: int, items: list[dict], now: str) -> None:
    for item in items:
        conn.execute(
            text(
                """
                INSERT INTO scoring_rubric_items (
                    rubric_id, category, skill, required_level, weight, beginner_benchmark,
                    competent_benchmark, expert_benchmark, evidence_guidance, created_at
                )
                VALUES (
                    :rubric_id, :category, :skill, :required_level, :weight, :beginner_benchmark,
                    :competent_benchmark, :expert_benchmark, :evidence_guidance, :created_at
                )
                """
            ),
            {**item, "rubric_id": rubric_id, "created_at": now},
        )


def _next_version(conn, role: str, position_code: str) -> int:
    where, params = _role_position_filter(role, position_code)
    sql = "SELECT COALESCE(MAX(version), 0) + 1 FROM scoring_rubrics"
    if where:
        sql += " WHERE " + where
    return int(conn.execute(text(sql), params).scalar() or 1)


def _role_position_filter(role: str = "", position_code: str = "") -> tuple[str, dict]:
    role = clean(role)
    position_code = clean(position_code)
    clauses = []
    params = {}
    if position_code:
        clauses.append("LOWER(COALESCE(position_code,'')) = LOWER(:position_code)")
        params["position_code"] = position_code
    if role:
        clauses.append("LOWER(role) = LOWER(:role)")
        params["role"] = role
    return " AND ".join(clauses), params


def _infer_category(skill: str) -> str:
    low = normalize_text(skill)
    if any(term in low for term in ["communication", "stakeholder", "presentation", "documentation", "collaboration"]):
        return "non_technical"
    if any(term in low for term in ["architecture", "leadership", "problem", "design", "mentor", "ownership", "troubleshooting"]):
        return "competency"
    return "technical"


def _infer_required_level(skill: str, job_description: str = "") -> str:
    skill_norm = normalize_text(skill)
    if any(term in skill_norm for term in ["architecture", "mentor", "mentoring", "ownership", "leadership"]):
        return "Expert"
    if _infer_category(skill) == "non_technical":
        return "Competent"
    context = normalize_text(_context_for_skill(job_description, skill))
    if any(term in context for term in ["expert", "architect", "architecture", "lead", "mentor", "mentoring", "optimize", "tradeoff"]):
        return "Expert"
    if any(term in context for term in ["required", "requires", "build", "develop", "design", "deploy", "production", "troubleshoot"]):
        return "Competent"
    return "Competent"


def _context_for_skill(job_description: str, skill: str) -> str:
    skill_norm = normalize_text(skill)
    for part in re.split(r"[\n\r.;:]", job_description or ""):
        if skill_norm and skill_norm in normalize_text(part):
            return part
    for canonical, aliases in JD_SKILL_ALIASES:
        if skill_norm == normalize_text(canonical):
            for part in re.split(r"[\n\r.;:]", job_description or ""):
                part_norm = normalize_text(part)
                if any(_phrase_in_text(alias, part_norm) for alias in aliases):
                    return part
    return job_description or ""


def _phrase_in_text(phrase: str, text_norm: str) -> bool:
    phrase_norm = normalize_text(phrase)
    if not phrase_norm:
        return False
    pattern = r"(?<![a-z0-9+#.])" + re.escape(phrase_norm) + r"(?![a-z0-9+#.])"
    return bool(re.search(pattern, text_norm))


def _catalog_skill_is_jd_metric(skill_norm: str) -> bool:
    if not skill_norm or len(skill_norm) < 3:
        return False
    blocked = ["fundamentals", "essentials", "bootcamp", "certified", "certification", "exam", "learning plan", "capstone"]
    if any(term in skill_norm for term in blocked):
        return False
    return len(skill_norm.split()) <= 4


def _catalog_category_hint(item: dict) -> str:
    skill = item.get("skill", "")
    skill_norm = normalize_text(skill)
    for row in catalog.rows:
        if normalize_text(row.sub_skill) == skill_norm:
            return row.category
    return skill


LEARNING_STOP_WORDS = {
    "and", "the", "for", "with", "from", "into", "using", "your", "you", "are", "can",
    "skill", "skills", "required", "require", "level", "course", "training", "learn",
    "developer", "engineer", "technical", "associate", "certified", "certification",
    "essentials", "fundamentals", "beginner", "advanced", "professional",
}


def _learning_context_terms(position_context: str, rubric: dict) -> set[str]:
    text = " ".join([
        position_context or "",
        rubric.get("role", ""),
        rubric.get("position_code", ""),
        " ".join(str(item.get("skill", "")) for item in rubric.get("items", [])),
    ])
    return _important_terms(text)


def _important_terms(value: str) -> set[str]:
    terms = set()
    for token in re.findall(r"[a-z0-9+#.]+", normalize_text(value or "")):
        if len(token) < 3 or token in LEARNING_STOP_WORDS:
            continue
        terms.add(token)
    joined = normalize_text(value or "")
    for phrase in ("ci cd", "machine learning", "data quality", "rest api", "rest apis", "state management", "micro frontend"):
        if phrase in joined:
            terms.add(phrase)
    return terms


def _gap_priority(item: dict) -> float:
    gap_bonus = {"missing": 0.32, "below_level": 0.22}.get(item.get("gap_type"), 0)
    level_bonus = {"Expert": 0.18, "Competent": 0.12, "Beginner": 0.05}.get(item.get("required_level"), 0.1)
    category_bonus = {"technical": 0.08, "competency": 0.06, "non_technical": 0.04}.get(item.get("category"), 0.04)
    return round(float(item.get("weight") or 0) / 100 + gap_bonus + level_bonus + category_bonus, 3)


def _ai_filter_catalog_courses(
    item: dict,
    courses: list[dict],
    gap_type: str,
    resume_text: str,
    context_terms: set[str],
    limit: int = 3,
) -> list[dict]:
    skill = item.get("skill", "")
    skill_norm = normalize_text(skill)
    skill_terms = _important_terms(skill)
    resume_terms = _important_terms(resume_text)
    target_prof = _target_proficiency(item.get("required_level", ""), gap_type)
    ranked = []
    seen = set()

    for course in courses:
        title = clean(course.get("sub_skill"))
        title_norm = normalize_text(title)
        if not title_norm or title_norm in seen:
            continue
        seen.add(title_norm)

        course_terms = _important_terms(" ".join([
            title,
            course.get("category", ""),
            course.get("nomination_type", ""),
            course.get("proficiency", ""),
        ]))
        skill_overlap = skill_terms & course_terms
        context_overlap = context_terms & course_terms
        resume_overlap = resume_terms & course_terms
        fuzzy = SequenceMatcher(None, skill_norm, title_norm).ratio() if skill_norm and title_norm else 0
        exact_or_contains = bool(skill_norm and (skill_norm == title_norm or skill_norm in title_norm or title_norm in skill_norm))

        score = float(course.get("match_confidence") or 0) * 0.42
        if exact_or_contains:
            score += 0.24
        elif skill_overlap:
            score += min(0.2, 0.07 * len(skill_overlap))
        elif fuzzy >= 0.72:
            score += 0.14
        elif course.get("match_reason") == "Category fallback":
            score -= 0.08

        score += min(0.18, 0.035 * len(context_overlap))
        score += min(0.08, 0.02 * len(resume_overlap))
        if normalize_text(course.get("proficiency")) == normalize_text(target_prof):
            score += 0.08
        elif course.get("proficiency") == "S1" and gap_type == "missing":
            score += 0.04
        if str(course.get("nomination_type", "")).lower() == "on-demand":
            score += 0.05
        if item.get("required_level") == "Expert" and str(course.get("nomination_type", "")).lower() == "sprint-based":
            score += 0.05

        reasons = []
        if exact_or_contains or skill_overlap or fuzzy >= 0.72:
            reasons.append("skill-gap aligned")
        if context_overlap:
            reasons.append("matches JD context: " + ", ".join(sorted(context_overlap)[:3]))
        if normalize_text(course.get("proficiency")) == normalize_text(target_prof):
            reasons.append(f"right proficiency {target_prof}")
        if str(course.get("nomination_type", "")).lower() == "on-demand":
            reasons.append("quick on-demand option")
        if not reasons:
            reasons.append(course.get("match_reason") or "catalog fallback")

        enriched = dict(course)
        enriched["target_proficiency"] = target_prof
        enriched["ai_filter_score"] = round(min(max(score, 0), 1), 3)
        enriched["ai_filter_reason"] = "; ".join(reasons[:3])
        ranked.append(enriched)

    ranked.sort(
        key=lambda course: (
            course.get("ai_filter_score", 0),
            1 if str(course.get("nomination_type", "")).lower() == "on-demand" else 0,
            course.get("match_confidence", 0),
        ),
        reverse=True,
    )
    return ranked[: max(1, min(limit, 5))]


def _target_proficiency(required_level: str, gap_type: str) -> str:
    if gap_type == "missing":
        return "S1"
    if required_level == "Expert":
        return "S3"
    if required_level == "Competent":
        return "S2"
    return "S1"


def _evidence_for_skill(resume_text: str, skill: str) -> list[str]:
    skill_norm = normalize_text(skill)
    evidence = []
    for raw in re.split(r"[\n\r.;]", resume_text or ""):
        line = clean(raw)
        if not line:
            continue
        if skill_norm and skill_norm in normalize_text(line):
            evidence.append(line[:260])
        if len(evidence) >= 3:
            break
    return evidence


def _observed_level(text_norm: str, skill: str, evidence: list[str]) -> str:
    if not evidence:
        return "None"
    skill_norm = normalize_text(skill)
    expert_terms = ["architect", "designed", "led", "lead", "optimized", "mentor", "strategy"]
    competent_terms = ["implemented", "developed", "built", "managed", "integrated", "delivered"]
    nearby = " ".join(evidence).lower()
    if any(term in nearby for term in expert_terms):
        return "Expert"
    if any(term in nearby for term in competent_terms):
        return "Competent"
    if skill_norm in text_norm:
        return "Beginner"
    return "None"


def _level_ratio(required: str, observed: str) -> float:
    rank = {"None": 0, "Beginner": 1, "Competent": 2, "Expert": 3}
    req = max(rank.get(required, 2), 1)
    obs = rank.get(observed, 0)
    return min(1.0, obs / req)


def _overall_from_item_scores(item_scores: list[dict], rubric_items: list[dict]) -> float:
    weights = {int(item["id"]): float(item.get("weight") or 0) for item in rubric_items}
    total_weight = sum(weights.values()) or 100
    earned = 0.0
    for score in item_scores:
        item_id = int(score.get("rubric_item_id") or score.get("item_id") or 0)
        raw_score = _normalize_interviewer_score(score.get("score"))
        if item_id in weights:
            earned += weights[item_id] * raw_score / 10
    return round((earned / total_weight) * 100, 1)


def _normalize_interviewer_score(value: Any) -> float:
    try:
        score = float(value)
    except Exception:
        score = 1.0
    # Backward compatibility for earlier 0-100 saved values.
    if score > 10:
        score = score / 10
    return round(max(1.0, min(score, 10.0)), 1)


def _normalized_item_scores(item_scores: list[dict], rubric_items: list[dict]) -> list[dict]:
    weights = {int(item["id"]): float(item.get("weight") or 0) for item in rubric_items}
    normalized = []
    for item_score in item_scores:
        if not isinstance(item_score, dict):
            continue
        item_id = int(item_score.get("rubric_item_id") or item_score.get("item_id") or 0)
        score = _normalize_interviewer_score(item_score.get("score"))
        weight = weights.get(item_id, 0.0)
        cleaned = dict(item_score)
        cleaned["rubric_item_id"] = item_id
        cleaned["score"] = score
        cleaned["weighted_score"] = round(weight * score / 10, 2)
        normalized.append(cleaned)
    return normalized


def _gap_summary(overall: float, gaps: list[dict]) -> str:
    if not gaps:
        return f"Rubric fit is strong at {overall} with no open skill gaps."
    top = ", ".join(item["skill"] for item in gaps[:3])
    return f"Rubric fit is {overall}. Priority learning gaps: {top}."
