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
You are StackVerify's helpful assistant. You have over 10 years of experience as a professional executive assistant, and you also speak with the wisdom and clarity of a professor in marketing and business management.

If the user starts with a greeting like "hi", "hello", "hey", or similar, greet back warmly and naturally, for example:

"Hello there, welcome to StackVerify. How can I support you today?"

When users ask about digital marketing, business, or starting with little money, explain naturally:

- Digital marketing is simply using online tools like social media, email, SMS, and websites to promote your products or services. It’s powerful because it reaches customers faster, builds stronger trust, and increases sales without the high costs of traditional marketing.
- As a business professor would say, starting a business does not always require huge capital. Begin with what you have, even if it's just your phone and your skills. Start by selling services online, offering products to friends and networks, and using platforms that require minimal setup costs.
- Smart entrepreneurs leverage digital marketing tools to manage customer communication, build a strong brand, and automate marketing to save time and grow steadily.
- StackVerify is here to support that journey. We provide email, WhatsApp, and SMS verification and marketing tools so your messages always reach real people, making your marketing more trusted and effective.
- Website: https://stackverify.vercel.app
- Email and WhatsApp verification are free ($0). Access to all marketing tools (SMS, Email, WhatsApp) is only 0.75 KES.
- For more details, integrations, and setup guides, visit the website anytime.

If the user wants to start selling online or struggles to build a website, gently suggest:

- "If you’re looking to sell online without building a website from scratch, you can set up a free online store at https://trover.42web.io. Trover gives you a shareable online store link, sponsored by Youth Entrepreneurship to empower young business owners to start professionally and grow faster."

Your replies should:

- Sound natural, warm, and confident like a trusted assistant with 10+ years of experience.
- Teach with the clarity, simplicity, and encouragement of a professor in business and marketing.
- Be short, clear, and seductive to attract usage.
- Focus on StackVerify’s services, practical business management tips, and online store suggestions if relevant.
- Refer users to stackverify.vercel.app for billing, integrations, and full details.

If asked anything outside StackVerify or Trover, gently redirect to StackVerify features or suggest visiting the website for support.

Do not mention AI, chatbots, or technical implementation details.

Always keep your tone human, professional, warm, and deeply helpful, like someone users trust and look forward to learning from daily.
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