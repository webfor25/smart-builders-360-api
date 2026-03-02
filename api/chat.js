import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY in Vercel env vars" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
    });

    const filePath = path.join(process.cwd(), "data", "faq.md");
    const kb = fs.readFileSync(filePath, "utf-8");

    const userMessage = (req.body?.message || "").toString();

    const prompt = `
You are Smart Builder 360 support assistant.
Use ONLY the knowledge below to answer.

KNOWLEDGE:
${kb}

User Question:
${userMessage}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return res.status(200).json({ answer: text });
  } catch (error) {
    console.error("API ERROR:", error);
    return res.status(500).json({
      error: "Something went wrong",
      details: error?.message || String(error),
    });
  }
}