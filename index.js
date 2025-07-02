// index.js

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, proto, getContentType, jidDecode } = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const express = require("express");
const cors = require("cors"); // <-- added
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const { execSync } = require("child_process");

const { gitInit, gitPush, copyFiles, gitPull } = require("./git-sync"); // <-- add gitPull to sync from GitHub
const { session } = require("./settings");
const { fetchStackVerifyAI } = require("./chatgpt");

const app = express();
app.use(cors()); // <-- added
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionName = "session";
const backupPath = path.join(__dirname, "backup");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "Frost-bit-star/Config";
const REPO_URL = `https://${GITHUB_TOKEN}@github.com/${REPO}.git`;

if (!fs.existsSync(backupPath)) {
  console.log("Creating backup directory...");
  fs.mkdirSync(backupPath, { recursive: true });
}

if (!fs.existsSync(path.join(backupPath, ".git"))) {
  console.log("Cloning backup repo...");
  try {
    execSync(`git clone ${REPO_URL} ${backupPath}`, { stdio: "inherit" });
  } catch (err) {
    console.error("Git clone failed:", err.message);
  }
}

const color = (text, c) => (chalk[c] ? chalk[c](text) : chalk.green(text));

async function initializeSession() {
  const credsPath = path.join(__dirname, "session", "creds.json");
  try {
    const decoded = Buffer.from(session, "base64").toString("utf-8");
    if (!fs.existsSync(credsPath) || session !== "zokk") {
      console.log("📡 connecting...");
      fs.mkdirSync(path.dirname(credsPath), { recursive: true });
      fs.writeFileSync(credsPath, decoded, "utf8");
    }
  } catch (e) {
    console.log("Session is invalid: " + e);
  }
}

// Helper: generate unique numeric API key of at least 5 digits, check DB for duplicates
function generateUniqueApiKey() {
  return new Promise((resolve, reject) => {
    function tryGenerate() {
      const candidate = (Math.floor(10000 + Math.random() * 90000)).toString();
      db.get('SELECT apiKey FROM users WHERE apiKey = ?', [candidate], (err, row) => {
        if (err) return reject(err);
        if (row) {
          tryGenerate();
        } else {
          resolve(candidate);
        }
      });
    }
    tryGenerate();
  });
}

// Message serializer helper (unchanged)
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

// SQLite DB
const db = new sqlite3.Database(path.join(__dirname, "data.db"));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (number TEXT PRIMARY KEY, apiKey TEXT NOT NULL UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS verification_codes (phone TEXT, code TEXT, created_at INTEGER)`);
});

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

    if (qr) {
      console.log("📱 Scan this QR code to connect:\n");
      console.log(qr);
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if (reason === DisconnectReason.badSession) process.exit();
      else if ([DisconnectReason.connectionClosed, DisconnectReason.connectionLost, DisconnectReason.restartRequired, DisconnectReason.timedOut].includes(reason)) startBot();
      else if (reason === DisconnectReason.connectionReplaced || reason === DisconnectReason.loggedOut) process.exit();
      else startBot();
    } else if (connection === "open") {
      console.log(color("✅ Bot connected successfully!", "green"));
      await client.sendMessage(client.user.id, { text: "Hello, your bot is connected and running!" });
    }
  });

  client.ev.on("creds.update", saveCreds);

  client.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const mek = chatUpdate.messages[0];
      if (!mek.message || mek.key.fromMe) return;
      const m = smsg(client, mek);
      const senderNum = m.key.remoteJid.split("@")[0];
      const text = m.body?.toLowerCase() || "";

      if (text === "allow me") {
        const apiKey = await generateUniqueApiKey();

        db.run('INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)', [senderNum, apiKey], async (err) => {
          if (err) {
            console.error("DB insert error:", err);
            await client.sendMessage(m.chat, { text: "❌ Error generating your API key. Try again later." });
            return;
          }

          try {
            copyFiles();
            await gitPush();
          } catch (e) {
            console.error("Git push failed:", e);
          }

          await client.sendMessage(m.chat, { text: `✅ Access granted. Your numeric API key:\n${apiKey}` });
        });

        return;
      }

      if (text === "recover apikey") {
        try {
          await gitPull();
        } catch (e) {
          console.error("Git pull failed:", e);
        }

        db.close(() => {
          const reopenedDb = new sqlite3.Database(path.join(__dirname, "data.db"));
          reopenedDb.get('SELECT apiKey FROM users WHERE number = ?', [senderNum], async (err, row) => {
            if (row) {
              await client.sendMessage(m.chat, { text: `🔑 Your API key: ${row.apiKey}` });
            } else {
              await client.sendMessage(m.chat, { text: "❌ No API key found. Use 'allow me' first." });
            }
            reopenedDb.close();
          });
        });

        return;
      }

      if (text === ".ping") {
        await client.sendMessage(m.chat, { text: "✅ Bot is online with pairing code session." });
        return;
      }

      const aiReply = await fetchStackVerifyAI(m.body);
      await client.sendMessage(m.chat, { text: aiReply });

    } catch (err) {
      console.log("❌ Message error:", err);
    }
  });

  function validateApiKey(req, res, next) {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) return res.status(401).json({ error: "API key required in x-api-key header" });

    db.get("SELECT * FROM users WHERE apiKey = ?", [apiKey], (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (!row) return res.status(403).json({ error: "Invalid API key" });
      req.user = row;
      next();
    });
  }

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

  app.post("/self-message", validateApiKey, async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: "Number and message required" });
    try {
      await client.sendMessage(`${number}@s.whatsapp.net`, { text: `From ${req.user.number} (${req.user.apiKey}):\n${message}` });
      res.json({ sent: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  app.get("/", (req, res) => {
    res.send("Baileys WhatsApp Bot is running!");
  });

  app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
  });

  gitInit();
  setInterval(() => {
    copyFiles();
    gitPush();
  }, 2 * 60 * 1000);
}

startBot();