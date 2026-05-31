"""
XGBoost Threat Scoring Engine
================================
Multi-feature threat scorer with calibration and explainability.

Input Features (8):
  1. identity_confidence   — face recognition match confidence (0-1)
  2. risk_level            — person's registered risk level (encoded)
  3. zone_risk             — risk level of the zone (0-1)
  4. loitering_duration    — normalized loitering time (0-1)
  5. velocity_anomaly      — speed ratio vs baseline (0-1 capped)
  6. visit_frequency       — how many times this track appeared (0-1)
  7. concurrent_events     — number of simultaneous events (0-1)
  8. behavior_count        — number of behavior flags triggered (0-1)

Output:
  - threat_score: float (0.0 - 1.0)
  - severity: "low" | "medium" | "high" | "critical"
  - explanation: dict of feature contributions
"""
from __future__ import annotations

import logging
import os
from typing import Dict, Any, Tuple

import numpy as np

logger = logging.getLogger(__name__)

RISK_LEVEL_MAP = {
    "unknown": 0.1,
    "low": 0.2,
    "medium": 0.5,
    "high": 0.8,
    "critical": 1.0,
}

BEHAVIOR_WEIGHTS = {
    "loitering": 0.6,
    "tailgating": 0.7,
    "crowd_formation": 0.5,
    "sudden_movement": 0.65,
    "zone_violation": 0.9,
    "repeated_reappearance": 0.75,
    "abandoned_object": 0.8,
}

SEVERITY_THRESHOLDS = {
    "critical": 0.80,
    "high": 0.60,
    "medium": 0.35,
    "low": 0.0,
}


class ThreatScorer:
    """XGBoost-based threat scoring engine with heuristic fallback."""

    MODEL_PATH = "/app/ml_models/threat_scorer.json"

    def __init__(self):
        self._model = None
        self._load_model()

    def _load_model(self):
        """Load trained XGBoost model if available, else use heuristic."""
        try:
            if os.path.exists(self.MODEL_PATH):
                import xgboost as xgb
                self._model = xgb.XGBClassifier()
                self._model.load_model(self.MODEL_PATH)
                logger.info("XGBoost threat model loaded")
            else:
                logger.info("XGBoost model not found — using calibrated heuristic scorer")
        except Exception as e:
            logger.warning(f"Failed to load XGBoost model: {e} — using heuristic")
            self._model = None

    def score(
        self,
        identity_confidence: float = 0.0,
        risk_level: str = "unknown",
        zone_risk: float = 0.3,
        loitering_duration_secs: float = 0.0,
        velocity_anomaly_ratio: float = 1.0,
        visit_frequency: int = 1,
        concurrent_events: int = 0,
        behavior_flags: list = None,
    ) -> Dict[str, Any]:
        """
        Compute threat score for a detection event.

        Returns:
            {
                "threat_score": float,
                "severity": str,
                "explanation": dict,
                "features": dict,
            }
        """
        behavior_flags = behavior_flags or []

        # Feature engineering
        features = self._extract_features(
            identity_confidence, risk_level, zone_risk,
            loitering_duration_secs, velocity_anomaly_ratio,
            visit_frequency, concurrent_events, behavior_flags,
        )

        if self._model is not None:
            score = self._xgboost_score(features)
        else:
            score = self._heuristic_score(features, behavior_flags)

        # Calibrate and clamp
        score = float(np.clip(score, 0.0, 1.0))
        severity = self._classify_severity(score)

        explanation = {
            "identity_contribution": features[0] * 0.25,
            "risk_level_contribution": features[1] * 0.20,
            "zone_risk_contribution": features[2] * 0.15,
            "loitering_contribution": features[3] * 0.15,
            "velocity_contribution": features[4] * 0.10,
            "behavior_contribution": features[7] * 0.15,
        }

        return {
            "threat_score": round(score, 4),
            "severity": severity,
            "explanation": explanation,
            "features": {
                "identity_confidence": features[0],
                "risk_level_encoded": features[1],
                "zone_risk": features[2],
                "loitering_normalized": features[3],
                "velocity_anomaly": features[4],
                "visit_frequency": features[5],
                "concurrent_events": features[6],
                "behavior_count": features[7],
            },
        }

    def _extract_features(
        self, identity_confidence, risk_level, zone_risk,
        loitering_secs, velocity_ratio, visit_freq,
        concurrent_events, behavior_flags,
    ) -> list:
        risk_encoded = RISK_LEVEL_MAP.get(risk_level.lower(), 0.1)
        loitering_norm = min(loitering_secs / 300.0, 1.0)  # normalize to 5 min max
        velocity_norm = min((velocity_ratio - 1.0) / 5.0, 1.0) if velocity_ratio > 1.0 else 0.0
        visit_norm = min(visit_freq / 10.0, 1.0)
        concurrent_norm = min(concurrent_events / 10.0, 1.0)
        behavior_norm = min(len(behavior_flags) / 5.0, 1.0)

        return [
            identity_confidence,
            risk_encoded,
            zone_risk,
            loitering_norm,
            velocity_norm,
            visit_norm,
            concurrent_norm,
            behavior_norm,
        ]

    def _heuristic_score(self, features: list, behavior_flags: list) -> float:
        """Calibrated weighted heuristic when ML model unavailable."""
        weights = [0.25, 0.20, 0.15, 0.15, 0.10, 0.05, 0.05, 0.05]
        base_score = sum(f * w for f, w in zip(features, weights))

        # Behavior-specific boosts
        behavior_boost = 0.0
        for flag in behavior_flags:
            behavior_boost = max(behavior_boost, BEHAVIOR_WEIGHTS.get(flag, 0.0) * 0.3)

        return min(base_score + behavior_boost, 1.0)

    def _xgboost_score(self, features: list) -> float:
        """Use trained XGBoost model."""
        X = np.array([features], dtype=np.float32)
        try:
            prob = self._model.predict_proba(X)[0]
            return float(prob[1]) if len(prob) > 1 else float(prob[0])
        except Exception as e:
            logger.warning(f"XGBoost inference failed: {e}")
            return self._heuristic_score(features, [])

    @staticmethod
    def _classify_severity(score: float) -> str:
        for level, threshold in SEVERITY_THRESHOLDS.items():
            if score >= threshold:
                return level
        return "low"
