const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { execSync } = require('child_process');

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

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});

client.initialize().then(async () => {
  if (!fs.existsSync(path.join(sessionPath, 'Default', 'Local Storage', 'leveldb'))) {
    const code = await client.requestPairingCode(centralBusinessNumber);
    console.log(`🔗 Pairing code: ${code}`);
  }
});

client.on('ready', () => {
  console.log('✅ Bot ready!');
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('centralNumber', ?)`, [centralBusinessNumber]);
  pushToGitHub("✅ Bot ready & paired");
});

client.on('disconnected', () => {
  console.warn('⚠️ Disconnected! Attempting reconnect...');
  setTimeout(() => client.initialize(), 5000);
});

// === Message Handler ===
client.on('message', async msg => {
  const sender = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  // === Allow New User ===
  if (text.includes("allow me")) {
    const apiKey = generate8DigitCode();
    db.run(`INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`, [sender, apiKey], async err => {
      if (!err) {
        await client.sendMessage(msg.from,
          `✅ You're activated!\n\n🔑 API Key: *${apiKey}*\nUse at:\nhttps://trover.42web.io/devs.php`
        );
        pushToGitHub(`✅ User ${sender} registered`);
      }
    });
    return;
  }

  // === Recover API Key ===
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

  // === AI Fallback ===
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

// === Server Start ===
app.listen(3000, () => console.log('🚀 Server live on port 3000'));

// === Helper ===
function generate8DigitCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}