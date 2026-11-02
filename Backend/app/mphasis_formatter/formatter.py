import os
import re
import shutil
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from PIL import Image, ImageDraw, ImageFont

from .rules import (
    _compact_spaces,
    _has_meaningful_content,
    _is_education_heading,
    _is_education_text,
    _looks_like_heading,
    _is_personal_info_text,
    _is_section_heading,
    remove_personal_info,
    sanitize_name,
)


LOGO_FILE = Path(__file__).with_name("mphasis_logo.png")

PHONE_PATTERN = re.compile(r"(?:\+?\d{1,3}[\s\-\.]?)?(?:\(?\d{3}\)?[\s\-\.]?)\d{3}[\s\-\.]?\d{4}")
EMAIL_PATTERN = re.compile(r"\b[\w\.-]+@[\w\.-]+\.\w+\b", re.IGNORECASE)
LINK_PATTERN = re.compile(r"(?:https?://\S+|www\.\S+|\b(?:linkedin|github|portfolio|behance)\b\s*[:\-].*)", re.IGNORECASE)
GPA_PATTERN = re.compile(r"\b(?:gpa|cgpa)\b", re.IGNORECASE)

SANITIZATION_ACTIONS = [
    ("contact_details", "Full contact details"),
    ("email", "Email addresses"),
    ("phone", "Phone numbers"),
    ("links", "LinkedIn/GitHub/portfolio links"),
    ("address", "Street address/location-style personal header details"),
    ("education", "Education section"),
    ("degree", "Degree names"),
    ("school", "University/college/institute names"),
    ("gpa", "GPA/CGPA"),
    ("academic", "Academic course/certification content when detected as education"),
]

PRESERVED_ACTIONS = [
    "Professional summary",
    "Technical skills",
    "Professional experience",
    "Company names",
    "Job titles",
    "Employment dates",
    "Projects and work highlights",
]


def _load_font(size: int, bold: bool = False):
    font_candidates = []
    if bold:
        font_candidates.extend(
            [
                r"C:\Windows\Fonts\arialbd.ttf",
                r"C:\Windows\Fonts\segoeuib.ttf",
                r"C:\Windows\Fonts\calibrib.ttf",
            ]
        )
    else:
        font_candidates.extend(
            [
                r"C:\Windows\Fonts\arial.ttf",
                r"C:\Windows\Fonts\segoeui.ttf",
                r"C:\Windows\Fonts\calibri.ttf",
            ]
        )

    for candidate in font_candidates:
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def _ensure_logo_image() -> str:
    if LOGO_FILE.exists():
        return str(LOGO_FILE)

    image = Image.new("RGBA", (460, 130), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)

    magenta = (219, 30, 118, 255)
    cyan = (94, 206, 255, 255)
    green = (132, 207, 62, 255)
    deep = (25, 25, 25, 255)
    gray = (99, 99, 99, 255)

    draw.polygon([(32, 48), (60, 20), (86, 46), (66, 66), (52, 54), (74, 32), (60, 18)], fill=magenta)
    draw.polygon([(22, 64), (48, 38), (64, 54), (36, 82), (18, 82), (12, 74)], fill=cyan)
    draw.polygon([(44, 86), (66, 64), (82, 80), (52, 110), (36, 110), (32, 102)], fill=green)

    title_font = _load_font(38, bold=True)
    tagline_font = _load_font(18, bold=False)

    draw.text((106, 24), "Mphasis", fill=deep, font=title_font)
    draw.text((110, 74), "The Next Applied", fill=gray, font=tagline_font)

    image.save(LOGO_FILE)
    return str(LOGO_FILE)


def _remove_paragraph(paragraph):
    element = paragraph._element
    parent = element.getparent()
    if parent is not None:
        parent.remove(element)


def _remove_table_row(row):
    element = row._tr
    parent = element.getparent()
    if parent is not None:
        parent.remove(element)


def _replace_paragraph_text_preserve_style(paragraph, text: str, *, bold: bool | None = None):
    # paragraph.runs does not include hyperlink runs, so clear the OOXML body
    # while preserving paragraph properties before writing sanitized text.
    for child in list(paragraph._p):
        if child.tag != qn("w:pPr"):
            paragraph._p.remove(child)
    run = paragraph.add_run(text)
    if bold is not None:
        run.bold = bold


def _looks_like_professional_history_line(text: str) -> bool:
    lowered = _compact_spaces(text).lower()
    if not lowered:
        return False
    role_terms = (
        "developer", "engineer", "analyst", "scientist", "consultant", "director",
        "manager", "lecturer", "founder", "associate", "administrator", "lead",
    )
    has_role = any(re.search(r"\b" + term + r"\b", lowered) for term in role_terms)
    has_date = bool(re.search(r"\b(?:19|20)\d{2}\b", text))
    degree_start = bool(re.match(
        r"^\s*(?:bsc|msc|mba|mca|mpa|phd|bachelor|master|b\.tech|m\.tech|btech|mtech|b\.e\.?|b\.sc|m\.sc|diploma)\b",
        lowered,
    ))
    return has_role and has_date and not degree_start


def _should_remove_education_paragraph(text: str) -> bool:
    if _is_education_heading(text):
        return True
    if not _is_education_text(text):
        return False
    return not _looks_like_professional_history_line(text)


def _is_table_section_after_education(text: str) -> bool:
    lowered = _compact_spaces(text).lower()
    if not lowered:
        return False
    return any(
        marker in lowered
        for marker in (
            "certification",
            "certifications",
            "licenses",
            "projects",
            "professional experience",
            "work experience",
            "employment",
            "technical skills",
            "skills",
        )
    )


def _configure_header_logo(document: Document):
    section = document.sections[0]
    header = section.header
    header_para = header.paragraphs[0] if header.paragraphs else header.add_paragraph()
    header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    # Clear existing header text/runs before adding the Mphasis logo.
    for run in list(header_para.runs):
        run._element.getparent().remove(run._element)

    logo_path = _ensure_logo_image()
    if os.path.exists(logo_path):
        header_para.add_run().add_picture(logo_path, width=Inches(2.2))


def _configure_document_layout(document: Document):
    section = document.sections[0]
    section.top_margin = Inches(0.65)
    section.bottom_margin = Inches(0.55)
    section.left_margin = Inches(0.7)
    section.right_margin = Inches(0.7)


def _add_text_run(paragraph, text: str, *, bold: bool = False, size: int = 11):
    run = paragraph.add_run(text)
    run.bold = bold
    run.font.name = "Calibri"
    run.font.size = Pt(size)
    return run


def _add_styled_paragraph(
    document: Document,
    text: str,
    *,
    bold: bool = False,
    size: int = 11,
    style: str | None = None,
    space_before: int = 0,
    space_after: int = 4,
):
    paragraph = document.add_paragraph()
    if style:
        paragraph.style = style
    paragraph.paragraph_format.space_before = Pt(space_before)
    paragraph.paragraph_format.space_after = Pt(space_after)
    _add_text_run(paragraph, text, bold=bold, size=size)
    return paragraph


def detect_sanitization_log_actions(text: str, *, in_education_section: bool = False) -> set[str]:
    cleaned = _compact_spaces(text)
    lowered = cleaned.lower()
    actions = set()

    if not cleaned:
        return actions
    if EMAIL_PATTERN.search(cleaned):
        actions.update({"contact_details", "email"})
    if PHONE_PATTERN.search(cleaned):
        actions.update({"contact_details", "phone"})
    if LINK_PATTERN.search(cleaned):
        actions.update({"contact_details", "links"})
    if _is_personal_info_text(cleaned):
        actions.update({"contact_details"})
        if any(
            term in lowered
            for term in (
                "address",
                "current location",
                "present location",
                "permanent address",
                "passport",
                "visa",
                "citizenship",
                "nationality",
                "marital status",
            )
        ):
            actions.add("address")
    if in_education_section or _is_education_heading(cleaned):
        actions.add("education")
    if _is_education_text(cleaned):
        if any(term in lowered for term in ("bachelor", "master", "b.tech", "m.tech", "b.e", "mba", "mca", "bca", "b.sc", "m.sc", "phd", "degree", "diploma")):
            actions.add("degree")
        if any(term in lowered for term in ("university", "college", "institute", "school", "academy")):
            actions.add("school")
        if GPA_PATTERN.search(cleaned):
            actions.add("gpa")
        if any(term in lowered for term in ("coursework", "academic", "academics", "certification", "certifications")):
            actions.add("academic")
        if not actions.intersection({"degree", "school", "gpa", "academic"}):
            actions.add("education")
    return actions


def _add_sanitization_log(document: Document, actions):
    action_set = set(actions or [])
    if not action_set:
        action_set = {"contact_details", "education"}

    _add_styled_paragraph(
        document,
        "Mphasis Sanitization Log",
        bold=True,
        size=11,
        space_before=12,
        space_after=3,
    )
    _add_styled_paragraph(
        document,
        "Removed or cleaned:",
        bold=True,
        size=10,
        space_after=2,
    )
    for key, label in SANITIZATION_ACTIONS:
        if key in action_set:
            _add_styled_paragraph(
                document,
                label,
                style="List Bullet",
                size=9,
                space_after=1,
            )

    _add_styled_paragraph(
        document,
        "Preserved:",
        bold=True,
        size=10,
        space_before=4,
        space_after=2,
    )
    for label in PRESERVED_ACTIONS:
        _add_styled_paragraph(
            document,
            label,
            style="List Bullet",
            size=9,
            space_after=1,
        )


def _sanitize_table_rows(document: Document):
    return _sanitize_table_rows_with_ai(document, set())


def _sanitize_table_rows_with_ai(document: Document, ai_remove_ids):
    for table_index, table in enumerate(document.tables):
        rows_to_remove = []
        inside_education_section = False
        for row_index, row in enumerate(table.rows):
            row_text = " ".join(_compact_spaces(cell.text) for cell in row.cells if _compact_spaces(cell.text))
            if not row_text:
                continue
            row_id = f"t:{table_index}:{row_index}"
            if inside_education_section and _is_table_section_after_education(row_text):
                inside_education_section = False
            if _is_section_heading(row_text) and not _is_education_heading(row_text):
                inside_education_section = False
            if _is_education_heading(row_text):
                inside_education_section = True
            if (
                row_id in ai_remove_ids
                or _is_personal_info_text(row_text)
                or inside_education_section
                or _should_remove_education_paragraph(row_text)
            ):
                rows_to_remove.append(row)
        for row in rows_to_remove:
            _remove_table_row(row)


def _strip_all_hyperlinks(document: Document):
    """Remove every hyperlink element from the document.

    If the visible link text is not personal info, it is kept as plain text.
    If it is personal info (URL, email, phone, LinkedIn …), the whole element is dropped.
    Runs over all paragraphs and table cells.
    """
    XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

    def _process_para(para):
        for hyperlink in list(para._p.findall(f".//{qn('w:hyperlink')}")):
            try:
                link_text = "".join(
                    (t.text or "") for t in hyperlink.findall(f".//{qn('w:t')}")
                )
                cleaned = _compact_spaces(link_text)
                parent = hyperlink.getparent()
                if parent is None:
                    continue
                children = list(parent)
                if hyperlink not in children:
                    continue
                idx = children.index(hyperlink)
                parent.remove(hyperlink)
                if cleaned and not _is_personal_info_text(cleaned):
                    run = OxmlElement("w:r")
                    t_elem = OxmlElement("w:t")
                    t_elem.text = cleaned
                    t_elem.set(XML_SPACE, "preserve")
                    run.append(t_elem)
                    parent.insert(idx, run)
            except Exception:
                pass

    for para in document.paragraphs:
        _process_para(para)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    _process_para(para)


def transform_docx_resume(source_path: str, output_path: str, candidate_name: str):
    shutil.copyfile(source_path, output_path)
    document = Document(output_path)
    sanitized_name = sanitize_name(candidate_name)

    first_content_paragraph = None
    inside_education_section = False
    paragraphs_to_remove = []
    log_actions = set()

    for paragraph in document.paragraphs:
        text = _compact_spaces(paragraph.text)
        if not text:
            continue

        if first_content_paragraph is None:
            first_content_paragraph = paragraph
            continue

    for paragraph_index, paragraph in enumerate(document.paragraphs):
        text = _compact_spaces(paragraph.text)
        if not text:
            continue

        if paragraph is first_content_paragraph:
            continue

        block_id = f"p:{paragraph_index}"

        if _is_section_heading(text):
            inside_education_section = _is_education_heading(text)
            if inside_education_section:
                log_actions.update(detect_sanitization_log_actions(text, in_education_section=True))
                paragraphs_to_remove.append(paragraph)
            continue

        if inside_education_section:
            log_actions.update(detect_sanitization_log_actions(text, in_education_section=True))
            paragraphs_to_remove.append(paragraph)
            continue

        if _is_personal_info_text(text):
            log_actions.update(detect_sanitization_log_actions(text))
            cleaned_text = _compact_spaces(remove_personal_info(text))
            if cleaned_text and _has_meaningful_content(cleaned_text):
                _replace_paragraph_text_preserve_style(paragraph, cleaned_text)
            else:
                paragraphs_to_remove.append(paragraph)
            continue

        if _should_remove_education_paragraph(text):
            log_actions.update(detect_sanitization_log_actions(text))
            paragraphs_to_remove.append(paragraph)

    if first_content_paragraph is not None:
        _replace_paragraph_text_preserve_style(first_content_paragraph, sanitized_name, bold=True)

    for paragraph in reversed(paragraphs_to_remove):
        _remove_paragraph(paragraph)

    for table in document.tables:
        for row in list(table.rows):
            row_text = " ".join(_compact_spaces(cell.text) for cell in row.cells if _compact_spaces(cell.text))
            if not row_text:
                continue
            if _is_personal_info_text(row_text) or _is_education_heading(row_text) or _should_remove_education_paragraph(row_text):
                log_actions.update(detect_sanitization_log_actions(row_text))

    _sanitize_table_rows_with_ai(document, set())
    _strip_all_hyperlinks(document)
    _configure_header_logo(document)
    document.save(output_path)
    return log_actions


def format_sanitized_resume_docx(candidate_name: str, body_lines, output_path: str, sanitization_log=None):
    document = Document()
    _configure_document_layout(document)
    _configure_header_logo(document)

    title = _add_styled_paragraph(
        document,
        sanitize_name(candidate_name),
        bold=True,
        size=16,
        space_after=10,
    )
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT

    for block in body_lines or []:
        block_type = block.get("type", "paragraph") if isinstance(block, dict) else "paragraph"
        text = block.get("text", "") if isinstance(block, dict) else str(block or "")
        text = _compact_spaces(text)
        if not text:
            continue
        if block_type == "heading":
            _add_styled_paragraph(
                document,
                text,
                bold=True,
                size=11,
                space_before=10,
                space_after=2,
            )
            continue
        if block_type == "title":
            _add_styled_paragraph(
                document,
                text,
                bold=True,
                size=11,
                space_before=2,
                space_after=1,
            )
            continue
        if block_type == "bullet":
            _add_styled_paragraph(
                document,
                text,
                style="List Bullet",
                size=10,
                space_after=1,
            )
            continue
        # Detect "Label: Value" skill lines (e.g. "Languages: Java 8/17") and bold the label
        colon_pos = text.find(": ")
        if 0 < colon_pos <= 30 and not text.startswith(("http", "www")):
            label_part = text[:colon_pos + 1]   # "Languages:"
            value_part = text[colon_pos + 1:]   # " Java 8/17"
            para = document.add_paragraph()
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.space_after = Pt(2)
            _add_text_run(para, label_part, bold=True, size=10)
            _add_text_run(para, value_part, size=10)
        else:
            _add_styled_paragraph(
                document,
                text,
                size=10,
                space_after=3,
            )

    document.save(output_path)


def format_resume_docx(profile: dict, output_path: str):
    document = Document()
    _configure_document_layout(document)
    _configure_header_logo(document)

    _add_styled_paragraph(
        document,
        profile.get("name", "Candidate"),
        bold=True,
        size=16,
        space_after=10,
    )

    for key in ("summary",):
        value = _compact_spaces(profile.get(key, ""))
        if value:
            _add_styled_paragraph(document, value, size=10, space_after=5)

    for section in (
        profile.get("core_competencies", {}),
        profile.get("professional_experience", []),
        profile.get("domain_expertise", []),
        profile.get("key_achievements", []),
        profile.get("certifications", []),
    ):
        if isinstance(section, dict):
            for heading, items in section.items():
                _add_styled_paragraph(
                    document,
                    _compact_spaces(heading),
                    bold=True,
                    size=11,
                    space_before=10,
                    space_after=2,
                )
                for item in items or []:
                    _add_styled_paragraph(
                        document,
                        _compact_spaces(str(item)),
                        style="List Bullet",
                        size=10,
                        space_after=1,
                    )
        elif isinstance(section, list):
            for item in section:
                if isinstance(item, dict):
                    for field in ("company", "title", "dates", "location"):
                        value = _compact_spaces(str(item.get(field, "")))
                        if value:
                            _add_styled_paragraph(
                                document,
                                value,
                                bold=True,
                                size=11,
                                space_before=2,
                                space_after=1,
                            )
                    for value in item.get("highlights", []) or []:
                        _add_styled_paragraph(
                            document,
                            _compact_spaces(str(value)),
                            style="List Bullet",
                            size=10,
                            space_after=1,
                        )
                else:
                    _add_styled_paragraph(
                        document,
                        _compact_spaces(str(item)),
                        style="List Bullet",
                        size=10,
                        space_after=1,
                    )

    document.save(output_path)


def format_pipeline_resume_docx(final_output: dict, output_path: str):
    document = Document()
    _configure_document_layout(document)
    _configure_header_logo(document)

    name = sanitize_name(final_output.get("name", "Candidate"))
    summary = _compact_spaces(final_output.get("summary", ""))
    experience = final_output.get("experience", []) or []
    skills = final_output.get("skills", []) or []

    _add_styled_paragraph(
        document,
        name,
        bold=True,
        size=16,
        space_after=8,
    )

    if summary:
        _add_styled_paragraph(
            document,
            "PROFESSIONAL SUMMARY",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        _add_styled_paragraph(document, summary, size=10, space_after=5)

    if experience:
        _add_styled_paragraph(
            document,
            "PROFESSIONAL EXPERIENCE",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        for entry in experience:
            company = _compact_spaces(str(entry.get("company", "")))
            role = _compact_spaces(str(entry.get("role", "")))
            duration = _compact_spaces(str(entry.get("duration", "")))
            location = _compact_spaces(str(entry.get("location", "")))

            if company:
                company_line = company
                if location:
                    company_line = f"{company_line} | {location}"
                _add_styled_paragraph(
                    document,
                    company_line,
                    bold=True,
                    size=11,
                    space_before=4,
                    space_after=1,
                )

            if role or duration:
                role_line = role
                if duration:
                    role_line = f"{role_line} | {duration}" if role_line else duration
                _add_styled_paragraph(
                    document,
                    role_line,
                    bold=True,
                    size=10,
                    space_after=1,
                )

            for bullet in entry.get("bullets", []) or []:
                cleaned_bullet = _compact_spaces(str(bullet))
                if cleaned_bullet:
                    _add_styled_paragraph(
                        document,
                        cleaned_bullet,
                        style="List Bullet",
                        size=10,
                        space_after=1,
                    )

    if skills:
        _add_styled_paragraph(
            document,
            "TECHNICAL SKILLS",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        _add_styled_paragraph(
            document,
            ", ".join(_compact_spaces(str(skill)) for skill in skills if _compact_spaces(str(skill))),
            size=10,
            space_after=4,
        )

    document.save(output_path)


def format_structured_resume_docx(profile: dict, output_path: str):
    document = Document()
    _configure_document_layout(document)
    _configure_header_logo(document)

    name = sanitize_name(profile.get("name", "Candidate"))
    headline = _compact_spaces(profile.get("headline", ""))
    summary = _compact_spaces(profile.get("summary", ""))
    competencies = profile.get("core_competencies", {}) or {}
    experience_entries = profile.get("professional_experience", []) or []
    key_achievements = profile.get("key_achievements", []) or []
    certifications = profile.get("certifications", []) or []
    additional_sections = profile.get("additional_sections", []) or []

    _add_styled_paragraph(
        document,
        name,
        bold=True,
        size=16,
        space_after=4,
    )
    if headline:
        _add_styled_paragraph(
            document,
            headline,
            bold=True,
            size=12,
            space_after=8,
        )

    if summary:
        _add_styled_paragraph(
            document,
            "PROFESSIONAL SUMMARY",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        _add_styled_paragraph(document, summary, size=10, space_after=6)

    if competencies:
        _add_styled_paragraph(
            document,
            "TECHNICAL SKILLS",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        for heading, items in competencies.items():
            skill_text = ", ".join(_compact_spaces(str(item)) for item in items if _compact_spaces(str(item)))
            if not skill_text:
                continue
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(2)
            _add_text_run(paragraph, f"{_compact_spaces(str(heading))}: ", bold=True, size=10)
            _add_text_run(paragraph, skill_text, size=10)

    if experience_entries:
        _add_styled_paragraph(
            document,
            "PROFESSIONAL EXPERIENCE",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        for entry in experience_entries:
            company = _compact_spaces(str(entry.get("company", "")))
            location = _compact_spaces(str(entry.get("location", "")))
            title = _compact_spaces(str(entry.get("title", "")))
            dates = _compact_spaces(str(entry.get("dates", "")))

            if company or location:
                company_line = company
                if location:
                    company_line = f"{company_line} | {location}" if company_line else location
                _add_styled_paragraph(
                    document,
                    company_line,
                    bold=True,
                    size=11,
                    space_before=4,
                    space_after=1,
                )

            if title or dates:
                title_line = title
                if dates:
                    title_line = f"{title_line} | {dates}" if title_line else dates
                _add_styled_paragraph(
                    document,
                    title_line,
                    bold=True,
                    size=10,
                    space_after=1,
                )

            for highlight in entry.get("highlights", []) or []:
                bullet = _compact_spaces(str(highlight))
                if not bullet:
                    continue
                _add_styled_paragraph(
                    document,
                    bullet,
                    style="List Bullet",
                    size=10,
                    space_after=1,
                )

    if key_achievements:
        _add_styled_paragraph(
            document,
            "KEY ACHIEVEMENTS",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        for item in key_achievements:
            bullet = _compact_spaces(str(item))
            if bullet:
                _add_styled_paragraph(document, bullet, style="List Bullet", size=10, space_after=1)

    if certifications:
        _add_styled_paragraph(
            document,
            "CERTIFICATIONS",
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        for item in certifications:
            bullet = _compact_spaces(str(item))
            if bullet:
                _add_styled_paragraph(document, bullet, style="List Bullet", size=10, space_after=1)

    for section in additional_sections:
        heading = _compact_spaces(str(section.get("heading", "")))
        items = section.get("items", []) or []
        if not heading:
            continue
        _add_styled_paragraph(
            document,
            heading.upper(),
            bold=True,
            size=11,
            space_before=8,
            space_after=3,
        )
        for item in items:
            bullet = _compact_spaces(str(item))
            if bullet:
                _add_styled_paragraph(document, bullet, style="List Bullet", size=10, space_after=1)

    document.save(output_path)
