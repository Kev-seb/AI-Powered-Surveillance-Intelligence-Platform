"""Application configuration — loaded from environment variables."""
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Application ────────────────────────────────────────────────
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    # ── Database ───────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://asip:asip_secret@localhost:5432/surveillance"
    MONGO_URL: str = "mongodb://asip:asip_secret@localhost:27017/surveillance?authSource=admin"
    REDIS_URL: str = "redis://:asip_redis@localhost:6379/0"

    # ── Celery ────────────────────────────────────────────────────
    CELERY_BROKER_URL: str = "redis://:asip_redis@localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://:asip_redis@localhost:6379/2"

    # ── LLM Providers ─────────────────────────────────────────────
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3"
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o"
    GEMINI_API_KEY: Optional[str] = None
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_MODEL: str = "meta-llama/llama-3-8b-instruct:free"

    # ── Computer Vision ───────────────────────────────────────────
    YOLO_MODEL: str = "yolov8x.pt"
    YOLO_CONFIDENCE: float = 0.25
    FACE_RECOGNITION_THRESHOLD: float = 0.40
    MAX_TRAJECTORY_LENGTH: int = 120

    # ── Storage ───────────────────────────────────────────────────
    UPLOAD_DIR: str = "/app/uploads"
    REPORTS_DIR: str = "/app/reports"
    MAX_UPLOAD_SIZE_MB: int = 500

    # ── CORS ──────────────────────────────────────────────────────
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    # ── Rate Limiting ─────────────────────────────────────────────
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def use_openai(self) -> bool:
        return bool(self.OPENAI_API_KEY)

    @property
    def use_gemini(self) -> bool:
        return bool(self.GEMINI_API_KEY)

    @property
    def use_openrouter(self) -> bool:
        return bool(self.OPENROUTER_API_KEY)


settings = Settings()
