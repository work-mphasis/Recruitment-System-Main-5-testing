from pydantic import BaseModel
from typing import Optional

# -----------------------------
# POSITION SCHEMAS
# -----------------------------
class PositionCreate(BaseModel):
    proposed_pod_name: str
    manager: str
    position_code: str
    role: str
    requirements: str
    location: str
    new_or_replacement: str
    number_of_positions: int
    requirement_receive_date: Optional[str] = None
    profile_shared_date: Optional[str] = None

class PositionResponse(PositionCreate):
    id: int

    class Config:
        orm_mode = True

# -----------------------------
# CANDIDATE SCHEMAS
# -----------------------------
class CandidateCreate(BaseModel):
    name: str
    email: str
    position_id: int

class CandidateResponse(BaseModel):
    id: int
    name: str
    email: str
    resume: str
    status: str
    position: Optional[PositionResponse]

    class Config:
        orm_mode = True