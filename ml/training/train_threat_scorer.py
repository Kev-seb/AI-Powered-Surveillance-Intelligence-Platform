"""
XGBoost Threat Scorer Training Script
Generates synthetic training data and trains the model.
Run: python ml/training/train_threat_scorer.py
"""
import json
import os
import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, classification_report
from sklearn.calibration import CalibratedClassifierCV


def generate_synthetic_data(n_samples: int = 10000):
    """Generate synthetic training data based on domain knowledge."""
    np.random.seed(42)

    # Feature definitions (same as ThreatScorer._extract_features)
    identity_confidence = np.random.beta(2, 5, n_samples)
    risk_level = np.random.choice([0.1, 0.2, 0.5, 0.8, 1.0], n_samples,
                                   p=[0.4, 0.3, 0.15, 0.1, 0.05])
    zone_risk = np.random.beta(2, 5, n_samples)
    loitering_norm = np.random.exponential(0.1, n_samples).clip(0, 1)
    velocity_anomaly = np.random.beta(1, 5, n_samples)
    visit_freq = np.random.exponential(0.1, n_samples).clip(0, 1)
    concurrent = np.random.beta(2, 8, n_samples)
    behavior_count = np.random.choice([0, 0.2, 0.4, 0.6, 0.8, 1.0], n_samples,
                                       p=[0.5, 0.2, 0.15, 0.08, 0.04, 0.03])

    X = np.column_stack([
        identity_confidence, risk_level, zone_risk, loitering_norm,
        velocity_anomaly, visit_freq, concurrent, behavior_count,
    ])

    # Label generation (domain-driven)
    threat_score = (
        identity_confidence * 0.25 +
        risk_level * 0.20 +
        zone_risk * 0.15 +
        loitering_norm * 0.15 +
        velocity_anomaly * 0.10 +
        behavior_count * 0.15
    )
    y = (threat_score > 0.45).astype(int)

    print(f"Generated {n_samples} samples — {y.sum()} threats ({y.mean():.1%})")
    return X, y


def train():
    MODEL_DIR = os.environ.get("MODEL_DIR", "/app/ml_models")
    os.makedirs(MODEL_DIR, exist_ok=True)
    model_path = os.path.join(MODEL_DIR, "threat_scorer.json")

    print("Generating training data...")
    X, y = generate_synthetic_data(10000)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print("Training XGBoost classifier...")
    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric="auc",
        random_state=42,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=50,
    )

    # Evaluate
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, y_pred_proba)
    y_pred = (y_pred_proba > 0.5).astype(int)

    print(f"\nTest AUC: {auc:.4f}")
    print(classification_report(y_test, y_pred, target_names=["Safe", "Threat"]))

    # Save
    model.save_model(model_path)
    print(f"Model saved: {model_path}")

    # Save feature importance
    importance = model.get_booster().get_score(importance_type="gain")
    with open(os.path.join(MODEL_DIR, "feature_importance.json"), "w") as f:
        json.dump(importance, f, indent=2)

    print("Training complete!")


if __name__ == "__main__":
    train()
