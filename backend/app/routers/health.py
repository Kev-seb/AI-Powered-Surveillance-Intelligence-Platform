"""Health check router."""
from fastapi import APIRouter
from app.core.config import settings
from app.core.websocket_manager import ws_manager
from app.schemas.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """System health check endpoint."""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        environment=settings.ENVIRONMENT,
        services={
            "api": "healthy",
            "database": "healthy",
            "cache": "healthy",
        },
        llm_provider="openai" if settings.use_openai else "ollama",
        websocket_connections=ws_manager.connection_count,
    )
