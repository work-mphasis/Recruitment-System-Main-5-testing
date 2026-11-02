"""
ai_scorer.py
Contextual resume-vs-JD scoring using a local Ollama model.
Falls back to the keyword engine if Ollama is unavailable.
"""

import json
import re
import requests
from typing import Optional

OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_MODEL   = "phi3:mini"
OLLAMA_TIMEOUT = 120              # seconds
MODEL_PREFERENCE = [
    "phi3:mini",
    "phi3",
    "llama3",
    "llama3.1",
    "qwen2.5:3b",
    "qwen2.5-coder:1.5b-base",
    "deepseek-coder:latest",
]


# ------------------------------------------------------------------
# Prompt
# ------------------------------------------------------------------

SCORE_PROMPT = """\
You are an expert technical recruiter. Analyse the candidate resume against the job description below and return ONLY a valid JSON object — no markdown, no explanation, nothing else before or after the JSON.

JOB DESCRIPTION:
{jd}

CANDIDATE RESUME:
{resume}

Return this exact JSON structure:
{{
  "overall": <integer 0-100>,
  "skills": {{
    "score": <integer 0-60>,
    "matched": [<skill strings found in resume>],
    "missing": [<skill strings from JD not found in resume>],
    "reasoning": "<one sentence>"
  }},
  "experience": {{
    "score": <integer 0-20>,
    "years_detected": <integer or null>,
    "reasoning": "<one sentence>"
  }},
  "context": {{
    "score": <integer 0-20>,
    "reasoning": "<one or two sentences explaining fit based on full context>"
  }},
  "summary": "<two sentences max — overall hiring recommendation>"
}}

Scoring guide:
- skills: 0-60 pts based on how many required skills the candidate actually demonstrates
- experience: 0-20 pts based on years and relevance of prior roles
- context: 0-20 pts based on how well the candidate's background fits the role
- overall: sum of the three, capped at 100
"""


# ------------------------------------------------------------------
# Ollama call
# ------------------------------------------------------------------

def score_with_ollama(resume_text: str, jd_text: str, model: str = OLLAMA_MODEL) -> Optional[dict]:
    """
    Sends resume + JD to a local Ollama model.
    Returns parsed dict or None if Ollama is unavailable or times out.
    """
    selected_model = select_ollama_model(model)
    if not selected_model:
        return None

    prompt = SCORE_PROMPT.format(
        jd=jd_text[:800],
        resume=resume_text[:800],
    )

    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model":  selected_model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 300,
                },
            },
            timeout=OLLAMA_TIMEOUT,
        )
        resp.raise_for_status()
        raw = resp.json().get("response", "")
        parsed = _parse_score_response(raw)
        if parsed:
            parsed["_model_used"] = selected_model
        return parsed

    except requests.exceptions.ConnectionError:
        return None
    except requests.exceptions.Timeout:
        print("⚠️  Ollama scoring timed out")
        return None
    except Exception as e:
        print(f"⚠️  Ollama error: {e}")
        return None


def _parse_score_response(raw: str) -> Optional[dict]:
    """Extract and validate the JSON from the model response."""
    clean = re.sub(r"```[a-zA-Z]*", "", raw).strip()

    start = clean.find("{")
    if start == -1:
        print(f"⚠️  No JSON found in Ollama response: {clean[:200]}")
        return None

    fragment = clean[start:]

    # Try parsing as-is first
    data = None
    try:
        end = fragment.rfind("}") + 1
        data = json.loads(fragment[:end])
    except json.JSONDecodeError:
        pass

    # If truncated, try closing the JSON with increasing numbers of braces
    if data is None:
        for closing in ['"}', '"}}', '"}}}']:
            try:
                data = json.loads(fragment + closing)
                break
            except json.JSONDecodeError:
                continue

    if data is None:
        print(f"⚠️  Could not parse Ollama JSON: {fragment[:300]}")
        return None

    # Require the 4 scoring fields; summary is optional
    required = {"overall", "skills", "experience", "context"}
    if not required.issubset(data.keys()):
        print(f"⚠️  Missing keys in Ollama response: {data.keys()}")
        return None

    data["overall"]             = max(0, min(100, int(data.get("overall", 0))))
    data["skills"]["score"]     = max(0, min(60,  int(data["skills"].get("score", 0))))
    data["experience"]["score"] = max(0, min(20,  int(data["experience"].get("score", 0))))
    data["context"]["score"]    = max(0, min(20,  int(data["context"].get("score", 0))))
    if "summary" not in data:
        data["summary"] = ""

    return data


# ------------------------------------------------------------------
# List available Ollama models
# ------------------------------------------------------------------

def list_ollama_models() -> list:
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        resp.raise_for_status()
        models = resp.json().get("models", [])
        return [m["name"] for m in models]
    except Exception:
        return []


def select_ollama_model(requested_model: str = "") -> str:
    models = list_ollama_models()
    if not models:
        return ""
    requested = (requested_model or "").strip()
    if requested in models:
        return requested
    for preferred in MODEL_PREFERENCE:
        for model in models:
            if model == preferred or model.startswith(f"{preferred}:"):
                return model
    return models[0]


def ollama_is_running() -> bool:
    try:
        requests.get("http://localhost:11434", timeout=3)
        return True
    except Exception:
        return False
