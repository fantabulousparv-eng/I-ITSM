const express = require('express');
const jwt = require('jsonwebtoken');
const { GoogleGenAI } = require('@google/genai');
const SYSTEM_PROMPT = require('../config/chatbotPrompt');

const router = express.Router();

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_HISTORY = 20;          // how many past messages we forward to Gemini
const MAX_MESSAGE_LENGTH = 2000; // characters per message

// Create the Gemini client lazily so the server still starts if the key is missing.
let ai = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

// Only logged in users may use the chatbot (protects the API quota).
// Uses the same JWT secret as authRoutes.js.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Login required' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// POST /api/chat
// body: { message: string, history: [{ role: 'user' | 'assistant', content: string }] }
// reply: { reply: string }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ message: 'message is required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `message is too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    }
    if (!Array.isArray(history)) {
      return res.status(400).json({ message: 'history must be an array' });
    }

    const client = getClient();
    if (!client) {
      return res.status(503).json({ message: 'Chatbot is not configured (missing GEMINI_API_KEY)' });
    }

    // Convert our simple history into Gemini's format ("assistant" becomes "model").
    const past = history
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content.slice(0, MAX_MESSAGE_LENGTH) }],
      }));

    // Gemini conversations should start with a user turn.
    while (past.length && past[0].role === 'model') past.shift();

    const contents = [...past, { role: 'user', parts: [{ text: message.trim() }] }];

    const response = await client.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction: SYSTEM_PROMPT },
    });

    const reply = response.text || "Sorry, I couldn't come up with a reply. Please try rephrasing.";
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ message: 'The chatbot ran into a problem. Please try again.' });
  }
});

module.exports = router;
