require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useSingleFileAuthState } = require('@whiskeysockets/baileys/lib/StateManagement'); // ✅ Fixed import

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GITHUB_REPO = 'https://github.com/Frost-bit-star/Whatsapp-storage.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const centralBusinessNumber = '255776822641'; // 🔒 Fixed business number
const LOCAL_REPO_PATH = path.join(__dirname, 'repo-data');

// === GitHub Sync Functions ===
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
    execSync(`git diff --cached --quiet || git commit -m '${msg}'`, { cwd: LOCAL_REPO_PATH });
    runGit('git push');
  } catch (err) {
    console.error("❌ Git push error:", err.message);
  }
}

function pullFromGitHub() {
  runGit('git pull');
}

// === Initialize Repo and SQLite DB ===
cloneRepo();
pullFromGitHub();

const dbPath = path.join(LOCAL_REPO_PATH, 'botdata.db');
const db = new sqlite3.Database(dbPath, err => {
  if (err) console.error("❌ DB Error:", err);
  else console.log("✅ SQLite Database connected");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, apiKey TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS verification_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, code TEXT, created_at INTEGER)`);
});

async function startBot() {
  const { state, saveState } = useSingleFileAuthState('./session.json');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Chrome (Windows)', 'Chrome', '110.0.0.0'],
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, isNewLogin } = update;
    if (connection === 'connecting') console.log('🔌 Connecting...');
    if (connection === 'open') {
      console.log('✅ Connected using pairing code session');
      await sock.sendMessage(`${centralBusinessNumber}@s.whatsapp.net`, { text: '🤖 Bot is online with pairing code session!' });
      pushToGitHub('🤖 Bot connected');
    }
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.warn('❌ Disconnected. Reason:', reason);
      process.exit(1);
    }
    if (isNewLogin) {
      try {
        console.log('🔑 Generating pairing code...');
        const code = await sock.requestPairingCode(centralBusinessNumber);
        console.log('🔗 Pairing Code for +255 776 822 641:', code);
      } catch (err) {
        console.error('❌ Failed to generate pairing code:', err.message);
        process.exit(1);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const sender = msg.key.remoteJid.split('@')[0];
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (text.toLowerCase() === "allow me") {
      const apiKey = crypto.randomBytes(16).toString('hex');
      db.run('INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)', [sender, apiKey]);
      await sock.sendMessage(msg.key.remoteJid, { text: `✅ Access granted. Your API key:\n${apiKey}` });
      return;
    }

    if (text.toLowerCase() === "recover apikey") {
      db.get('SELECT apiKey FROM users WHERE number = ?', [sender], async (err, row) => {
        if (row) await sock.sendMessage(msg.key.remoteJid, { text: `🔑 Your API key: ${row.apiKey}` });
        else await sock.sendMessage(msg.key.remoteJid, { text: "❌ No API key found. Use 'allow me' first." });
      });
      return;
    }

    if (text === ".ping") {
      await sock.sendMessage(msg.key.remoteJid, { text: "✅ Bot is online with pairing code session." });
      return;
    }
  });

  // === Express endpoints ===

  app.post('/request-code', validateApiKey, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone required' });
    const code = crypto.randomInt(1000, 9999).toString();
    const createdAt = Date.now();
    db.run(`INSERT INTO verification_codes (phone, code, created_at) VALUES (?, ?, ?)`, [phone, code, createdAt]);
    try {
      await sock.sendMessage(`${phone}@s.whatsapp.net`, { text: `${code} is your verification code.` });
      res.json({ message: 'OTP sent' });
    } catch {
      res.status(500).json({ message: 'Failed to send OTP' });
    }
  });

  app.post('/verify-code', validateApiKey, (req, res) => {
    const { phone, code } = req.body;
    const expiry = Date.now() - 5 * 60 * 1000;
    db.get(`SELECT * FROM verification_codes WHERE phone = ? AND code = ? AND created_at > ?`, [phone, code, expiry], (err, row) => {
      if (row) res.json({ valid: true });
      else res.status(400).json({ valid: false });
    });
  });

  app.post('/self-message', validateApiKey, async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'Number and message required' });
    try {
      await sock.sendMessage(`${number}@s.whatsapp.net`, { text: `From ${req.user.number} (${req.user.apiKey}):\n${message}` });
      res.json({ sent: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to send message' });
    }
  });
}

function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required in x-api-key header' });
  
  db.get('SELECT * FROM users WHERE apiKey = ?', [apiKey], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(403).json({ error: 'Invalid API key' });
    req.user = row;
    next();
  });
}

startBot();
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
setInterval(() => pushToGitHub('⏱️ Auto-backup'), 2 * 60 * 1000);