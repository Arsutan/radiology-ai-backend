// server.js
// Node.js + Express backend for Radiology AI prototype
// - Accepts image uploads
// - Runs life-threat checks
// - Calls vision LLM (template) or returns mock when no API key
// - Returns JSON findings + a draft radiology report
// - Includes simple audit logging to disk (for demo only)

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // npm i node-fetch@2
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Storage for uploads (dev/demo). In production use S3 / GCS.
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Very small life-threat keyword check (server-side)
const LIFE_THREAT_KEYWORDS = [
  "chest pain",
  "shortness of breath",
  "sudden weakness",
  "slurred speech",
  "severe bleeding",
  "unconscious",
];

// Simple audit logger (append-only)
function auditLog(obj) {
  const file = path.join(__dirname, "audit.log");
  const line = `[${new Date().toISOString()}] ${JSON.stringify(obj)}\n`;
  fs.appendFileSync(file, line);
}

// Helper: check life threat in text
function containsLifeThreat(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return LIFE_THREAT_KEYWORDS.some((k) => t.includes(k));
}

// ---- AI Vision Integration (template)
// This function demonstrates calling an LLM/vision endpoint.
// It expects `filePath` (local path on server). In many deployments,
// you will upload the file to a public URL (S3) and pass that URL to the model.
// NOTE: we provide a mock path when OPENAI_API_KEY is not set.
async function analyzeImageWithAI(filePath, patientMeta = {}) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  // If no key, return a mock response so the frontend works for demos.
  if (!OPENAI_KEY) {
    // MOCK (fast demo)
    return {
      findings: [
        "Cardiothoracic ratio within normal limits",
        "No acute focal airspace consolidation identified",
        "No pleural effusion seen",
      ],
      differentials: [
        "Normal chest radiograph",
        "Early interstitial change (consider follow-up)",
      ],
      urgency: "Routine — review by radiologist within 24 hours",
      report: `Technique: AP chest radiograph.\nFindings: Cardiothoracic ratio within normal limits. No focal consolidation or pleural effusion.\nImpression: No acute cardiopulmonary disease identified.`,
      confidence: 0.78,
      rawModelOutput: null,
      usedModel: "mock",
    };
  }

  // REAL integration (example using OpenAI Responses API style)
  const imageUrlForModel = filePath; // transform to public URL at deployment

  const systemPrompt = `
You are a clinical support assistant for licensed radiologists. 
Given a chest X-ray (or other radiological image) and optional patient metadata, provide:
1) concise Findings (bullet list)
2) Possible Differential Diagnoses (bullet list)
3) Urgency assessment: "Emergency / Urgent / Routine"
4) A draft radiology report with Technique, Findings, Impression.
5) Confidence (0.0-1.0)
Always be conservative: if uncertain, instruct 'consult radiologist for confirmation'.
Return JSON.
  `;

  const body = {
    model: process.env.VISION_MODEL || "gpt-4o-mini-vision",
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `Image URL: ${imageUrlForModel}\nPatient metadata: ${JSON.stringify(
          patientMeta
        )}`,
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error("LLM error: " + txt);
  }
  const json = await res.json();

  let assistantText = "";
  try {
    assistantText = json.output?.[0]?.content?.[0]?.text || JSON.stringify(json);
  } catch (e) {
    assistantText = JSON.stringify(json);
  }

  return {
    findings: ["(see raw report)"],
    differentials: ["(see raw report)"],
    urgency: "Unknown — review recommended",
    report: assistantText,
    confidence: 0.6,
    rawModelOutput: json,
    usedModel: body.model,
  };
}

// ---- Routes

app.get("/_health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    const { patientName, age, sex, notes } = req.body;
    const file = req.file;
    const clientIp = req.ip;

    if (!file) {
      return res.status(400).json({ error: "No image file uploaded (field 'image')" });
    }

    if (containsLifeThreat(notes || "")) {
      auditLog({ event: "life_threat_detected", patientName, notes, file: file.filename });
      return res.json({
        emergency: true,
        message:
          "EMERGENCY: Life-threatening symptoms detected in notes. Seek immediate medical care and notify on-call clinician.",
      });
    }

    const patientMeta = { patientName, age, sex, notes };

    auditLog({
      event: "upload",
      file: file.filename,
      originalname: file.originalname,
      patientMeta,
      clientIp,
    });

    const filePath = path.resolve(file.path); // local path on server
    let analysis;
    try {
      analysis = await analyzeImageWithAI(filePath, patientMeta);
    } catch (err) {
      console.error("AI call failed:", err);
      analysis = {
        findings: ["AI error — see admin logs"],
        differentials: [],
        urgency: "Unknown",
        report: `AI processing failed. Error: ${err.message}`,
        confidence: 0,
      };
    }

    const reportObj = {
      id: Date.now() + "-" + Math.round(Math.random() * 1e9),
      file: file.filename,
      createdAt: new Date().toISOString(),
      patientMeta,
      analysis,
    };
    const reportsDir = path.join(__dirname, "reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);
    const reportPath = path.join(reportsDir, reportObj.id + ".json");
    fs.writeFileSync(reportPath, JSON.stringify(reportObj, null, 2));

    auditLog({ event: "draft_ready", reportId: reportObj.id, file: file.filename });

    res.json({
      success: true,
      reportId: reportObj.id,
      findings: analysis.findings,
      differentials: analysis.differentials,
      urgency: analysis.urgency,
      draftReport: analysis.report,
      confidence: analysis.confidence,
      next: "Send this draft to a radiologist for review via /clinician/approve",
      sampleUploadedFilePath: filePath,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

app.post("/clinician/approve", express.json(), (req, res) => {
  const { reportId, clinicianId, action, notes } = req.body;
  if (!reportId || !clinicianId || !action) return res.status(400).json({ error: "Missing fields" });

  auditLog({ event: "clinician_action", reportId, clinicianId, action, notes });
  res.json({ ok: true, reportId, clinicianId, action });
});

app.listen(PORT, () => {
  console.log(`Radiology AI backend listening on port ${PORT}`);
});
