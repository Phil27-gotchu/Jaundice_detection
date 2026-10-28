import os
import json
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, roc_auc_score

def train_and_export():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(current_dir, "..", "data", "synthetic_neonatal_jaundice_dataset.csv")
    
    if not os.path.exists(data_path):
        data_path = "synthetic_neonatal_jaundice_dataset.csv"
        
    print(f"Loading dataset from: {data_path}")
    df = pd.read_csv(data_path)
    
    # Core optical features measured directly by the IoT probe:
    feature_names = ["bg_ratio", "br_ratio", "od_diff"]
    target_name = "jaundice_label"
    
    X = df[feature_names]
    y = df[target_name]
    
    # 70/30 Train/Test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.30, random_state=42, stratify=y
    )
    
    print(f"Dataset split: {len(X_train)} train samples, {len(X_test)} test samples (70/30)")
    
    # Fit StandardScaler
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Train Logistic Regression
    clf = LogisticRegression(random_state=42, max_iter=1000)
    clf.fit(X_train_scaled, y_train)
    
    # Evaluate
    y_pred = clf.predict(X_test_scaled)
    y_prob = clf.predict_proba(X_test_scaled)[:, 1]
    
    acc = accuracy_score(y_test, y_pred)
    auc = roc_auc_score(y_test, y_prob)
    cm = confusion_matrix(y_test, y_pred)
    
    print(f"\nModel Performance on 30% Test Set:")
    print(f"Accuracy: {acc * 100:.2f}%")
    print(f"ROC-AUC:  {auc:.4f}")
    print("\nConfusion Matrix:")
    print(cm)
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))
    
    # Export model parameters to JSON for fast, zero-dependency Node.js execution
    model_export = {
        "model_type": "LogisticRegression",
        "features": feature_names,
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
            "var": scaler.var_.tolist()
        },
        "coefficients": clf.coef_[0].tolist(),
        "intercept": float(clf.intercept_[0]),
        "threshold": 0.5,
        "metrics": {
            "test_accuracy": float(acc),
            "roc_auc": float(auc)
        }
    }
    
    export_path = os.path.join(current_dir, "trained_model.json")
    with open(export_path, "w") as f:
        json.dump(model_export, f, indent=2)
    print(f"\nModel parameters exported to: {export_path}")
    
    # Also verify that our mathematical formula matches scikit-learn exactly
    print("\nVerifying mathematical formula against sklearn predict_proba:")
    all_match = True
    for i in range(len(X_test)):
        row = X_test.iloc[i].values
        # Standardize: (x - mean) / scale
        scaled = (row - scaler.mean_) / scaler.scale_
        # z = beta0 + sum(beta_i * x_i)
        z = clf.intercept_[0] + np.dot(clf.coef_[0], scaled)
        prob = 1.0 / (1.0 + np.exp(-z))
        sk_prob = y_prob[i]
        diff = abs(prob - sk_prob)
        if diff > 1e-6:
            all_match = False
            print(f"Mismatch at index {i}: custom={prob}, sklearn={sk_prob}")
            break
            
    if all_match:
        print("Success! Custom sigmoid formula matches scikit-learn predict_proba to < 1e-6!")

if __name__ == "__main__":
    train_and_export()

