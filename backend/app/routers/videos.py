"""Video upload, processing, and status router."""
import os
import uuid
import logging
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, BackgroundTasks, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db, AsyncSessionLocal
from app.core.security import get_current_user, require_role
from app.models.video import Video
from app.schemas.schemas import VideoProcessRequest, VideoResponse
from app.tasks.video_processor import process_video_task

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}
MAX_SIZE = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


async def transcode_video_background(
    video_id: uuid.UUID,
    tmp_path: Path,
    dest_path: Path,
):
    """Background task to transcode uploaded video and extract metadata."""
    import subprocess
    import asyncio
    import cv2
    from app.models.video import Video

    cmd = [
        "ffmpeg", "-y", "-i", str(tmp_path),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "veryfast", "-c:a", "aac",
        str(dest_path)
    ]
    
    error_msg = None
    fps = 0.0
    total_frames = 0
    width = 0
    height = 0
    duration = 0.0

    logger.info(f"Starting background transcode for video {video_id} using command: {' '.join(cmd)}")
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: subprocess.run(cmd, capture_output=True, check=True))
        
        # Probe metadata with OpenCV
        cap = cv2.VideoCapture(str(dest_path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0.0
        cap.release()
        logger.info(f"Transcode successful for video {video_id}. Metadata: fps={fps}, frames={total_frames}, res={width}x{height}, duration={duration:.2f}s")
    except Exception as e:
        error_msg = f"Failed to transcode video to browser-compatible H.264: {str(e)}"
        logger.error(f"Error transcoding video {video_id}: {error_msg}")
        if dest_path.exists():
            dest_path.unlink()
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    # Update database record
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(select(Video).where(Video.id == video_id))
            video = result.scalar_one_or_none()
            if video:
                if error_msg:
                    video.status = "failed"
                    video.error_message = error_msg
                else:
                    video.status = "pending"
                    video.duration_secs = duration
                    video.fps = fps
                    video.resolution = f"{width}x{height}"
                    video.frames_total = total_frames
                await db.commit()
                logger.info(f"Database updated for video {video_id}. Status: {video.status}")
        except Exception as e:
            await db.rollback()
            logger.error(f"Failed to update video transcode status for {video_id} in database: {e}")


@router.post("/upload", response_model=VideoResponse, status_code=201)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Upload a surveillance video for processing."""
    # Validate extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    # Read and size-check
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, f"File exceeds {settings.MAX_UPLOAD_SIZE_MB}MB limit")

    # Save to temp file
    video_id = uuid.uuid4()
    tmp_name = f"{video_id}_tmp{ext}"
    tmp_path = Path(settings.UPLOAD_DIR) / tmp_name
    tmp_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(tmp_path, "wb") as f:
        await f.write(content)

    # Prepare transcode destination
    safe_name = f"{video_id}.mp4"
    dest_path = Path(settings.UPLOAD_DIR) / safe_name

    # Save record immediately in transcoding state
    video = Video(
        id=video_id,
        filename=safe_name,
        original_name=file.filename,
        file_path=str(dest_path),
        file_size=len(content),
        duration_secs=None,
        fps=None,
        resolution=None,
        frames_total=0,
        uploaded_by=current_user.id,
        status="transcoding",
    )
    db.add(video)
    await db.flush()

    # Schedule background transcoding task
    background_tasks.add_task(transcode_video_background, video_id, tmp_path, dest_path)

    return video


@router.post("/{video_id}/process", response_model=VideoResponse)
async def start_processing(
    video_id: uuid.UUID,
    options: VideoProcessRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("operator")),
):
    """Trigger async video processing pipeline via Celery."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(404, "Video not found")
    if video.status == "processing":
        raise HTTPException(409, "Video is already being processed")

    task = process_video_task.delay(
        str(video_id),
        options.dict(),
    )
    video.status = "queued"
    video.celery_task_id = task.id
    await db.flush()
    return video


@router.get("/{video_id}/status", response_model=VideoResponse)
async def get_video_status(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get processing status and progress for a video."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(404, "Video not found")
    return video



@router.delete("/{video_id}")
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("operator")),
):
    """Delete a video, its files from disk, and associated events/reports."""
    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(404, "Video not found")

    # Delete incident reports
    from sqlalchemy import text
    await db.execute(
        text("DELETE FROM incident_reports WHERE video_id = :video_id"),
        {"video_id": video_id}
    )

    # Delete events
    await db.execute(
        text("DELETE FROM events WHERE video_id = :video_id"),
        {"video_id": video_id}
    )

    # Delete files from disk
    if video.file_path:
        video_path = Path(video.file_path)
        if video_path.exists():
            video_path.unlink()
        
        # Check if there is a temp/transcoded file
        tmp_path = video_path.parent / f"{video_id}_tmp.mp4"
        if tmp_path.exists():
            tmp_path.unlink()

    # Delete video record
    await db.delete(video)
    await db.flush()

    return {
        "message": "Video and associated data deleted successfully",
        "video_id": str(video_id),
    }



@router.get("/", response_model=list[VideoResponse])
async def list_videos(
    skip: int = 0,
    limit: int = 20,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """List all uploaded videos with optional status filter."""
    query = select(Video).order_by(Video.uploaded_at.desc()).offset(skip).limit(limit)
    if status:
        query = query.where(Video.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{video_id}/stream")
async def stream_video(
    video_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Stream video file with HTTP range support for seek-capable playback."""
    from fastapi.responses import StreamingResponse
    import os

    result = await db.execute(select(Video).where(Video.id == video_id))
    video = result.scalar_one_or_none()
    if not video:
        raise HTTPException(404, "Video not found")
    path = Path(video.file_path)
    if not path.exists():
        raise HTTPException(404, "Video file not found on disk")

    file_size = path.stat().st_size
    range_header = request.headers.get("range")

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "video/mp4",
        "Content-Disposition": f'inline; filename="{video.original_name or video.filename}"'
    }

    if not range_header:
        def chunk_generator():
            with open(path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
        headers["Content-Length"] = str(file_size)
        return StreamingResponse(chunk_generator(), headers=headers)

    try:
        range_str = range_header.replace("bytes=", "")
        start_str, end_str = range_str.split("-")
        start = int(start_str)
        end = int(end_str) if end_str else file_size - 1
    except Exception:
        raise HTTPException(400, "Invalid Range Header")

    if start >= file_size:
        raise HTTPException(416, "Requested Range Not Satisfiable")

    end = min(end, file_size - 1)
    chunk_size = end - start + 1

    def range_generator(start_byte, end_byte):
        with open(path, "rb") as f:
            f.seek(start_byte)
            bytes_to_read = end_byte - start_byte + 1
            while bytes_to_read > 0:
                chunk_to_read = min(bytes_to_read, 1024 * 1024)
                data = f.read(chunk_to_read)
                if not data:
                    break
                yield data
                bytes_to_read -= len(data)

    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(chunk_size)
    return StreamingResponse(range_generator(start, end), status_code=206, headers=headers)
