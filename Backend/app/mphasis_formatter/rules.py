import re
from difflib import SequenceMatcher

PERSONAL_INFO_PATTERNS = [
    r"\b[\w\.-]+@[\w\.-]+\.\w+\b",
    r"(?:\+?\d{1,3}[\s\-\.]?)?(?:\(?\d{3}\)?[\s\-\.]?)\d{3}[\s\-\.]?\d{4}",
    r"(?:https?://\S+|www\.\S+)",
    r"\b(?:linkedin|github|twitter|behance|instagram|facebook)\.com/\S*",
    r"\b(?:linkedin|github|portfolio|behance)\b\s*[:\-].*",
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    r"\b\d{5}(?:-\d{4})?\b",
]
CONTACT_PATTERN = re.compile(
    r"(?i)(?:\b[\w\.-]+@[\w\.-]+\.\w+\b|https?://\S+|www\.\S+|\b(?:linkedin|github|twitter|behance|instagram|facebook)\.com/\S*|\b(?:linkedin|github|portfolio|behance)\b\s*[:\-].*|(?:\+?\d{1,3}[\s\-\.]?)?(?:\(?\d{3}\)?[\s\-\.]?)\d{3}[\s\-\.]?\d{4})"
)

EDUCATION_KEYWORDS = [
    "bachelor", "master", "b.tech", "m.tech", "b.e", "mba", "mca",
    "bca", "b.sc", "m.sc", "phd", "college", "university", "education",
    "school", "institute", "academy", "degree", "graduate", "graduation",
    "diploma", "gpa", "cgpa", "coursework", "academic", "academics",
    "bachelors", "masters", "btech", "mtech", "bsc", "msc",
    "vidyalaya", "kendriya", "navodaya",
]

PERSONAL_INFO_KEYWORDS = [
    "address",
    "personal details",
    "personal information",
    "date of birth",
    "dob",
    "nationality",
    "marital status",
    "email",
    "e-mail",
    "phone",
    "mobile",
    "contact",
    "linkedin",
    "github",
    "portfolio",
    "current location",
    "present location",
    "permanent address",
    "passport",
    "visa",
    "citizenship",
]

EDUCATION_SECTION_TITLES = [
    "education",
    "education details",
    "educational details",
    "educational qualification",
    "educational qualifications",
    "academic qualifications",
    "qualifications",
    "academic background",
    "educational background",
    "academic profile",
    "academic credentials",
    "academics",
]

KNOWN_SECTION_TITLES = {
    *EDUCATION_SECTION_TITLES,
    "professional summary",
    "profile summary",
    "summary professional",
    "summary",
    "profile",
    "professional profile",
    "career summary",
    "career highlights",
    "professional highlights",
    "profile highlights",
    "highlights",
    "key highlights",
    "work experience",
    "work history",
    "professional experience",
    "experience",
    "employment history",
    "employment",
    "skills",
    "skills set",
    "skills & languages",
    "skills and languages",
    "technical skills",
    "technical proficiencies",
    "core competencies",
    "core skills",
    "technical expertise",
    "development skills",
    "java development skills",
    "java skills",
    "projects",
    "project experience",
    "certifications",
    "awards",
    "achievements",
    "key achievements",
    "domain expertise",
    "internship",
    "internships",
    "volunteer experience",
    "volunteer & extra curricular",
    "volunteer and extra curricular",
    "extracurricular",
    "extra curricular",
}

EXPERIENCE_SECTION_TITLES = {
    "work experience",
    "work history",
    "professional experience",
    "experience",
    "employment history",
    "employment",
    "project experience",
    "projects",
    "volunteer experience",
    "volunteer & extra curricular",
    "volunteer and extra curricular",
    "extracurricular",
    "extra curricular",
}

def _compact_spaces(text: str) -> str:
    cleaned = str(text or "").replace("\u200b", " ").replace("\ufeff", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def _normalize_for_matching(text: str) -> str:
    return _compact_spaces(str(text or "")).lower()


def _normalize_heading(text: str) -> str:
    return _normalize_for_matching(text).strip(":- ")


def _normalized_alnum(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", _normalize_for_matching(text))


def _is_personal_info_text(text: str) -> bool:
    lowered = _normalize_for_matching(text)
    if not lowered:
        return False
    label_keywords = {
        "address",
        "date of birth",
        "dob",
        "email",
        "e-mail",
        "phone",
        "mobile",
        "contact",
        "current location",
        "present location",
        "permanent address",
        "passport",
        "visa",
        "citizenship",
        "nationality",
        "marital status",
        "personal details",
        "personal information",
    }
    profile_link_keywords = {"linkedin", "github", "portfolio", "behance"}
    for keyword in PERSONAL_INFO_KEYWORDS:
        if keyword in profile_link_keywords:
            if re.search(rf"(?i)^\s*{re.escape(keyword)}\s*[:\-]", lowered):
                return True
            continue
        if keyword in label_keywords:
            if re.search(rf"(?i)^\s*{re.escape(keyword)}(?:\b|[\s:\-])", lowered):
                return True
        elif keyword in lowered:
            return True
    return any(re.search(pattern, str(text or ""), flags=re.IGNORECASE) for pattern in PERSONAL_INFO_PATTERNS)


def _is_education_text(text: str) -> bool:
    lowered = _normalize_for_matching(text)
    if not lowered:
        return False
    if _is_education_heading(lowered):
        return True
    return any(keyword in lowered for keyword in EDUCATION_KEYWORDS)


def _should_drop_text(text: str) -> bool:
    cleaned = _compact_spaces(text)
    if not cleaned:
        return True
    return _is_personal_info_text(cleaned) or _is_education_text(cleaned)


def _is_section_heading(text: str) -> bool:
    cleaned = _compact_spaces(text)
    if cleaned.endswith(":") and len(cleaned.split()) <= 5:
        return True
    lowered = _normalize_heading(text)
    if not lowered:
        return False
    if _is_education_heading(lowered):
        return True
    return lowered in KNOWN_SECTION_TITLES


def _is_education_heading(text: str) -> bool:
    lowered = _normalize_heading(text)
    if not lowered:
        return False
    if lowered in EDUCATION_SECTION_TITLES:
        return True

    words = lowered.split()
    if len(words) > 5:
        return False

    heading_hints = (
        "education",
        "educational",
        "academic",
        "academics",
        "qualification",
        "qualifications",
    )
    return any(hint in lowered for hint in heading_hints)


def _looks_like_heading(text: str) -> bool:
    cleaned = _compact_spaces(text)
    if not cleaned:
        return False
    if len(cleaned) > 80:
        return False
    if _is_section_heading(cleaned):
        return True

    words = cleaned.split()
    if len(words) > 6:
        return False

    if cleaned.endswith(":"):
        return True

    alphabetic = [word for word in words if any(ch.isalpha() for ch in word)]
    if not alphabetic:
        return False

    if cleaned.upper() == cleaned and any(ch.isalpha() for ch in cleaned):
        return True

    title_case_ratio = sum(word[:1].isupper() for word in alphabetic) / len(alphabetic)
    return title_case_ratio >= 0.8 and len(alphabetic) <= 4


def _clean_bullet_prefix(text: str) -> str:
    return re.sub(r"^(?:[\-\*\u2022\u25AA\u25E6\u27A2]+\s*)+", "", text or "").strip()


def _best_duplicate_variant(left: str, right: str) -> str:
    def score(value: str) -> tuple[int, int, int]:
        cleaned = _compact_spaces(value)
        return (
            cleaned.count("|") + cleaned.count("\u2022"),
            -len(re.findall(r"\bI\b", cleaned)),
            len(re.findall(r"[A-Za-z]", cleaned)),
        )

    return _compact_spaces(max((left, right), key=score))


def _collapse_inline_duplicate_content(text: str) -> str:
    cleaned = _compact_spaces(text)
    if not cleaned:
        return ""

    if "\u2022" in cleaned:
        left, right = (part.strip() for part in cleaned.split("\u2022", 1))
        if left and right:
            ratio = SequenceMatcher(None, _normalize_for_matching(left), _normalize_for_matching(right)).ratio()
            if ratio >= 0.72:
                return _best_duplicate_variant(left, right)

    words = cleaned.split()
    if len(words) >= 4 and len(words) % 2 == 0:
        midpoint = len(words) // 2
        left = " ".join(words[:midpoint])
        right = " ".join(words[midpoint:])
        ratio = SequenceMatcher(None, _normalize_for_matching(left), _normalize_for_matching(right)).ratio()
        if ratio >= 0.88:
            return _best_duplicate_variant(left, right)

    for size in range(min(12, max(2, len(words) // 2)), 1, -1):
        duplicate_removed = False
        for start in range(0, len(words) - (size * 2) + 1):
            first = " ".join(words[start:start + size])
            second = " ".join(words[start + size:start + (size * 2)])
            ratio = SequenceMatcher(None, _normalize_for_matching(first), _normalize_for_matching(second)).ratio()
            if ratio >= 0.94:
                words = words[:start + size] + words[start + (size * 2):]
                duplicate_removed = True
                break
        if duplicate_removed:
            return _compact_spaces(" ".join(words))

    return cleaned


def _has_meaningful_content(text: str) -> bool:
    return any(ch.isalnum() for ch in str(text or ""))


_TECH_NAME_BLOCKLIST = frozenset({
    # Languages / runtimes
    "java", "python", "kotlin", "swift", "ruby", "scala", "golang", "php",
    "typescript", "javascript", "perl", "rust", "dart",
    # Frameworks / libraries
    "spring", "hibernate", "angular", "react", "vue", "django", "flask",
    "express", "rails", "laravel", "struts",
    # Tech concepts / tools
    "core", "node", "sql", "aws", "api", "docker", "linux", "html", "css",
    "net", "xml", "json", "rest", "soap", "jpa", "orm", "mvc", "jwt",
    "oauth", "crud", "kafka", "redis", "git", "maven", "gradle", "jenkins",
    "kubernetes", "terraform", "microservices", "devops", "fullstack",
    "backend", "frontend", "mongodb", "mysql", "postgres", "redis",
    # Role / seniority noise
    "mphasis", "fsd", "ssd", "mid", "senior", "junior", "sr", "jr",
    "resume", "cv", "updated", "final", "original",
})


def _looks_like_name(text: str) -> bool:
    cleaned = _compact_spaces(text).strip(" ,:-")
    if not cleaned or len(cleaned) > 60:
        return False
    if any(ch.isdigit() for ch in cleaned):
        return False
    if _is_personal_info_text(cleaned) or _is_section_heading(cleaned):
        return False

    words = cleaned.split()
    if len(words) < 2 or len(words) > 5:
        return False
    blocked_words = {"designer", "associate", "profile", "summary", "skills", "experience"}
    if any(_normalize_for_matching(word) in TITLE_KEYWORDS for word in words):
        return False
    if any(_normalize_for_matching(word) in blocked_words for word in words):
        return False
    if any(_normalize_for_matching(word) in _TECH_NAME_BLOCKLIST for word in words):
        return False

    valid_words = 0
    for word in words:
        token = word.strip(".")
        if not token:
            continue
        if not all(ch.isalpha() or ch in ".'-" for ch in token):
            return False
        if token[:1].isupper() or len(token) == 1:
            valid_words += 1

    return valid_words == len(words)


def _extract_candidate_name_hint(candidate_name: str) -> str:
    cleaned = _compact_spaces(str(candidate_name or "").replace("_", " "))
    if not cleaned:
        return ""

    segments = [segment.strip() for segment in re.split(r"\s+[|-]\s+", cleaned) if segment.strip()]
    candidates = [cleaned, *segments, *(reversed(segments))]

    tokens = cleaned.split()
    for length in (3, 2):
        if len(tokens) >= length:
            candidates.append(" ".join(tokens[:length]))
            candidates.append(" ".join(tokens[-length:]))

    seen = set()
    for candidate in candidates:
        normalized = _normalize_for_matching(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        if _looks_like_name(candidate):
            return candidate
    return ""


# Pre-computed lookup: strip all non-alpha from each known title → map to a
# nicely-cased display form.  Used to fix "PROFILEHIGHLIGHTS" ← PDF character-spacing.
_KNOWN_SECTION_NOSPACE: dict[str, str] = {
    re.sub(r"[^a-z]", "", title): " ".join(w.capitalize() for w in title.split())
    for title in KNOWN_SECTION_TITLES
}

_CHAR_SPACED_RE = re.compile(r"^(?:[A-Za-z]\s){3,}[A-Za-z]\s*$")


def _normalize_char_spaced_line(text: str) -> str:
    """Fix two PDF character-spacing artefacts:
    1. 'P R O F I L E   H I G H L I G H T S' → 'PROFILE HIGHLIGHTS'
    2. 'PROFILEHIGHLIGHTS' (all-caps, no spaces) → 'Profile Highlights'
    Both are then recognisable by _is_section_heading.
    """
    # Case 1 – single-letter tokens separated by spaces
    if _CHAR_SPACED_RE.match(text):
        joined = re.sub(r"\s+", "", text).lower()
        normalized = _KNOWN_SECTION_NOSPACE.get(joined)
        if normalized:
            return normalized.upper()
        return re.sub(r"\s+", "", text)  # join the letters; best we can do

    # Case 2 – ALL_CAPS single word that is a squashed section title
    stripped = text.strip()
    if stripped.isupper() and " " not in stripped and 5 <= len(stripped) <= 45:
        normalized = _KNOWN_SECTION_NOSPACE.get(stripped.lower())
        if normalized:
            return normalized.upper()

    return text


def _extract_resume_name(resume_text: str, candidate_name: str) -> str:
    candidate_hint = _extract_candidate_name_hint(candidate_name)

    # The recruiter enters candidate_name manually — it is the authoritative source.
    # Prefer it over anything extracted from potentially garbled PDF text.
    if candidate_hint:
        return candidate_hint

    # Even when _extract_candidate_name_hint can't parse a clean 2-word name
    # (e.g. slug "Gundupatil 4 Java Mphasis"), prefer candidate_name over the
    # PDF scan.  PDF text extraction order is unreliable and frequently picks up
    # technology terms ("Hibernate JPA") before it reaches the actual name.
    if candidate_name and candidate_name.strip():
        return candidate_name.strip()

    # PDF fallback: only reached when candidate_name is completely absent.
    top_lines = []
    for raw_line in (resume_text or "").splitlines():
        line = _compact_spaces(raw_line)
        if not line:
            continue
        top_lines.append(line)
        if len(top_lines) >= 20:
            break

    for line in top_lines:
        if _looks_like_name(line):
            return line
        contact_stripped = _compact_spaces(CONTACT_PATTERN.split(line, maxsplit=1)[0]).strip(" |:-")
        if _looks_like_name(contact_stripped):
            return contact_stripped

    return candidate_name


def _is_experience_section(text: str) -> bool:
    return _normalize_heading(text) in EXPERIENCE_SECTION_TITLES


def _is_skill_section(text: str) -> bool:
    normalized = _normalize_heading(text)
    return any(kw in normalized for kw in (
        "skill", "expertise", "competenc", "technolog", "tech stack",
    ))


def _looks_like_emphasis_line(text: str, current_section: str = "") -> bool:
    cleaned = _compact_spaces(text)
    if not cleaned or len(cleaned) > 90:
        return False
    if _is_personal_info_text(cleaned) or _is_education_text(cleaned):
        return False
    if not _is_experience_section(current_section):
        return False

    lowered = _normalize_for_matching(cleaned)
    if re.search(r"\b(?:19|20)\d{2}\b", cleaned):
        return True
    if "," in cleaned and len(cleaned.split()) <= 8 and not cleaned.endswith((".", "!", "?")):
        return True
    if any(keyword in lowered for keyword in TITLE_KEYWORDS):
        return True
    if any(keyword in lowered for keyword in ("associate", "designer", "scientist", "founder", "intern", "consultant")):
        return True

    if _is_experience_section(current_section):
        words = cleaned.split()
        title_case_words = [word for word in words if word[:1].isupper()]
        if words and len(words) <= 8 and len(title_case_words) >= max(1, len(words) - 1):
            return True

    return False


def _looks_like_professional_history_line(text: str) -> bool:
    cleaned = _compact_spaces(text)
    lowered = _normalize_for_matching(cleaned)
    if not lowered:
        return False
    role_terms = (
        "developer", "engineer", "analyst", "scientist", "consultant", "director",
        "manager", "lecturer", "founder", "associate", "administrator", "lead",
    )
    has_role = any(re.search(r"\b" + term + r"\b", lowered) for term in role_terms)
    has_date = bool(re.search(r"\b(?:19|20)\d{2}\b", cleaned))
    degree_start = bool(re.match(
        r"^\s*(?:bsc|msc|mba|mca|mpa|phd|bachelor|master|b\.tech|m\.tech|btech|mtech|b\.e\.?|b\.sc|m\.sc|diploma)\b",
        lowered,
    ))
    return has_role and has_date and not degree_start


def _should_remove_education_line(text: str) -> bool:
    if _is_education_heading(text):
        return True
    if not _is_education_text(text):
        return False
    return not _looks_like_professional_history_line(text)


YEARS_WORKED_PATTERNS = [
    r"\b\d{1,2}\+?\s*(?:years?|yrs?)\b",
    r"\b(?:19|20)\d{2}\s*(?:-|–|to)\s*(?:present|current|now|(?:19|20)\d{2})\b",
    r"\b(?:since\s+)?(?:19|20)\d{2}\b",
]

TITLE_KEYWORDS = (
    "developer",
    "engineer",
    "architect",
    "consultant",
    "manager",
    "analyst",
    "administrator",
    "specialist",
    "lead",
)


def sanitize_name(full_name: str) -> str:
    cleaned = _compact_spaces(full_name)
    if not cleaned:
        return "Candidate"
    if cleaned.upper() == cleaned:
        cleaned = " ".join(part.capitalize() for part in cleaned.split())

    # Drop numeric tokens and known non-name terms (e.g. "Gundupatil 4 Java Mphasis" → ["Gundupatil"])
    all_parts = cleaned.split()
    name_parts = [
        p for p in all_parts
        if not any(ch.isdigit() for ch in p)
        and _normalize_for_matching(p) not in _TECH_NAME_BLOCKLIST
    ]
    parts = name_parts if name_parts else all_parts

    first_name = parts[0]
    if len(parts) == 1:
        return first_name
    return f"{first_name} {parts[-1][0].upper()}."


def remove_personal_info(text: str) -> str:
    if not text:
        return ""

    cleaned_lines = []
    for raw_line in str(text or "").splitlines():
        line = _collapse_inline_duplicate_content(raw_line)
        for pattern in PERSONAL_INFO_PATTERNS:
            line = re.sub(pattern, "", line, flags=re.IGNORECASE)
        # Remove char-spaced / fragmented email remnants — e.g. "gundupati l 9741@gmai l . com"
        # The standard email regex above requires a full address; this catches fragments with @.
        if "@" in line:
            line = re.sub(
                r"(?:\S+\s+){0,3}\S*@\S*(?:\s+\S+){0,3}",
                "",
                line,
            )
            line = _compact_spaces(line)
        if _is_personal_info_text(line):
            continue
        line = _compact_spaces(line)
        if line:
            cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def remove_education_content(text: str) -> str:
    if not text:
        return ""

    cleaned_lines = []
    for line in text.splitlines():
        if _is_education_text(line):
            continue
        line = _compact_spaces(line)
        if line:
            cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def remove_years_worked(text: str) -> str:
    cleaned = str(text or "")
    for pattern in YEARS_WORKED_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    return "\n".join(
        line for line in (_compact_spaces(line) for line in cleaned.splitlines()) if line
    ).strip()


def remove_job_title_phrases(text: str) -> str:
    cleaned = _collapse_inline_duplicate_content(text)
    if not cleaned:
        return ""

    leading_title_pattern = (
        r"^(?:experienced|seasoned|senior|lead|principal|results-driven|skilled|accomplished)\s+"
        r"[a-z0-9/&,+\-\s]{0,60}\b(?:developer|engineer|architect|consultant|manager|analyst|administrator|specialist|lead)\b"
        r"\s*(?=(?:with|focused|specializing|specialised|who|having)\b)"
    )
    cleaned = re.sub(leading_title_pattern, "", cleaned, flags=re.IGNORECASE).lstrip(" ,.-")
    cleaned = _compact_spaces(cleaned)
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned


def _should_merge_with_previous(previous_block: dict, current_block: dict) -> bool:
    if previous_block["type"] == "bullet" and current_block["type"] in {"paragraph", "bullet"}:
        text = current_block["text"]
        return (
            not _is_section_heading(text)
            and not _looks_like_emphasis_line(text)
            and not _is_personal_info_text(text)
            and not _is_education_text(text)
            and text[:1].islower()  # only merge true lowercase continuations
        )

    if previous_block["type"] == "paragraph" and current_block["type"] == "paragraph":
        prev_text = previous_block["text"]
        curr_text = current_block["text"]
        if _is_section_heading(curr_text) or _looks_like_emphasis_line(curr_text):
            return False
        if prev_text.endswith((".", "!", "?", ":")):
            return False
        if curr_text[:1].islower():
            return True
        if len(prev_text.split()) <= 8 and len(curr_text.split()) <= 8:
            # Never merge "Label: Value" skill lines (e.g. "Languages: Java 8/17")
            if ":" in prev_text or ":" in curr_text:
                return False
            return True
    return False


def _postprocess_body_blocks(body_blocks: list[dict], sanitized_name: str) -> list[dict]:
    processed = []
    seen_block_keys = set()

    for block in body_blocks:
        text = _compact_spaces(_collapse_inline_duplicate_content(block["text"]))
        if not text:
            continue
        if _normalize_for_matching(text) == _normalize_for_matching(sanitized_name):
            continue

        normalized_text = _normalized_alnum(text)
        block_key = (block["type"], normalized_text)
        if normalized_text and block_key in seen_block_keys:
            continue

        current = {"type": block["type"], "text": text}
        if processed:
            previous_normalized = _normalize_for_matching(processed[-1]["text"])
            current_normalized = _normalize_for_matching(text)
            if (
                current["type"] == "paragraph"
                and len(current_normalized) <= 60
                and current_normalized
                and current_normalized in previous_normalized
            ):
                continue
        if processed and _should_merge_with_previous(processed[-1], current):
            processed[-1]["text"] = _compact_spaces(f"{processed[-1]['text']} {text}")
            continue

        processed.append(current)
        if normalized_text:
            seen_block_keys.add(block_key)

    return processed


def sanitize_resume_content(resume_text: str, candidate_name: str) -> dict:
    extracted_name = _extract_resume_name(resume_text, candidate_name)
    sanitized_name = sanitize_name(extracted_name)
    normalized_candidate_names = {
        _normalize_for_matching(candidate_name),
        _normalize_for_matching(extracted_name),
        _normalize_for_matching(_extract_candidate_name_hint(candidate_name)),
        _normalize_for_matching(sanitized_name),
    }
    body_blocks = []
    inside_education_section = False
    inside_skill_section = False
    current_section = ""
    pending_bullet = False

    for raw_line in (resume_text or "").splitlines():
        line = _compact_spaces(_collapse_inline_duplicate_content(raw_line))
        line = _normalize_char_spaced_line(line)
        if not line:
            continue

        if _normalize_for_matching(line) in normalized_candidate_names:
            continue

        if not _has_meaningful_content(line):
            pending_bullet = "\u2022" in raw_line or "*" in raw_line or "-" in raw_line
            continue

        if _is_section_heading(line):
            current_section = line
            inside_education_section = _is_education_text(line)
            inside_skill_section = _is_skill_section(line)
            if inside_education_section:
                continue
            body_blocks.append({
                "type": "heading",
                "text": line,
            })
            continue

        if inside_education_section:
            continue

        if _should_remove_education_line(line) and (
            not _is_experience_section(current_section) or _is_education_heading(line)
        ):
            continue

        if _is_personal_info_text(line):
            pending_bullet = False
            continue

        cleaned_line = remove_personal_info(line)
        if inside_education_section or _should_remove_education_line(line):
            cleaned_line = remove_education_content(cleaned_line)
        cleaned_line = _collapse_inline_duplicate_content(cleaned_line)
        cleaned_line = _compact_spaces(cleaned_line)
        # Remove squashed all-caps tokens from PDF char-spacing (e.g. "GUNDERAYAPATIL").
        # Legitimate tech acronyms (OOP, JPA, MVC, JWT …) are ≤ 8 chars; anything longer
        # is almost certainly a concatenated name or junk from the PDF sidebar.
        if re.search(r"\b[A-Z]{9,}\b", cleaned_line):
            cleaned_line = re.sub(r"\b[A-Z]{9,}\b", "", cleaned_line)
            cleaned_line = _compact_spaces(cleaned_line)

        if not cleaned_line or not _has_meaningful_content(cleaned_line) or _is_personal_info_text(cleaned_line):
            pending_bullet = False
            continue
        if (
            _normalize_for_matching(sanitized_name).split()[0] in _normalize_for_matching(cleaned_line)
            and len(re.findall(r"[A-Za-z]", cleaned_line)) <= len(re.findall(r"[A-Za-z]", sanitized_name)) + 2
        ):
            continue
        if (
            not current_section
            and len(cleaned_line.split()) <= 3
            and len(re.findall(r"[A-Za-z]", cleaned_line)) <= 6
            and not _looks_like_name(cleaned_line)
            and not any(keyword in _normalize_for_matching(cleaned_line) for keyword in [*TITLE_KEYWORDS, "designer", "summary", "profile"])
        ):
            continue

        # Skip camelCase compound tokens that are concatenated job titles from PDF
        # char-spacing artefacts (e.g. "JavaFullStackDeveloper").  They contain no
        # useful content after anonymisation and are not skill items.
        if (
            " " not in cleaned_line
            and len(cleaned_line) > 12
            and any(
                kw in _normalize_for_matching(re.sub(r"([A-Z])", r" \1", cleaned_line))
                for kw in TITLE_KEYWORDS
            )
        ):
            continue

        bullet_text = _clean_bullet_prefix(cleaned_line)
        is_bullet = (bullet_text != cleaned_line and bullet_text) or pending_bullet
        pending_bullet = False
        block_type = "bullet" if is_bullet else "paragraph"

        # Under a skills section, short lines with no sentence punctuation are individual
        # skill bullets — e.g. "Core Java", "Spring Boot", "JWT Token".
        # Classifying them as bullets prevents _should_merge_with_previous from joining them.
        if (
            not is_bullet
            and inside_skill_section
            and len(cleaned_line.split()) <= 6
            and not cleaned_line.endswith((".", "!", "?"))
            and not re.search(r"\b(?:19|20)\d{2}\b", cleaned_line)
        ):
            block_type = "bullet"
            is_bullet = True

        if (
            not body_blocks
            and not current_section
            and any(
                keyword in _normalize_for_matching(cleaned_line)
                for keyword in [*TITLE_KEYWORDS, "designer", "associate", "consultant", "scientist", "founder"]
            )
            and len(cleaned_line.split()) <= 8
        ):
            block_type = "title"
        if not is_bullet and _looks_like_emphasis_line(cleaned_line, current_section=current_section):
            block_type = "title"
        if (
            block_type == "paragraph"
            and body_blocks
            and body_blocks[-1]["type"] == "bullet"
            and cleaned_line[:1].islower()
        ):
            body_blocks[-1]["text"] = _compact_spaces(f"{body_blocks[-1]['text']} {cleaned_line}")
            continue
        body_blocks.append({
            "type": block_type,
            "text": bullet_text if is_bullet else cleaned_line,
        })

    body_blocks = _postprocess_body_blocks(body_blocks, sanitized_name)

    return {
        "name": sanitized_name,
        "body_blocks": body_blocks,
    }


def remove_candidate_name_references(text: str, candidate_names=None) -> str:
    cleaned = str(text or "")
    for candidate_name in candidate_names or []:
        normalized_name = _compact_spaces(candidate_name)
        if not normalized_name:
            continue
        cleaned = re.sub(rf"\b{re.escape(normalized_name)}\b", "", cleaned, flags=re.IGNORECASE)
    return "\n".join(
        line for line in (_compact_spaces(line) for line in cleaned.splitlines()) if line
    ).strip()


def _clean_text(value: str, candidate_names=None) -> str:
    cleaned = remove_education_content(remove_personal_info(str(value or "")))
    cleaned = remove_years_worked(cleaned)
    return remove_candidate_name_references(cleaned, candidate_names)


def _clean_list(values, candidate_names=None):
    cleaned = []
    for value in values or []:
        text = _clean_text(value, candidate_names)
        if text and not _should_drop_text(text):
            cleaned.append(text)
    return cleaned


def _clean_competencies(competencies: dict, candidate_names=None) -> dict:
    cleaned = {}
    for heading, items in (competencies or {}).items():
        label = _compact_spaces(str(heading))
        if _should_drop_text(label):
            continue
        cleaned_items = _clean_list(items, candidate_names)
        if label and cleaned_items:
            cleaned[label] = cleaned_items
    return cleaned


def _clean_experience_entries(entries, candidate_names=None) -> list:
    cleaned_entries = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue

        raw_company = str(entry.get("company", "") or "")
        raw_location = str(entry.get("location", "") or "")
        raw_dates = str(entry.get("dates", "") or "")
        raw_title = str(entry.get("title", "") or "")
        raw_highlights = [str(value or "") for value in entry.get("highlights", [])]

        if any(
            _is_education_text(value)
            for value in [raw_company, raw_location, raw_dates, raw_title, *raw_highlights]
            if value
        ):
            continue

        cleaned_entry = {
            "company": _clean_text(raw_company, candidate_names),
            "location": _clean_text(raw_location, candidate_names),
            "dates": _clean_text(raw_dates, candidate_names),
            "title": _clean_text(raw_title, candidate_names),
            "highlights": _clean_list(raw_highlights, candidate_names),
        }

        if any(
            _is_education_text(cleaned_entry[field]) or _is_personal_info_text(cleaned_entry[field])
            for field in ["company", "location", "dates", "title"]
            if cleaned_entry[field]
        ):
            continue

        if any(
            [
                cleaned_entry["company"],
                cleaned_entry["location"],
                cleaned_entry["dates"],
                cleaned_entry["title"],
                cleaned_entry["highlights"],
            ]
        ):
            cleaned_entries.append(cleaned_entry)
    return cleaned_entries


def apply_resume_rules(profile: dict, candidate_name: str) -> dict:
    profile = profile or {}
    sanitized = {}
    candidate_names = {
        _compact_spaces(profile.get("name", "")),
        _compact_spaces(candidate_name),
    }
    candidate_names.discard("")
    company_names = {
        _compact_spaces(entry.get("company", ""))
        for entry in profile.get("professional_experience", [])
        if isinstance(entry, dict)
    }
    title_names = {
        _compact_spaces(entry.get("title", ""))
        for entry in profile.get("professional_experience", [])
        if isinstance(entry, dict)
    }
    removable_names = {value for value in [*candidate_names, *company_names, *title_names] if value}

    sanitized["name"] = sanitize_name(profile.get("name") or candidate_name)
    sanitized["summary"] = remove_job_title_phrases(_clean_text(profile.get("summary", ""), removable_names))
    sanitized["core_competencies"] = _clean_competencies(profile.get("core_competencies", {}), removable_names)
    sanitized["professional_experience"] = _clean_experience_entries(profile.get("professional_experience", []), removable_names)
    sanitized["domain_expertise"] = _clean_list(profile.get("domain_expertise", []), removable_names)
    sanitized["key_achievements"] = _clean_list(profile.get("key_achievements", []), removable_names)
    sanitized["certifications"] = _clean_list(profile.get("certifications", []), removable_names)

    # Explicitly remove all education content in final output.
    sanitized["education"] = []

    # Explicitly remove company/title/date/location fields from experience.
    for entry in sanitized["professional_experience"]:
        entry["company"] = ""
        entry["location"] = ""
        entry["dates"] = ""
        entry["title"] = ""

    return sanitized
