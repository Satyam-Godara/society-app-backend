const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Ask Gemini a question grounded in the society rulebook.
 * @param {string} rulebook  - Full text of the society rulebook
 * @param {string} question  - Resident's question
 * @param {string} language  - Detected language code (en, hi, etc.)
 * @returns {{ answer: string, rule_cited: string }}
 */
async function askRulebook(rulebook, question, language = 'en') {

  const langInstruction = language !== 'en'
    ? `The resident asked in a non-English language. Detect the language and reply in the SAME language as the question.`
    : `Reply in clear, simple English.`;

  const prompt = `
You are a helpful society management assistant for an Indian residential society.
You have been given the society's official rulebook below.

STRICT RULES YOU MUST FOLLOW:
1. Answer ONLY using information found in the rulebook below.
2. If the answer is not in the rulebook, say: "I couldn't find this in the society rulebook. Please contact your secretary."
3. Always mention which section or rule you are referring to.
4. Keep answers short, clear, and friendly — 2 to 4 sentences maximum.
5. ${langInstruction}
6. Never make up rules or policies that are not in the rulebook.

---SOCIETY RULEBOOK START---
${rulebook}
---SOCIETY RULEBOOK END---

Resident's question: ${question}

Reply in this exact JSON format (no markdown, no code blocks, just raw JSON):
{
  "answer": "your answer here",
  "rule_cited": "Section X.X or Rule name, or null if not found"
}
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // Strip any accidental markdown code fences Gemini sometimes adds
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    // If JSON parse fails, return raw text as answer
    return { answer: text, rule_cited: null };
  }
}

/**
 * Generate a 2-line AI summary of a notice (for the notices feed)
 * @param {string} noticeBody - Full notice text
 * @returns {string} - Short summary
 */
async function summarizeNotice(noticeBody) {
  const prompt = `
Summarize this housing society notice in 1-2 short sentences.
Be direct and clear. No fluff. No "This notice says..." preamble.
Notice: ${noticeBody}
`;
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = { askRulebook, summarizeNotice };