"""Request/response logging middleware with trace IDs."""
import time
import uuid

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from structlog.contextvars import bind_contextvars, clear_contextvars

logger = structlog.get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    async def _write_audit_log(self, request: Request, response_status: int, duration_ms: int, trace_id: str):
        try:
            path = request.url.path
            is_detect_frame = "/detect/frame" in path
            should_audit = request.method in ("POST", "PUT", "DELETE", "PATCH") or "/reports/" in path
            
            if not should_audit or is_detect_frame:
                return

            token = None
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
            else:
                token = request.query_params.get("token")

            username = None
            user_id = None
            if token:
                try:
                    from jose import jwt
                    from app.core.config import settings
                    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
                    username = payload.get("username")
                    user_id = payload.get("sub")
                except Exception:
                    pass

            parts = [p for p in path.split("/") if p.strip()]
            resource_type = None
            resource_id = None
            if len(parts) >= 3:
                resource_type = parts[2]
                resource_id = parts[3] if len(parts) > 3 else None
            elif len(parts) == 2:
                resource_type = parts[1]

            from app.core.database import AsyncSessionLocal
            from app.models.audit import AuditLog
            import uuid

            async with AsyncSessionLocal() as db:
                audit_log = AuditLog(
                    user_id=uuid.UUID(user_id) if user_id else None,
                    username=username,
                    action=f"{request.method} {path}",
                    resource_type=resource_type,
                    resource_id=resource_id,
                    ip_address=request.client.host if request.client else "unknown",
                    user_agent=request.headers.get("User-Agent"),
                    status_code=response_status,
                    duration_ms=duration_ms,
                    trace_id=trace_id,
                )
                db.add(audit_log)
                await db.commit()
        except Exception as e:
            logger.error("failed_to_write_audit_log", error=str(e))

    async def dispatch(self, request: Request, call_next) -> Response:
        clear_contextvars()
        trace_id = str(uuid.uuid4()).replace("-", "")[:16]
        correlation_id = request.headers.get("X-Correlation-ID", trace_id)

        bind_contextvars(
            trace_id=trace_id,
            correlation_id=correlation_id,
            method=request.method,
            path=request.url.path,
            client_ip=request.client.host if request.client else "unknown",
        )

        start = time.perf_counter()
        try:
            response = await call_next(request)
            duration_ms = int((time.perf_counter() - start) * 1000)

            logger.info(
                "request_completed",
                status_code=response.status_code,
                duration_ms=duration_ms,
            )

            await self._write_audit_log(request, response.status_code, duration_ms, trace_id)

            response.headers["X-Trace-ID"] = trace_id
            response.headers["X-Correlation-ID"] = correlation_id
            return response

        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.error("request_failed", error=str(exc), duration_ms=duration_ms)
            await self._write_audit_log(request, 500, duration_ms, trace_id)
            raise
