require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const qrcode = require('qrcode');
const { execSync } = require('child_process');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

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
        execSync('git diff --cached --quiet || git commit -m "${msg}"', { cwd: LOCAL_REPO_PATH });
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

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, apiKey TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS verification_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, code TEXT, created_at INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS pairing_codes (code TEXT PRIMARY KEY, created_at INTEGER, verified INTEGER DEFAULT 0)`);
});

let qrData = null;
const pairingCodes = [];

app.get('/qr', async (req, res) => {
    if (!qrData && pairingCodes.length === 0) return res.status(503).json({ message: 'Pairing code not ready yet' });
    let output = '';
    if (qrData) {
        const url = await qrcode.toDataURL(qrData);
        output = `<img src='${url}' alt='QR Code'/>`;
    }
    res.send(`${output}<p>Pairing Code: <b>${pairingCodes.join(', ')}</b></p>`);
});

let retryCount = 0;
const MAX_RETRIES = 5;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, fs),
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);

    if (!fs.existsSync('./auth/creds.json')) {
        console.log('🔗 Requesting pairing code...');
        try {
            const code = await sock.requestPairingCode(centralBusinessNumber);
            if (code) {
                console.log(`🔐 Pairing Code: ${code}`);
                pairingCodes.length = 0;
                pairingCodes.push(code);
                db.run(`INSERT OR IGNORE INTO pairing_codes (code, created_at) VALUES (?, ?)`, [code, Date.now()]);
            }
        } catch (err) {
            console.error('❌ Failed to get pairing code:', err);
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ Connected to WhatsApp');
            retryCount = 0;
            await sock.sendMessage(`${centralBusinessNumber}@s.whatsapp.net`, { text: '🤖 Bot is now online!' });
            pushToGitHub('🤖 Bot connected');
        }
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.warn('❌ Disconnected. Reason:', reason);
            if (reason !== 403 && retryCount < MAX_RETRIES) {
                retryCount++;
                console.log(`🔁 Retry attempt ${retryCount}/${MAX_RETRIES}`);
                setTimeout(startBot, 5000);
            } else {
                console.error('🛑 Too many retries or session expired. Exiting...');
                process.exit(1);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid.split('@')[0];
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        if (text.toLowerCase().startsWith('pair ')) {
            const code = text.split(' ')[1]?.toUpperCase();
            db.get(`SELECT * FROM pairing_codes WHERE code = ? AND verified = 0`, [code], async (err, row) => {
                if (row) {
                    db.run(`UPDATE pairing_codes SET verified = 1 WHERE code = ?`, [code]);
                    await sock.sendMessage(msg.key.remoteJid, { text: `✅ Pairing successful. Bot restarting...` });
                    pushToGitHub(`✅ Pairing code ${code} verified`);
                    setTimeout(() => process.exit(0), 3000);
                } else {
                    sock.sendMessage(msg.key.remoteJid, { text: `❌ Invalid or used pairing code.` });
                }
            });
            return;
        }

        if (text.includes("allow me")) {
            const apiKey = crypto.randomInt(10000000, 99999999).toString();
            db.run(`INSERT OR REPLACE INTO users (number, apiKey) VALUES (?, ?)`, [sender, apiKey], err => {
                if (!err) sock.sendMessage(msg.key.remoteJid, { text: `✅ You're activated!\n🔑 API Key: *${apiKey}*` });
            });
            return;
        }

        if (text === ".ping") {
            sock.sendMessage(msg.key.remoteJid, { text: "✅ Bot is online." });
            return;
        }
    });

    app.post('/request-code', async (req, res) => {
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

    app.post('/verify-code', (req, res) => {
        const { phone, code } = req.body;
        const expiry = Date.now() - 5 * 60 * 1000;
        db.get(`SELECT * FROM verification_codes WHERE phone = ? AND code = ? AND created_at > ?`, [phone, code, expiry], (err, row) => {
            if (row) res.json({ valid: true });
            else res.status(400).json({ valid: false });
        });
    });

    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

startBot();
setInterval(() => pushToGitHub('⏱️ Auto-backup'), 2 * 60 * 1000);
