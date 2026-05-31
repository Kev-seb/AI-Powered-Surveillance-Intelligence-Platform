"""
Real-time frame detection endpoint.
Accepts a single JPEG/PNG frame, runs YOLOv8n + Haar face detection,
returns bounding boxes normalised to the ORIGINAL uploaded frame dimensions.

Confidence: 0.25 (lower = more recall, catches partial/small persons)
Frame size: runs YOLO at the uploaded size (frontend caps at 480px already).
            Haar face detection also runs at the uploaded size.
"""
from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()

# One worker: sequential inference avoids GPU/CPU contention and race conditions
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="yolo_live")

_detector = None
_warmed_up = False


def _load_and_warmup():
    """Load yolov8n and prime PyTorch JIT with a dummy inference."""
    global _detector, _warmed_up
    if _detector is not None:
        return _detector

    from ml.pipeline.detector import PersonDetector
    live_model = "yolov8n.pt"
    logger.info(f"Loading live detector: {live_model}")
    t0 = time.monotonic()
    _detector = PersonDetector(model_path=live_model, confidence=0.25, detect_classes=None)
    logger.info(f"Live detector loaded in {(time.monotonic()-t0)*1000:.0f}ms")

    if not _warmed_up:
        logger.info("Pre-warming live detector ...")
        dummy = np.zeros((480, 640, 3), dtype=np.uint8)
        try:
            _detector.detect(dummy, detect_faces=False)
            _warmed_up = True
            logger.info("Live detector pre-warm complete")
        except Exception as e:
            logger.warning(f"Pre-warm failed (non-fatal): {e}")

    return _detector


def _run_detection(frame: np.ndarray, detect_faces: bool) -> tuple[list, float]:
    """
    Run detection synchronously — executed in thread pool.

    We run YOLO at the UPLOADED resolution (frontend already caps at 480px).
    This avoids double-resize and keeps face bboxes accurate.
    For YOLO specifically we resize to 640px input (YOLO native size) which
    actually IMPROVES accuracy vs 320px while staying fast after warmup.
    """
    detector = _load_and_warmup()
    h, w = frame.shape[:2]

    # Resize to 640 wide for YOLO (its native training size → best accuracy)
    # After warmup this takes ~100-200ms on CPU for yolov8n
    yolo_w = 640
    if w != yolo_w:
        sx = yolo_w / w
        yolo_frame = cv2.resize(frame, (yolo_w, int(h * sx)), interpolation=cv2.INTER_LINEAR)
    else:
        yolo_frame = frame
        sx = 1.0
    sy = (int(h * sx) / h) if w != yolo_w else 1.0

    t0 = time.monotonic()

    # Run YOLO on the resized frame
    from ml.pipeline.detector import COCO_CLASS_NAMES
    results = detector.model(
        yolo_frame,
        classes=detector.detect_classes,
        conf=detector.confidence,
        verbose=False,
        iou=0.45,
        agnostic_nms=True,
        max_det=50,
    )

    detections: list = []
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            bw, bh = x2 - x1, y2 - y1
            cid = int(box.cls[0])
            # Scale bbox back to original uploaded frame coords
            ox1 = x1 / sx
            oy1 = y1 / sy
            obw = bw / sx
            obh = bh / sy
            detections.append({
                "bbox":       {"x": int(ox1), "y": int(oy1), "w": int(obw), "h": int(obh)},
                "confidence": round(float(box.conf[0]), 3),
                "class_id":   cid,
                "class_name": COCO_CLASS_NAMES.get(cid, detector.model.names.get(cid, "unknown")),
                "cx":         ox1 + obw / 2,
                "cy":         oy1 + obh / 2,
            })

    # Run face detection directly on uploaded frame (no extra resize needed)
    if detect_faces and h > 60 and w > 60:
        face_dets = detector.detect_faces(frame)
        detections.extend(face_dets)

    elapsed_ms = (time.monotonic() - t0) * 1000
    return detections, round(elapsed_ms, 1)


# ── Schemas ───────────────────────────────────────────────────────────────────
class Detection(BaseModel):
    bbox: Dict[str, int]   # {x, y, w, h} in uploaded-frame pixel coordinates
    confidence: float
    class_id: int
    class_name: str
    cx: float
    cy: float


class DetectResponse(BaseModel):
    detections: List[Detection]
    width: int             # uploaded frame width (bboxes are in this coordinate space)
    height: int
    inference_ms: float


# ── Endpoint ──────────────────────────────────────────────────────────────────
@router.post("/frame", response_model=DetectResponse)
async def detect_frame(
    file: UploadFile = File(...),
    detect_faces: bool = Query(True, description="Also run Haar face detection"),
    _=Depends(get_current_user),
):
    """
    Run real-time YOLOv8n + face detection on a single webcam frame.

    - **file**: JPEG captured via canvas.toBlob (frontend caps at 480px wide)
    - Returns bboxes in the **uploaded frame's pixel space** (not the video element size)
    """
    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Empty frame received")

    arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Could not decode image — send JPEG or PNG")

    orig_h, orig_w = frame.shape[:2]

    try:
        loop = asyncio.get_event_loop()
        raw_dets, infer_ms = await loop.run_in_executor(
            _executor, _run_detection, frame, detect_faces
        )
    except Exception as exc:
        logger.error(f"Detection error: {exc}", exc_info=True)
        raise HTTPException(500, f"Detection failed: {exc}")

    detections = [Detection(**d) for d in raw_dets]
    logger.info(
        f"detect/frame: {len(detections)} objects in {infer_ms:.0f}ms "
        f"({orig_w}x{orig_h}) "
        f"[{', '.join(d.class_name for d in detections) or 'none'}]"
    )
    return DetectResponse(
        detections=detections,
        width=orig_w,
        height=orig_h,
        inference_ms=infer_ms,
    )


# Pre-warm on module import
def _schedule_prewarm():
    try:
        _executor.submit(_load_and_warmup)
        logger.info("Live detector pre-warm submitted")
    except Exception as e:
        logger.warning(f"Could not schedule pre-warm: {e}")

_schedule_prewarm()
