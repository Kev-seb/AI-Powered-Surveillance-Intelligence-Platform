"""
Behavioral Analysis Engine
Detects suspicious behaviors from track trajectories:
  - Loitering
  - Tailgating
  - Crowd formation
  - Sudden movement
  - Zone violation
  - Repeated reappearance
  - Abandoned object (heuristic)
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Dict, List, Any, Set

from ml.pipeline.tracker import Track

logger = logging.getLogger(__name__)


class BehaviorAnalyzer:
    """Analyzes track patterns to detect suspicious behaviors."""

    def __init__(
        self,
        fps: float = 25.0,
        loiter_seconds: float = 30.0,
        crowd_threshold: int = 5,
        speed_anomaly_multiplier: float = 3.0,
    ):
        self.fps = fps
        self.loiter_frames = int(loiter_seconds * fps)
        self.crowd_threshold = crowd_threshold
        self.speed_multiplier = speed_anomaly_multiplier

        # Track state memory
        self._track_zones: Dict[int, Set[str]] = defaultdict(set)
        self._track_appearances: Dict[int, int] = defaultdict(int)
        self._speed_history: List[float] = []

    def analyze(
        self,
        tracks: List[Track],
        zones: List[Dict],
        frame_number: int,
    ) -> List[Dict[str, Any]]:
        """
        Analyze current tracks for behavioral anomalies.

        Returns list of behavior events:
        [
            {
                "track_id": int,
                "behavior": str,
                "details": dict,
            }
        ]
        """
        events = []

        # Update speed baseline
        speeds = [t.speed for t in tracks if t.speed > 0]
        if speeds:
            self._speed_history.extend(speeds)
            if len(self._speed_history) > 500:
                self._speed_history = self._speed_history[-500:]

        avg_speed = sum(self._speed_history) / len(self._speed_history) if self._speed_history else 1.0

        for track in tracks:
            flags = []

            # 1. LOITERING — track present for too long
            if track.duration_frames >= self.loiter_frames:
                flags.append(("loitering", {
                    "duration_frames": track.duration_frames,
                    "duration_seconds": round(track.duration_frames / self.fps, 1),
                }))

            # 2. SUDDEN MOVEMENT — speed spike
            if avg_speed > 0 and track.speed > avg_speed * self.speed_multiplier:
                flags.append(("sudden_movement", {
                    "speed": round(track.speed, 2),
                    "avg_speed": round(avg_speed, 2),
                    "ratio": round(track.speed / avg_speed, 1),
                }))

            # 3. ZONE VIOLATION — track enters restricted zone
            if track.trajectory:
                current_pos = track.trajectory[-1]
                for zone in zones:
                    if zone.get("restricted") and self._point_in_zone(
                        current_pos["cx"], current_pos["cy"], zone
                    ):
                        if zone["id"] not in self._track_zones[track.track_id]:
                            self._track_zones[track.track_id].add(zone["id"])
                            flags.append(("zone_violation", {
                                "zone_id": zone["id"],
                                "zone_name": zone.get("name", "Restricted Zone"),
                            }))

            # 4. REPEATED REAPPEARANCE — same track reappearing
            appearances = self._track_appearances.get(track.track_id, 0)
            if appearances > 3:
                flags.append(("repeated_reappearance", {
                    "appearance_count": appearances,
                }))

            for behavior, details in flags:
                events.append({
                    "track_id": track.track_id,
                    "behavior": behavior,
                    "details": details,
                })

        # 5. CROWD FORMATION — many people clustered
        if len(tracks) >= self.crowd_threshold:
            # Check if people are spatially clustered
            if tracks:
                positions = [(t.bbox["x"] + t.bbox["w"] / 2, t.bbox["y"] + t.bbox["h"] / 2) for t in tracks]
                if self._is_clustered(positions, cluster_radius=200):
                    events.append({
                        "track_id": -1,  # group event
                        "behavior": "crowd_formation",
                        "details": {
                            "count": len(tracks),
                            "threshold": self.crowd_threshold,
                        },
                    })

        # 6. TAILGATING — two tracks very close together, both moving
        moving_tracks = [t for t in tracks if t.speed > 2.0]
        if len(moving_tracks) >= 2:
            for i, t1 in enumerate(moving_tracks):
                for t2 in moving_tracks[i+1:]:
                    dist = self._track_distance(t1, t2)
                    if dist < 80:  # pixels
                        events.append({
                            "track_id": t1.track_id,
                            "behavior": "tailgating",
                            "details": {
                                "following_track_id": t2.track_id,
                                "distance_px": round(dist, 1),
                            },
                        })

        return events

    def update_track_appearances(self, track_id: int, appeared: bool = True):
        if appeared:
            self._track_appearances[track_id] += 1

    @staticmethod
    def _point_in_zone(cx: float, cy: float, zone: dict) -> bool:
        """Check if a point is inside a polygon zone using ray casting."""
        polygon = zone.get("polygon", [])
        if len(polygon) < 3:
            return False

        n = len(polygon)
        inside = False
        j = n - 1

        for i in range(n):
            xi, yi = polygon[i]["x"], polygon[i]["y"]
            xj, yj = polygon[j]["x"], polygon[j]["y"]

            if ((yi > cy) != (yj > cy)) and (cx < (xj - xi) * (cy - yi) / (yj - yi) + xi):
                inside = not inside
            j = i

        return inside

    @staticmethod
    def _is_clustered(positions: List[tuple], cluster_radius: float) -> bool:
        """Check if positions form a spatial cluster."""
        if not positions:
            return False
        cx = sum(p[0] for p in positions) / len(positions)
        cy = sum(p[1] for p in positions) / len(positions)
        distances = [((p[0]-cx)**2 + (p[1]-cy)**2)**0.5 for p in positions]
        return sum(1 for d in distances if d < cluster_radius) >= len(positions) * 0.7

    @staticmethod
    def _track_distance(t1: Track, t2: Track) -> float:
        cx1 = t1.bbox["x"] + t1.bbox["w"] / 2
        cy1 = t1.bbox["y"] + t1.bbox["h"] / 2
        cx2 = t2.bbox["x"] + t2.bbox["w"] / 2
        cy2 = t2.bbox["y"] + t2.bbox["h"] / 2
        return ((cx1-cx2)**2 + (cy1-cy2)**2) ** 0.5
