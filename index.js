// index.js

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, getContentType, jidDecode } = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const { execSync } = require("child_process");

const { gitInit, gitPush, copyFiles, gitPull } = require("./git-sync");
const { session } = require("./settings");
const { fetchStackVerifyAI } = require("./chatgpt");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionName = "session";
const backupPath = path.join(__dirname, "backup");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// === Repo 1: session backup ===
const REPO1 = "Frost-bit-star/Config";
const REPO1_URL = `https://${GITHUB_TOKEN}@github.com/${REPO1}.git`;

// === Repo 2: stack.db storage ===
const REPO2 = "Frost-bit-star/Storage-saas-paid";
const REPO2_URL = `https://${GITHUB_TOKEN}@github.com/${REPO2}.git`;
const REPO2_PATH = path.join(__dirname, "repo-data");
const STACK_DB = path.join(REPO2_PATH, "stack.db");

// === Clone or init Repo 2 ===
if (!fs.existsSync(REPO2_PATH)) {
  console.log("Cloning Storage-saas-paid repo...");
  execSync(`git clone ${REPO2_URL} ${REPO2_PATH}`, { stdio: "inherit" });
} else {
  execSync('git pull', { cwd: REPO2_PATH });
}

// === Repo 1 session backup initialization ===
if (!fs.existsSync(backupPath)) {
  console.log("Creating backup directory...");
  fs.mkdirSync(backupPath, { recursive: true });
}
if (!fs.existsSync(path.join(backupPath, ".git"))) {
  console.log("Cloning Config repo...");
  execSync(`git clone ${REPO1_URL} ${backupPath}`, { stdio: "inherit" });
}
(async () => {
  try {
    await gitPull();
    console.log("✅ Pulled latest session backup before server start.");
  } catch (e) {
    console.error("Git pull failed on startup:", e);
  }
})();

async function initializeSession() {
  const credsPath = path.join(__dirname, "session", "creds.json");
  try {
    const decoded = Buffer.from(session, "base64").toString("utf-8");
    if (!fs.existsSync(credsPath) || session !== "zokk") {
      console.log("📡 Connecting...");
      fs.mkdirSync(path.dirname(credsPath), { recursive: true });
      fs.writeFileSync(credsPath, decoded, "utf8");
    }
  } catch (e) {
    console.log("Session is invalid: " + e);
  }
}

// === SQLite DB initialization ===
const db = new sqlite3.Database(STACK_DB, err => {
  if (err) console.error("❌ stack.db load error:", err);
  else console.log("✅ stack.db loaded");
});
db.run(`CREATE TABLE IF NOT EXISTS apikeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT,
  email TEXT,
  password TEXT,
  apikey TEXT UNIQUE,
  status TEXT CHECK(status IN ('paid','unpaid')) DEFAULT 'unpaid'
)`);
db.run(`CREATE TABLE IF NOT EXISTS verification_codes (
  phone TEXT,
  code TEXT,
  created_at INTEGER
)`);

// === Validate API key as paid ===
function validateApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "API key required" });
  db.get("SELECT * FROM apikeys WHERE apikey = ?", [apiKey], (err, row) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!row) return res.status(403).json({ error: "Invalid API key" });
    if (row.status !== 'paid') return res.status(402).json({ error: "Upgrade to paid plan" });
    req.user = row;
    next();
  });
}

async function startBot() {
  await initializeSession();
  const { state, saveCreds } = await useMultiFileAuthState(`./${sessionName}`);
  console.log("Connecting to WhatsApp...");

  const client = makeWASocket({
    logger: pino({ level: "silent" }),
    browser: ["Bot", "Chrome", "1.0.0"],
    auth: state,
  });

  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) console.log("📱 Scan this QR code to connect:\n", qr);
    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if ([DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.loggedOut].includes(reason)) process.exit();
      else startBot();
    } else if (connection === "open") {
      console.log("✅ Bot connected successfully!");
      await client.sendMessage(client.user.id, { text: "Hello, your bot is connected and running!" });
    }
  });

  client.ev.on("creds.update", saveCreds);

  client.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const mek = chatUpdate.messages[0];
      if (!mek.message || mek.key.fromMe) return;
      const m = smsg(client, mek);
      const text = m.body?.toLowerCase() || "";

      if (text === ".ping") {
        await client.sendMessage(m.chat, { text: "✅ Bot is online." });
        return;
      }

      const aiReply = await fetchStackVerifyAI(m.sender, m.body);
      await client.sendMessage(m.chat, { text: aiReply });

    } catch (err) {
      console.log("❌ Message error:", err);
    }
  });

  // === OTP endpoints ===
  app.post("/request-code", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone required" });
    const code = crypto.randomInt(1000, 9999).toString();
    const createdAt = Date.now();
    db.run(`INSERT INTO verification_codes (phone, code, created_at) VALUES (?, ?, ?)`, [phone, code, createdAt]);
    try {
      await client.sendMessage(`${phone}@s.whatsapp.net`, { text: `${code} is your verification code.` });
      res.json({ message: "OTP sent" });
    } catch {
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/verify-code", (req, res) => {
    const { phone, code } = req.body;
    const expiry = Date.now() - 5 * 60 * 1000;
    db.get(`SELECT * FROM verification_codes WHERE phone = ? AND code = ? AND created_at > ?`, [phone, code, expiry], (err, row) => {
      if (row) res.json({ valid: true });
      else res.status(400).json({ valid: false });
    });
  });

  // === Self message ===
  app.post("/self-message", validateApiKey, async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: "Number and message required" });
    try {
      await client.sendMessage(`${number}@s.whatsapp.net`, { text: `From ${req.user.company}: ${message}` });
      res.json({ sent: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // === Bulk message ===
  app.post("/bulk-message", validateApiKey, async (req, res) => {
    const { numbers, template } = req.body;
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !template) {
      return res.status(400).json({ error: "Numbers (array) and template required" });
    }
    const results = [];
    for (const number of numbers) {
      try {
        const message = template.replace("{number}", number).replace("{sender}", req.user.company);
        await client.sendMessage(`${number}@s.whatsapp.net`, { text: message });
        results.push({ number, status: "sent" });
      } catch (err) {
        console.error(`Failed to send to ${number}:`, err);
        results.push({ number, status: "failed", error: err.message });
      }
    }
    res.json({ results });
  });

  app.get("/", (req, res) => {
    res.send("Baileys WhatsApp Bot with OTP, Self Message, Bulk Message, AI replies, and Stack DB Paid API management is running!");
  });

  app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
  });

  gitInit();
  setInterval(() => {
    copyFiles();
    gitPush();
    execSync('git add . && git commit -m "Auto backup" && git push', { cwd: REPO2_PATH });
  }, 2 * 60 * 1000);
}

function smsg(conn, m) {
  if (!m) return m;
  if (m.key) {
    m.id = m.key.id;
    m.isBaileys = m.id.startsWith("BAE5") && m.id.length === 16;
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat.endsWith("@g.us");
    m.sender = jidDecode((m.fromMe && conn.user.id) || m.participant || m.key.participant || m.chat || "") || ((m.fromMe && conn.user.id) || m.participant || m.key.participant || m.chat || "");
    if (m.isGroup) m.participant = jidDecode(m.key.participant) || m.key.participant || "";
  }
  if (m.message) {
    m.mtype = getContentType(m.message);
    m.msg = m.mtype == "viewOnceMessage"
      ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]
      : m.message[m.mtype];
    m.body = m.message.conversation || m.msg.caption || m.msg.text || m.text;
  }
  m.reply = (text, chatId = m.chat, options = {}) =>
    conn.sendMessage(chatId, { text, ...options }, { quoted: m });
  return m;
}

startBot();