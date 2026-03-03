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

export default async function handler(req, res) {
  // CORS (needed for Webflow)
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

    const ai = new GoogleGenAI({ apiKey });

    // Load knowledge files from /data
    const dataDir = path.join(process.cwd(), "data");
    const files = [
      "business_knowledge.md",
      "faq.md",
      "company.md",
      "integrations.md",
      "support_troubleshooting.md",
    ];

    const kb = files
      .map((f) => {
        const p = path.join(dataDir, f);
        return `\n\n### FILE: ${f}\n` + readSafe(p);
      })
      .join("\n");

    const prompt = `
You are Smart Builders 360 sales + support assistant.
Use ONLY the knowledge below. If the answer is not in the knowledge, say you are not sure and suggest contacting support.

KNOWLEDGE:
${kb}

User question:
${message}
`.trim();

    async function generateWithFallback(aiClient, promptText) {
      try {
        // Primary model (fast/cheap, but can be overloaded sometimes)
        return await aiClient.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: promptText,
        });
      } catch (err) {
        const errorText = err?.message || String(err);

        // Fallback on temporary overload / unavailable
        if (errorText.includes("UNAVAILABLE") || errorText.includes("503")) {
          console.log("Primary model overloaded, falling back to gemini-1.5-flash");
          return await aiClient.models.generateContent({
            model: "gemini-1.5-flash",
            contents: promptText,
          });
        }

        throw err;
      }
    }

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