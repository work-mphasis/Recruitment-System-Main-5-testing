from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
import re

import fitz
import pdfplumber
from docx import Document
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


PARSER_CONFIG = {
    "use_native_first": True,
    "low_confidence_threshold": 0.65,
    "duplicate_similarity_threshold": 0.90,
    "bullet_duplicate_similarity_threshold": 0.92,
    "duplicate_ratio_threshold": 0.15,
    "false_role_threshold": 0.25,
    "role_score_threshold": 3.4,
    "section_score_threshold": 2.2,
    "line_merge_tolerance": 4.5,
    "header_footer_y_threshold": 90.0,
    "top_name_y_threshold": 130.0,
    "column_gap_min": 72.0,
    "allow_ocr_fallback": True,
    "prefer_native_for_clean_text_pdfs": True,
    "native_min_text_length": 120,
    "native_min_line_count": 8,
    "near_duplicate_window": 12,
}

SECTION_KEYWORDS = {
    "summary": {
        "summary",
        "professional summary",
        "profile summary",
        "career summary",
        "overview",
        "profile",
        "about",
    },
    "experience": {
        "experience",
        "work experience",
        "professional experience",
        "employment history",
        "work history",
        "career history",
    },
    "skills": {
        "skills",
        "technical skills",
        "core skills",
        "core competencies",
        "competencies",
        "technical competencies",
        "skills and tools",
        "tools",
    },
    "projects": {
        "projects",
        "project experience",
        "selected projects",
        "project details",
    },
    "education": {
        "education",
        "academic background",
        "education details",
        "qualification",
        "qualifications",
    },
    "certifications": {"certifications", "certificates", "licenses"},
}
ROLE_KEYWORDS = {
    "engineer",
    "developer",
    "designer",
    "architect",
    "analyst",
    "manager",
    "consultant",
    "lead",
    "specialist",
    "associate",
    "administrator",
    "researcher",
    "qa",
    "tester",
}
COMPANY_HINTS = {
    "inc",
    "corp",
    "corporation",
    "llc",
    "ltd",
    "limited",
    "technologies",
    "technology",
    "solutions",
    "systems",
    "services",
    "consulting",
    "consultancy",
    "labs",
    "studio",
    "group",
    "international",
}
SKILL_HINTS = {
    "python",
    "java",
    "javascript",
    "react",
    "angular",
    "sql",
    "aws",
    "azure",
    "figma",
    "jira",
    "confluence",
    "docker",
    "kubernetes",
    "tableau",
    "power bi",
}
DATE_PATTERNS = [
    re.compile(
        r"(?i)\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)"
        r"\s+\d{4}\s*(?:[-–—]|to)\s*(?:present|current|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+\d{4})\b"
    ),
    re.compile(r"(?i)\b\d{1,2}/\d{4}\s*(?:[-–—]|to)\s*(?:present|current|\d{1,2}/\d{4})\b"),
    re.compile(r"(?i)\b\d{4}\s*(?:[-–—]|to)\s*(?:present|current|\d{4})\b"),
]
CONTACT_PATTERN = re.compile(
    r"(?i)(?:\b[\w\.-]+@[\w\.-]+\.\w+\b|https?://\S+|www\.\S+|\b(?:linkedin|github|portfolio|behance)\b|(?:\+?\d[\d\-\s\(\)]{7,}\d))"
)

EXPECTED_SECTION_ORDER = ["summary", "experience", "projects", "skills", "education", "certifications"]


@dataclass
class ExtractedBlock:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    page: int
    column: int = 0

    def as_dict(self) -> dict:
        return {
            "text": self.text,
            "x0": self.x0,
            "y0": self.y0,
            "x1": self.x1,
            "y1": self.y1,
            "page": self.page,
            "column": self.column,
        }


@dataclass
class ExtractedPage:
    blocks: list[ExtractedBlock] = field(default_factory=list)
    width: float = 0.0
    height: float = 0.0


@dataclass
class ExtractedDocument:
    source: str
    pages: list[ExtractedPage] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "pages": [
                {"blocks": [block.as_dict() for block in page.blocks]}
                for page in self.pages
            ],
        }


@dataclass
class ParsedCandidate:
    document: ExtractedDocument
    lines: list[dict]
    classified: dict
    parsed: dict
    validation: dict
    confidence: float
    metrics: dict
    adapter_name: str


class ExtractionAdapter:
    source = "unknown"

    def extract(self, file_path: str) -> ExtractedDocument:
        raise NotImplementedError


class NativePdfAdapter(ExtractionAdapter):
    source = "native"

    def extract(self, file_path: str) -> ExtractedDocument:
        document = _extract_document_with_pymupdf(file_path)
        if _document_text_length(document) >= PARSER_CONFIG["native_min_text_length"]:
            return document
        fallback = _extract_document_with_pdfplumber(file_path)
        if _document_text_length(fallback) > _document_text_length(document):
            return fallback
        return document


class SuryaAdapter(ExtractionAdapter):
    source = "surya"

    def __init__(self, extractor=None):
        self.extractor = extractor

    def extract(self, file_path: str) -> ExtractedDocument:
        if callable(self.extractor):
            return self.extractor(file_path)
        return ExtractedDocument(
            source=self.source,
            metadata={"available": False, "reason": "Surya adapter is not configured."},
        )


class PaddleOcrAdapter(ExtractionAdapter):
    source = "paddleocr"

    def __init__(self, extractor=None):
        self.extractor = extractor

    def extract(self, file_path: str) -> ExtractedDocument:
        if callable(self.extractor):
            return self.extractor(file_path)
        return ExtractedDocument(
            source=self.source,
            metadata={"available": False, "reason": "PaddleOCR adapter is not configured."},
        )


class OcrMyPdfPreprocessor:
    source = "ocrmypdf+native"

    def __init__(self, preprocess=None):
        self.preprocess = preprocess

    def process(self, file_path: str) -> str | None:
        if callable(self.preprocess):
            return self.preprocess(file_path)
        return None


def _compact_spaces(text: str) -> str:
    cleaned = str(text or "").replace("\u200b", " ").replace("\ufeff", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def _normalize_similarity_text(text: str) -> str:
    cleaned = _compact_spaces(text).lower()
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    return _compact_spaces(cleaned)


def _similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, _normalize_similarity_text(left), _normalize_similarity_text(right)).ratio()


def _normalize_name(name: str) -> str:
    cleaned = _compact_spaces(name)
    parts = [part for part in cleaned.split() if part]
    if not parts:
        return "Candidate"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0].upper()}."


def _normalize_heading(text: str) -> str:
    return _normalize_similarity_text(text).strip(":- ")


def _is_heading_line(text: str) -> bool:
    normalized = _normalize_heading(text)
    if normalized in {item for values in SECTION_KEYWORDS.values() for item in values}:
        return True
    cleaned = _compact_spaces(text)
    return cleaned.endswith(":") and len(cleaned.split()) <= 5


def _is_contact_line(text: str) -> bool:
    return bool(CONTACT_PATTERN.search(str(text or "")))


def _clean_bullet_prefix(text: str) -> str:
    return re.sub(r"^(?:[\-\*\u2022\u25AA\u25E6\u27A2]+\s*)+", "", str(text or "")).strip()


def _join_tokens(tokens: list[str]) -> str:
    text = ""
    for token in tokens:
        if not text:
            text = token
            continue
        if token in {".", ",", ";", ":", ")", "]", "}", "%"}:
            text += token
        elif text.endswith(("(", "[", "{", "/", "-")):
            text += token
        else:
            text += f" {token}"
    return _compact_spaces(text)


def _is_skill_like(text: str) -> bool:
    lowered = _normalize_similarity_text(text)
    if not lowered:
        return False
    if sum(1 for hint in SKILL_HINTS if hint in lowered) >= 2:
        return True
    return lowered.count(",") >= 3 or lowered.count("|") >= 2


def _looks_like_name_candidate(text: str) -> bool:
    cleaned = _compact_spaces(text).strip(" ,:-|")
    if not cleaned or len(cleaned) > 60 or _is_contact_line(cleaned) or _is_heading_line(cleaned):
        return False
    if any(ch.isdigit() for ch in cleaned):
        return False
    words = cleaned.split()
    if len(words) < 2 or len(words) > 3:
        return False
    lowered = [word.lower() for word in words]
    if len(lowered) != len(set(lowered)):
        return False
    blocked = {"profile", "summary", "skills", "experience"}
    if any(word.lower().strip(".") in blocked for word in words):
        return False
    return all(re.match(r"^[A-Z][A-Za-z'.-]*$", word) for word in words)


def _looks_like_company(text: str) -> bool:
    cleaned = _compact_spaces(text)
    lowered = cleaned.lower()
    if not cleaned or len(cleaned.split()) > 16 or _is_skill_like(cleaned):
        return False
    stripped = cleaned
    date_range = extract_date_range(cleaned)
    if date_range:
        stripped = cleaned.replace(date_range, "").strip(" |-")
        lowered = stripped.lower()
    if any(hint in lowered for hint in COMPANY_HINTS):
        return True
    words = [word for word in stripped.split() if any(ch.isalpha() for ch in word)]
    if len(words) < 2:
        return False
    title_case_ratio = sum(word[:1].isupper() for word in words) / len(words)
    return title_case_ratio >= 0.8


def _looks_like_role(text: str) -> bool:
    cleaned = _compact_spaces(text).lower()
    if not cleaned or len(cleaned.split()) > 12 or _is_skill_like(cleaned):
        return False
    return any(keyword in cleaned for keyword in ROLE_KEYWORDS)


def _line_y_tolerance(items: list[dict]) -> float:
    heights = [max(1.0, float(item["y1"]) - float(item["y0"])) for item in items]
    if not heights:
        return PARSER_CONFIG["line_merge_tolerance"]
    heights.sort()
    median = heights[len(heights) // 2]
    return max(3.0, min(6.0, median * 0.55))


def extract_date_range(line: str) -> str:
    text = _compact_spaces(line)
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            return _compact_spaces(match.group(0))
    return ""


def detect_columns(blocks: list[dict], page_width: float | None = None) -> list[list[dict]]:
    if len(blocks) < 2:
        return [sorted(blocks, key=lambda item: (item["y0"], item["x0"]))]

    page_width = float(page_width or max(item["x1"] for item in blocks))
    centers = sorted(((item["x0"] + item["x1"]) / 2.0) for item in blocks)
    largest_gap = 0.0
    boundary = None

    for left, right in zip(centers, centers[1:]):
        gap = right - left
        if gap > largest_gap and gap >= max(PARSER_CONFIG["column_gap_min"], page_width * 0.12):
            candidate = (left + right) / 2.0
            left_count = sum(1 for center in centers if center < candidate)
            right_count = len(centers) - left_count
            min_group_size = 1 if len(centers) <= 4 else max(2, len(centers) // 4)
            if left_count >= min_group_size and right_count >= min_group_size:
                largest_gap = gap
                boundary = candidate

    if boundary is None:
        return [sorted(blocks, key=lambda item: (item["y0"], item["x0"]))]

    left_column = [item for item in blocks if ((item["x0"] + item["x1"]) / 2.0) < boundary]
    right_column = [item for item in blocks if ((item["x0"] + item["x1"]) / 2.0) >= boundary]
    return [
        sorted(left_column, key=lambda item: (item["y0"], item["x0"])),
        sorted(right_column, key=lambda item: (item["y0"], item["x0"])),
    ]


def _column_priority(column: list[dict]) -> int:
    score = 0
    for block in column[:12]:
        normalized = _normalize_heading(block.get("text", ""))
        if normalized in SECTION_KEYWORDS["summary"] or normalized in SECTION_KEYWORDS["experience"]:
            score += 3
        elif normalized in SECTION_KEYWORDS["projects"]:
            score += 1
        elif normalized in SECTION_KEYWORDS["skills"] or normalized in SECTION_KEYWORDS["education"] or normalized in SECTION_KEYWORDS["certifications"]:
            score -= 2
    return score


def _order_page_columns(columns: list[list[dict]]) -> list[list[dict]]:
    if len(columns) != 2:
        return columns

    left_column, right_column = columns
    if not left_column or not right_column:
        return columns

    left_priority = _column_priority(left_column)
    right_priority = _column_priority(right_column)
    if left_priority != right_priority:
        return [left_column, right_column] if left_priority > right_priority else [right_column, left_column]

    return columns


def is_bullet_start(line: dict | str) -> bool:
    if isinstance(line, dict):
        text = _compact_spaces(line.get("text", ""))
        indent = float(line.get("indent", 0.0))
    else:
        text = _compact_spaces(line)
        indent = 0.0

    if not text:
        return False
    if re.match(r"^(?:[\-\*\u2022\u25AA\u25E6\u27A2]+\s+)", text):
        return True
    if text[:1].islower():
        return False
    if indent >= 90 and len(text.split()) <= 25 and not _looks_like_company(text) and not _looks_like_role(text):
        return True
    return False


def reconstruct_lines(blocks: list[dict]) -> list[dict]:
    if not blocks:
        return []

    tolerance = _line_y_tolerance(blocks)
    grouped = []

    for block in blocks:
        raw_lines = [item for item in str(block.get("text", "")).splitlines() if _compact_spaces(item)]
        if not raw_lines:
            continue

        block_height = max(1.0, float(block["y1"]) - float(block["y0"]))
        line_step = block_height / max(1, len(raw_lines))

        for index, raw_line in enumerate(raw_lines):
            line_y0 = float(block["y0"]) + (index * line_step)
            line_y1 = min(float(block["y1"]), line_y0 + line_step)
            cleaned = _compact_spaces(raw_line)
            grouped.append(
                {
                    "page": block["page"],
                    "column": block["column"],
                    "x0": float(block["x0"]),
                    "x1": float(block["x1"]),
                    "y0": line_y0,
                    "y1": line_y1,
                    "text": cleaned,
                    "indent": float(block["x0"]),
                    "is_bullet": is_bullet_start({"text": cleaned, "indent": float(block["x0"])}),
                }
            )

    grouped.sort(key=lambda item: (item["page"], item["column"], item["y0"], item["x0"]))

    merged = []
    for line in grouped:
        if not merged:
            merged.append(line)
            continue

        previous = merged[-1]
        same_row = (
            previous["page"] == line["page"]
            and previous["column"] == line["column"]
            and abs(previous["y0"] - line["y0"]) <= tolerance
        )
        if same_row:
            previous["text"] = _join_tokens([previous["text"], line["text"]])
            previous["x0"] = min(previous["x0"], line["x0"])
            previous["x1"] = max(previous["x1"], line["x1"])
            previous["y1"] = max(previous["y1"], line["y1"])
            previous["indent"] = min(previous["indent"], line["indent"])
            previous["is_bullet"] = previous["is_bullet"] or line["is_bullet"]
            continue

        should_merge_wrap = (
            previous["page"] == line["page"]
            and previous["column"] == line["column"]
            and not previous["is_bullet"]
            and not line["is_bullet"]
            and not _is_heading_line(previous["text"])
            and not _is_heading_line(line["text"])
            and not extract_date_range(previous["text"])
            and not extract_date_range(line["text"])
            and not previous["text"].endswith((".", "!", "?", ":"))
            and line["text"][:1].islower()
            and line["y0"] - previous["y1"] <= tolerance * 1.25
        )
        if should_merge_wrap:
            previous["text"] = _join_tokens([previous["text"], line["text"]])
            previous["x1"] = max(previous["x1"], line["x1"])
            previous["y1"] = max(previous["y1"], line["y1"])
            continue

        merged.append(line)

    for line in merged:
        line["text"] = _compact_spaces(line["text"])
        line["is_bullet"] = line["is_bullet"] or is_bullet_start(line)

    return merged


def deduplicate_lines(lines: list[str]) -> list[str]:
    deduplicated = []
    seen = []
    threshold = PARSER_CONFIG["duplicate_similarity_threshold"]

    for line in lines:
        cleaned = _compact_spaces(line)
        normalized = _normalize_similarity_text(cleaned)
        if not normalized:
            continue

        duplicate = any(normalized == item or SequenceMatcher(None, normalized, item).ratio() > threshold for item in seen)
        if duplicate:
            continue

        deduplicated.append(cleaned)
        seen.append(normalized)

    return deduplicated


def _find_header_footer_duplicates(lines: list[dict]) -> set[str]:
    pages_by_line: dict[str, set[int]] = {}
    y_positions: dict[str, list[float]] = {}

    for line in lines:
        normalized = _normalize_similarity_text(line["text"])
        if not normalized:
            continue
        pages_by_line.setdefault(normalized, set()).add(int(line["page"]))
        y_positions.setdefault(normalized, []).append(float(line["y0"]))

    repeated = set()
    for normalized, pages in pages_by_line.items():
        if len(pages) < 2:
            continue

        avg_y0 = sum(y_positions[normalized]) / len(y_positions[normalized])
        sample = next(item for item in lines if _normalize_similarity_text(item["text"]) == normalized)
        if (
            avg_y0 <= PARSER_CONFIG["header_footer_y_threshold"]
            or avg_y0 >= 700
            or _is_contact_line(sample["text"])
            or _looks_like_name_candidate(sample["text"])
        ):
            repeated.add(normalized)

    return repeated


def _deduplicate_line_records(lines: list[dict], debug: bool = False) -> list[dict]:
    header_footer_duplicates = _find_header_footer_duplicates(lines)
    recent = []
    deduplicated = []
    removed = 0

    for line in lines:
        text = _compact_spaces(line["text"])
        normalized = _normalize_similarity_text(text)
        if not normalized:
            continue

        if normalized in header_footer_duplicates:
            removed += 1
            continue

        if any(
            normalized == _normalize_similarity_text(previous["text"])
            or _similarity(text, previous["text"]) > PARSER_CONFIG["duplicate_similarity_threshold"]
            for previous in recent[-8:]
        ):
            removed += 1
            continue

        updated = dict(line)
        updated["text"] = text
        updated["is_bullet"] = updated["is_bullet"] or is_bullet_start(updated)
        deduplicated.append(updated)
        recent.append(updated)

    if debug:
        print(f"Lines before dedup: {len(lines)}")
        print(f"Lines after dedup: {len(deduplicated)}")
        print(f"Duplicate lines removed: {removed}")

    return deduplicated


def score_section_line(line: dict, index: int, total_lines: int) -> dict[str, float]:
    text = _compact_spaces(line.get("text", ""))
    normalized = _normalize_heading(text)
    word_count = len(text.split())
    is_short_heading = word_count <= 5
    uppercase_ratio = sum(ch.isupper() for ch in text if ch.isalpha()) / max(1, sum(ch.isalpha() for ch in text))
    position_ratio = index / max(1, total_lines)
    scores = {section: 0.0 for section in SECTION_KEYWORDS}

    for section, keywords in SECTION_KEYWORDS.items():
        if normalized in keywords:
            scores[section] += 3.5
        else:
            for keyword in keywords:
                ratio = SequenceMatcher(None, normalized, keyword).ratio()
                if ratio >= 0.78:
                    scores[section] += ratio * 2.5

    if is_short_heading:
        for section in scores:
            scores[section] += 0.5
    if uppercase_ratio >= 0.8 and word_count <= 6:
        for section in scores:
            scores[section] += 0.4
    if position_ratio <= 0.18:
        scores["summary"] += 0.4
    if position_ratio >= 0.2:
        scores["experience"] += 0.2
        scores["skills"] += 0.1

    if _is_contact_line(text):
        for section in scores:
            scores[section] -= 1.0

    return scores


def classify_sections(lines: list[dict], debug: bool = False) -> dict:
    section_map = {
        "summary": [],
        "experience": [],
        "skills": [],
        "projects": [],
        "education": [],
        "certifications": [],
        "other": [],
    }
    detected_sections = []
    section_scores = {section: [] for section in section_map if section != "other"}
    current_section = "summary"

    for index, line in enumerate(lines):
        scores = score_section_line(line, index, len(lines))
        best_section = max(scores, key=scores.get)
        best_score = scores[best_section]

        for section_name, value in scores.items():
            if section_name in section_scores:
                section_scores[section_name].append(value)

        if best_score >= PARSER_CONFIG["section_score_threshold"] and len(line["text"].split()) <= 7:
            current_section = best_section
            if current_section not in detected_sections:
                detected_sections.append(current_section)
            continue

        section_map[current_section if current_section in section_map else "other"].append(line)

    if debug:
        print(f"Detected sections: {detected_sections or ['summary']}")

    return {
        "order": detected_sections or ["summary"],
        "sections": section_map,
        "section_confidence": {
            name: round(sum(values) / len(values), 2) if values else 0.0
            for name, values in section_scores.items()
        },
    }


def score_role_candidate(line: dict, prev_line: dict | None, next_line: dict | None, section: str) -> float:
    text = _compact_spaces(line["text"])
    score = 0.0

    if section == "experience":
        score += 1.8
    if _looks_like_role(text):
        score += 2.0
    if extract_date_range(text):
        score += 1.4
    if prev_line and extract_date_range(prev_line["text"]):
        score += 0.8
    if next_line and extract_date_range(next_line["text"]):
        score += 0.8
    if next_line and is_bullet_start(next_line):
        score += 0.9
    if prev_line and _looks_like_company(prev_line["text"]):
        score += 1.1
    if next_line and _looks_like_company(next_line["text"]):
        score += 0.5

    words = text.split()
    if 1 <= len(words) <= 10:
        title_case_ratio = sum(word[:1].isupper() for word in words if any(ch.isalpha() for ch in word)) / max(1, len(words))
        score += title_case_ratio

    if _is_heading_line(text):
        score -= 2.4
    if _is_contact_line(text):
        score -= 2.0
    if _is_skill_like(text):
        score -= 1.8
    if text.count(",") >= 3:
        score -= 1.2
    if len(words) > 18:
        score -= 1.8

    return round(score, 2)


def detect_roles(lines: list[dict], section_name: str, debug: bool = False) -> dict:
    accepted = []
    rejected = []

    for index, line in enumerate(lines):
        text = _compact_spaces(line["text"])
        if is_bullet_start(line):
            rejected.append((index, text, -1.0))
            continue
        if extract_date_range(text) and not _looks_like_role(text) and not _looks_like_company(text):
            rejected.append((index, text, -0.5))
            continue

        prev_line = lines[index - 1] if index > 0 else None
        next_line = lines[index + 1] if index + 1 < len(lines) else None
        score = score_role_candidate(line, prev_line, next_line, section_name)
        if score >= PARSER_CONFIG["role_score_threshold"]:
            accepted.append((index, score))
            if debug:
                print(f"Role candidate accepted: {line['text']} -> {score}")
        else:
            rejected.append((index, text, score))

    if debug:
        for _, text, score in rejected[:10]:
            print(f"Role candidate rejected: {text} -> {score}")

    return {
        "accepted_indexes": [index for index, _ in accepted],
        "accepted_scores": [score for _, score in accepted],
        "rejected": rejected,
    }


def _parse_header_lines(header_lines: list[str]) -> dict:
    company = ""
    role = ""
    duration = ""

    for line in header_lines:
        current_date = extract_date_range(line)
        if current_date:
            duration = _compact_spaces(" ".join(filter(None, [duration, current_date]))).strip()

        parts = [part.strip() for part in re.split(r"\s*\|\s*", line) if part.strip()] or [line]
        for part in parts:
            if not role and _looks_like_role(part):
                role = part
                continue
            if not company and _looks_like_company(part):
                company = part

    if not company and header_lines:
        company = header_lines[0]
    if not role and len(header_lines) > 1:
        role = header_lines[1]

    return {
        "company": _compact_spaces(company).strip(" |-"),
        "role": _compact_spaces(role).strip(" |-"),
        "duration": _compact_spaces(duration).strip(" |-"),
    }


def deduplicate_bullets(bullets: list[str]) -> list[str]:
    deduplicated = []
    seen = []
    threshold = PARSER_CONFIG["bullet_duplicate_similarity_threshold"]

    for bullet in bullets:
        cleaned = _compact_spaces(_clean_bullet_prefix(bullet))
        normalized = _normalize_similarity_text(cleaned)
        if not normalized:
            continue

        duplicate = any(normalized == item or SequenceMatcher(None, normalized, item).ratio() > threshold for item in seen)
        if duplicate:
            continue

        deduplicated.append(cleaned)
        seen.append(normalized)

    return deduplicated


def group_bullets(lines: list[dict]) -> list[str]:
    bullets = []

    for line in lines:
        text = _compact_spaces(line["text"])
        if not text:
            continue

        if is_bullet_start(line):
            bullets.append(_clean_bullet_prefix(text))
            continue

        if bullets and not _is_heading_line(text) and not _looks_like_company(text) and not _looks_like_role(text):
            bullets[-1] = _join_tokens([bullets[-1], text])
            continue

        if bullets:
            bullets.append(text)

    return deduplicate_bullets(bullets)


def group_experience(lines: list[dict], sections: dict, debug: bool = False) -> list[dict]:
    experience_lines = sections.get("experience", [])
    if not experience_lines:
        return []

    detection = detect_roles(experience_lines, "experience", debug=debug)
    role_indexes = detection["accepted_indexes"]
    if not role_indexes:
        role_indexes = [index for index, line in enumerate(experience_lines) if _looks_like_company(line["text"]) and index + 1 < len(experience_lines)]

    entries = []
    bullet_count_before = sum(1 for line in experience_lines if is_bullet_start(line))

    for offset, role_index in enumerate(role_indexes):
        next_role_index = role_indexes[offset + 1] if offset + 1 < len(role_indexes) else len(experience_lines)
        header_start = role_index

        while header_start > 0:
            previous = experience_lines[header_start - 1]
            text = previous["text"]
            if is_bullet_start(previous):
                break
            if _looks_like_company(text) or extract_date_range(text) or (_looks_like_role(text) and len(text.split()) <= 10):
                header_start -= 1
                continue
            break

        header_lines = []
        body_lines = []
        seen_bullet = False
        for line in experience_lines[header_start:next_role_index]:
            text = line["text"]
            if not seen_bullet and not is_bullet_start(line) and (extract_date_range(text) or _looks_like_company(text) or _looks_like_role(text) or len(header_lines) < 2):
                header_lines.append(text)
                continue
            seen_bullet = True
            body_lines.append(line)

        parsed_header = _parse_header_lines(header_lines)
        bullets = group_bullets(body_lines)
        if not bullets and body_lines:
            bullets = deduplicate_bullets([line["text"] for line in body_lines if _compact_spaces(line["text"])])

        entry = {
            "company": parsed_header["company"],
            "role": parsed_header["role"],
            "duration": parsed_header["duration"],
            "bullets": bullets,
        }
        if any(entry.values()):
            entries.append(entry)

    if debug:
        print(f"Detected roles: {len(entries)}")
        print(f"Bullets before dedup: {bullet_count_before}")
        print(f"Bullets after dedup: {sum(len(entry['bullets']) for entry in entries)}")
        for entry in entries:
            print(f"{entry['company']} | {entry['role']} -> bullets: {len(entry['bullets'])}")

    return entries


def extract_name(lines: list[dict]) -> str:
    candidates = []
    for line in lines:
        if line["page"] != 1 or line["y0"] > PARSER_CONFIG["top_name_y_threshold"]:
            continue
        text = CONTACT_PATTERN.split(line["text"], maxsplit=1)[0]
        text = _compact_spaces(text).strip(" |-•")
        if _looks_like_name_candidate(text):
            candidates.append(text)

    if candidates:
        return _normalize_name(candidates[0])
    return "Candidate"


def _summary_text(lines: list[dict]) -> str:
    values = []
    for line in lines:
        text = _compact_spaces(line["text"])
        if not text or _is_contact_line(text) or _is_heading_line(text) or _looks_like_name_candidate(text):
            continue
        values.append(text)
    return "\n".join(deduplicate_lines(values))


def _skills_list(lines: list[dict]) -> list[str]:
    values = []
    for line in lines:
        for chunk in re.split(r"[;,•|]", line["text"]):
            cleaned = _compact_spaces(chunk)
            if cleaned:
                values.append(cleaned)
    return deduplicate_lines(values)


def validate_output(raw_lines: list[str] | str, parsed: dict, debug: bool = False) -> dict:
    if isinstance(raw_lines, str):
        raw_lines = [line for line in raw_lines.splitlines() if _compact_spaces(line)]

    raw_unique = deduplicate_lines(raw_lines)
    experience = parsed.get("sections", {}).get("experience", []) or []
    role_count = len(experience)
    bullet_count = sum(len(entry.get("bullets", [])) for entry in experience)
    missing_headers = []
    supported_roles = 0

    raw_text = "\n".join(raw_unique).lower()
    for entry in experience:
        company = _compact_spaces(entry.get("company", ""))
        role = _compact_spaces(entry.get("role", ""))
        if company and company.lower() not in raw_text:
            missing_headers.append(company)
        if role and role.lower() not in raw_text:
            missing_headers.append(role)
        if entry.get("bullets") or entry.get("duration"):
            supported_roles += 1

    confidence_score = round(
        max(
            0.0,
            min(
                1.0,
                0.35
                + (0.2 if role_count > 0 else 0.0)
                + (0.2 if bullet_count > 0 else 0.0)
                + (0.15 if not missing_headers else 0.0)
                + (0.1 * supported_roles / max(1, role_count))
            ),
        ),
        2,
    )

    validation = {
        "role_count": role_count,
        "bullet_count": bullet_count,
        "missing_headers": missing_headers,
        "supported_roles": supported_roles,
        "confidence_score": confidence_score,
        "is_valid": role_count > 0 and supported_roles == role_count and not missing_headers,
    }

    if debug:
        print(f"Confidence score: {confidence_score}")
        if missing_headers:
            print(f"Missing headers: {missing_headers}")

    return validation


def compute_extraction_confidence(raw_blocks: list[dict], raw_lines: list[dict], parsed_output: dict):
    raw_text_lines = [line["text"] for line in raw_lines if _compact_spaces(line["text"])]
    unique_lines = deduplicate_lines(raw_text_lines)
    exact_duplicate_ratio = 0.0 if not raw_text_lines else max(0.0, 1.0 - (len(unique_lines) / len(raw_text_lines)))

    near_duplicate_hits = 0
    comparisons = 0
    window = PARSER_CONFIG["near_duplicate_window"]
    normalized_lines = [_normalize_similarity_text(text) for text in raw_text_lines]
    for index, line in enumerate(normalized_lines):
        if not line:
            continue
        for other in normalized_lines[index + 1:index + 1 + window]:
            if not other:
                continue
            comparisons += 1
            if SequenceMatcher(None, line, other).ratio() >= PARSER_CONFIG["duplicate_similarity_threshold"]:
                near_duplicate_hits += 1
    near_duplicate_ratio = 0.0 if comparisons == 0 else near_duplicate_hits / comparisons

    classified = classify_sections(raw_lines)
    section_order = classified["order"]
    section_positions = {section: index for index, section in enumerate(EXPECTED_SECTION_ORDER)}
    out_of_order_count = 0
    for current, nxt in zip(section_order, section_order[1:]):
        if section_positions.get(current, -1) > section_positions.get(nxt, -1):
            out_of_order_count += 1
    section_order_penalty = out_of_order_count / max(1, len(section_order))

    experience_lines = classified["sections"].get("experience", [])
    role_detection = detect_roles(experience_lines, "experience")
    rejected_role_ratio = 0.0
    total_role_candidates = len(role_detection["accepted_indexes"]) + len(role_detection["rejected"])
    if total_role_candidates:
        rejected_role_ratio = len(role_detection["rejected"]) / total_role_candidates

    experience_entries = parsed_output.get("sections", {}).get("experience", []) or []
    suspicious_roles = sum(
        1
        for entry in experience_entries
        if not entry.get("bullets") or (not entry.get("duration") and not entry.get("company"))
    )
    suspicious_role_ratio = 0.0 if not experience_entries else suspicious_roles / len(experience_entries)

    bullet_starts = sum(1 for line in raw_lines if is_bullet_start(line))
    parsed_bullet_count = sum(len(entry.get("bullets", [])) for entry in experience_entries)
    flattened_bullet_ratio = 0.0
    if bullet_starts:
        flattened_bullet_ratio = max(0.0, 1.0 - (parsed_bullet_count / bullet_starts))

    repeated_headers = len(_find_header_footer_duplicates(raw_lines))
    repeated_header_ratio = 0.0 if not raw_lines else repeated_headers / len(raw_lines)
    orphan_ratio = len(classified["sections"].get("other", [])) / max(1, len(raw_lines))
    missing_experience_penalty = 0.35 if not experience_lines or not experience_entries else 0.0

    confidence = 1.0
    confidence -= exact_duplicate_ratio * 0.25
    confidence -= near_duplicate_ratio * 0.18
    confidence -= section_order_penalty * 0.12
    confidence -= rejected_role_ratio * 0.10
    confidence -= suspicious_role_ratio * 0.18
    confidence -= flattened_bullet_ratio * 0.16
    confidence -= repeated_header_ratio * 0.10
    confidence -= orphan_ratio * 0.10
    confidence -= missing_experience_penalty
    confidence = max(0.0, min(1.0, round(confidence, 2)))

    metrics = {
        "duplicate_ratio": round(exact_duplicate_ratio, 3),
        "near_duplicate_ratio": round(near_duplicate_ratio, 3),
        "section_order_penalty": round(section_order_penalty, 3),
        "rejected_role_ratio": round(rejected_role_ratio, 3),
        "suspicious_role_ratio": round(suspicious_role_ratio, 3),
        "flattened_bullet_ratio": round(flattened_bullet_ratio, 3),
        "repeated_header_ratio": round(repeated_header_ratio, 3),
        "orphan_ratio": round(orphan_ratio, 3),
        "role_count": len(experience_entries),
        "bullet_count": parsed_bullet_count,
        "section_order": section_order,
    }
    return confidence, metrics


def _flatten_document_blocks(document: ExtractedDocument) -> list[dict]:
    blocks = []
    for page_index, page in enumerate(document.pages, start=1):
        page_blocks = [block.as_dict() for block in page.blocks]
        for block in page_blocks:
            block["page"] = page_index
        if page_blocks:
            ordered_columns = _order_page_columns(detect_columns(page_blocks, page.width or None))
            for column_index, column in enumerate(ordered_columns):
                for block in column:
                    block["column"] = column_index
                    blocks.append(block)
    return blocks


def _build_parsed_candidate(document: ExtractedDocument, candidate_name: str, debug: bool = False) -> ParsedCandidate:
    raw_blocks = _flatten_document_blocks(document)
    raw_lines = reconstruct_lines(raw_blocks)
    lines = _deduplicate_line_records(raw_lines, debug=debug)
    classified = classify_sections(lines, debug=debug)
    experience = group_experience(lines, classified["sections"], debug=debug)
    parsed = {
        "name": extract_name(lines) or _normalize_name(candidate_name),
        "sections": {
            "summary": _summary_text(classified["sections"]["summary"]),
            "experience": experience,
            "skills": _skills_list(classified["sections"]["skills"]),
        },
    }
    validation = validate_output([line["text"] for line in raw_lines], parsed, debug=debug)
    confidence, metrics = compute_extraction_confidence(raw_blocks, lines, parsed)
    if debug:
        print(f"Extractor used: {document.source}")
        print(f"Extraction confidence score: {confidence}")
        print(f"Duplicate ratio: {metrics['duplicate_ratio']}")
        print(f"Role count: {metrics['role_count']}")
        print(f"Bullet distribution: {metrics['bullet_count']}")
    return ParsedCandidate(
        document=document,
        lines=lines,
        classified=classified,
        parsed=parsed,
        validation=validation,
        confidence=confidence,
        metrics=metrics,
        adapter_name=document.source,
    )


def compare_extraction_candidates(native_result: ParsedCandidate, ocr_result: ParsedCandidate) -> ParsedCandidate:
    native_score = native_result.confidence
    ocr_score = ocr_result.confidence

    if ocr_score > native_score + 0.03:
        return ocr_result
    if native_score > ocr_score + 0.03:
        return native_result

    native_dup = native_result.metrics.get("duplicate_ratio", 1.0) + native_result.metrics.get("near_duplicate_ratio", 1.0)
    ocr_dup = ocr_result.metrics.get("duplicate_ratio", 1.0) + ocr_result.metrics.get("near_duplicate_ratio", 1.0)
    if ocr_dup < native_dup - 0.05:
        return ocr_result
    if native_dup < ocr_dup - 0.05:
        return native_result

    native_false_roles = native_result.metrics.get("suspicious_role_ratio", 1.0)
    ocr_false_roles = ocr_result.metrics.get("suspicious_role_ratio", 1.0)
    if ocr_false_roles < native_false_roles - 0.05:
        return ocr_result

    if PARSER_CONFIG["prefer_native_for_clean_text_pdfs"]:
        return native_result
    return ocr_result


def _document_text_length(document: ExtractedDocument) -> int:
    return len("\n".join(block.text for page in document.pages for block in page.blocks))


def _document_is_scanned_like(document: ExtractedDocument) -> bool:
    block_count = sum(len(page.blocks) for page in document.pages)
    text_length = _document_text_length(document)
    return block_count <= 3 or text_length < 80


def _extract_document_with_pymupdf(file_path: str) -> ExtractedDocument:
    pages = []
    with fitz.open(file_path) as pdf:
        for page_index, page in enumerate(pdf, start=1):
            blocks = []
            for block in page.get_text("blocks"):
                x0, y0, x1, y1, text, _, block_type = block[:7]
                cleaned = _compact_spaces(text)
                if block_type != 0 or not cleaned:
                    continue
                blocks.append(
                    ExtractedBlock(
                        text=text,
                        x0=float(x0),
                        y0=float(y0),
                        x1=float(x1),
                        y1=float(y1),
                        page=page_index,
                    )
                )
            pages.append(ExtractedPage(blocks=blocks, width=float(page.rect.width), height=float(page.rect.height)))
    return ExtractedDocument(source="native", pages=pages, metadata={"extractor": "pymupdf"})


def _extract_document_with_pdfplumber(file_path: str) -> ExtractedDocument:
    pages = []
    with pdfplumber.open(file_path) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            words = page.extract_words(use_text_flow=True, keep_blank_chars=False)
            blocks = []
            for word in words:
                cleaned = _compact_spaces(word.get("text", ""))
                if not cleaned:
                    continue
                blocks.append(
                    ExtractedBlock(
                        text=cleaned,
                        x0=float(word["x0"]),
                        y0=float(word["top"]),
                        x1=float(word["x1"]),
                        y1=float(word["bottom"]),
                        page=page_index,
                    )
                )
            pages.append(ExtractedPage(blocks=blocks, width=float(page.width), height=float(page.height)))
    return ExtractedDocument(source="native", pages=pages, metadata={"extractor": "pdfplumber"})


def extract_with_pymupdf(file_path: str) -> dict:
    document = _extract_document_with_pymupdf(file_path)
    blocks = _flatten_document_blocks(document)
    lines = reconstruct_lines(blocks)
    text = "\n".join(line["text"] for line in lines if line["text"])
    return {"document": document, "blocks": blocks, "lines": lines, "text": text}


def extract_with_pdfplumber(file_path: str) -> dict:
    document = _extract_document_with_pdfplumber(file_path)
    blocks = _flatten_document_blocks(document)
    lines = reconstruct_lines(blocks)
    text = "\n".join(line["text"] for line in lines if line["text"])
    return {"document": document, "blocks": blocks, "lines": lines, "text": text}


def extract_resume(file_path: str, candidate_name: str | None = None, debug: bool = False, adapters: dict | None = None) -> ParsedCandidate:
    candidate_name = candidate_name or Path(file_path).stem.replace("_", " ")
    adapters = adapters or {}

    native_adapter = adapters.get("native") or NativePdfAdapter()
    surya_adapter = adapters.get("surya") or SuryaAdapter()
    paddle_adapter = adapters.get("paddle") or PaddleOcrAdapter()
    ocrmypdf_preprocessor = adapters.get("ocrmypdf") or OcrMyPdfPreprocessor()

    native_document = native_adapter.extract(file_path)
    native_candidate = _build_parsed_candidate(native_document, candidate_name, debug=debug)

    if debug:
        print(f"Reroute decision candidate confidence: {native_candidate.confidence}")

    if (
        not PARSER_CONFIG["allow_ocr_fallback"]
        or native_candidate.confidence > PARSER_CONFIG["low_confidence_threshold"]
    ):
        if debug:
            print("Reroute decision: keeping native extraction")
        return native_candidate

    candidates = [native_candidate]

    if _document_is_scanned_like(native_document):
        preprocessed_path = ocrmypdf_preprocessor.process(file_path)
        if preprocessed_path:
            try:
                preprocessed_document = native_adapter.extract(preprocessed_path)
                preprocessed_document.source = "ocrmypdf+native"
                candidates.append(_build_parsed_candidate(preprocessed_document, candidate_name, debug=debug))
            finally:
                if preprocessed_path != file_path and Path(preprocessed_path).exists():
                    try:
                        Path(preprocessed_path).unlink()
                    except OSError:
                        pass

    for adapter in (surya_adapter, paddle_adapter):
        document = adapter.extract(file_path)
        if not document.pages:
            continue
        candidates.append(_build_parsed_candidate(document, candidate_name, debug=debug))

    best_candidate = native_candidate
    for candidate in candidates[1:]:
        best_candidate = compare_extraction_candidates(best_candidate, candidate)

    if debug:
        print(f"Reroute decision: selected {best_candidate.adapter_name}")
        print(f"Final parser confidence: {best_candidate.confidence}")

    return best_candidate


def extract_resume_structure(file_path: str, candidate_name: str | None = None, debug: bool = False) -> dict:
    return extract_resume(file_path, candidate_name=candidate_name, debug=debug).parsed


def _extract_docx_text(file_path: str) -> str:
    doc = Document(file_path)
    values = []
    for paragraph in doc.paragraphs:
        text = paragraph.text.strip()
        if text:
            values.append(text)
    return "\n".join(values)


def _extract_pdf_text(file_path: str) -> str:
    candidate = extract_resume(file_path, candidate_name=Path(file_path).stem, debug=False)
    return "\n".join(line["text"] for line in candidate.lines if _compact_spaces(line["text"]))


def extract_resume_text(file_path: str) -> str:
    suffix = Path(file_path).suffix.lower()
    if suffix == ".docx":
        return _extract_docx_text(file_path)
    if suffix == ".pdf":
        return _extract_pdf_text(file_path)
    raise ValueError(f"Unsupported resume file format: {suffix}")


def create_summary_pdf(candidate, summary):
    file_path = f"app/resumes/{candidate}_summary.pdf"
    styles = getSampleStyleSheet()

    story = [
        Paragraph("Candidate Profile", styles["Title"]),
        Spacer(1, 20),
        Paragraph(f"<b>Name:</b> {candidate}", styles["Normal"]),
        Spacer(1, 20),
        Paragraph("<b>Professional Summary</b>", styles["Heading2"]),
        Spacer(1, 10),
        Paragraph(summary, styles["Normal"]),
    ]

    doc = SimpleDocTemplate(file_path, pagesize=letter)
    doc.build(story)
    return file_path
