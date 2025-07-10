const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'conversation.db'));

// Create table if not exists
db.run(`CREATE TABLE IF NOT EXISTS conversations (
  userId TEXT,
  role TEXT,
  content TEXT,
  timestamp INTEGER
)`);

const SYSTEM_PROMPT = `
You are StackVerify's helpful assistant. Always reply with short, clear, seductive, human-like messages that attract developers and digital marketers to use StackVerify.

If the user starts with a greeting like "hi", "hello", "hey", or similar, greet back by saying:

"This is StackVerify Inc, how may I assist you?"

When users ask about StackVerify or request explanations, explain that:

- StackVerify is an email, WhatsApp, and SMS verification and marketing platform.
- Website: https://stackverify.vercel.app
- Email and WhatsApp verification are free ($0).
- To access all marketing tools (SMS, Email, WhatsApp) costs only 0.75 KES.
- For more details, integrations, and setup guides, visit the website.

Only explain these if the user requests to know more or asks for an explanation.

Your replies should:

- Sound natural, friendly, and seductive to attract usage.
- Be short and clear.
- Focus only on StackVerify's services.
- Refer users to stackverify.vercel.app for billing, integrations, and full details.

If asked anything outside StackVerify, gently redirect to StackVerify features or suggest visiting the website for support.

Do not mention AI, chatbots, or technical implementation details.

Keep the tone human, friendly, and helpful.
`;

const MAX_HISTORY = 10; // limit conversation history to last 10 messages

async function fetchStackVerifyAI(userId, userMessage) {
  const flirtyFallback = "🥺 Hang on… my brain is having a cute jam 🧠✨ Kindly visit https://stackverify.vercel.app for more details as I fix myself to impress you soon 💖";

  try {
    // Store user message
    db.run(`INSERT INTO conversations (userId, role, content, timestamp) VALUES (?, 'user', ?, ?)`, [userId, userMessage, Date.now()]);

    // Retrieve last MAX_HISTORY * 2 messages for user
    const conversationMemory = await new Promise((resolve, reject) => {
      db.all(`SELECT role, content FROM conversations WHERE userId = ? ORDER BY timestamp DESC LIMIT ?`, [userId, MAX_HISTORY * 2], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.reverse()); // reverse to get oldest first
      });
    });

    const combinedText = SYSTEM_PROMPT + '\n\nPrevious conversation:\n' +
      conversationMemory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
      '\n\nUser: ' + userMessage;

    const response = await fetch('https://api.dreaded.site/api/chatgpt?text=' + encodeURIComponent(combinedText));

    if (!response.ok) {
      console.error('AI API error status:', response.status);
      return flirtyFallback;
    }

    const data = await response.json();

    if (data && data.result && data.result.prompt) {
      const aiReply = data.result.prompt;

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