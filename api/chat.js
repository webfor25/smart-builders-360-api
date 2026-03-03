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

    const dataDir = path.join(process.cwd(), "data");
    const files = ["faq.md", "company.md", "integrations.md", "support_troubleshooting.md"];

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

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return res.status(200).json({ answer: response.text || "No answer." });
  } catch (err) {
    return res.status(500).json({
      error: "Something went wrong",
      details: err?.message || String(err),
    });
  }
}