const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'conversation.db'));

// Create tables if not exist
db.run(`CREATE TABLE IF NOT EXISTS conversations (
  userId TEXT,
  role TEXT,
  content TEXT,
  timestamp INTEGER
)`);

db.run(`CREATE TABLE IF NOT EXISTS session_flags (
  userId TEXT,
  date TEXT,
  greeted INTEGER DEFAULT 0
)`);

const SYSTEM_PROMPT = `
You are StackVerify's trusted assistant with over 10 years of experience as an executive assistant and business professor.

Instructions:
- First, read and understand the user's input carefully.
- Only reply based on what the user specifically asks. Do not suggest anything extra unless they request it.
- Keep replies short, warm, natural, and human-like.
- If asked about StackVerify, explain clearly that it verifies emails, WhatsApp, and SMS contacts to improve marketing accuracy and trust. Email & WhatsApp verification are free; all tools cost only 0.75 KES. Website: https://stackverify.vercel.app
- If asked about website building or online stores, mention Trover (https://trover.42web.io/partner.php) only if the user requests it.
- If asked about digital marketing or business, teach clearly but only what was asked.
- Never provide unrelated suggestions. Focus strictly on the user's question.
- Never dump long paragraphs. Never mention AI or system details. Always sound human, confident, and deeply helpful.
`;

const MAX_HISTORY = 10;

async function fetchStackVerifyAI(userId, userMessage) {
  const flirtyFallback = "🥺 Hang on… my brain is having a cute jam 🧠✨ Kindly visit https://stackverify.vercel.app for more details as I fix myself to impress you soon 💖";

  try {
    const today = new Date().toISOString().split('T')[0];

    // Check if greeted today
    const greetedToday = await new Promise((resolve) => {
      db.get(`SELECT greeted FROM session_flags WHERE userId = ? AND date = ?`, [userId, today], (err, row) => {
        if (row && row.greeted) resolve(true);
        else resolve(false);
      });
    });

    // If greeting needed, mark as greeted and return greeting
    if (!greetedToday && /hi|hello|hey/i.test(userMessage.trim())) {
      db.run(`INSERT OR REPLACE INTO session_flags (userId, date, greeted) VALUES (?, ?, 1)`, [userId, today]);
      return "Hi there 👋 How can I support you today?";
    }

    // Store user message
    db.run(`INSERT INTO conversations (userId, role, content, timestamp) VALUES (?, 'user', ?, ?)`, [userId, userMessage, Date.now()]);

    // Determine trimming logic
    const needsTeaching = /(teach|explain|how|help|guide|steps|start|link|website|store|stackverify|trover)/i.test(userMessage);
    const historyLimit = needsTeaching ? MAX_HISTORY * 2 : Math.min(4, MAX_HISTORY);

    // Fetch conversation history
    const conversationMemory = await new Promise((resolve, reject) => {
      db.all(`SELECT role, content FROM conversations WHERE userId = ? ORDER BY timestamp DESC LIMIT ?`, [userId, historyLimit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.reverse());
      });
    });

    // Compose AI prompt input prioritising user input first
    const combinedText = 'User input:\n' + userMessage +
      '\n\nConversation history:\n' +
      conversationMemory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
      '\n\nInstructions:\n' + SYSTEM_PROMPT;

    const response = await fetch('https://api.dreaded.site/api/chatgpt?text=' + encodeURIComponent(combinedText));

    if (!response.ok) {
      console.error('AI API error status:', response.status);
      return flirtyFallback;
    }

    const data = await response.json();

    if (data && data.result && data.result.prompt) {
      const aiReply = data.result.prompt.trim();

      // Store AI reply
      db.run(`INSERT INTO conversations (userId, role, content, timestamp) VALUES (?, 'assistant', ?, ?)`, [userId, aiReply, Date.now()]);

      // Delete old messages if exceeding MAX_HISTORY * 2
      db.get(`SELECT COUNT(*) as count FROM conversations WHERE userId = ?`, [userId], (err, row) => {
        if (!err && row.count > MAX_HISTORY * 2) {
          const deleteCount = row.count - (MAX_HISTORY * 2);
          db.run(`DELETE FROM conversations WHERE userId = ? AND rowid IN (
            SELECT rowid FROM conversations WHERE userId = ? ORDER BY timestamp ASC LIMIT ?
          )`, [userId, userId, deleteCount]);
        }
      });

      return aiReply;
    } else {
      return flirtyFallback;
    }

  } catch (err) {
    console.error('AI API fetch error:', err.message);
    return flirtyFallback;
  }
}

module.exports = { fetchStackVerifyAI };