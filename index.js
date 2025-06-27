// verification.js
require('dotenv').config();
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

let sock = null;
let sessionData = null;
let pairingCode = null;

app.get('/', (req, res) => {
  res.send(`
    <h2>WhatsApp Pairing</h2>
    <form method="POST" action="/pair">
      <input name="number" placeholder="Enter your phone number" required />
      <button type="submit">Generate Pairing Code</button>
    </form>
    ${pairingCode ? `<p>Pairing Code: <b>${pairingCode}</b></p>` : ''}
    ${sessionData ? `<h3>Session Data</h3><textarea rows="20" cols="100">${sessionData}</textarea>` : ''}
  `);
});

app.post('/pair', async (req, res) => {
  const number = req.body.number;
  if (!number) return res.send("Phone number required.");

  const { state, saveCreds } = await useMultiFileAuthState('./auth-' + number);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, fs),
    },
    printQRInTerminal: true,
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting') console.log('🔌 Connecting...');
    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp');
      const session = JSON.stringify(state.creds, null, 2);
      sessionData = session;
    }
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.warn('❌ Disconnected. Reason:', reason);
    }

    // === Request pairing code ===
    if (connection === 'connecting') {
      console.log('🔗 Requesting pairing code...');
      try {
        pairingCode = await sock.requestPairingCode(number);
        console.log(`🔐 Pairing Code: ${pairingCode}`);
      } catch (err) {
        console.error('❌ Failed to get pairing code:', err);
      }
    }
  });

  res.redirect('/');
});

app.listen(PORT, () => console.log(`🚀 Verification server running on http://localhost:${PORT}`));