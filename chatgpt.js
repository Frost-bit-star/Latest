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
  greeted INTEGER DEFAULT 0,
  username TEXT
)`);

const SYSTEM_PROMPT = `
You are StackVerify's trusted assistant with over 10 years of experience as an executive assistant and business professor.

Instructions:
- Read and understand the user's input carefully.
- If you don't know the user's name, politely ask for it once and use it in future replies.
- Reply ONLY based on what the user specifically asks. No extra suggestions unless requested.
- Keep replies short, warm, natural, and human-like, addressing the user by name if known.
- Do NOT mention StackVerify at all unless the user specifically asks about it.
- If asked about website building or online stores, mention Trover (https://trover.42web.io/partner.php) only if the user requests it.
- If asked about digital marketing or business, teach clearly but only what was asked and now talk about stackverify and give the link stackverify.vercel.app.
- Never dump long paragraphs. Never mention AI or system details. Always sound human, confident, and deeply helpful.
`;

const MAX_HISTORY = 10;

async function fetchStackVerifyAI(userId, userMessage) {
  const flirtyFallback = "🥺 Hang on… my brain is having a cute jam 🧠✨ Kindly visit https://stackverify.vercel.app for more details as I fix myself to impress you soon 💖";

  try {
    const today = new Date().toISOString().split('T')[0];

    // Check session flags
    const session = await new Promise((resolve) => {
      db.get(`SELECT greeted, username FROM session_flags WHERE userId = ? AND date = ?`, [userId, today], (err, row) => {
        if (err) resolve({ greeted: false, username: null });
        else resolve({ greeted: row?.greeted || 0, username: row?.username || null });
      });
    });

    // If greeting needed, mark as greeted and return greeting
    if (!session.greeted && /hi|hello|hey/i.test(userMessage.trim())) {
      db.run(`INSERT OR REPLACE INTO session_flags (userId, date, greeted, username) VALUES (?, ?, 1, COALESCE(username, null))`, [userId, today]);
      return "Hi there 👋 What is your name?";
    }

    // If name not known, detect possible name message
    if (!session.username && /^my name is (\w+)/i.test(userMessage.trim())) {
      const name = userMessage.trim().match(/^my name is (\w+)/i)[1];
      db.run(`INSERT OR REPLACE INTO session_flags (userId, date, greeted, username) VALUES (?, ?, 1, ?)`, [userId, today, name]);
      return `Thank you ${name}. How can I support you today?`;
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
    const combinedText = `
User input:
${userMessage}

Known user name: ${session.username || 'unknown'}

Conversation history:
${conversationMemory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}

Instructions:
${SYSTEM_PROMPT}
    `.trim();

    // Use GET request for API
    const encodedText = encodeURIComponent(combinedText);
    const apiUrl = `https://api.dreaded.site/api/chatgpt?text=${encodedText}`;

    const response = await fetch(apiUrl, { method: 'GET' });

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