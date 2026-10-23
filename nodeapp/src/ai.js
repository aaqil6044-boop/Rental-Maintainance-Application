"use strict";
/**
 * Maintenance issue classification through the Gemini API.
 * - The key is read from the server environment only.
 * - Only the title and description are sent: no names, addresses or contact details.
 * - The reply is validated; anything malformed is an error, never a made-up success.
 * - The suggestion is advisory. A manager accepts or rejects it.
 */
const config = require("./config");
const { CATEGORIES, PRIORITIES } = require("./rules");

class AiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

let fetchImpl = (...a) => fetch(...a);
const useFetch = (fn) => { fetchImpl = fn; };      // tests inject a fake network here

const status = () => ({ configured: !!config.gemini.key, model: config.gemini.model, provider: "Google Gemini" });

function validate(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch (e) { throw new AiError(502, "AI_BAD_RESPONSE", "The AI service returned a reply that could not be read."); }
  }
  const category = String(data && data.category || "").toUpperCase();
  const priority = String(data && data.priority || "").toUpperCase();
  const explanation = String(data && data.explanation || "").trim();
  if (!CATEGORIES.includes(category) || !PRIORITIES.includes(priority) || !explanation) {
    throw new AiError(502, "AI_BAD_RESPONSE", "The AI service returned a suggestion that failed validation.");
  }
  return { category, priority, explanation: explanation.slice(0, 500) };
}

async function classify({ title, description }) {
  if (!config.gemini.key) {
    throw new AiError(503, "AI_NOT_CONFIGURED", "AI suggestions are not set up. Add GEMINI_API_KEY to the server settings.");
  }
  const prompt =
    "You triage rental property maintenance requests. Choose the best category and a priority " +
    "(URGENT only for safety risks such as gas, flooding, fire or no power/water; HIGH for loss of an essential service; " +
    "MEDIUM for faults that affect comfort; LOW for cosmetic issues). Give a one or two sentence reason.\n\n" +
    `Title: ${String(title).slice(0, 200)}\nDescription: ${String(description).slice(0, 1500)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2, responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", required: ["category", "priority", "explanation"], properties: {
        category: { type: "STRING", enum: CATEGORIES },
        priority: { type: "STRING", enum: PRIORITIES },
        explanation: { type: "STRING" } } },
    },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.gemini.timeoutMs);
  let res;
  try {
    res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:generateContent`,
      { method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.gemini.key },
        body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === "AbortError") throw new AiError(504, "AI_TIMEOUT", "The AI service did not answer in time.");
    throw new AiError(502, "AI_UNREACHABLE", "The AI service could not be reached.");
  } finally { clearTimeout(timer); }

  if (res.status === 429) throw new AiError(503, "AI_RATE_LIMITED", "The AI service is busy. Try again shortly.");
  if (res.status === 401 || res.status === 403) throw new AiError(503, "AI_NOT_CONFIGURED", "The AI key was rejected. Check GEMINI_API_KEY.");
  if (!res.ok) throw new AiError(502, "AI_UPSTREAM", `The AI service returned an error (${res.status}).`);

  const json = await res.json();
  const text = json && json.candidates && json.candidates[0] && json.candidates[0].content &&
               json.candidates[0].content.parts && json.candidates[0].content.parts[0] &&
               json.candidates[0].content.parts[0].text;
  if (!text) throw new AiError(502, "AI_BAD_RESPONSE", "The AI service returned an empty reply.");
  return validate(text);
}

module.exports = { classify, status, validate, useFetch, AiError };
