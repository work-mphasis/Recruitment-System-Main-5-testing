# AGENTS.md

## Project Overview

This is a local ATS/recruitment system.

- Backend: FastAPI in `Backend/app/main.py`
- Frontend: React/Vite in `frontend/src`
- Backend data is mostly managed through Postgres-backed sheet helpers in `Backend/app/pg_sheets.py`
- Resume scoring currently lives in `Backend/app/ai_scorer.py` and `Backend/app/main.py`
- Resume summaries and parsing live in `Backend/app/summary_generator.py` and `Backend/app/resume_parser.py`

## Current Feature Goal

Implement customer-validated scoring rubrics, L1/L2/Client interview scoring, and skill gap analysis.

Skill learning recommendations must come from the latest TalentNext catalog Excel file in:

`C:\Users\audri\Downloads\TalentNextCatalog*.xlsx`

The catalog has one sheet with columns:

- `Sub Skill`
- `Proficiency`
- `Nomination Type`
- `Category`

The file changes over time, so the backend must discover the latest matching file on startup and support manual refresh.

## Implementation Rules

- Do not replace the existing AI score flow; extend it.
- Keep `/ai-profile-score/{filename}` backward compatible.
- Add APIs for rubrics, catalog status/search/refresh, candidate rubric scores, and skill gap analysis.
- Prefer focused backend modules instead of making `main.py` larger where practical.
- Use Postgres-backed durable storage for rubrics and candidate scores.
- Keep `position_skills.json` compatibility, but active validated rubrics should become the preferred scoring source.
- External rubric document upload is out of scope for v1.

## Backend Requirements

Add services for:

- TalentNext catalog discovery and parsing
- Rubric CRUD/versioning
- Rubric validation by `L1`, `L2`, and `Client`
- Candidate interview scoring
- Skill gap analysis
- TalentNext learning recommendation matching

Catalog matching should rank recommendations by:

1. Exact normalized `Sub Skill` match
2. Fuzzy `Sub Skill` match
3. Same `Category`
4. Prefer `On-demand` for quick learning
5. Prefer `Sprint-based` for capstone/project recommendations

## Frontend Requirements

Update:

- Position Management: add rubric editor and validation panel
- Candidates: add Rubric Score tab
- Resumes: add Skill Gap & Learning Path section
- Show TalentNext catalog status and manual refresh action

## Acceptance Criteria

- Backend loads latest `TalentNextCatalog*.xlsx` from Downloads on startup.
- Manual refresh reloads catalog without restart.
- Skill gap analysis recommends TalentNext learning items for missing skills.
- Active rubrics require validation.
- L1/L2/Client scoring is stored against a rubric version.
- Existing resume analysis still works when no active rubric exists.
- UI exposes rubric editing, validation, candidate scoring, and catalog-backed recommendations.

## Test Commands

Suggested checks:

- Backend import/startup check
- API tests for catalog refresh/status/search
- API tests for rubric lifecycle
- API tests for skill gap recommendations
- Frontend build with `npm run build` from `frontend`
