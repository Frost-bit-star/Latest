const {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_PATH = './storage/session';
const PAIRING_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Ensure session folder exists
fs.mkdirSync(SESSION_PATH, { recursive: true });

const startBot = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
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

  let isPaired = !!state.creds.registered;
  const timeout = setTimeout(() => {
    if (!isPaired) {
      console.log('❌ Pairing time expired. Restart the server to try again.');
      process.exit(1);
    }
  }, PAIRING_TIMEOUT);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, isNewLogin, qr, pairingCode } = update;

    if (pairingCode && !isPaired) {
      console.log(`🔗 Pairing Code: ${pairingCode}`);
      console.log('⌛ You have 5 minutes to pair this bot with your WhatsApp.');
    }

    if (connection === 'open') {
      isPaired = true;
      clearTimeout(timeout);
      console.log('✅ Successfully connected to WhatsApp');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== 401;
      console.log('❌ Connection closed. Reason:', lastDisconnect?.error);
      if (shouldReconnect) {
        startBot(); // auto-reconnect
      } else {
        console.log('⚠️ Logged out. Re-pair required.');
        process.exit(1);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
};

// Start Express + Bot
app.get('/', (req, res) => {
  res.send('✅ WhatsApp Bot Server is Live');
});

app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  startBot();
});