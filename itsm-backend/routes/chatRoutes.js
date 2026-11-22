const express = require('express');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const chatLimit = rateLimit({ keyPrefix: 'chat', max: 12, windowMs: 60000 });
const instructions = 'You are the IT support assistant for an incident desk. Offer concise, reversible troubleshooting steps or help draft a ticket. Ask for missing details. Never ask for credentials or claim you accessed systems or filed an incident.';

router.post('/', requireAuth, chatLimit, asyncHandler(async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
    throw AppError.badRequest('Enter a message between 1 and 2000 characters.');
  }
  if (!Array.isArray(history) || history.length > 10 || history.length % 2 ||
      !history.every((turn, i) => turn?.role === (i % 2 ? 'assistant' : 'user') &&
        typeof turn.text === 'string' && turn.text.trim() && turn.text.length <= 4000)) {
    throw AppError.badRequest('Invalid conversation history. Start a new chat.');
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AppError('The support assistant is not configured yet.', 503, 'CHAT_UNCONFIGURED');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const contents = [...history, { role: 'user', text: message.trim() }].map(turn => ({
    role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.text }],
  }));

  let reply;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] }, contents }),
    });
    if (response.status === 429) throw new AppError('The assistant reached its usage limit. Try again later.', 429, 'CHAT_QUOTA');
    if (response.status === 404) throw new AppError('The configured Gemini model is unavailable for this project. Check GEMINI_MODEL.', 503, 'CHAT_MODEL');
    if (response.status === 401 || response.status === 403) throw new AppError('Gemini denied access. Check the backend API key and its project permissions.', 503, 'CHAT_ACCESS');
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      if (body?.error?.details?.some(detail => detail.reason === 'API_KEY_INVALID')) {
        throw new AppError('Gemini rejected the API key. Set the replacement key and restart the backend.', 503, 'CHAT_KEY');
      }
      throw new AppError(`Gemini returned HTTP ${response.status}. Check the project configuration in AI Studio.`, 502, 'CHAT_PROVIDER');
    }
    const data = await response.json();
    reply = data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text).join('').trim();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'TimeoutError') throw new AppError('Gemini took too long to respond. Try again.', 504, 'CHAT_TIMEOUT');
    throw new AppError('The backend could not read a response from Gemini. Check its internet connection.', 502, 'CHAT_CONNECTION');
  }
  if (!reply) throw new AppError('Gemini returned no reply text. Try rephrasing your question.', 502, 'CHAT_EMPTY');
  res.json({ reply });
}));

module.exports = router;
