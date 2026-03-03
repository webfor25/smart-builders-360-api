import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

function readSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function buildKnowledge() {
  const dataDir = path.join(process.cwd(), "data");
  const files = [
    "faq.md",
    "company.md",
    "integrations.md",
    "support_troubleshooting.md",
    "business_knowledge.md",
  ];

  const kb = files
    .map((f) => {
      const p = path.join(dataDir, f);
      const content = readSafe(p);
      return content ? `\n\n### FILE: ${f}\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return kb;
}

function isRetryableGeminiError(err) {
  // Gemini SDK often returns an object like:
  // { error: { code: 503, message: "...", status: "UNAVAILABLE" } }
  // Sometimes it's a stringified JSON in err.message
  const msg = err?.message || "";
  if (msg.includes('"code":503') || msg.includes("UNAVAILABLE")) return true;
  if (msg.includes('"code":429') || msg.includes("RESOURCE_EXHAUSTED")) return true;
  if (msg.includes('"code":500')) return true;
  return false;
}

function isModelNotFoundError(err) {
  const msg = err?.message || "";
  return msg.includes("404") && msg.includes("not found for API version");
}

async function generateWithFallback(ai, models, prompt) {
  let lastErr = null;

  for (const modelName of models) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });

      const text = response?.text || "";
      if (text.trim()) return { text, usedModel: modelName };

      // If model responded but empty, try next one
      lastErr = new Error(`Empty response from ${modelName}`);
    } catch (err) {
      lastErr = err;

      // If model name is not supported, skip to next model
      if (isModelNotFoundError(err)) continue;

      // If overloaded / rate-limited / transient, try next model
      if (isRetryableGeminiError(err)) continue;

      // Non-retryable error, stop immediately
      throw err;
    }
  }

  // If all models failed, throw the last error
  throw lastErr || new Error("All models failed");
}

export default async function handler(req, res) {
  // CORS for Webflow
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const message = (req.body?.message || "").toString().trim();
    if (!message) return res.status(400).json({ error: "Missing message" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const kb = buildKnowledge();
    if (!kb.trim()) {
      return res.status(500).json({
        error: "Knowledge base is empty",
        details: "No readable .md files found in /data or they are empty.",
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
You are Smart Builders 360 sales + support assistant.
Use ONLY the knowledge below.
If the answer is not in the knowledge, say you are not sure and suggest contacting support.

KNOWLEDGE:
${kb}

User question:
${message}
`.trim();

    // Use current, supported model names first.
    // (Avoid gemini-1.5-flash on v1beta because it may 404.)
    const models = [
      "gemini-3-flash-preview",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ];

    const { text, usedModel } = await generateWithFallback(ai, models, prompt);

    return res.status(200).json({ answer: text, model: usedModel });
  } catch (err) {
    return res.status(500).json({
      error: "Something went wrong",
      details: err?.message || String(err),
    });
  }
}