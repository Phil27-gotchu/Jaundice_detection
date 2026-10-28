"use strict";

const fs = require("fs");
const path = require("path");

const MODEL_PATH = path.join(__dirname, "..", "ml", "model", "trained_model.json");

// Default weights from Logistic Regression trained on 70/30 split of synthetic dataset
const DEFAULT_MODEL = {
  model_type: "LogisticRegression",
  features: ["bg_ratio", "br_ratio", "od_diff"],
  scaler: {
    mean: [0.69486558, 0.45075744, 0.39970762],
    scale: [0.17991455, 0.12299024, 0.27197490],
  },
  coefficients: [-1.92400653, -1.68399288, 1.81566865],
  intercept: 0.24775094,
  threshold: 0.5,
};

let loadedModel = null;

function getModel() {
  if (loadedModel) return loadedModel;
  try {
    if (fs.existsSync(MODEL_PATH)) {
      const raw = fs.readFileSync(MODEL_PATH, "utf8");
      loadedModel = JSON.parse(raw);
      return loadedModel;
    }
  } catch (err) {
    console.warn("Could not load trained_model.json, using default weights:", err.message);
  }
  loadedModel = DEFAULT_MODEL;
  return loadedModel;
}

/**
 * Evaluates patient scan against the trained Logistic Regression model.
 *
 * @param {{ bgRatio: number, brRatio: number, odDiff: number }} reading
 * @returns {{
 *   hasJaundice: boolean,
 *   probability: number,
 *   percentage: number,
 *   riskLevel: "HIGH" | "MODERATE" | "LOW",
 *   statusLabel: string,
 *   recommendation: string
 * }}
 */
function predict(reading) {
  if (!reading) return null;

  const model = getModel();
  const bg = Number(reading.bgRatio ?? 0);
  const br = Number(reading.brRatio ?? 0);
  const od = Number(reading.odDiff ?? 0);

  const means = model.scaler.mean;
  const scales = model.scaler.scale;
  const coefs = model.coefficients;
  const intercept = model.intercept;
  const threshold = model.threshold ?? 0.5;

  // Standardize inputs: (x - mean) / scale
  const s0 = (bg - means[0]) / scales[0];
  const s1 = (br - means[1]) / scales[1];
  const s2 = (od - means[2]) / scales[2];

  // Logit z = intercept + beta0*s0 + beta1*s1 + beta2*s2
  const z = intercept + coefs[0] * s0 + coefs[1] * s1 + coefs[2] * s2;

  // Sigmoid probability: P(jaundice = 1)
  const probability = 1 / (1 + Math.exp(-z));
  const percentage = Math.round(probability * 1000) / 10;
  const hasJaundice = probability >= threshold;

  let riskLevel = "LOW";
  let statusLabel = "Low Chance of Jaundice";
  let recommendation =
    "Optical reflectance ratios are consistent with normal neonatal skin baseline. Continue routine monitoring.";

  if (probability >= 0.70) {
    riskLevel = "HIGH";
    statusLabel = "High Chance of Jaundice";
    recommendation =
      "Screening indicates significant bilirubin absorption. Clinical evaluation and confirmatory serum bilirubin (TSB) test strongly recommended.";
  } else if (probability >= 0.45) {
    riskLevel = "MODERATE";
    statusLabel = "Moderate Risk (Borderline)";
    recommendation =
      "Optical readings show borderline bilirubin levels. Repeat probe scan in 4–6 hours and observe for visible icterus.";
  }

  return {
    hasJaundice,
    probability: Math.round(probability * 10000) / 10000,
    percentage,
    riskLevel,
    statusLabel,
    recommendation,
  };
}

module.exports = { predict, getModel };

