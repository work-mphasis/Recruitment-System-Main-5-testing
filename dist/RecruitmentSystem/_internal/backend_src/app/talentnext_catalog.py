from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
import threading
import re

from openpyxl import load_workbook


REQUIRED_COLUMNS = {
    "sub skill": "sub_skill",
    "proficiency": "proficiency",
    "nomination type": "nomination_type",
    "category": "category",
}


@dataclass
class CatalogRow:
    sub_skill: str
    proficiency: str
    nomination_type: str
    category: str


class TalentNextCatalog:
    def __init__(self, downloads_dir: str | None = None):
        self.downloads_dir = Path(downloads_dir) if downloads_dir else Path.home() / "Downloads"
        self._lock = threading.Lock()
        self._rows: list[CatalogRow] = []
        self._file_path = ""
        self._file_mtime = ""
        self._last_refreshed = ""
        self._error = ""

    @property
    def rows(self) -> list[CatalogRow]:
        with self._lock:
            return list(self._rows)

    def discover_latest_file(self) -> Path | None:
        candidates = [
            path for path in self.downloads_dir.glob("TalentNextCatalog*.xlsx")
            if path.is_file() and not path.name.startswith("~$")
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda item: item.stat().st_mtime)

    def refresh(self) -> dict:
        latest = self.discover_latest_file()
        if latest is None:
            with self._lock:
                self._rows = []
                self._file_path = ""
                self._file_mtime = ""
                self._last_refreshed = datetime.now().isoformat()
                self._error = f"No TalentNextCatalog*.xlsx file found in {self.downloads_dir}"
            return self.status()

        try:
            rows = self._load_rows(latest)
            mtime = datetime.fromtimestamp(latest.stat().st_mtime).isoformat()
            with self._lock:
                self._rows = rows
                self._file_path = str(latest)
                self._file_mtime = mtime
                self._last_refreshed = datetime.now().isoformat()
                self._error = ""
        except Exception as exc:
            with self._lock:
                self._last_refreshed = datetime.now().isoformat()
                self._error = str(exc)
        return self.status()

    def status(self) -> dict:
        with self._lock:
            rows = list(self._rows)
            categories = sorted({row.category for row in rows if row.category})
            proficiencies = {}
            nomination_types = {}
            for row in rows:
                proficiencies[row.proficiency] = proficiencies.get(row.proficiency, 0) + 1
                nomination_types[row.nomination_type] = nomination_types.get(row.nomination_type, 0) + 1
            return {
                "loaded": bool(rows),
                "file_path": self._file_path,
                "file_name": Path(self._file_path).name if self._file_path else "",
                "file_modified_at": self._file_mtime,
                "last_refreshed_at": self._last_refreshed,
                "row_count": len(rows),
                "category_count": len(categories),
                "categories": categories,
                "proficiencies": proficiencies,
                "nomination_types": nomination_types,
                "error": self._error,
            }

    def search(
        self,
        query: str = "",
        category: str = "",
        proficiency: str = "",
        limit: int = 25,
    ) -> list[dict]:
        query_norm = normalize_text(query)
        category_norm = normalize_text(category)
        proficiency_norm = normalize_text(proficiency)
        matches = []
        rows = self.rows
        if not rows:
            self.refresh()
            rows = self.rows
        for row in rows:
            if category_norm and normalize_text(row.category) != category_norm:
                continue
            if proficiency_norm and normalize_text(row.proficiency) != proficiency_norm:
                continue
            if query_norm:
                row_norm = normalize_text(row.sub_skill)
                cat_norm = normalize_text(row.category)
                if query_norm not in row_norm and query_norm not in cat_norm:
                    similarity = SequenceMatcher(None, query_norm, row_norm).ratio()
                    if similarity < 0.58:
                        continue
                else:
                    similarity = 1.0 if query_norm == row_norm else 0.82
            else:
                similarity = 0.5
            matches.append({**asdict(row), "match_score": round(similarity, 3)})
        matches.sort(key=lambda item: item["match_score"], reverse=True)
        return matches[: max(1, min(limit, 100))]

    def recommend(
        self,
        skill: str,
        category: str = "",
        required_level: str = "",
        gap_type: str = "missing",
        limit: int = 5,
    ) -> list[dict]:
        skill_norm = normalize_text(skill)
        category_norm = normalize_text(category)
        target_prof = proficiency_for_gap(required_level, gap_type)
        recommendations = []
        rows = self.rows
        if not rows:
            self.refresh()
            rows = self.rows
        for row in rows:
            row_norm = normalize_text(row.sub_skill)
            cat_norm = normalize_text(row.category)
            if not row_norm:
                continue

            exact = skill_norm and skill_norm == row_norm
            long_enough = len(skill_norm) >= 3 and len(row_norm) >= 3
            contains = bool(long_enough and (skill_norm in row_norm or row_norm in skill_norm))
            fuzzy = SequenceMatcher(None, skill_norm, row_norm).ratio() if long_enough else 0
            fuzzy_match = bool(long_enough and skill_norm[0] == row_norm[0] and fuzzy >= 0.72)
            same_category = bool(category_norm and category_norm == cat_norm)

            if not exact and not contains and not fuzzy_match and not same_category:
                continue

            score = 0.0
            if exact:
                score += 1.0
            elif contains:
                score += 0.78
            else:
                score += fuzzy * 0.65
            if same_category:
                score += 0.18
            if normalize_text(row.proficiency) == normalize_text(target_prof):
                score += 0.08
            if row.nomination_type.lower() == "on-demand":
                score += 0.04
            if "project" in normalize_text(skill) and row.nomination_type.lower() == "sprint-based":
                score += 0.08

            reason = "Exact skill match" if exact else "Related skill match" if contains or fuzzy_match else "Category fallback"
            recommendations.append({
                **asdict(row),
                "match_confidence": round(min(score, 1.0), 3),
                "match_reason": reason,
                "target_proficiency": target_prof,
            })

        recommendations.sort(
            key=lambda item: (
                item["match_confidence"],
                1 if item["nomination_type"].lower() == "on-demand" else 0,
            ),
            reverse=True,
        )
        return recommendations[: max(1, min(limit, 10))]

    def _load_rows(self, path: Path) -> list[CatalogRow]:
        workbook = load_workbook(path, read_only=True, data_only=True)
        worksheet = workbook.worksheets[0]
        header_row = next(worksheet.iter_rows(min_row=1, max_row=1, values_only=True), None)
        if not header_row:
            raise ValueError("TalentNext catalog has no header row")

        header_map = {}
        for index, header in enumerate(header_row):
            key = normalize_header(header)
            if key in REQUIRED_COLUMNS:
                header_map[REQUIRED_COLUMNS[key]] = index

        missing = sorted(set(REQUIRED_COLUMNS.values()) - set(header_map.keys()))
        if missing:
            raise ValueError(f"TalentNext catalog missing required columns: {', '.join(missing)}")

        rows = []
        seen = set()
        for values in worksheet.iter_rows(min_row=2, values_only=True):
            sub_skill = clean_cell(values[header_map["sub_skill"]] if header_map["sub_skill"] < len(values) else "")
            if not sub_skill:
                continue
            row = CatalogRow(
                sub_skill=sub_skill,
                proficiency=clean_cell(values[header_map["proficiency"]] if header_map["proficiency"] < len(values) else ""),
                nomination_type=clean_cell(values[header_map["nomination_type"]] if header_map["nomination_type"] < len(values) else ""),
                category=clean_cell(values[header_map["category"]] if header_map["category"] < len(values) else ""),
            )
            key = tuple(asdict(row).values())
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
        return rows


def clean_cell(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_header(value) -> str:
    return clean_cell(value).lower()


def normalize_text(value: str) -> str:
    cleaned = clean_cell(value).lower()
    cleaned = cleaned.replace("&", " and ")
    cleaned = re.sub(r"[^a-z0-9+#.\s]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def proficiency_for_gap(required_level: str = "", gap_type: str = "") -> str:
    level = normalize_text(required_level)
    gap = normalize_text(gap_type)
    if "expert" in level or "deep" in gap or "critical" in gap:
        return "S*"
    if "competent" in level or "below" in gap:
        return "S2"
    return "S1"


catalog = TalentNextCatalog()
