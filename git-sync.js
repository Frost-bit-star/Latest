const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const REPO_DIR = path.resolve(__dirname, "backup");
const COMMIT_MSG = "Auto backup session & db";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "Frost-bit-star/Config"

if (!GITHUB_TOKEN || !GITHUB_REPO) {
  console.error("❌ GITHUB_TOKEN or GITHUB_REPO environment variable not set.");
  process.exit(1);
}

// ✅ Clean and correct repo URL without double protocol
const REPO_URL = `https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;

function gitInit() {
  if (!fs.existsSync(REPO_DIR)) {
    console.log("📥 Cloning backup repo...");
    try {
      execSync(`git clone ${REPO_URL} ${REPO_DIR}`, { stdio: "inherit" });

      execSync(`git -C ${REPO_DIR} config user.name "Frost-bit-star"`, { stdio: "inherit" });
      execSync(`git -C ${REPO_DIR} config user.email "morganmilstone983@gmail.com"`, { stdio: "inherit" });

    } catch (cloneErr) {
      console.error("❌ Git clone failed:", cloneErr.message);
    }
  } else {
    console.log("🔄 Backup repo already cloned, skipping pull to avoid overwriting session.");
  }
}

function gitPush() {
  try {
    execSync(`git -C ${REPO_DIR} config user.name "Frost-bit-star"`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} config user.email "morganmilstone983@gmail.com"`, { stdio: "inherit" });

    console.log("📤 Preparing backup push to GitHub...");

    execSync(`git -C ${REPO_DIR} add .`, { stdio: "inherit" });

    // ✅ Check for staged changes before committing
    const status = execSync(`git -C ${REPO_DIR} status --porcelain`).toString();
    if (status.trim() === "") {
      console.log("ℹ️ Nothing to commit, backup unchanged.");
    } else {
      execSync(`git -C ${REPO_DIR} commit -m "${COMMIT_MSG}"`, { stdio: "inherit" });

      execSync(`git -C ${REPO_DIR} remote set-url origin ${REPO_URL}`, { stdio: "inherit" });
      execSync(`git -C ${REPO_DIR} push`, { stdio: "inherit" });

      console.log("✅ Backup pushed to GitHub");
    }

  } catch (e) {
    console.error("❌ Git push error:", e.message);
  }
}

function copyFiles() {
  const sessionDir = path.resolve(__dirname, "session");
  const dbFile = path.resolve(__dirname, "data.db");

  if (!fs.existsSync(REPO_DIR)) return;

  // ✅ Copy session folder to backup
  if (fs.existsSync(sessionDir)) {
    console.log("📁 Backing up session directory...");
    fs.cpSync(sessionDir, path.join(REPO_DIR, "session"), { recursive: true, force: true });
  }

  // ✅ Copy database file to backup
  if (fs.existsSync(dbFile)) {
    console.log("📄 Backing up database file...");
    fs.copyFileSync(dbFile, path.join(REPO_DIR, "data.db"));
  }
}

module.exports = {
  gitInit,
  gitPush,
  copyFiles,
};