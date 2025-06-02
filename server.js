const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { execSync } = require('child_process');

const app = express();
app.use(express.json());

// === GitHub Setup ===
const GITHUB_REPO = 'https://github.com/Frost-bit-star/Config.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LOCAL_REPO_PATH = path.join(__dirname, 'repo-data');

function runGitCommand(cmd, cwd = LOCAL_REPO_PATH) {
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch (err) {
    console.error("❌ Git command failed:", err.message);
  }
}

function cloneRepoIfNotExists() {
  if (!fs.existsSync(LOCAL_REPO_PATH)) {
    const tokenizedUrl = GITHUB_REPO.replace('https://', `https://${GITHUB_TOKEN}@`);
    execSync(`git clone ${tokenizedUrl} repo-data`, { cwd: __dirname, stdio: 'inherit' });
  }
}

function pullLatestFromGitHub() {
  runGitCommand('git pull');
}

function commitAndPushChanges(msg = 'Update bot data') {
  runGitCommand('git add .');
  runGitCommand(`git commit -m "${msg}" || echo "Nothing to commit"`);
  runGitCommand('git push');
}

// === Clone repo and pull latest on start ===
cloneRepoIfNotExists();
pullLatestFromGitHub();

// === Initialize SQLite DB from repo ===
const dbPath = path.join(LOCAL_REPO_PATH, 'botdata.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ Failed to connect to database", err);
  else console.log("✅ SQLite database connected");
});

// === Create tables if not exist ===
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    apiKey TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

// === Business Number ===
const HARDCODED_BUSINESS_NUMBER = '255776822641';
let centralBusinessNumber = HARDCODED_BUSINESS_NUMBER;

// === WhatsApp Client ===
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(LOCAL_REPO_PATH, 'session') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox']
  }
});

function registerHardcodedNumber() {
  db.run(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`,
    [centralBusinessNumber],
    (err) => {
      if (err) console.error('❌ DB Save Error:', err);
      else {
        console.log(`✅ Business number registered: ${centralBusinessNumber}`);
        commitAndPushChanges('✅ Session paired and business number registered');
      }
    }
  );
}

// Check if session exists
const sessionExists = fs.existsSync(path.join(LOCAL_REPO_PATH, 'session/Default/Local Storage/leveldb'));

client.initialize().then(async () => {
  if (!sessionExists) {
    try {
      const code = await client.requestPairingCode(centralBusinessNumber);
      console.log(`🔗 Pairing code (8-digit): ${code}`);
    } catch (err) {
      console.error('❌ Failed to generate pairing code:', err);
    }
  }
});

client.on('ready', () => {
  console.log('✅ WhatsApp bot is ready and online!');
  registerHardcodedNumber();
});

client.on('authenticated', () => {
  console.log('🔐 Authenticated with WhatsApp');
});

client.on('auth_failure', msg => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', reason => {
  console.log('⚠️ WhatsApp disconnected:', reason);
});

// === Message Handling ===
client.on('message', async msg => {
  const senderNumber = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  if (!centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 Bot is not activated.`);
  }

  if (msg.to !== `${centralBusinessNumber}@c.us` && senderNumber !== centralBusinessNumber) {
    return await client.sendMessage(msg.from, `🚫 You can only communicate with the business number.`);
  }

  if (text.includes("allow me")) {
    const apiKey = generate8DigitCode();
    db.run(
      `INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`,
      [senderNumber, apiKey],
      async err => {
        if (!err) {
          await client.sendMessage(msg.from,
            `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\n\nUse it at:\nhttps://trover.42web.io/devs.php`
          );
          commitAndPushChanges(`✅ User ${senderNumber} registered`);
        } else {
          console.error('DB Insert Error:', err);
        }
      }
    );
    return;
  }

  if (text.includes("recover apikey")) {
    pullLatestFromGitHub();
    db.get(
      `SELECT apiKey FROM users WHERE number = ?`,
      [senderNumber],
      async (err, row) => {
        if (err) {
          console.error('DB Fetch Error:', err);
          return await client.sendMessage(msg.from, "❌ Error accessing your data.");
        }

        if (row) {
          await client.sendMessage(msg.from, `🔐 Your existing API Key: *${row.apiKey}*`);
        } else {
          await client.sendMessage(msg.from, `⚠️ No API key found. Send *allow me* to get one.`);
        }
      }
    );
    return;
  }

  // === AI Fallback ===
  try {
    const aiResponse = await axios.post(
      'https://troverstarapiai.vercel.app/api/chat',
      {
        messages: [{ role: "user", content: msg.body }],
        model: "gpt-3.5-turbo"
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const aiReply = aiResponse.data?.response?.content || "🤖 Sorry, I couldn't understand that.";
    await client.sendMessage(msg.from, aiReply);
  } catch (error) {
    console.error("AI Request Failed:", error.message);
    await client.sendMessage(msg.from, "❌ AI service unavailable. Try again later.");
  }
});

// === HTTP API ===
app.post('/api/send', async (req, res) => {
  const { apikey, message, mediaUrl, caption } = req.body;

  if (!centralBusinessNumber) {
    return res.status(500).send("Bot is not linked to a business number.");
  }

  if (!apikey || (!message && !mediaUrl)) {
    return res.status(400).send("Missing API key or message/mediaUrl");
  }

  db.get(`SELECT number FROM users WHERE apiKey = ?`, [apikey], async (err, row) => {
    if (err) {
      console.error('DB Select Error:', err);
      return res.status(500).send("Database error");
    }

    if (!row) {
      return res.status(401).send("Invalid API key");
    }

    const chatId = `${row.number}@c.us`;

    try {
      if (mediaUrl) {
        const media = await MessageMedia.fromUrl(mediaUrl);
        await client.sendMessage(chatId, media, { caption });
      } else {
        await client.sendMessage(chatId, message);
      }

      res.send("✅ Message sent from business number");
    } catch (e) {
      console.error('Send Error:', e);
      res.status(500).send("❌ Failed to send message");
    }
  });
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});

// === Generate Random Code ===
function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}