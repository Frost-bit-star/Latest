require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { execSync } = require('child_process');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const GITHUB_REPO = 'https://github.com/Frost-bit-star/Whatsapp-storage.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const centralBusinessNumber = process.env.BUSINESS_NUMBER || '255776822641';

const LOCAL_REPO_PATH = path.join(__dirname, 'repo-data');
function runGit(cmd, cwd = LOCAL_REPO_PATH) {
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
  } catch (err) {
    console.error("❌ Git failed:", err.message);
  }
}
function cloneRepo() {
  if (!fs.existsSync(LOCAL_REPO_PATH)) {
    const tokenUrl = GITHUB_REPO.replace('https://', `https://${GITHUB_TOKEN}@`);
    execSync(`git clone ${tokenUrl} repo-data`, { cwd: __dirname, stdio: 'inherit' });
  }
}
function setupGit() {
  runGit('git config user.name "Frostbit Star"');
  runGit('git config user.email "morganmilstone983@gmail.com"');
}
function pushToGitHub(msg = 'Update bot data') {
  setupGit();
  runGit('git add .');
  try {
    execSync(`git diff --cached --quiet || git commit -m "${msg}"`, { cwd: LOCAL_REPO_PATH });
    runGit('git push');
  } catch (err) {
    console.error("❌ Git push error:", err.message);
  }
}
function pullFromGitHub() {
  runGit('git pull');
}

cloneRepo();
pullFromGitHub();
const dbPath = path.join(LOCAL_REPO_PATH, 'botdata.db');
const db = new sqlite3.Database(dbPath, err => {
  if (err) console.error("❌ DB Error:", err);
  else console.log("✅ Database connected");
});

const initDB = () => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    apiKey TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    code TEXT,
    created_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS pairing_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    created_at INTEGER,
    verified INTEGER DEFAULT 0
  )`);
};
initDB();

const pairingCodeLength = 8;
function generatePairingCodes(count = 8) {
  const codes = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < pairingCodeLength; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const createdAt = Date.now();
    db.run(`INSERT INTO pairing_codes (code, created_at) VALUES (?, ?)`, [code, createdAt]);
    codes.push(code);
  }
  return codes;
}

function checkSessionExists() {
  const sessionPath = path.join(__dirname, '.wwebjs_auth', 'session-main');
  return fs.existsSync(sessionPath);
}

if (!checkSessionExists()) {
  console.log("🆕 No WhatsApp session found. Generating manual pairing codes:");
  const codes = generatePairingCodes();
  console.log("🔐 Enter one of the following codes on your app to pair:", codes);
} else {
  console.log("🔁 Existing WhatsApp session detected. Skipping pairing code generation.");
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'main' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('ready', () => {
  console.log('✅ Bot is ready.');
  client.sendMessage(`${centralBusinessNumber}@c.us`, "🤖 Bot is online!");
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, ['centralNumber', centralBusinessNumber]);
  pushToGitHub('✅ Bot ready & paired');
});
client.on('auth_failure', msg => console.error('❌ Authentication failed:', msg));
client.on('disconnected', reason => console.warn(`⚠️ Disconnected: ${reason}`));

client.on('message', async msg => {
  const sender = msg.from.split('@')[0];
  const text = msg.body.trim().toLowerCase();

  if (text.startsWith("pair ")) {
    const code = text.split(" ")[1];
    db.get(`SELECT * FROM pairing_codes WHERE code = ? AND verified = 0`, [code], (err, row) => {
      if (row) {
        db.run(`UPDATE pairing_codes SET verified = 1 WHERE code = ?`, [code]);
        client.sendMessage(msg.from, `✅ Pairing successful. Session will now be stored.`);
      } else {
        client.sendMessage(msg.from, `❌ Invalid or already used code.`);
      }
    });
    return;
  }

  if (text.includes("allow me")) {
    const apiKey = Math.floor(10000000 + Math.random() * 90000000).toString();
    db.run(`INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`, [sender, apiKey], async err => {
      if (!err) {
        await client.sendMessage(msg.from, `✅ You're activated!\n🔑 API Key: *${apiKey}*\nVisit: https://stackverify.vercel.app`);
        pushToGitHub(`✅ User ${sender} registered`);
      } else {
        await client.sendMessage(msg.from, '⚠️ Registration error, try again.');
      }
    });
    return;
  }

  if (text.includes("recover apikey")) {
    pullFromGitHub();
    db.get(`SELECT apiKey FROM users WHERE number = ?`, [sender], async (err, row) => {
      if (row) await client.sendMessage(msg.from, `🔐 Your API Key: *${row.apiKey}*`);
      else await client.sendMessage(msg.from, `⚠️ No key found. Send *allow me*.`);
    });
    return;
  }

  if (text === ".ping") {
    await client.sendMessage(msg.from, `✅ Bot is online.`);
    return;
  }

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

client.initialize();

// OTP endpoints
app.post('/request-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: 'Phone number is required.' });

  const code = crypto.randomInt(1000, 9999).toString();
  const createdAt = Date.now();

  db.run(
    `INSERT INTO verification_codes (phone, code, created_at) VALUES (?, ?, ?)`,
    [phone, code, createdAt],
    async function (err) {
      if (err) return res.status(500).json({ message: 'Failed to store code.' });

      const chatId = `${phone}@c.us`;
      try {
        await client.sendMessage(chatId, `${code} is your verification code. For your security, do not share this code.`);
        res.json({ message: 'OTP sent to WhatsApp.' });
      } catch (e) {
        console.error("WhatsApp send failed:", e.message);
        res.status(500).json({ message: 'Failed to send OTP on WhatsApp.' });
      }
    }
  );
});

app.post('/verify-code', (req, res) => {
  const { phone, code } = req.body;
  const expiry = Date.now() - 5 * 60 * 1000;

  if (!phone || !code) return res.status(400).json({ valid: false, message: 'Phone and code are required.' });

  db.get(
    `SELECT * FROM verification_codes WHERE phone = ? AND code = ? AND created_at > ?`,
    [phone, code, expiry],
    (err, row) => {
      if (err) return res.status(500).json({ valid: false, message: 'Database error.' });
      if (row) return res.json({ valid: true, message: '✅ Code is valid!' });
      else return res.status(400).json({ valid: false, message: '❌ Invalid or expired code.' });
    }
  );
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
