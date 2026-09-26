/**
 * Minimal Google Gemini client (the FREE tier — no billing needed). The only
 * module that knows the LLM transport, so swapping providers later touches one
 * file. Needs a free API key from https://aistudio.google.com in GEMINI_API_KEY;
 * the model is GEMINI_MODEL (default gemini-2.0-flash).
 *
 * The request/response shaping (geminiBody / geminiText) is pure and unit-tested
 * (gemini.test.mjs); askGemini does the fetch.
 */

const endpoint = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

/** Pure: shape the Gemini request body from a system prompt + chat messages
 *  ([{ role:'user'|'assistant', text }]). Gemini uses role 'model' for the AI. */
export function geminiBody(systemPrompt, messages) {
  return {
    system_instruction: { parts: [{ text: String(systemPrompt ?? '') }] },
    contents: (Array.isArray(messages) ? messages : []).map((m) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(m.text ?? m.content ?? '') }],
    })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
  };
}

/** Pure: extract the reply text from a Gemini generateContent response. */
export function geminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((p) => p?.text || '').join('').trim();
  return '';
}

/** Ask Gemini. Throws Error('NO_KEY') when unconfigured so the caller can show a
 *  friendly setup message instead of an error. */
export async function askGemini(systemPrompt, messages) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('NO_KEY');
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const res = await fetch(endpoint(model, key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody(systemPrompt, messages)),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}${t ? ': ' + t.slice(0, 200) : ''}`);
  }
  const data = await res.json();
  const text = geminiText(data);
  if (!text) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'no text';
    throw new Error(`Gemini returned ${reason}`);
  }
  return text;
}
