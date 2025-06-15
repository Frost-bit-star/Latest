const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// === GitHub Repo Sync ===
const GITHUB_REPO = 'https://github.com/Frost-bit-star/Config.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LOCAL_REPO_PATH = path.join(__dirname, 'repo-data');

function runGit(cmd, cwd = LOCAL_REPO_PATH) {
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch (err) {
    console.error("❌ Git failed:", err.message);
  }
}

function setupGit() {
  runGit('git config user.name "Frostbit Star"');
  runGit('git config user.email "morganmilstone983@gmail.com"');
}

function ensureMainBranch() {
  const head = path.join(LOCAL_REPO_PATH, '.git', 'HEAD');
  if (fs.existsSync(head) && !fs.readFileSync(head, 'utf-8').includes('refs/heads/main')) {
    runGit('git checkout -b main');
  }
}

function cloneRepo() {
  if (!fs.existsSync(LOCAL_REPO_PATH)) {
    const tokenUrl = GITHUB_REPO.replace('https://', `https://${GITHUB_TOKEN}@`);
    execSync(`git clone ${tokenUrl} repo-data`, { cwd: __dirname, stdio: 'inherit' });
  }
}

function pullFromGitHub() {
  runGit('git pull');
}

function pushToGitHub(msg = 'Update bot data') {
  setupGit();
  ensureMainBranch();
  runGit('git add .');
  try {
    execSync(`git diff --cached --quiet || git commit -m "${msg}"`, { cwd: LOCAL_REPO_PATH });
    runGit('git push -u origin main');
  } catch (err) {
    console.error("❌ Push error:", err.message);
  }
}

// === Init Git Repo and Pull Data ===
cloneRepo();
pullFromGitHub();

// === SQLite Init ===
const dbPath = path.join(LOCAL_REPO_PATH, 'botdata.db');
const db = new sqlite3.Database(dbPath, err => {
  if (err) console.error("❌ DB connect error:", err);
  else console.log("✅ DB connected");
});

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

// === WhatsApp Setup ===
const centralBusinessNumber = '255776822641'; // Your business number
const sessionPath = path.join(LOCAL_REPO_PATH, 'session');

// Check if session folder exists with leveldb data
function sessionExists() {
  const leveldbPath = path.join(sessionPath, 'Default', 'Local Storage', 'leveldb');
  return fs.existsSync(leveldbPath);
}

// Delete session folder if missing or expired to force fresh pairing
function cleanSessionIfInvalid() {
  if (!sessionExists()) {
    console.log('❗ Session missing or expired, clearing session data...');
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log('🧹 Old session data deleted.');
    }
  }
}

// Main client variable (will hold current client instance)
let client;

async function startClient() {
  cleanSessionIfInvalid();

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: { headless: true, args: ['--no-sandbox'] }
  });

  client.on('ready', () => {
    console.log('✅ Bot ready and paired!');
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`, [centralBusinessNumber]);
    pushToGitHub("✅ Bot ready & paired");
    client.sendMessage(centralBusinessNumber, "🤖 Bot is online!"); // Notify that bot is online
  });

  client.on('disconnected', async () => {
    console.warn('⚠️ Disconnected! Re-initializing...');
    try {
      await client.destroy();
    } catch (e) {
      console.error("❌ Error destroying client:", e.message);
    }
    // Delay before restart to avoid rapid loops
    setTimeout(() => startClient(), 5000);
  });

  client.on('auth_failure', async () => {
    console.warn('❌ Auth failure detected. Requesting pairing code...');
    try {
      const code = await client.requestPairingCode(centralBusinessNumber);
      console.log(`🔗 Pairing code: ${code}`);
    } catch (e) {
      console.error('❌ Failed to get pairing code:', e);
    }
  });

  client.on('message', async msg => {
    const sender = msg.from.split('@')[0];
    const text = msg.body.trim().toLowerCase();

    // Allow new user registration
    if (text.includes("allow me")) {
      const apiKey = generate8DigitCode();
      db.run(`INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`, [sender, apiKey], async err => {
        if (!err) {
          await client.sendMessage(msg.from,
            `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\nUse at:\nhttps://trover.42web.io/devs.php`
          );
          pushToGitHub(`✅ User ${sender} registered`);
        } else {
          await client.sendMessage(msg.from, '⚠️ Registration error, please try again later.');
        }
      });
      return;
    }

    // Recover API Key
    if (text.includes("recover apikey")) {
      pullFromGitHub();
      db.get(`SELECT apiKey FROM users WHERE number = ?`, [sender], async (err, row) => {
        if (row) {
          await client.sendMessage(msg.from, `🔐 Your API Key: *${row.apiKey}*`);
        } else {
          await client.sendMessage(msg.from, `⚠️ No API key found. Send *allow me*.`);
        }
      });
      return;
    }

    // Check bot status
    if (text === ".ping") {
      const status = sessionExists() ? "online" : "offline";
      const response = status === "offline" ? `⚠️ Bot is offline. New pairing code: ${await client.requestPairingCode(centralBusinessNumber)}` : "✅ Bot is online!";
      await client.sendMessage(msg.from, response);
      return;
    }

    // AI fallback reply
    try {
      const aiRes = await axios.post(
        'https://troverstarapiai.vercel.app/api/chat',
        { messages: [{ role: "user", content: msg.body }], model: "gpt-3.5-turbo" },
        { headers: { "Content-Type": "application/json" } }
      );
      const reply = aiRes.data?.response?.content || "🤖 I didn't understand that.";
      await client.sendMessage(msg.from, reply);
    } catch (e) {
      console.error("AI error:", e.message);
      await client.sendMessage(msg.from, "❌ AI unavailable. Try later.");
    }
  });

  await client.initialize();

  // If session missing at startup, request pairing code immediately
  if (!sessionExists()) {
    try {
      const code = await client.requestPairingCode(centralBusinessNumber);
      console.log(`🔗 Pairing code at startup: ${code}`);
    } catch (e) {
      console.error('❌ Failed to get startup pairing code:', e);
    }
  }

  return client;
}

// Start the WhatsApp client
startClient();

// === HTTP API ===
app.post('/api/send', async (req, res) => {
  const { apikey, message, mediaUrl, caption } = req.body;
  if (!apikey || (!message && !mediaUrl)) return res.status(400).send("Missing input");

  db.get(`SELECT number FROM users WHERE apiKey = ?`, [apikey], async (err, row) => {
    if (!row) return res.status(401).send("Invalid API key");
    const chatId = `${row.number}@c.us`;

    try {
      if (mediaUrl) {
        const media = await MessageMedia.fromUrl(mediaUrl);
        await client.sendMessage(chatId, media, { caption });
      } else {
        await client.sendMessage(chatId, message);
      }
      res.send("✅ Message sent");
    } catch (e) {
      console.error("Send error:", e.message);
      res.status(500).send("❌ Send failed");
    }
  });
});

// === Helper ===
function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

// === Start HTTP Server ===
app.listen(3000, () => console.log('🚀 Server live on port 3000'));

// === GitHub Sync Interval ===
setInterval(() => {
  pullFromGitHub();
  pushToGitHub("Periodic update from server");
}, 120000); // 2 minutes
I