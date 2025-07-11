const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'conversation.db'));

// Promisify DB helpers
function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Create tables if not exist
db.serialize(() => {
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
});

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
    const session = await dbGet(`SELECT greeted, username FROM session_flags WHERE userId = ? AND date = ?`, [userId, today])
      .catch(() => ({ greeted: 0, username: null })) || { greeted: 0, username: null };

    // Greeting logic
    if (!session.greeted && /hi|hello|hey/i.test(userMessage.trim())) {
      await dbRun(
        `INSERT OR REPLACE INTO session_flags (userId, date, greeted, username) VALUES (?, ?, 1, ?)`,
        [userId, today, session.username]
      );
      return "Hi there 👋 What is your name?";
    }

    // Detect name input
    const nameMatch = userMessage.trim().match(/my name is ([\w\s]+)/i);
    if (!session.username && nameMatch) {
      const name = nameMatch[1].trim();
      await dbRun(
        `INSERT OR REPLACE INTO session_flags (userId, date, greeted, username) VALUES (?, ?, 1, ?)`,
        [userId, today, name]
      );
      return `Thank you ${name}. How can I support you today?`;
    }

    // Store user message
    await dbRun(`INSERT INTO conversations (userId, role, content, timestamp) VALUES (?, 'user', ?, ?)`, [userId, userMessage, Date.now()]);

    // Determine history limit
    const needsTeaching = /(teach|explain|how|help|guide|steps|start|link|website|store|stackverify|trover)/i.test(userMessage);
    const historyLimit = needsTeaching ? MAX_HISTORY * 2 : Math.min(4, MAX_HISTORY);

    // Fetch conversation history
    const conversationMemory = await dbAll(
      `SELECT role, content FROM conversations WHERE userId = ? ORDER BY timestamp DESC LIMIT ?`,
      [userId, historyLimit]
    );

    // Compose AI prompt input prioritising user input first
    const combinedText = `
User input:
${userMessage}

Known user name: ${session.username || 'unknown'}

Conversation history:
${conversationMemory.reverse().map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}

Instructions:
${SYSTEM_PROMPT}
    `.trim();

    // Make GET request
    const apiUrl = `https://api.dreaded.site/api/chatgpt?text=${encodeURIComponent(combinedText)}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      console.error('AI API error status:', response.status);
      return flirtyFallback;
    }

    const data = await response.json();
    const aiReply = data?.result?.prompt?.trim();

    if (aiReply) {
      // Store AI reply
      await dbRun(`INSERT INTO conversations (userId, role, content, timestamp) VALUES (?, 'assistant', ?, ?)`, [userId, aiReply, Date.now()]);

      // Delete old messages if exceeding MAX_HISTORY * 2
      const countRow = await dbGet(`SELECT COUNT(*) as count FROM conversations WHERE userId = ?`, [userId]);
      if (countRow.count > MAX_HISTORY * 2) {
        const deleteCount = countRow.count - (MAX_HISTORY * 2);
        await dbRun(`DELETE FROM conversations WHERE userId = ? AND rowid IN (
          SELECT rowid FROM conversations WHERE userId = ? ORDER BY timestamp ASC LIMIT ?
        )`, [userId, userId, deleteCount]);
      }

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