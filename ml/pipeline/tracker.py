"""
ByteTrack-based Multi-Object Tracker
Maintains persistent track IDs and trajectory history across frames.
"""
from __future__ import annotations

import logging
from collections import defaultdict, deque
from typing import Dict, List, Any, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class Track:
    """Represents a tracked person/object across frames."""

    def __init__(self, track_id: int, detection: dict, frame_number: int):
        self.track_id = track_id
        self.bbox = detection["bbox"]
        self.confidence = detection["confidence"]
        self.class_id = detection.get("class_id", 0)
        self.class_name = detection.get("class_name", "person")
        self.trajectory: deque = deque(maxlen=120)
        self.trajectory.append({
            "frame": frame_number,
            "cx": detection["cx"],
            "cy": detection["cy"],
            "bbox": detection["bbox"],
        })
        self.first_frame = frame_number
        self.last_frame = frame_number
        self.hit_count = 1
        self.miss_count = 0
        self.velocities: deque = deque(maxlen=30)

    def update(self, detection: dict, frame_number: int):
        prev_cx = self.trajectory[-1]["cx"] if self.trajectory else detection["cx"]
        prev_cy = self.trajectory[-1]["cy"] if self.trajectory else detection["cy"]

        self.bbox = detection["bbox"]
        self.confidence = detection["confidence"]
        self.class_id = detection.get("class_id", self.class_id)
        self.class_name = detection.get("class_name", self.class_name)
        self.last_frame = frame_number
        self.hit_count += 1
        self.miss_count = 0

        self.trajectory.append({
            "frame": frame_number,
            "cx": detection["cx"],
            "cy": detection["cy"],
            "bbox": detection["bbox"],
        })

        # Compute velocity
        vx = detection["cx"] - prev_cx
        vy = detection["cy"] - prev_cy
        self.velocities.append((vx, vy))

    @property
    def avg_velocity(self) -> Tuple[float, float]:
        if not self.velocities:
            return 0.0, 0.0
        vx = sum(v[0] for v in self.velocities) / len(self.velocities)
        vy = sum(v[1] for v in self.velocities) / len(self.velocities)
        return vx, vy

    @property
    def speed(self) -> float:
        vx, vy = self.avg_velocity
        return (vx**2 + vy**2) ** 0.5

    @property
    def duration_frames(self) -> int:
        return self.last_frame - self.first_frame

    def to_dict(self) -> dict:
        return {
            "track_id": self.track_id,
            "bbox": self.bbox,
            "confidence": self.confidence,
            "class_id": self.class_id,
            "class_name": self.class_name,
            "first_frame": self.first_frame,
            "last_frame": self.last_frame,
            "hit_count": self.hit_count,
            "speed": self.speed,
            "trajectory": list(self.trajectory),
        }


class ByteTracker:
    """
    Simplified ByteTrack implementation for multi-person tracking.
    Uses IoU-based matching with confidence-based high/low detection split.
    """

    def __init__(self, iou_threshold: float = 0.3, max_missed: int = 30):
        self.iou_threshold = iou_threshold
        self.max_missed = max_missed
        self._next_id = 1
        self._active_tracks: Dict[int, Track] = {}
        self._lost_tracks: Dict[int, Track] = {}

    def update(self, detections: List[dict], frame_number: int) -> List[Track]:
        """Update tracker with new detections. Returns list of active tracks."""
        if not detections:
            # Age out all tracks
            for track in list(self._active_tracks.values()):
                track.miss_count += 1
                if track.miss_count > self.max_missed:
                    self._lost_tracks[track.track_id] = track
                    del self._active_tracks[track.track_id]
            return list(self._active_tracks.values())

        # Split high/low confidence
        high_dets = [d for d in detections if d["confidence"] >= 0.6]
        low_dets = [d for d in detections if d["confidence"] < 0.6]

        unmatched_tracks = list(self._active_tracks.values())
        unmatched_dets = []

        # Match high confidence detections first
        matched_track_ids = set()
        for det in high_dets:
            best_track = None
            best_iou = self.iou_threshold

            for track in unmatched_tracks:
                if track.track_id in matched_track_ids:
                    continue
                iou = self._compute_iou(det["bbox"], track.bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_track = track

            if best_track:
                best_track.update(det, frame_number)
                matched_track_ids.add(best_track.track_id)
            else:
                unmatched_dets.append(det)

        # Match low confidence against remaining tracks
        for det in low_dets:
            best_track = None
            best_iou = self.iou_threshold * 0.8  # lower threshold

            for track in unmatched_tracks:
                if track.track_id in matched_track_ids:
                    continue
                iou = self._compute_iou(det["bbox"], track.bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_track = track

            if best_track:
                best_track.update(det, frame_number)
                matched_track_ids.add(best_track.track_id)

        # Age out unmatched tracks
        for track in unmatched_tracks:
            if track.track_id not in matched_track_ids:
                track.miss_count += 1
                if track.miss_count > self.max_missed:
                    self._lost_tracks[track.track_id] = self._active_tracks.pop(track.track_id)

        # Create new tracks for unmatched detections
        for det in unmatched_dets:
            track = Track(self._next_id, det, frame_number)
            self._active_tracks[self._next_id] = track
            self._next_id += 1

        return list(self._active_tracks.values())

    def get_all_trajectories(self) -> Dict[int, list]:
        """Return trajectory history for all tracks (active + lost)."""
        all_tracks = {**self._active_tracks, **self._lost_tracks}
        return {tid: list(track.trajectory) for tid, track in all_tracks.items()}

    @staticmethod
    def _compute_iou(bbox1: dict, bbox2: dict) -> float:
        """Compute Intersection-over-Union for two bounding boxes."""
        x1_1, y1_1 = bbox1["x"], bbox1["y"]
        x2_1 = x1_1 + bbox1["w"]
        y2_1 = y1_1 + bbox1["h"]

        x1_2, y1_2 = bbox2["x"], bbox2["y"]
        x2_2 = x1_2 + bbox2["w"]
        y2_2 = y1_2 + bbox2["h"]

        inter_x1 = max(x1_1, x1_2)
        inter_y1 = max(y1_1, y1_2)
        inter_x2 = min(x2_1, x2_2)
        inter_y2 = min(y2_1, y2_2)

        if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
            return 0.0

        inter_area = (inter_x2 - inter_x1) * (inter_y2 - inter_y1)
        area1 = bbox1["w"] * bbox1["h"]
        area2 = bbox2["w"] * bbox2["h"]
        union = area1 + area2 - inter_area

        return inter_area / union if union > 0 else 0.0
