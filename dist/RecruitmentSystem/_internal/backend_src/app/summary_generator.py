"""
summary_generator.py
────────────────────
Generates a rich, candidate-specific resume summary using Ollama.
Falls back to keyword extraction when Ollama is unavailable.

Every call to generate_summary() produces a FRESH response —
no local caching so each candidate gets a unique, tailored summary.
"""

import re
import requests

OLLAMA_URL    = "http://localhost:11434/api/generate"
DEFAULT_MODEL = "phi3:mini"


# ── Ollama helpers ─────────────────────────────────────────────

def _ollama_available() -> bool:
    try:
        r = requests.get("http://localhost:11434/api/tags", timeout=3)
        return r.status_code == 200
    except Exception:
        return False


def _get_best_model() -> str:
    """Return best available model, preferring phi3:mini for speed."""
    try:
        r      = requests.get("http://localhost:11434/api/tags", timeout=3)
        models = [m["name"] for m in r.json().get("models", [])]
        if not models:
            return DEFAULT_MODEL
        preferred = ["phi3:mini", "phi3", "llama3", "llama3.1"]
        for pref in preferred:
            for m in models:
                if m == pref or m.startswith(f"{pref}:"):
                    return m
        return models[0]
    except Exception:
        return DEFAULT_MODEL


def _call_ollama(prompt: str, model: str) -> str:
    payload = {
        "model":  model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": 220,
        },
    }
    r = requests.post(OLLAMA_URL, json=payload, timeout=120)
    r.raise_for_status()
    return r.json().get("response", "").strip()


# ── Keyword fallback ───────────────────────────────────────────

def _keyword_summary(resume_text: str) -> str:
    text = resume_text[:8000]

    # Years of experience
    exp_matches = re.findall(
        r"(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)", text, re.I
    )
    years_str = (
        f"{max(int(x) for x in exp_matches)} years"
        if exp_matches else "an unspecified period"
    )

    # Highest education
    edu_order = [
        "PhD", "Ph.D", "Doctorate",
        "Master", "MBA", "M.S.", "M.Sc", "M.Tech",
        "Bachelor", "B.S.", "B.Sc", "B.E.", "B.Tech",
        "Associate",
    ]
    edu_found = next(
        (k for k in edu_order if re.search(rf"\b{re.escape(k)}\b", text, re.I)),
        None,
    )
    edu_str = f"holds a {edu_found} degree" if edu_found else "has relevant academic qualifications"

    # Technical skills
    skill_pat = re.compile(
        r"\b(Python|Java|SQL|R|Tableau|Power\s*BI|Excel|Azure|AWS|GCP|Spark|Kafka|"
        r"Airflow|BigQuery|Dataflow|TensorFlow|PyTorch|Scikit-learn|Pandas|NumPy|"
        r"JavaScript|TypeScript|React|Node\.?js|Docker|Kubernetes|Git|CI/CD|MLflow|"
        r"SAS|SPSS|Hadoop|Hive|dbt|Snowflake|Redshift|Looker|FastAPI|Flask|Django|"
        r"Machine Learning|Deep Learning|NLP|Computer Vision|Data Engineering|"
        r"Data Analysis|Business Intelligence|ETL|ELT)\b",
        re.I,
    )
    skills = list(dict.fromkeys(m.group() for m in skill_pat.finditer(text)))[:10]
    skills_str = ", ".join(skills) if skills else "various technical tools"

    return (
        f"This candidate has {years_str} of professional experience and {edu_str}. "
        f"Their technical toolkit includes {skills_str}. "
        f"Based on the resume content they demonstrate applied experience across "
        f"data-driven and analytical domains."
    )


# ── Public API ─────────────────────────────────────────────────

def generate_summary(resume_text: str, job_description: str = "") -> str:
    """
    Generate a fresh, candidate-specific summary paragraph.

    Parameters
    ----------
    resume_text     : full text extracted from the .docx resume
    job_description : optional JD to tailor skill focus and alignment assessment

    Returns a plain paragraph — no bullet points, no markdown.
    """

    # ── Legacy usage: main.py passes a raw prompt string for JD-match scoring ──
    # Detect this by checking if the text starts with the recruiter system prompt.
    if resume_text.strip().startswith("You are an expert recruiter"):
        if _ollama_available():
            model = _get_best_model()
            try:
                return _call_ollama(resume_text, model)
            except Exception as e:
                return f"[Ollama error: {e}]"
        return "[Ollama unavailable]"

    # ── Keyword fallback when Ollama is offline ──
    if not _ollama_available():
        return _keyword_summary(resume_text)

    model = _get_best_model()

    # ── Build the JD section ──
    jd_section = ""
    if job_description and job_description.strip():
        jd_section = f"""
Job Description (use this to focus on relevant skills and assess alignment):
\"\"\"
{job_description[:2500]}
\"\"\"
"""

    # ── Core prompt ──
    prompt = f"""You are a senior technical recruiter writing a professional candidate brief for a hiring manager.

Read the resume below carefully and write a focused summary paragraph of 10 to 12 sentences.

Your paragraph MUST cover ALL of the following — use only facts from the resume, never invent details:

1. Total years of professional experience and the main industries or domains worked in.
2. Current or most recent job title and employer (if mentioned).
3. Highest educational qualification — degree name, field of study, and university (if mentioned).
4. 6 to 10 most important technical skills — if a Job Description is provided, prioritise skills that appear in it.
5. Any certifications, notable achievements, or awards mentioned in the resume.
6. A concise assessment of how well this candidate fits the role (only if a Job Description is provided).

Strict rules:
- Write ONE continuous paragraph. No bullet points, no headers, no markdown, no numbered lists.
- Write in third person: "The candidate has...", "They hold...", "Their experience includes..."
- Be specific: use actual numbers, tool names, company/university names from the resume.
- Do NOT start with "Summary:", "Candidate:", or any label.
- Do NOT repeat the same point twice.
- Aim for 10 to 12 sentences. Do not exceed 12.
{jd_section}
Resume:
\"\"\"
{resume_text[:1800]}
\"\"\"

Write the summary paragraph now:"""

    try:
        return _call_ollama(prompt, model)
    except Exception:
        return _keyword_summary(resume_text)
