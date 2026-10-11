import os
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

def main():
    # 1. Determine dataset path dynamically
    current_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(current_dir, "..", "data", "synthetic_neonatal_jaundice_dataset.csv")

    if not os.path.exists(data_path):
        # Fallback if run from project root or different directory
        data_path = "synthetic_neonatal_jaundice_dataset.csv"

    print(f"Loading data from: {data_path}")
    df = pd.read_csv(data_path)

    print("\nDataset Info:")
    print(f"Shape: {df.shape}")
    print(df.head())

    # 2. Preprocess data
    # Drop identifier column if present
    if "id" in df.columns:
        df = df.drop(columns=["id"])

    # Convert categorical variables (e.g., gender) to numeric
    if "gender" in df.columns:
        df["gender"] = df["gender"].map({"Male": 1, "Female": 0})

    # Separate features (X) and target (y)
    target_column_1 = "jaundice_label"
    target_column_2 = "r"
    target_column_3 = "g"
    target_column_4 = "b"
    
    X = df.drop(columns=[target_column_1,target_column_2,target_column_3,target_column_4])
    y = df[target_column_1]

    # 3. 70/30 Train-Test Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.30, random_state=42, stratify=y
    )

    print(f"\nTrain set size: {X_train.shape[0]} samples")
    print(f"Test set size:  {X_test.shape[0]} samples")

    # 4. Feature Scaling (recommended for Logistic Regression)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # 5. Initialize and train Random Forest model
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train_scaled, y_train)

    # 6. Make predictions
    y_pred = model.predict(X_test_scaled)

    # 7. Evaluate model performance
    acc = accuracy_score(y_test, y_pred)
    cm = confusion_matrix(y_test, y_pred)
    cr = classification_report(y_test, y_pred)

    print("\n" + "="*40)
    print("MODEL EVALUATION RESULTS")
    print("="*40)
    print(f"Accuracy: {acc * 100:.2f}%\n")
    print("Confusion Matrix:")
    print(cm)
    print("\nClassification Report:")
    print(cr)

if __name__ == "__main__":
    main()

