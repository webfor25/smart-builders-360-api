import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    const filePath = path.join(process.cwd(), "data", "faq.md");
    const kb = fs.readFileSync(filePath, "utf-8");

    const prompt = `
You are Smart Builder 360 support assistant.
Use ONLY the knowledge below to answer.

KNOWLEDGE:
${kb}

User Question:
${req.body.message}
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.status(200).json({ answer: text });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  }
}