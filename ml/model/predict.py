#!/usr/bin/env python3
"""
ML Predictor for Jaundice Screening.
Loads the trained Logistic Regression model and predicts jaundice probability
and classification from optical readings (bgRatio, brRatio, odDiff).
"""

import os
import json
import math
import sys

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trained_model.json")

def load_model():
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model file not found: {MODEL_PATH}. Run train_and_export.py first.")
    with open(MODEL_PATH, "r") as f:
        return json.load(f)

def predict_jaundice(bg_ratio, br_ratio, od_diff, model=None):
    if model is None:
        model = load_model()
        
    means = model["scaler"]["mean"]
    scales = model["scaler"]["scale"]
    coefs = model["coefficients"]
    intercept = model["intercept"]
    threshold = model.get("threshold", 0.5)
    
    # Standardize input features
    inputs = [float(bg_ratio), float(br_ratio), float(od_diff)]
    scaled = [(inputs[i] - means[i]) / scales[i] for i in range(3)]
    
    # Logistic linear combination z = intercept + dot(coefs, scaled)
    z = intercept + sum(c * s for c, s in zip(coefs, scaled))
    
    # Sigmoid function
    prob = 1.0 / (1.0 + math.exp(-z))
    has_jaundice = prob >= threshold
    
    # Classify risk category
    if prob >= 0.70:
        risk_level = "HIGH"
        label = "High Risk of Jaundice"
    elif prob >= 0.45:
        risk_level = "MODERATE"
        label = "Moderate Risk (Borderline)"
    else:
        risk_level = "LOW"
        label = "Low Risk / Normal"
        
    return {
        "has_jaundice": bool(has_jaundice),
        "probability": round(prob, 4),
        "percentage": round(prob * 100, 1),
        "risk_level": risk_level,
        "label": label,
        "features": {
            "bg_ratio": float(bg_ratio),
            "br_ratio": float(br_ratio),
            "od_diff": float(od_diff)
        }
    }

if __name__ == "__main__":
    if len(sys.argv) >= 4:
        bg = float(sys.argv[1])
        br = float(sys.argv[2])
        od = float(sys.argv[3])
    else:
        # Sample test case
        print("Usage: python predict.py <bg_ratio> <br_ratio> <od_diff>")
        print("Testing with sample readings...")
        print("\n1. Sample Positive (Jaundice) Case (bg=0.45, br=0.30, od=0.85):")
        print(json.dumps(predict_jaundice(0.45, 0.30, 0.85), indent=2))
        print("\n2. Sample Negative (Normal) Case (bg=0.85, br=0.55, od=0.15):")
        print(json.dumps(predict_jaundice(0.85, 0.55, 0.15), indent=2))

