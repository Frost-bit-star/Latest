const {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_PATH = './storage/session';
const PAIRING_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const API_KEYS = ['your-secret-api-key']; // 🔒 You can load from DB or env later

// Ensure session folder exists
fs.mkdirSync(SESSION_PATH, { recursive: true });

app.use(express.json());

let currentPairingCode = null;
let sock = null;
let isPaired = false;
let deviceInfo = {};

const startBot = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, fs)
    },
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    browser: ['Ubuntu', 'Chrome', '22.04.4']
  });

  isPaired = !!state.creds.registered;
  const timeout = setTimeout(() => {
    if (!isPaired) {
      console.log('❌ Pairing time expired. Restart the server to try again.');
      process.exit(1);
    }
  }, PAIRING_TIMEOUT);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, pairingCode, isNewLogin, qr, client } = update;

    if (pairingCode && !isPaired) {
      currentPairingCode = pairingCode;
      console.log(`🔗 Pairing Code: ${pairingCode}`);
      console.log('⌛ You have 5 minutes to pair this bot with your WhatsApp.');
    }

    if (connection === 'open') {
      isPaired = true;
      currentPairingCode = null;
      clearTimeout(timeout);
      deviceInfo = client || {};
      console.log('✅ Successfully connected to WhatsApp');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
      console.log('❌ Connection closed. Reason:', lastDisconnect?.error);
      if (shouldReconnect) {
        startBot(); // Reconnect
      } else {
        console.log('⚠️ Logged out. Re-pair required.');
        process.exit(1);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
};

// 🌐 Home Route
app.get('/', (req, res) => {
  res.send(`
    <h2>✅ WhatsApp Bot Server is Live</h2>
    <ul>
      <li><a href="/pair">/pair</a> – Get current pairing code</li>
      <li><a href="/status">/status</a> – Bot connection status</li>
      <li><a href="/info">/info</a> – Device info</li>
    </ul>
  `);
});

// 🔗 Pairing Code Display
app.get('/pair', (req, res) => {
  if (currentPairingCode) {
    res.send(`
      <h2>🔗 Pairing Code</h2>
      <p><strong>${currentPairingCode}</strong></p>
      <p>Use this in WhatsApp > Linked Devices > Link with Code.</p>
    `);
  } else {
    res.send('<p>✅ Already paired or waiting for pairing code. Please refresh shortly.</p>');
  }
});

// ✅ Status Check
app.get('/status', (req, res) => {
  res.json({
    status: isPaired ? 'connected' : 'not_connected',
    pairingCode: currentPairingCode || null
  });
});

// 📱 Device Info
app.get('/info', (req, res) => {
  if (!isPaired) {
    return res.status(400).json({ error: 'Not paired yet' });
  }
  res.json({ device: deviceInfo });
});

// 📩 Send Message
app.post('/send', async (req, res) => {
  const { number, message, apikey } = req.body;

  if (!API_KEYS.includes(apikey)) {
    return res.status(403).json({ error: 'Invalid API Key' });
  }

  if (!isPaired || !sock) {
    return res.status(500).json({ error: 'Bot not connected' });
  }

  if (!number || !message) {
    return res.status(400).json({ error: 'Missing number or message' });
  }

  try {
    const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    res.json({ success: true, to: jid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  startBot();
});