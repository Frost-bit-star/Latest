// pairing-server.js
require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

let currentPairingCode = null;
let sessionData = null;

async function startBot(phone) {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    version,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, pairingCode, lastDisconnect } = update;

    if (pairingCode) {
      console.log(`🔗 Pairing code for ${phone}: ${pairingCode}`);
      currentPairingCode = pairingCode;
    }

    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp');

      // Save session.json
      const creds = state.creds;
      const keys = {};
      for (const key in state.keys) {
        keys[key] = await state.keys.get(key);
      }

      sessionData = { creds, keys };
      fs.writeFileSync('session.json', JSON.stringify(sessionData, null, 2));
      console.log('✅ Session saved to session.json');
    }

    if (connection === 'close') {
      console.log('❌ Disconnected');
    }
  });

  try {
    await sock.requestPairingCode(phone);
  } catch (err) {
    console.error('❌ Failed to generate pairing code:', err);
  }
}

// === Web routes ===

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>WhatsApp Pairing Generator</title>
        <style>
          body { font-family: sans-serif; margin: 20px; background: #121212; color: #eee; }
          input, button { padding: 10px; margin: 5px; }
          pre { background: #222; padding: 10px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h2>🔗 WhatsApp Pairing Generator</h2>
        <form method="POST" action="/pair">
          <input type="text" name="phone" placeholder="Enter phone number" required />
          <button type="submit">Generate Pairing Code</button>
        </form>

        <h3>Pairing Code</h3>
        <pre>${currentPairingCode || 'No code generated yet'}</pre>

        <h3>Session JSON</h3>
        <pre id="session">${sessionData ? JSON.stringify(sessionData, null, 2) : 'No session yet'}</pre>
        <button onclick="copySession()">Copy Session JSON</button>

        <script>
          function copySession() {
            const text = document.getElementById('session').innerText;
            navigator.clipboard.writeText(text).then(() => {
              alert('✅ Session copied to clipboard!');
            });
          }
        </script>
      </body>
    </html>
  `);
});

app.use(express.urlencoded({ extended: true }));

app.post('/pair', (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.send('Phone number required');
  startBot(phone);
  res.redirect('/');
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`🚀 Pairing server running on http://localhost:${PORT}`);
});