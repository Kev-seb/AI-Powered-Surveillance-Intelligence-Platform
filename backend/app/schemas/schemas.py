"""Pydantic schemas for all API entities."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ── Auth ─────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: UUID
    username: str
    role: str

class RefreshRequest(BaseModel):
    refresh_token: str

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8)
    role: str = "operator"

class UserResponse(BaseModel):
    id: UUID
    username: str
    email: str
    role: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Videos ───────────────────────────────────────────────────────
class VideoResponse(BaseModel):
    id: UUID
    filename: str
    original_name: Optional[str]
    file_size: Optional[int]
    duration_secs: Optional[float]
    fps: Optional[float]
    resolution: Optional[str]
    status: str
    progress: float
    frames_total: int
    frames_processed: int
    error_message: Optional[str]
    uploaded_at: datetime
    processed_at: Optional[datetime]
    celery_task_id: Optional[str]

    class Config:
        from_attributes = True

class VideoProcessRequest(BaseModel):
    yolo_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    enable_face_recognition: bool = True
    enable_behavior_analysis: bool = True
    zone_config: Optional[Dict[str, Any]] = None


# ── Events ───────────────────────────────────────────────────────
class EventResponse(BaseModel):
    id: UUID
    timestamp: datetime
    video_id: Optional[UUID]
    camera_id: Optional[UUID]
    track_id: Optional[int]
    person_id: Optional[UUID]
    event_type: str
    severity: str
    threat_score: float
    confidence: float
    frame_number: Optional[int]
    timestamp_secs: Optional[float]
    bbox: Optional[Dict]
    zone_id: Optional[str]
    zone_name: Optional[str]
    behavior_flags: List[str]
    metadata: Optional[Dict] = Field(default=None, validation_alias="metadata_", serialization_alias="metadata")
    person_name: Optional[str] = None
    acknowledged: bool
    acknowledged_at: Optional[datetime]

    class Config:
        from_attributes = True
        populate_by_name = True

class EventListResponse(BaseModel):
    items: List[EventResponse]
    total: int
    page: int
    per_page: int

class AcknowledgeRequest(BaseModel):
    note: Optional[str] = None


# ── Persons ───────────────────────────────────────────────────────
class PersonCreate(BaseModel):
    name: Optional[str] = None
    alias: Optional[str] = None
    risk_level: str = "unknown"
    notes: Optional[str] = None

class PersonResponse(BaseModel):
    id: UUID
    name: Optional[str]
    alias: Optional[str]
    risk_level: str
    notes: Optional[str]
    is_registered: bool
    registered_at: Optional[datetime]
    created_at: datetime
    photo_path: Optional[str]

    class Config:
        from_attributes = True

class PersonCard(BaseModel):
    person: PersonResponse
    total_events: int
    first_seen: Optional[datetime]
    last_seen: Optional[datetime]
    visit_count: int
    avg_threat_score: float
    behavior_summary: Dict[str, int]
    recent_events: List[EventResponse]


# ── Alerts ───────────────────────────────────────────────────────
class AlertResponse(BaseModel):
    id: UUID
    event_id: UUID
    alert_type: str
    severity: str
    title: Optional[str]
    description: Optional[str]
    threat_score: Optional[float]
    is_read: bool
    is_dismissed: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Incidents & Reports ───────────────────────────────────────────
class IncidentReportResponse(BaseModel):
    id: UUID
    event_id: Optional[UUID]
    video_id: Optional[UUID]
    title: Optional[str]
    summary: Optional[str]
    classification: Optional[str]
    recommended_actions: List[str]
    confidence_notes: Optional[str]
    llm_provider: Optional[str]
    llm_model: Optional[str]
    generated_at: datetime
    docx_path: Optional[str]

    class Config:
        from_attributes = True


# ── Analytics ─────────────────────────────────────────────────────
class DashboardMetrics(BaseModel):
    total_events_today: int
    active_threats: int
    persons_detected: int
    videos_processed: int
    avg_threat_score: float
    severity_breakdown: Dict[str, int]
    event_type_breakdown: Dict[str, int]
    hourly_events: List[Dict[str, Any]]
    top_zones: List[Dict[str, Any]]

class OccupancyData(BaseModel):
    zone_id: str
    zone_name: str
    current_count: int
    max_capacity: Optional[int]
    timestamp: datetime


# ── Health ────────────────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str
    services: Dict[str, str]
    llm_provider: str
    websocket_connections: int


# ── Sensor Ingestion ──────────────────────────────────────────────
class SensorEvent(BaseModel):
    sensor_id: str
    sensor_type: str  # motion, door, thermal, etc.
    timestamp: datetime
    value: Any
    metadata: Optional[Dict] = None

class SensorIngestResponse(BaseModel):
    accepted: int
    events: List[str]
