import OpenAI from "openai";

console.log(
  process.env.OPENAI_API_KEY
    ? "✅ OpenAI API key loaded successfully"
    : "❌ OPENAI_API_KEY is missing"
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default openai;