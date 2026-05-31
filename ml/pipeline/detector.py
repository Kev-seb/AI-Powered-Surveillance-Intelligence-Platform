"""
YOLOv8 Multi-Class Detector with Face Detection
Wraps ultralytics YOLOv8 for person/vehicle detection with configurable confidence,
plus OpenCV Haar-cascade face detection for precise facial bounding boxes.

Key design decisions:
- Faces ARE included even when they overlap a person bbox (a person HAS a face)
- Lower minNeighbors (3) and scaleFactor (1.15) for better live-cam recall
- Profile cascade used as fallback when frontal detection yields nothing
- Confidence returned per-detection: YOLO uses model score, Haar uses 0.80 fixed
"""
from __future__ import annotations

import logging
from typing import List, Dict, Any

import numpy as np
import cv2

logger = logging.getLogger(__name__)

# COCO class names for the classes we care about
COCO_CLASS_NAMES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}


class PersonDetector:
    """YOLOv8-based multi-class detector (persons, vehicles) + Haar face detector."""

    # COCO class IDs we want from YOLO (default)
    DETECT_CLASSES = [0, 1, 2, 3, 5, 7]

    def __init__(self, model_path: str = "yolov8n.pt", confidence: float = 0.25, detect_classes: List[int] | None = None):
        import torch
        if not hasattr(torch, "_patched_load"):
            _orig = torch.load
            def _safe_load(*args, **kwargs):
                kwargs["weights_only"] = False
                return _orig(*args, **kwargs)
            torch.load = _safe_load
            torch._patched_load = True

        from ultralytics import YOLO
        logger.info(f"Loading YOLOv8 model: {model_path}")
        self.model = YOLO(model_path)
        self.confidence = confidence
        self.detect_classes = detect_classes

        # ── Haar cascade face detectors ───────────────────────────────────
        self._face_frontal = None
        self._face_profile = None
        try:
            base = cv2.data.haarcascades
            self._face_frontal = cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml")
            self._face_profile = cv2.CascadeClassifier(base + "haarcascade_profileface.xml")
            if self._face_frontal.empty() or self._face_profile.empty():
                logger.warning("One or more Haar cascades are empty! Checking fallback paths...")
                import os
                import cv2 as cv_lib
                fallback_base = os.path.dirname(cv_lib.__file__) + "/data/"
                if self._face_frontal.empty() and os.path.exists(fallback_base + "haarcascade_frontalface_default.xml"):
                    self._face_frontal = cv2.CascadeClassifier(fallback_base + "haarcascade_frontalface_default.xml")
                if self._face_profile.empty() and os.path.exists(fallback_base + "haarcascade_profileface.xml"):
                    self._face_profile = cv2.CascadeClassifier(fallback_base + "haarcascade_profileface.xml")
            
            frontal_ok = not self._face_frontal.empty() if self._face_frontal else False
            profile_ok = not self._face_profile.empty() if self._face_profile else False
            logger.info(f"Haar face cascades initialized: frontal_loaded={frontal_ok}, profile_loaded={profile_ok}")
        except Exception as e:
            logger.warning(f"Face cascades not available: {e}")

        logger.info(f"Detector ready: model={model_path} conf={confidence} classes={detect_classes}")

    # ─────────────────────────────────────────────────────────────────────────
    def _run_cascade(
        self,
        gray: np.ndarray,
        cascade: cv2.CascadeClassifier,
        scale: float = 1.15,
        neighbors: int = 3,
        min_size: int = 25,
    ) -> list:
        """Run a single Haar cascade and return raw (x,y,w,h) tuples."""
        try:
            faces = cascade.detectMultiScale(
                gray,
                scaleFactor=scale,
                minNeighbors=neighbors,
                minSize=(min_size, min_size),
                flags=cv2.CASCADE_SCALE_IMAGE,
            )
            return list(faces) if len(faces) > 0 else []
        except Exception:
            return []

    def detect_faces(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        """
        Detect faces using frontal + profile Haar cascades.
        Dynamically adjusts min_size based on frame height to prevent microscopic false positives on 1080p/720p videos.
        """
        if self._face_frontal is None:
            return []

        h, w = frame.shape[:2]
        # Prevent microscopic detections on 1080p/720p (4% of height, min 25px)
        min_size = max(25, int(h * 0.04))

        # Grayscale + CLAHE for better contrast
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

        raw: list = []

        # Pass 1: frontal, robust settings (fewer false positives)
        raw += self._run_cascade(gray, self._face_frontal, scale=1.15, neighbors=5, min_size=min_size)

        # Pass 2: profile (fallback to avoid double-false-positives)
        if not raw and self._face_profile is not None:
            raw += self._run_cascade(gray, self._face_profile, scale=1.15, neighbors=4, min_size=min_size)

        # Deduplicate overlapping boxes across all passes
        filtered = self._nms_faces(raw, iou_thresh=0.35)

        detections = []
        for (x, y, w, h) in filtered:
            detections.append({
                "bbox":       {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
                "confidence": 0.80,
                "class_id":   100,
                "class_name": "face",
                "cx":         float(x + w / 2),
                "cy":         float(y + h / 2),
                "xyxy":       [float(x), float(y), float(x + w), float(y + h)],
            })
        return detections

    @staticmethod
    def _nms_faces(boxes: list, iou_thresh: float = 0.35) -> list:
        """Simple IoU-based NMS to remove duplicate face detections."""
        if not boxes:
            return []
        keep = []
        used = [False] * len(boxes)
        for i, (x1, y1, w1, h1) in enumerate(boxes):
            if used[i]:
                continue
            keep.append((x1, y1, w1, h1))
            for j, (x2, y2, w2, h2) in enumerate(boxes):
                if i == j or used[j]:
                    continue
                # Intersection
                ix = max(x1, x2);  iy = max(y1, y2)
                iw = min(x1+w1, x2+w2) - ix
                ih = min(y1+h1, y2+h2) - iy
                if iw <= 0 or ih <= 0:
                    continue
                inter = iw * ih
                union = w1*h1 + w2*h2 - inter
                if union > 0 and inter / union > iou_thresh:
                    used[j] = True
        return keep

    # ─────────────────────────────────────────────────────────────────────────
    def detect(self, frame: np.ndarray, detect_faces: bool = True) -> List[Dict[str, Any]]:
        """
        Run YOLO + face detection on a single frame.

        Returns list of dicts:
            bbox        : {x, y, w, h}  (pixel coords in the *input* frame)
            confidence  : float
            class_id    : int  (100 = face)
            class_name  : str  ("person", "car", "face", …)
            cx, cy      : float  (centre of bbox)
        """
        # ── YOLO inference ────────────────────────────────────────────────
        results = self.model(
            frame,
            classes=self.detect_classes,
            conf=self.confidence,
            verbose=False,
            iou=0.45,
            agnostic_nms=True,
            max_det=50,
        )

        detections: List[Dict[str, Any]] = []
        for result in results:
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                w, h = x2 - x1, y2 - y1
                cid = int(box.cls[0])
                detections.append({
                    "bbox":       {"x": int(x1), "y": int(y1), "w": int(w), "h": int(h)},
                    "confidence": float(box.conf[0]),
                    "class_id":   cid,
                    "class_name": COCO_CLASS_NAMES.get(cid, self.model.names.get(cid, "unknown")),
                    "cx":         x1 + w / 2,
                    "cy":         y1 + h / 2,
                    "xyxy":       [x1, y1, x2, y2],
                })

        # ── Face detection ────────────────────────────────────────────────
        # Run face detection only inside cropped regions of detected persons
        # to eliminate background false positives and speed up execution.
        if detect_faces and self._face_frontal is not None and frame.shape[0] > 60 and frame.shape[1] > 60:
            person_dets = [d for d in detections if d["class_name"] == "person"]
            face_dets = []

            for person in person_dets:
                px, py, pw, ph = person["bbox"]["x"], person["bbox"]["y"], person["bbox"]["w"], person["bbox"]["h"]

                # Expand crop slightly upwards (by 15% of height) to ensure face/head is captured
                y_offset = int(ph * 0.15)
                crop_y1 = max(0, py - y_offset)
                crop_y2 = min(frame.shape[0], py + ph)
                crop_x1 = max(0, px)
                crop_x2 = min(frame.shape[1], px + pw)

                crop_w = crop_x2 - crop_x1
                crop_h = crop_y2 - crop_y1

                if crop_w > 20 and crop_h > 20:
                    crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]
                    
                    # Scale minimum face size relative to the person crop height
                    min_size = max(20, int(crop_h * 0.08))

                    # Convert crop to grayscale and enhance contrast using CLAHE
                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                    gray = clahe.apply(gray)

                    raw_faces = []
                    # Pass 1: Frontal cascade
                    raw_faces += self._run_cascade(gray, self._face_frontal, scale=1.15, neighbors=5, min_size=min_size)

                    # Pass 2: Profile cascade (fallback)
                    if not raw_faces and self._face_profile is not None:
                        raw_faces += self._run_cascade(gray, self._face_profile, scale=1.15, neighbors=4, min_size=min_size)

                    # Deduplicate overlapping face bounding boxes
                    filtered_faces = self._nms_faces(raw_faces, iou_thresh=0.35)

                    for (x, y, w, h) in filtered_faces:
                        # Translate coordinates back to global frame context
                        gx = crop_x1 + x
                        gy = crop_y1 + y
                        gw = w
                        gh = h

                        face_dets.append({
                            "bbox":       {"x": int(gx), "y": int(gy), "w": int(gw), "h": int(gh)},
                            "confidence": 0.80,
                            "class_id":   100,
                            "class_name": "face",
                            "cx":         float(gx + gw / 2),
                            "cy":         float(gy + gh / 2),
                            "xyxy":       [float(gx), float(gy), float(gx + gw), float(gy + gh)],
                        })

            detections.extend(face_dets)

        return detections

    # ─────────────────────────────────────────────────────────────────────────
    def detect_batch(self, frames: List[np.ndarray]) -> List[List[Dict]]:
        """Batch YOLO inference (no face detection — use detect() per frame for that)."""
        results = self.model(
            frames,
            classes=self.detect_classes,
            conf=self.confidence,
            verbose=False,
            iou=0.45,
            agnostic_nms=True,
        )
        batch: List[List[Dict]] = []
        for result in results:
            frame_dets = []
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                w, h = x2 - x1, y2 - y1
                cid = int(box.cls[0])
                frame_dets.append({
                    "bbox":       {"x": int(x1), "y": int(y1), "w": int(w), "h": int(h)},
                    "confidence": float(box.conf[0]),
                    "class_id":   cid,
                    "class_name": COCO_CLASS_NAMES.get(cid, self.model.names.get(cid, "unknown")),
                    "cx":         x1 + w / 2,
                    "cy":         y1 + h / 2,
                    "xyxy":       [x1, y1, x2, y2],
                })
            batch.append(frame_dets)
        return batch
