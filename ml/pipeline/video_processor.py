"""
Video Processing Orchestrator
================================
Runs the complete AI pipeline frame-by-frame:
  1. Detect persons (YOLOv8)
  2. Track across frames (ByteTrack)
  3. Recognize faces (DeepFace + FAISS)
  4. Analyze behaviors
  5. Score threats (XGBoost)
  6. Generate structured events
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

import cv2
import numpy as np

from ml.pipeline.detector import PersonDetector
from ml.pipeline.tracker import ByteTracker
from ml.pipeline.face_recognizer import FaceRecognizer
from ml.pipeline.behavior_analyzer import BehaviorAnalyzer
from ml.pipeline.threat_scorer import ThreatScorer
from ml.pipeline.zone_manager import ZoneManager

logger = logging.getLogger(__name__)

PROCESS_EVERY_N_FRAMES = 2  # Skip frames for performance (process every 2nd frame for better detection)


class VideoPipeline:
    """Full AI video processing pipeline."""

    def __init__(self):
        from app.core.config import settings

        self.detector = PersonDetector(
            model_path=settings.YOLO_MODEL,
            confidence=settings.YOLO_CONFIDENCE,
            detect_classes=[0, 1, 2, 3, 5, 7],
        )
        self.face_recognizer = FaceRecognizer(
            similarity_threshold=settings.FACE_RECOGNITION_THRESHOLD,
        )
        self.threat_scorer = ThreatScorer()
        logger.info("VideoPipeline initialized")

    def process(
        self,
        video_path: str,
        video_id: str,
        options: Dict[str, Any],
        progress_callback: Optional[Callable] = None,
        mongo_db: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Process a video file through the full pipeline.

        Returns:
            {
                "events": List[dict],
                "trajectories": Dict[int, list],
                "frames_processed": int,
                "heatmap_points": List[dict],
            }
        """
        # Setup
        # Build face recognizer index synchronously if we have mongo_db
        if mongo_db is not None and options.get("enable_face_recognition", True):
            self.face_recognizer.build_index_sync(mongo_db)

        # Override confidence threshold if passed in options
        yolo_conf = options.get("yolo_confidence")
        if yolo_conf is not None:
            self.detector.confidence = float(yolo_conf)
            logger.info(f"YOLO confidence overridden to: {yolo_conf}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720

        # Load zones
        zone_config = options.get("zone_config")
        if not zone_config and mongo_db is not None:
            # Query custom zones from MongoDB
            db_zones = list(mongo_db.zones.find())
            if db_zones:
                zone_config = []
                for db_z in db_zones:
                    z = dict(db_z)
                    z["id"] = str(z.get("id") or z["_id"])
                    z.pop("_id", None)
                    zone_config.append(z)
                logger.info(f"Loaded {len(zone_config)} custom zones from MongoDB for processing")

        tracker = ByteTracker()
        behavior_analyzer = BehaviorAnalyzer(fps=fps)
        zone_manager = ZoneManager(zone_config, width=width, height=height)

        all_events: List[dict] = []
        heatmap_points: List[dict] = []
        frame_number = 0
        processed_count = 0

        # Track recognition cache (avoid re-running face recognition every frame)
        recognition_cache: Dict[int, dict] = {}

        logger.info(f"Processing video {video_id}: {total_frames} frames @ {fps}fps")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_number += 1

            # Process every N frames for efficiency
            if frame_number % PROCESS_EVERY_N_FRAMES != 0:
                continue

            processed_count += 1
            timestamp_secs = frame_number / fps

            # ── 1. Detect (persons + vehicles + faces) ──────────
            detections = self.detector.detect(frame, detect_faces=True)

            # ── 2. Track ───────────────────────────────────────
            active_tracks = tracker.update(detections, frame_number)

            # ── 3. Per-track processing ────────────────────────
            for track in active_tracks:
                cx = track.bbox["x"] + track.bbox["w"] / 2
                cy = track.bbox["y"] + track.bbox["h"] / 2

                # Heatmap data
                heatmap_points.append({"x": cx, "y": cy, "weight": 0.5})

                # Zone assignment
                zone = zone_manager.get_primary_zone(cx, cy)
                entered_zones = zone_manager.update_track_zones(track.track_id, cx, cy)

                # ── 4. Face Recognition (cached) ───────────────
                face_result = recognition_cache.get(track.track_id, {})
                if (
                    options.get("enable_face_recognition", True)
                    and track.class_name == "face"
                ):
                    has_result = bool(face_result)
                    is_matched = face_result.get("matched", False)
                    should_run = not has_result or (not is_matched and track.duration_frames % int(fps) == 0)

                    if should_run:
                        face_crop = self.face_recognizer.extract_face_crop(frame, track.bbox)
                        if face_crop is not None:
                            face_result = self.face_recognizer.recognize_face(face_crop)
                            recognition_cache[track.track_id] = face_result

                # ── 5. Behavior Analysis ───────────────────────
                behaviors = []
                is_face_track = track.class_name == "face"
                if not is_face_track and options.get("enable_behavior_analysis", True):
                    behavior_events = behavior_analyzer.analyze(
                        [track],
                        zone_manager.get_all_zones(),
                        frame_number,
                    )
                    behaviors = [ev["behavior"] for ev in behavior_events]

                # Zone violation from zone entry
                if not is_face_track and entered_zones:
                    for ez in entered_zones:
                        if ez.restricted:
                            behaviors.append("zone_violation")

                # ── 6. Threat Scoring ──────────────────────────
                threat_result = self.threat_scorer.score(
                    identity_confidence=face_result.get("confidence", 0.0),
                    risk_level="unknown",  # would be fetched from DB in production
                    zone_risk=zone.risk_level if zone else 0.2,
                    loitering_duration_secs=track.duration_frames / fps,
                    velocity_anomaly_ratio=max(1.0, track.speed / 5.0),
                    visit_frequency=1,
                    concurrent_events=len(active_tracks),
                    behavior_flags=behaviors,
                )

                # ── 7. Create event ────────────────────────────────
                # Always create an event for every tracked detection
                is_face = track.class_name == "face"
                is_vehicle = track.class_name in ("car", "truck", "bus", "motorcycle", "bicycle")

                # Determine event type and severity
                if behaviors:
                    event_type = behaviors[0]
                elif is_face:
                    event_type = "face_detected"
                elif is_vehicle:
                    event_type = f"{track.class_name}_detected"
                else:
                    event_type = f"{track.class_name}_detection"

                # Lower threshold for all objects to ensure they are captured and displayed
                min_threshold = 0.01

                if threat_result["threat_score"] >= min_threshold or behaviors or is_face or is_vehicle or track.class_name == "person":
                    all_events.append({
                        "track_id": track.track_id,
                        "event_type": event_type,
                        "severity": threat_result["severity"] if not is_face else "low",
                        "threat_score": threat_result["threat_score"],
                        "confidence": track.confidence,
                        "frame_number": frame_number,
                        "timestamp_secs": timestamp_secs,
                        "bbox": track.bbox,
                        "zone_id": zone.id if zone and not is_face else None,
                        "zone_name": zone.name if zone and not is_face else None,
                        "behavior_flags": list(set(behaviors)),
                        "person_id": face_result.get("person_id"),
                        "metadata": {
                            "threat_explanation": threat_result.get("explanation"),
                            "face_matched": face_result.get("matched", False),
                            "class_id": track.class_id,
                            "class_name": track.class_name,
                        },
                    })

            # Progress callback
            if progress_callback and frame_number % 30 == 0:
                progress = min(frame_number / total_frames, 0.99)
                progress_callback(progress, processed_count)

        cap.release()

        # Deduplicate events (keep highest threat per track per 5-sec window)
        events = self._deduplicate_events(all_events, window_secs=5.0)

        logger.info(f"Pipeline complete: {processed_count} frames, {len(events)} events")

        return {
            "events": events,
            "trajectories": tracker.get_all_trajectories(),
            "frames_processed": processed_count,
            "heatmap_points": heatmap_points,
        }

    @staticmethod
    def _deduplicate_events(events: List[dict], window_secs: float = 5.0) -> List[dict]:
        """Keep highest-threat event per track per time window, with class-specific windows."""
        buckets: Dict[str, dict] = {}
        for ev in events:
            # Use smaller windows for faces (1s) and persons (3s) for better granularity
            class_name = ev.get("metadata", {}).get("class_name", "person")
            if class_name == "face":
                win = 1.0  # 1-second window for faces
            elif class_name == "person":
                win = 3.0  # 3-second window for persons
            else:
                win = window_secs  # 5-second window for vehicles
            window = int(ev["timestamp_secs"] / win)
            key = f"{ev['track_id']}_{window}_{ev['event_type']}"
            if key not in buckets or ev["threat_score"] > buckets[key]["threat_score"]:
                buckets[key] = ev
        return sorted(buckets.values(), key=lambda e: e["timestamp_secs"])

