"""
Polygon-based Zone Management System
Manages surveillance zones with occupancy counting, direction analysis,
and risk level assignment.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class Zone:
    """A named surveillance zone defined by a polygon."""

    def __init__(self, config: dict):
        self.id: str = config["id"]
        self.name: str = config.get("name", self.id)
        self.polygon: List[dict] = config.get("polygon", [])  # [{"x": ..., "y": ...}]
        self.risk_level: float = config.get("risk_level", 0.3)
        self.restricted: bool = config.get("restricted", False)
        self.max_capacity: Optional[int] = config.get("max_capacity")
        self.alert_on_entry: bool = config.get("alert_on_entry", False)
        self._current_occupants: set = set()

    def contains(self, cx: float, cy: float) -> bool:
        """Ray-casting polygon containment check."""
        polygon = self.polygon
        n = len(polygon)
        if n < 3:
            return False

        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = polygon[i]["x"], polygon[i]["y"]
            xj, yj = polygon[j]["x"], polygon[j]["y"]
            if ((yi > cy) != (yj > cy)) and (cx < (xj - xi) * (cy - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
        return inside

    def update_occupant(self, track_id: int, in_zone: bool):
        if in_zone:
            self._current_occupants.add(track_id)
        else:
            self._current_occupants.discard(track_id)

    @property
    def occupancy(self) -> int:
        return len(self._current_occupants)

    @property
    def is_overcrowded(self) -> bool:
        return self.max_capacity is not None and self.occupancy > self.max_capacity

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "polygon": self.polygon,
            "risk_level": self.risk_level,
            "restricted": self.restricted,
            "occupancy": self.occupancy,
            "max_capacity": self.max_capacity,
            "is_overcrowded": self.is_overcrowded,
        }


class ZoneManager:
    """Manages all zones in a camera view."""

    # Default zones if none configured
    DEFAULT_ZONES = [
        {
            "id": "entrance",
            "name": "Main Entrance",
            "polygon": [
                {"x": 0, "y": 0},
                {"x": 400, "y": 0},
                {"x": 400, "y": 200},
                {"x": 0, "y": 200},
            ],
            "risk_level": 0.4,
            "restricted": False,
        },
        {
            "id": "restricted_area",
            "name": "Restricted Area",
            "polygon": [
                {"x": 600, "y": 0},
                {"x": 1280, "y": 0},
                {"x": 1280, "y": 300},
                {"x": 600, "y": 300},
            ],
            "risk_level": 0.9,
            "restricted": True,
            "alert_on_entry": True,
        },
        {
            "id": "general",
            "name": "General Area",
            "polygon": [
                {"x": 0, "y": 200},
                {"x": 1280, "y": 200},
                {"x": 1280, "y": 720},
                {"x": 0, "y": 720},
            ],
            "risk_level": 0.2,
            "restricted": False,
        },
    ]

    def __init__(
        self,
        zone_configs: Optional[List[dict]] = None,
        width: int = 1280,
        height: int = 720,
    ):
        configs = zone_configs or self.DEFAULT_ZONES
        scaled_configs = []
        for config in configs:
            cfg = dict(config)
            polygon = cfg.get("polygon", [])
            if polygon:
                # Detect if coordinates are normalized (all values <= 1.0)
                max_val = max(
                    max(pt.get("x", 0), pt.get("y", 0)) for pt in polygon
                )
                if max_val <= 1.0:
                    # Scale from normalized [0, 1] to absolute pixel coordinates
                    cfg["polygon"] = [
                        {"x": pt["x"] * width, "y": pt["y"] * height}
                        for pt in polygon
                    ]
                    logger.info(
                        f"Zone '{cfg.get('name', cfg['id'])}': scaled normalized "
                        f"polygon to {width}x{height}"
                    )

            # Map alert_threshold → risk_level / restricted if not already set
            if "alert_threshold" in cfg and "risk_level" not in cfg:
                threshold = float(cfg["alert_threshold"])
                cfg["risk_level"] = threshold
                cfg["restricted"] = threshold >= 0.7
                cfg["alert_on_entry"] = threshold >= 0.7

            scaled_configs.append(cfg)

        self._zones: Dict[str, Zone] = {
            cfg["id"]: Zone(cfg) for cfg in scaled_configs
        }
        logger.info(f"ZoneManager initialized: {len(self._zones)} zones")

    def get_zones_for_point(self, cx: float, cy: float) -> List[Zone]:
        """Find all zones containing the given point."""
        return [zone for zone in self._zones.values() if zone.contains(cx, cy)]

    def update_track_zones(self, track_id: int, cx: float, cy: float) -> List[Zone]:
        """Update which zones a track occupies. Returns newly entered zones."""
        entered = []
        for zone in self._zones.values():
            in_zone = zone.contains(cx, cy)
            was_in = track_id in zone._current_occupants
            zone.update_occupant(track_id, in_zone)
            if in_zone and not was_in:
                entered.append(zone)
        return entered

    def remove_track(self, track_id: int):
        for zone in self._zones.values():
            zone._current_occupants.discard(track_id)

    def get_primary_zone(self, cx: float, cy: float) -> Optional[Zone]:
        """Returns highest-risk zone containing the point."""
        zones = self.get_zones_for_point(cx, cy)
        if not zones:
            return None
        return max(zones, key=lambda z: z.risk_level)

    def get_all_zones(self) -> List[dict]:
        return [z.to_dict() for z in self._zones.values()]

    def get_occupancy_report(self) -> Dict[str, int]:
        return {z.id: z.occupancy for z in self._zones.values()}
