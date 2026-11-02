from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from .database import Base
from datetime import datetime

class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    proposed_pod_name = Column(String)
    manager = Column(String)
    position_code = Column(String, unique=True)
    role = Column(String)
    requirements = Column(String)
    location = Column(String)
    new_or_replacement = Column(String)
    number_of_positions = Column(Integer)
    requirement_receive_date = Column(String)
    profile_shared_date = Column(String)

    # Relationship
    candidates = relationship("Candidate", back_populates="position")


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String)
    resume = Column(String)  # File path to uploaded resume
    status = Column(String, default="Pending")
    position_id = Column(Integer, ForeignKey("positions.id"))

    # Relationship
    position = relationship("Position", back_populates="candidates")
    created_at = Column(DateTime, default=datetime.utcnow)