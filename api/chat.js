import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

/* ===========================
   SAFE FILE READER
=========================== */
function readSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/* ===========================
   OVERLOAD DETECTION
=========================== */
function isOverloadedError(err) {
  const s = [
    err?.message,
    err?.stack,
    typeof err === "string" ? err : "",
    (() => {
      try { return JSON.stringify(err); } catch { return ""; }
    })(),
  ].join(" ");

  return (
    s.includes('"code":503') ||
    s.includes("503") ||
    s.includes("UNAVAILABLE") ||
    s.includes("high demand") ||
    s.includes("Resource has been exhausted") ||
    s.includes("429")
  );
}

/* ===========================
   SIMPLE SLEEP
=========================== */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ===========================
   RETRY WRAPPER
=========================== */
async function generateWithRetry(aiClient, model, promptText, retries = 2) {
  let lastErr;

  for (let i = 0; i <= retries; i++) {
    try {
      return await aiClient.models.generateContent({
        model,
        contents: promptText,
      });
    } catch (err) {
      lastErr = err;
      await sleep([300, 700, 1500][i] || 1500);
    }
  }

  throw lastErr;
}

/* ===========================
   PRIMARY + FALLBACK
=========================== */
async function generateWithFallback(aiClient, promptText) {
  try {
    // Primary model
    return await generateWithRetry(
      aiClient,
      "gemini-3-flash-preview",
      promptText,
      1
    );
  } catch (err) {
    if (isOverloadedError(err)) {
      console.log("Primary overloaded → Falling back to gemini-1.5-flash");

      return await generateWithRetry(
        aiClient,
        "gemini-1.5-flash",
        promptText,
        1
      );
    }

    throw err;
  }
}

/* ===========================
   MAIN HANDLER
=========================== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const message = (req.body?.message || "").toString().trim();
    if (!message) {
      return res.status(400).json({ error: "Missing message" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Load knowledge files
    const dataDir = path.join(process.cwd(), "data");

    const files = [
      "business_knowledge.md",
      "faq.md",
      "company.md",
      "integrations.md",
      "support_troubleshooting.md",
    ];

    const kb = files
      .map((file) => {
        const filePath = path.join(dataDir, file);
        return `\n\n### FILE: ${file}\n` + readSafe(filePath);
      })
      .join("\n");

    const prompt = `
You are Smart Builders 360 sales and support assistant.

Use ONLY the knowledge below.
If the answer is not found in the knowledge, say:
"I’m not sure about that. Please contact support for more details."

KNOWLEDGE:
${kb}

User question:
${message}
`.trim();

    const response = await generateWithFallback(ai, prompt);

    return res.status(200).json({
      answer: response?.text || "No answer.",
    });

  } catch (err) {
    return res.status(500).json({
      error: "Something went wrong",
      details: err?.message || String(err),
    });
  }
}