import base64
import json
import os
import re
from urllib import error, request

import fitz


OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_TAGS_URL = "http://localhost:11434/api/tags"
DEFAULT_TEXT_MODEL_PREFERENCE = [
    "qwen2.5:72b",
    "qwen2.5:32b",
    "qwen2.5:14b",
    "llama3.3:70b",
    "llama3.1:8b",
    "qwen2.5:3b",
]
DEFAULT_VISION_MODEL_PREFERENCE = [
    "qwen2.5vl:72b",
    "qwen2.5vl:32b",
    "qwen2.5vl:7b",
    "llava:34b",
    "bakllava:7b",
]
MAX_RESUME_CHARS = 9000
MAX_REDACTION_BLOCK_CHARS = 14000
MAX_LAYOUT_TEXT_CHARS = 12000
MAX_LAYOUT_IMAGES = 4
CONTACT_HINTS = ("@", "linkedin", "github", "portfolio", "phone", "mobile", "contact", "address")
PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "summary": {"type": "string"},
        "core_competencies": {
            "type": "object",
            "properties": {
                "Technical Expertise": {"type": "array", "items": {"type": "string"}},
                "Tools & Platforms": {"type": "array", "items": {"type": "string"}},
                "Delivery & Functional Strengths": {"type": "array", "items": {"type": "string"}},
            },
            "additionalProperties": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "professional_experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "location": {"type": "string"},
                    "dates": {"type": "string"},
                    "title": {"type": "string"},
                    "highlights": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["company", "location", "dates", "title", "highlights"],
            },
        },
        "domain_expertise": {"type": "array", "items": {"type": "string"}},
        "key_achievements": {"type": "array", "items": {"type": "string"}},
        "certifications": {"type": "array", "items": {"type": "string"}},
        "education": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "name",
        "summary",
        "core_competencies",
        "professional_experience",
        "domain_expertise",
        "key_achievements",
        "certifications",
        "education",
    ],
}
RESUME_RENDER_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "core_competencies": {
            "type": "object",
            "additionalProperties": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "professional_experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "location": {"type": "string"},
                    "dates": {"type": "string"},
                    "title": {"type": "string"},
                    "highlights": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["company", "location", "dates", "title", "highlights"],
            },
        },
        "key_achievements": {"type": "array", "items": {"type": "string"}},
        "certifications": {"type": "array", "items": {"type": "string"}},
        "additional_sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": "string"},
                    "items": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["heading", "items"],
            },
        },
    },
    "required": [
        "name",
        "headline",
        "summary",
        "core_competencies",
        "professional_experience",
        "key_achievements",
        "certifications",
        "additional_sections",
    ],
}
REDACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "remove_ids": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["remove_ids"],
}
PDF_LAYOUT_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "body_blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string"},
                    "text": {"type": "string"},
                },
                "required": ["type", "text"],
            },
        },
    },
    "required": ["name", "body_blocks"],
}
ALLOWED_BLOCK_TYPES = {"heading", "title", "paragraph", "bullet"}
EXTRACTION_STAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "summary": {"type": "string"},
        "experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "role": {"type": "string"},
                    "duration": {"type": "string"},
                    "location": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                    "environment": {"type": "array", "items": {"type": "string"}},
                    "projects": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["company", "role", "duration", "location", "bullets", "environment", "projects"],
            },
        },
        "skills": {"type": "array", "items": {"type": "string"}},
        "extra": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["name", "summary", "experience", "skills", "extra"],
}
FINAL_STAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "summary": {"type": "string"},
        "experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "role": {"type": "string"},
                    "duration": {"type": "string"},
                    "location": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["company", "role", "duration", "location", "bullets"],
            },
        },
        "skills": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["name", "summary", "experience", "skills"],
}
VALIDATION_STAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "all_companies_preserved": {"type": "boolean"},
        "all_roles_preserved": {"type": "boolean"},
        "all_bullets_preserved": {"type": "boolean"},
        "skills_preserved": {"type": "boolean"},
        "personal_info_removed": {"type": "boolean"},
        "education_removed": {"type": "boolean"},
        "issues": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "all_companies_preserved",
        "all_roles_preserved",
        "all_bullets_preserved",
        "skills_preserved",
        "personal_info_removed",
        "education_removed",
        "issues",
    ],
}
PIPELINE_STAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "step_1_extraction": EXTRACTION_STAGE_SCHEMA,
        "step_2_sanitization": EXTRACTION_STAGE_SCHEMA,
        "step_3_normalization": EXTRACTION_STAGE_SCHEMA,
        "step_4_mphasis_transformation": FINAL_STAGE_SCHEMA,
        "step_5_validation": VALIDATION_STAGE_SCHEMA,
        "step_6_final_output": FINAL_STAGE_SCHEMA,
    },
    "required": [
        "step_1_extraction",
        "step_2_sanitization",
        "step_3_normalization",
        "step_4_mphasis_transformation",
        "step_5_validation",
        "step_6_final_output",
    ],
}
PERSONAL_INFO_PATTERNS = [
    r"\b[\w\.-]+@[\w\.-]+\.\w+\b",
    r"(?:\+?\d[\d\-\s\(\)]{7,}\d)",
    r"(?:https?://\S+|www\.\S+)",
    r"\b(?:linkedin|github|twitter|behance|instagram|facebook)\.com/\S*",
    r"\b(?:linkedin|github|portfolio)\b",
]
EDUCATION_TERMS = (
    "bachelor",
    "master",
    "m.tech",
    "b.tech",
    "mba",
    "mca",
    "bca",
    "b.sc",
    "m.sc",
    "phd",
    "education",
    "university",
    "college",
    "school",
    "institute",
    "diploma",
    "gpa",
    "cgpa",
)


def _extract_json_block(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _read_env_preferences(env_name: str, default: list[str]) -> list[str]:
    raw = os.getenv(env_name, "").strip()
    if raw:
        return [item.strip() for item in raw.split(",") if item.strip()]
    return list(default)


def _get_model_preference() -> list[str]:
    return _read_env_preferences("OLLAMA_RESUME_MODELS", DEFAULT_TEXT_MODEL_PREFERENCE)


def _get_vision_model_preference() -> list[str]:
    return _read_env_preferences("OLLAMA_RESUME_VISION_MODELS", DEFAULT_VISION_MODEL_PREFERENCE)


def _get_available_models() -> set[str]:
    req = request.Request(OLLAMA_TAGS_URL, method="GET")
    try:
        with request.urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (error.URLError, TimeoutError, json.JSONDecodeError):
        return set()

    return {
        model.get("name", "").strip()
        for model in body.get("models", [])
        if isinstance(model, dict) and model.get("name")
    }


def _select_model(preferred_models: list[str] | None = None, available_models: set[str] | None = None) -> str:
    preferred_models = preferred_models or _get_model_preference()
    available_models = available_models if available_models is not None else _get_available_models()

    for model_name in preferred_models:
        if model_name in available_models:
            return model_name
        for available in available_models:
            if available == model_name or available.startswith(f"{model_name}-") or available.startswith(f"{model_name}:"):
                return available

    return preferred_models[0]


def _select_text_model(available_models: set[str] | None = None) -> str:
    return _select_model(_get_model_preference(), available_models)


def _select_vision_model(available_models: set[str] | None = None) -> str:
    return _select_model(_get_vision_model_preference(), available_models)


def _coerce_string_list(values):
    if values is None:
        return []
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return []
    return [str(item).strip() for item in values if str(item).strip()]


def _prepare_resume_text(resume_text: str) -> str:
    lines = []
    seen = set()

    for raw_line in (resume_text or "").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        lowered = line.lower()
        if not line:
            continue
        if len(line) < 4 and not any(ch.isalpha() for ch in line):
            continue
        if any(hint in lowered for hint in CONTACT_HINTS):
            continue
        if line in seen:
            continue
        seen.add(line)
        lines.append(line)

    compacted = "\n".join(lines)
    if len(compacted) > MAX_RESUME_CHARS:
        compacted = compacted[:MAX_RESUME_CHARS].rsplit("\n", 1)[0]
    return compacted


def _normalize_profile(profile: dict, candidate_name: str) -> dict:
    profile = profile if isinstance(profile, dict) else {}
    competencies = profile.get("core_competencies", {})
    if not isinstance(competencies, dict):
        competencies = {}

    normalized_competencies = {}
    for key, value in competencies.items():
        cleaned_key = str(key).strip()
        cleaned_values = _coerce_string_list(value)
        if cleaned_key and cleaned_values:
            normalized_competencies[cleaned_key] = cleaned_values

    experience_entries = []
    for entry in profile.get("professional_experience", []) if isinstance(profile.get("professional_experience", []), list) else []:
        if not isinstance(entry, dict):
            continue
        experience_entries.append({
            "company": str(entry.get("company", "") or "").strip(),
            "location": str(entry.get("location", "") or "").strip(),
            "dates": str(entry.get("dates", "") or "").strip(),
            "title": str(entry.get("title", "") or "").strip(),
            "highlights": _coerce_string_list(entry.get("highlights", [])),
        })

    return {
        "name": str(profile.get("name") or candidate_name).strip(),
        "summary": str(profile.get("summary", "") or "").strip(),
        "core_competencies": normalized_competencies,
        "professional_experience": experience_entries,
        "domain_expertise": _coerce_string_list(profile.get("domain_expertise", [])),
        "key_achievements": _coerce_string_list(profile.get("key_achievements", [])),
        "certifications": _coerce_string_list(profile.get("certifications", [])),
        "education": _coerce_string_list(profile.get("education", [])),
    }


def _normalize_render_profile(profile: dict, candidate_name: str) -> dict:
    profile = profile if isinstance(profile, dict) else {}
    competencies = profile.get("core_competencies", {})
    if not isinstance(competencies, dict):
        competencies = {}

    normalized_competencies = {}
    for key, value in competencies.items():
        cleaned_key = str(key).strip()
        cleaned_values = _coerce_string_list(value)
        if cleaned_key and cleaned_values:
            normalized_competencies[cleaned_key] = cleaned_values

    experience_entries = []
    raw_experience = profile.get("professional_experience", [])
    if not isinstance(raw_experience, list):
        raw_experience = []
    for entry in raw_experience:
        if not isinstance(entry, dict):
            continue
        experience_entries.append({
            "company": str(entry.get("company", "") or "").strip(),
            "location": str(entry.get("location", "") or "").strip(),
            "dates": str(entry.get("dates", "") or "").strip(),
            "title": str(entry.get("title", "") or "").strip(),
            "highlights": _coerce_string_list(entry.get("highlights", [])),
        })

    additional_sections = []
    raw_sections = profile.get("additional_sections", [])
    if not isinstance(raw_sections, list):
        raw_sections = []
    for section in raw_sections:
        if not isinstance(section, dict):
            continue
        heading = str(section.get("heading", "") or "").strip()
        items = _coerce_string_list(section.get("items", []))
        if heading and items:
            additional_sections.append({
                "heading": heading,
                "items": items,
            })

    return {
        "name": str(profile.get("name") or candidate_name).strip(),
        "headline": str(profile.get("headline", "") or "").strip(),
        "summary": str(profile.get("summary", "") or "").strip(),
        "core_competencies": normalized_competencies,
        "professional_experience": experience_entries,
        "key_achievements": _coerce_string_list(profile.get("key_achievements", [])),
        "certifications": _coerce_string_list(profile.get("certifications", [])),
        "additional_sections": additional_sections,
    }


def _normalize_pdf_layout(layout: dict, candidate_name: str) -> dict:
    layout = layout if isinstance(layout, dict) else {}
    blocks = []
    for block in layout.get("body_blocks", []) if isinstance(layout.get("body_blocks", []), list) else []:
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type", "paragraph") or "paragraph").strip().lower()
        text = re.sub(r"\s+", " ", str(block.get("text", "") or "")).strip()
        if block_type not in ALLOWED_BLOCK_TYPES:
            block_type = "paragraph"
        if not text:
            continue
        blocks.append({
            "type": block_type,
            "text": text,
        })

    return {
        "name": str(layout.get("name") or candidate_name).strip(),
        "body_blocks": blocks,
    }


def _normalize_name_initial(name: str, fallback_name: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(name or fallback_name or "")).strip()
    if not cleaned:
        return fallback_name
    if cleaned.upper() == cleaned:
        cleaned = " ".join(part.capitalize() for part in cleaned.split())
    parts = cleaned.split()
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0].upper()}."


def _normalize_extraction_stage(stage: dict, candidate_name: str) -> dict:
    stage = stage if isinstance(stage, dict) else {}
    experience = []
    raw_experience = stage.get("experience", [])
    if not isinstance(raw_experience, list):
        raw_experience = []

    for entry in raw_experience:
        if not isinstance(entry, dict):
            continue
        experience.append({
            "company": str(entry.get("company", "") or "").strip(),
            "role": str(entry.get("role", "") or "").strip(),
            "duration": str(entry.get("duration", "") or "").strip(),
            "location": str(entry.get("location", "") or "").strip(),
            "bullets": _coerce_string_list(entry.get("bullets", [])),
            "environment": _coerce_string_list(entry.get("environment", [])),
            "projects": _coerce_string_list(entry.get("projects", [])),
        })

    return {
        "name": str(stage.get("name") or candidate_name).strip(),
        "summary": str(stage.get("summary", "") or "").strip(),
        "experience": experience,
        "skills": _coerce_string_list(stage.get("skills", [])),
        "extra": _coerce_string_list(stage.get("extra", [])),
    }


def _normalize_final_stage(stage: dict, candidate_name: str) -> dict:
    stage = stage if isinstance(stage, dict) else {}
    experience = []
    raw_experience = stage.get("experience", [])
    if not isinstance(raw_experience, list):
        raw_experience = []

    for entry in raw_experience:
        if not isinstance(entry, dict):
            continue
        experience.append({
            "company": str(entry.get("company", "") or "").strip(),
            "role": str(entry.get("role", "") or "").strip(),
            "duration": str(entry.get("duration", "") or "").strip(),
            "location": str(entry.get("location", "") or "").strip(),
            "bullets": _coerce_string_list(entry.get("bullets", [])),
        })

    return {
        "name": str(stage.get("name") or candidate_name).strip(),
        "summary": str(stage.get("summary", "") or "").strip(),
        "experience": experience,
        "skills": _coerce_string_list(stage.get("skills", [])),
    }


def _normalize_validation_stage(stage: dict) -> dict:
    stage = stage if isinstance(stage, dict) else {}
    return {
        "all_companies_preserved": bool(stage.get("all_companies_preserved", False)),
        "all_roles_preserved": bool(stage.get("all_roles_preserved", False)),
        "all_bullets_preserved": bool(stage.get("all_bullets_preserved", False)),
        "skills_preserved": bool(stage.get("skills_preserved", False)),
        "personal_info_removed": bool(stage.get("personal_info_removed", False)),
        "education_removed": bool(stage.get("education_removed", False)),
        "issues": _coerce_string_list(stage.get("issues", [])),
    }


def _normalize_pipeline_response(payload: dict, candidate_name: str) -> dict:
    payload = payload if isinstance(payload, dict) else {}
    return {
        "step_1_extraction": _normalize_extraction_stage(payload.get("step_1_extraction", {}), candidate_name),
        "step_2_sanitization": _normalize_extraction_stage(payload.get("step_2_sanitization", {}), candidate_name),
        "step_3_normalization": _normalize_extraction_stage(payload.get("step_3_normalization", {}), candidate_name),
        "step_4_mphasis_transformation": _normalize_final_stage(payload.get("step_4_mphasis_transformation", {}), candidate_name),
        "step_5_validation": _normalize_validation_stage(payload.get("step_5_validation", {})),
        "step_6_final_output": _normalize_final_stage(payload.get("step_6_final_output", {}), candidate_name),
    }


def _render_pdf_pages_base64(pdf_path: str, max_pages: int = MAX_LAYOUT_IMAGES) -> list[str]:
    images = []
    with fitz.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf):
            if page_index >= max_pages:
                break
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            images.append(base64.b64encode(pixmap.tobytes("png")).decode("ascii"))
    return images


def _serialize_layout_preview(layout: dict) -> str:
    serialized = json.dumps(layout, ensure_ascii=False)
    if len(serialized) > MAX_LAYOUT_TEXT_CHARS:
        return serialized[:MAX_LAYOUT_TEXT_CHARS]
    return serialized


def _build_prompt(resume_text: str, candidate_name: str, retry: bool = False) -> str:
    retry_instruction = ""
    if retry:
        retry_instruction = (
            "\nIMPORTANT: Your previous answer was invalid. "
            "Return a valid JSON object only, with no markdown, no prose, and no code fences.\n"
        )

    return f"""
You are converting a candidate resume into a clean Mphasis submission profile for Mphasis.
{retry_instruction}
Return a valid JSON object only. Do not include markdown, commentary, or code fences.

Rules:
- Use only information grounded in the resume text.
- Do not invent employers, dates, degrees, or technologies.
- Keep the tone polished and recruiter-friendly.
- Make the profile look like a professional submission resume.
- Limit professional experience to the most relevant roles.
- Keep bullets concise and impact-oriented.
- Strictly exclude education details, personal information, company names, job titles, employment dates, and years worked from the final profile.
- Keep the summary focused on skills, technologies, domain exposure, certifications, and delivery strengths only.
- Convert experience into anonymized roles and responsibilities bullets.
- Leave professional_experience.company, professional_experience.location, professional_experience.dates, and professional_experience.title empty unless absolutely required for valid JSON.
- Do not include years of experience anywhere in the output.

Candidate name hint: {candidate_name}

Resume text:
{resume_text}
""".strip()


def _build_redaction_prompt(blocks, candidate_name: str, retry: bool = False) -> str:
    retry_instruction = ""
    if retry:
        retry_instruction = (
            "\nIMPORTANT: Your previous answer was invalid. "
            "Return valid JSON only, with no markdown, no prose, and no code fences.\n"
        )

    serialized_blocks = []
    total_chars = 0
    for block in blocks or []:
        block_id = str(block.get("id", "")).strip()
        text = str(block.get("text", "")).strip()
        if not block_id or not text:
            continue
        line = f"{block_id}: {text}"
        if total_chars + len(line) > MAX_REDACTION_BLOCK_CHARS:
            break
        serialized_blocks.append(line)
        total_chars += len(line) + 1

    serialized = "\n".join(serialized_blocks)

    return f"""
You are reviewing resume blocks for a strict redaction pass.
{retry_instruction}
Return a valid JSON object only. Do not include markdown, commentary, or code fences.

Task:
- Select only the block IDs that must be removed.
- Remove blocks only if they contain personal information or education details.
- Personal information includes phone numbers, email addresses, physical addresses, LinkedIn, GitHub, portfolio URLs, nationality, DOB, passport, visa, marital status, or similar contact/personal details.
- Education details includes education section headings, school or university names, degrees, diplomas, GPA, graduation dates, academic qualifications, academic background, coursework, and similar academic content.
- If a heading starts an education section, include that heading's ID in remove_ids.

Do not remove:
- The candidate's name block
- Job titles
- Company names
- Employment dates
- Roles and responsibilities
- Skills
- Certifications
- Project details
- Professional summary content

Candidate name hint: {candidate_name}

Resume blocks:
{serialized}
""".strip()


def _build_pdf_extraction_prompt(candidate_name: str, retry: bool = False) -> str:
    retry_instruction = ""
    if retry:
        retry_instruction = (
            "\nIMPORTANT: Your previous answer was invalid. "
            "Return a valid JSON object only, with no markdown, prose, or code fences.\n"
        )

    return f"""
You are reading resume pages and converting them into a clean, structured resume layout.
{retry_instruction}
Return a valid JSON object only.

Output schema:
- name: candidate name found inside the resume
- body_blocks: ordered blocks using only these types: heading, title, paragraph, bullet

Instructions:
- Read the pages in order and preserve the resume's actual content order.
- Keep the candidate's name.
- Remove contact and personal details such as email, phone, address, LinkedIn, GitHub, portfolio, nationality, DOB, passport, visa, and marital status.
- Remove the education section entirely.
- Preserve professional summary, technical skills, work experience, company names, role titles, locations, dates, certifications, projects, and achievement bullets.
- Use heading for section labels like WORK EXPERIENCE or TECHNICAL SKILLS.
- Use title for important lines that should be bold in the final resume, such as role titles, company lines, and date/location lines.
- Use bullet for actual bullet content.
- Use paragraph for normal summary sentences.
- Do not invent missing text.

Candidate name hint from filename: {candidate_name}
""".strip()


def _build_pdf_refinement_prompt(raw_text: str, initial_layout: dict, candidate_name: str, retry: bool = False) -> str:
    retry_instruction = ""
    if retry:
        retry_instruction = (
            "\nIMPORTANT: Your previous answer was invalid. "
            "Return a valid JSON object only, with no markdown, prose, or code fences.\n"
        )

    return f"""
You are refining a structured resume layout for a clean transformed resume.
{retry_instruction}
Return a valid JSON object only.

Goal:
- Produce a clean, professional transformed resume that preserves real candidate details.
- Keep work experience complete and do not skip company, title, date, location, or achievement details present in the source.
- Remove contact and personal details.
- Remove education content.
- Keep ordering professional and easy to format.

Output schema:
- name: candidate name
- body_blocks: ordered blocks using only heading, title, paragraph, bullet

Formatting rules:
- Keep the name from resume content, not the filename, when available.
- Prefer title blocks for role titles, company lines, and important date/location lines that should be bold.
- Prefer heading blocks for section names.
- Preserve bullet content as bullet blocks.
- Do not invent or summarize away experience details.

Candidate name hint: {candidate_name}

Raw extracted text:
{raw_text}

Initial layout JSON:
{_serialize_layout_preview(initial_layout)}
""".strip()


def _build_pdf_text_only_prompt(raw_text: str, candidate_name: str, retry: bool = False) -> str:
    retry_instruction = ""
    if retry:
        retry_instruction = (
            "\nIMPORTANT: Your previous answer was invalid. "
            "Return a valid JSON object only, with no markdown, prose, or code fences.\n"
        )

    return f"""
You are converting raw PDF resume text into a clean structured resume layout.
{retry_instruction}
Return a valid JSON object only.

Output schema:
- name: candidate name
- body_blocks: ordered blocks using only heading, title, paragraph, bullet

Instructions:
- Keep real candidate details from the resume.
- Do not skip company names, role titles, dates, locations, skills, certifications, project details, or work achievements.
- Remove contact and personal details.
- Remove education content.
- Use heading for section names.
- Use title for important lines that should be bold, such as current role, company lines, and date/location lines.
- Use bullet for achievement bullets.
- Use paragraph for normal prose.
- Preserve the most readable ordering possible from the source text.
- Do not invent missing information.

Candidate name hint: {candidate_name}

Raw extracted text:
{raw_text}
""".strip()


def _build_pdf_render_prompt(raw_text: str, candidate_name: str, retry: bool = False) -> str:
    retry_instruction = ""
    if retry:
        retry_instruction = (
            "\nIMPORTANT: Your previous answer was invalid. "
            "Return a valid JSON object only, with no markdown, prose, or code fences.\n"
        )

    return f"""
You are converting a PDF resume into a clean, professional structured resume for final DOCX rendering.
{retry_instruction}
Return a valid JSON object only.

Requirements:
- Preserve important candidate details from the source resume.
- Keep the candidate name.
- Capture a concise professional headline from the resume when available.
- Keep a professional summary.
- Keep technical skills grouped logically under core_competencies.
- Keep professional_experience fully structured with company, title, location, dates, and highlights.
- Keep certifications and notable achievements when present.
- Remove contact information, personal details, and education content.
- Do not anonymize company, title, dates, or location.
- Do not invent missing details.

Candidate hint from filename: {candidate_name}

Raw resume text:
{raw_text}
""".strip()


def _build_staged_resume_prompt(resume_text: str, candidate_name: str, retry: bool = False, issues: list[str] | None = None) -> str:
    retry_instruction = ""
    if retry:
        retry_instruction = (
            "\nIMPORTANT: Your previous answer was invalid or failed validation. "
            "Fix the issues and return a valid JSON object only, with no markdown, prose, or code fences.\n"
        )

    issue_text = ""
    if issues:
        issue_text = "\nValidation issues from the previous attempt:\n- " + "\n- ".join(issues) + "\n"

    return f"""
You are an expert resume transformation engine.

Your job is to transform the provided resume into Mphasis client format in a strict, step-by-step manner, without losing any work experience content.
{retry_instruction}
{issue_text}
NON-NEGOTIABLE RULES:
1. DO NOT drop any company, role, project, responsibility, achievement, environment, or bullet point from work experience.
2. DO NOT summarize work experience.
3. DO NOT merge companies or roles.
4. DO NOT combine multiple bullets into one if that causes loss of detail.
5. You may improve grammar, clarity, tense consistency, and formatting, but you must preserve the full meaning and detail.
6. Remove all personal information:
   - email
   - phone
   - LinkedIn
   - GitHub
   - portfolio links
   - full address
   - any other contact details
7. Remove all education details completely.
8. Output the name as: First Name + Initial only.
9. Preserve all relevant technical skills.
10. Keep the experience order exactly the same as in the input.

PROCESS:
Follow these exact internal steps and return a single valid JSON object with these keys:
- step_1_extraction
- step_2_sanitization
- step_3_normalization
- step_4_mphasis_transformation
- step_5_validation
- step_6_final_output

For steps 1, 2, and 3 use this schema:
{{
  "name": "",
  "summary": "",
  "experience": [
    {{
      "company": "",
      "role": "",
      "duration": "",
      "location": "",
      "bullets": [],
      "environment": [],
      "projects": []
    }}
  ],
  "skills": [],
  "extra": []
}}

For step 4 and step 6 use this schema:
{{
  "name": "",
  "summary": "",
  "experience": [
    {{
      "company": "",
      "role": "",
      "duration": "",
      "location": "",
      "bullets": []
    }}
  ],
  "skills": []
}}

For step 5 use this schema:
{{
  "all_companies_preserved": true,
  "all_roles_preserved": true,
  "all_bullets_preserved": true,
  "skills_preserved": true,
  "personal_info_removed": true,
  "education_removed": true,
  "issues": []
}}

Return valid JSON only.

Candidate hint: {candidate_name}

Resume text:
{resume_text}
""".strip()


def _request_json(
    prompt: str,
    selected_model: str,
    schema: dict,
    timeout: int = 240,
    images: list[str] | None = None,
) -> dict:
    payload_data = {
        "model": selected_model,
        "prompt": prompt,
        "stream": False,
        "format": schema,
        "keep_alive": "10m",
        "options": {
            "temperature": 0,
        },
    }
    if images:
        payload_data["images"] = images

    payload = json.dumps(payload_data).encode("utf-8")

    req = request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Ollama request failed for model '{selected_model}': {exc}") from exc

    model_response = body.get("response", "")
    if not model_response:
        raise RuntimeError("Ollama returned an empty transformation response")

    try:
        response_payload = _extract_json_block(model_response)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Ollama returned invalid JSON for model '{selected_model}': {exc}") from exc
    if not isinstance(response_payload, dict):
        raise RuntimeError(f"Ollama transformation response was not a JSON object for model '{selected_model}'")

    return response_payload


def _request_profile(prompt: str, selected_model: str) -> dict:
    return _request_json(prompt, selected_model, PROFILE_SCHEMA)


def _request_render_profile(prompt: str, selected_model: str, images: list[str] | None = None, timeout: int = 240) -> dict:
    return _request_json(prompt, selected_model, RESUME_RENDER_SCHEMA, timeout=timeout, images=images)


def _request_pipeline(prompt: str, selected_model: str, timeout: int = 360) -> dict:
    return _request_json(prompt, selected_model, PIPELINE_STAGE_SCHEMA, timeout=timeout)


def transform_resume_text(resume_text: str, candidate_name: str) -> dict:
    selected_model = _select_text_model()
    prepared_resume_text = _prepare_resume_text(resume_text)

    errors = []
    for retry in (False, True):
        prompt = _build_prompt(prepared_resume_text, candidate_name, retry=retry)
        try:
            profile = _request_profile(prompt, selected_model)
            return _normalize_profile(profile, candidate_name)
        except RuntimeError as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors))


def _extract_pdf_layout_from_images(pdf_path: str, candidate_name: str, vision_model: str) -> dict:
    page_images = _render_pdf_pages_base64(pdf_path)
    if not page_images:
        raise RuntimeError("No PDF pages were rendered for vision extraction")

    errors = []
    for retry in (False, True):
        prompt = _build_pdf_extraction_prompt(candidate_name, retry=retry)
        try:
            response_payload = _request_json(
                prompt,
                vision_model,
                PDF_LAYOUT_SCHEMA,
                timeout=300,
                images=page_images,
            )
            return _normalize_pdf_layout(response_payload, candidate_name)
        except RuntimeError as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors))


def _refine_pdf_layout_with_text(raw_text: str, candidate_name: str, initial_layout: dict, text_model: str) -> dict:
    prepared_resume_text = _prepare_resume_text(raw_text)
    errors = []

    for retry in (False, True):
        prompt = _build_pdf_refinement_prompt(prepared_resume_text, initial_layout, candidate_name, retry=retry)
        try:
            response_payload = _request_json(
                prompt,
                text_model,
                PDF_LAYOUT_SCHEMA,
                timeout=240,
            )
            return _normalize_pdf_layout(response_payload, candidate_name)
        except RuntimeError as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors))


def _build_pdf_layout_from_text(raw_text: str, candidate_name: str, text_model: str) -> dict:
    prepared_resume_text = _prepare_resume_text(raw_text)
    errors = []

    for retry in (False, True):
        prompt = _build_pdf_text_only_prompt(prepared_resume_text, candidate_name, retry=retry)
        try:
            response_payload = _request_json(
                prompt,
                text_model,
                PDF_LAYOUT_SCHEMA,
                timeout=240,
            )
            return _normalize_pdf_layout(response_payload, candidate_name)
        except RuntimeError as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors))


def _build_pdf_render_profile_from_text(raw_text: str, candidate_name: str, text_model: str) -> dict:
    prepared_resume_text = _prepare_resume_text(raw_text)
    errors = []

    for retry in (False, True):
        prompt = _build_pdf_render_prompt(prepared_resume_text, candidate_name, retry=retry)
        try:
            response_payload = _request_render_profile(prompt, text_model, timeout=300)
            return _normalize_render_profile(response_payload, candidate_name)
        except RuntimeError as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors))


def _build_pdf_render_profile_from_images(
    pdf_path: str,
    raw_text: str,
    candidate_name: str,
    vision_model: str,
) -> dict:
    prepared_resume_text = _prepare_resume_text(raw_text)
    page_images = _render_pdf_pages_base64(pdf_path)
    if not page_images:
        raise RuntimeError("No PDF pages were rendered for vision profile extraction")

    errors = []
    for retry in (False, True):
        prompt = _build_pdf_render_prompt(prepared_resume_text, candidate_name, retry=retry)
        try:
            response_payload = _request_render_profile(
                prompt,
                vision_model,
                images=page_images,
                timeout=360,
            )
            return _normalize_render_profile(response_payload, candidate_name)
        except RuntimeError as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors))


def build_pdf_resume_layout(pdf_path: str, raw_text: str, candidate_name: str) -> dict:
    available_models = _get_available_models()
    text_model = _select_text_model(available_models)
    vision_model = _select_vision_model(available_models)

    if text_model not in available_models:
        raise RuntimeError("No configured text resume model is available in Ollama")

    if vision_model in available_models:
        initial_layout = _extract_pdf_layout_from_images(pdf_path, candidate_name, vision_model)
        refined_layout = _refine_pdf_layout_with_text(raw_text, candidate_name, initial_layout, text_model)

        if refined_layout.get("body_blocks"):
            return refined_layout
        return initial_layout

    return _build_pdf_layout_from_text(raw_text, candidate_name, text_model)


def build_pdf_resume_profile(pdf_path: str, raw_text: str, candidate_name: str) -> dict:
    available_models = _get_available_models()
    text_model = _select_text_model(available_models)
    vision_model = _select_vision_model(available_models)

    if text_model not in available_models and vision_model not in available_models:
        raise RuntimeError("No configured resume extraction model is available in Ollama")

    if vision_model in available_models:
        try:
            return _build_pdf_render_profile_from_images(pdf_path, raw_text, candidate_name, vision_model)
        except RuntimeError:
            if text_model in available_models:
                return _build_pdf_render_profile_from_text(raw_text, candidate_name, text_model)
            raise

    return _build_pdf_render_profile_from_text(raw_text, candidate_name, text_model)


def _canonical_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _contains_personal_info(payload: dict) -> bool:
    text = json.dumps(payload, ensure_ascii=False)
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in PERSONAL_INFO_PATTERNS)


def _contains_education_terms(payload: dict) -> bool:
    text = json.dumps(payload, ensure_ascii=False).lower()
    return any(term in text for term in EDUCATION_TERMS)


def _build_fallback_final_output(stage: dict, candidate_name: str) -> dict:
    stage = _normalize_extraction_stage(stage, candidate_name)
    experience = []
    for entry in stage.get("experience", []):
        experience.append({
            "company": entry.get("company", ""),
            "role": entry.get("role", ""),
            "duration": entry.get("duration", ""),
            "location": entry.get("location", ""),
            "bullets": list(entry.get("bullets", [])),
        })

    return {
        "name": _normalize_name_initial(stage.get("name", ""), candidate_name),
        "summary": stage.get("summary", ""),
        "experience": experience,
        "skills": list(stage.get("skills", [])),
    }


def _validate_pipeline_output(pipeline: dict) -> list[str]:
    issues = []
    extracted = pipeline["step_1_extraction"]
    final_output = pipeline["step_6_final_output"]

    extracted_experience = extracted.get("experience", [])
    final_experience = final_output.get("experience", [])

    if len(extracted_experience) != len(final_experience):
        issues.append("The number of experience entries changed between extraction and final output.")

    for index, extracted_entry in enumerate(extracted_experience):
        if index >= len(final_experience):
            issues.append(f"Missing final experience entry for role index {index}.")
            continue

        final_entry = final_experience[index]
        extracted_company = _canonical_text(extracted_entry.get("company", ""))
        final_company = _canonical_text(final_entry.get("company", ""))
        if extracted_company and extracted_company not in final_company:
            issues.append(f"Company missing or changed at experience index {index}: '{extracted_entry.get('company', '')}'.")

        extracted_role = _canonical_text(extracted_entry.get("role", ""))
        final_role = _canonical_text(final_entry.get("role", ""))
        if extracted_role and extracted_role not in final_role:
            issues.append(f"Role missing or changed at experience index {index}: '{extracted_entry.get('role', '')}'.")

        extracted_bullets = [_canonical_text(item) for item in extracted_entry.get("bullets", []) if _canonical_text(item)]
        final_bullets = [_canonical_text(item) for item in final_entry.get("bullets", []) if _canonical_text(item)]
        if len(final_bullets) < len(extracted_bullets):
            issues.append(f"Bullet count decreased for experience index {index}.")
        for bullet in extracted_bullets:
            if not any(bullet in final_bullet or final_bullet in bullet for final_bullet in final_bullets):
                issues.append(f"A work-experience bullet is missing at experience index {index}.")
                break

    extracted_skills = [_canonical_text(item) for item in extracted.get("skills", []) if _canonical_text(item)]
    final_skills = [_canonical_text(item) for item in final_output.get("skills", []) if _canonical_text(item)]
    for skill in extracted_skills:
        if skill and skill not in final_skills:
            issues.append(f"Skill missing from final output: '{skill}'.")
            break

    if _contains_personal_info(final_output):
        issues.append("Personal information is still present in the final output.")

    if _contains_education_terms(final_output):
        issues.append("Education details are still present in the final output.")

    normalized_name = _normalize_name_initial(final_output.get("name", ""), extracted.get("name", ""))
    if final_output.get("name", "") != normalized_name:
        issues.append("Final output name is not normalized to first name plus initial.")

    return issues


def transform_resume_pipeline(resume_text: str, candidate_name: str) -> dict:
    selected_model = _select_text_model()
    prepared_resume_text = _prepare_resume_text(resume_text)
    errors = []
    last_pipeline = None

    for attempt, retry in enumerate((False, True), start=1):
        prompt = _build_staged_resume_prompt(prepared_resume_text, candidate_name, retry=retry, issues=errors[-3:] if errors else None)
        try:
            response_payload = _request_pipeline(prompt, selected_model, timeout=420)
            pipeline = _normalize_pipeline_response(response_payload, candidate_name)
            pipeline["step_2_sanitization"]["name"] = _normalize_name_initial(
                pipeline["step_2_sanitization"].get("name", ""),
                candidate_name,
            )
            pipeline["step_3_normalization"]["name"] = _normalize_name_initial(
                pipeline["step_3_normalization"].get("name", ""),
                candidate_name,
            )
            pipeline["step_4_mphasis_transformation"]["name"] = _normalize_name_initial(
                pipeline["step_4_mphasis_transformation"].get("name", ""),
                candidate_name,
            )
            pipeline["step_6_final_output"]["name"] = _normalize_name_initial(
                pipeline["step_6_final_output"].get("name", ""),
                candidate_name,
            )

            issues = _validate_pipeline_output(pipeline)
            if not issues:
                pipeline["step_5_validation"]["issues"] = []
                pipeline["step_5_validation"]["all_companies_preserved"] = True
                pipeline["step_5_validation"]["all_roles_preserved"] = True
                pipeline["step_5_validation"]["all_bullets_preserved"] = True
                pipeline["step_5_validation"]["skills_preserved"] = True
                pipeline["step_5_validation"]["personal_info_removed"] = True
                pipeline["step_5_validation"]["education_removed"] = True
                return pipeline

            pipeline["step_5_validation"]["issues"] = list(dict.fromkeys([*pipeline["step_5_validation"]["issues"], *issues]))
            pipeline["step_5_validation"]["all_companies_preserved"] = False
            pipeline["step_5_validation"]["all_roles_preserved"] = False
            pipeline["step_5_validation"]["all_bullets_preserved"] = False
            pipeline["step_5_validation"]["skills_preserved"] = False
            pipeline["step_5_validation"]["personal_info_removed"] = not any("Personal information" in issue for issue in issues)
            pipeline["step_5_validation"]["education_removed"] = not any("Education" in issue for issue in issues)
            pipeline["step_6_final_output"] = _build_fallback_final_output(
                pipeline["step_3_normalization"] or pipeline["step_2_sanitization"] or pipeline["step_1_extraction"],
                candidate_name,
            )
            last_pipeline = pipeline
            errors.extend(issues)
        except RuntimeError as exc:
            errors.append(str(exc))

    if last_pipeline:
        return last_pipeline
    raise RuntimeError("; ".join(errors))


def identify_resume_redactions(blocks, candidate_name: str):
    selected_model = _select_text_model()
    errors = []

    for retry in (False, True):
        prompt = _build_redaction_prompt(blocks, candidate_name, retry=retry)
        try:
            response_payload = _request_json(prompt, selected_model, REDACTION_SCHEMA, timeout=180)
            remove_ids = response_payload.get("remove_ids", [])
            if not isinstance(remove_ids, list):
                raise RuntimeError("Ollama redaction response did not contain a valid remove_ids list")
            return {
                str(item).strip()
                for item in remove_ids
                if str(item).strip()
            }
        except RuntimeError as exc:
            errors.append(str(exc))

    raise RuntimeError("; ".join(errors))
