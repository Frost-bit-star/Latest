const {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_PATH = path.join(__dirname, "auth_info");

const BUSINESS_NUMBER = "255776822641@s.whatsapp.net";
const AI_ENDPOINT = "https://troverstarapiai.vercel.app/api/chat";

// Optional: restore session from base64 (optional)
const SESSION_DATA = null;

let sock;
let ready = false;

function restoreSessionFromHardcodedEnv(sessionBase64) {
  if (!sessionBase64) return;
  if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
    const parsed = JSON.parse(Buffer.from(sessionBase64, "base64").toString());
    for (const [filename, data] of Object.entries(parsed)) {
      fs.writeFileSync(path.join(SESSION_PATH, filename), JSON.stringify(data, null, 2));
    }
    console.log("✅ Session restored from hardcoded value");
  }
}

async function startBot() {
  try {
    restoreSessionFromHardcodedEnv(SESSION_DATA);

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, fs)
      },
      printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, isNewLogin }) => {
      if (connection === "open") {
        ready = true;
        console.log("✅ Bot is connected");

        if (!SESSION_DATA && isNewLogin) {
          const sessionObj = {};
          const files = fs.readdirSync(SESSION_PATH);
          for (const file of files) {
            const content = fs.readFileSync(path.join(SESSION_PATH, file), "utf-8");
            sessionObj[file] = JSON.parse(content);
          }

          const base64 = Buffer.from(JSON.stringify(sessionObj)).toString("base64");

          await sock.sendMessage(BUSINESS_NUMBER, {
            text: `✅ *Pairing Complete!*\n\nPaste this in your code:\n\nconst SESSION_DATA = "${base64}";`
          });

          console.log("📦 Session data sent to business number");
        }
      }

      if (connection === "close") {
        ready = false;
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          console.warn("❌ Disconnected. Reconnecting...");
          setTimeout(startBot, 5000);
        } else {
          console.error("❌ Logged out. Manual re-pairing required.");
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const sender = msg.key.remoteJid;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

      if (text.toLowerCase() === "ping") {
        await sock.sendMessage(sender, { text: "✅ I'm alive!" });
        return;
      }

      try {
        const aiRes = await axios.post(
          AI_ENDPOINT,
          {
            messages: [{ role: "user", content: text }],
            model: "gpt-3.5-turbo"
          },
          { headers: { "Content-Type": "application/json" } }
        );

        const reply = aiRes.data?.response?.content || "🤖 I didn't understand.";
        await sock.sendMessage(sender, { text: reply });
      } catch (err) {
        console.error("❌ AI error:", err.message);
        await sock.sendMessage(sender, { text: "⚠️ AI service unavailable." });
      }
    });

    // Request pairing code if session does not exist
    if (!fs.existsSync(path.join(SESSION_PATH, "creds.json"))) {
      try {
        const code = await sock.requestPairingCode(BUSINESS_NUMBER.split("@")[0]);
        console.log(`🔗 Pairing Code: ${code}`);
      } catch (err) {
        console.error("❌ Failed to get pairing code:", err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error starting bot:", err.message);
    setTimeout(startBot, 5000);
  }
}

startBot();

// === API to send messages ===
app.post("/api/send", async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message) return res.status(400).send("Missing number/message");

  try {
    await sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
    res.send("✅ Message sent");
  } catch (err) {
    console.error("❌ Error sending:", err.message);
    res.status(500).send("Send failed");
  }
});

// === Health check ===
app.get("/api/health", async (req, res) => {
  let aiWorks = false;

  try {
    const ping = await axios.post(
      AI_ENDPOINT,
      { messages: [{ role: "user", content: "ping" }], model: "gpt-3.5-turbo" },
      { headers: { "Content-Type": "application/json" } }
    );
    aiWorks = ping.status === 200;
  } catch {}

  res.json({
    status: ready ? "✅ Bot Online" : "❌ Bot Offline",
    ai: aiWorks ? "✅ AI Responding" : "❌ AI Down",
    timestamp: new Date().toISOString()
  });
});

// === Railway keep-alive ===
setInterval(() => {
  axios.get(`http://localhost:${PORT}/api/health`).catch(() => {});
}, 60000);

// === Graceful shutdown ===
process.on("SIGINT", async () => {
  console.log("🔒 Shutting down...");
  try {
    await sock.logout();
  } catch {}
  process.exit(0);
});

app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));