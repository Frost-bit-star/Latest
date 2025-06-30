const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const REPO_DIR = path.resolve(__dirname, "backup");
const COMMIT_MSG = "Auto backup session & db";

function gitInit() {
  if (!process.env.GITHUB_REPO) {
    console.error("❌ GITHUB_REPO environment variable not set.");
    return;
  }

  if (!fs.existsSync(REPO_DIR)) {
    console.log("📥 Cloning backup repo...");
    try {
      execSync(`git clone ${process.env.GITHUB_REPO} ${REPO_DIR}`, { stdio: "inherit" });
    } catch (cloneErr) {
      console.error("❌ Git clone failed:", cloneErr.message);
    }
  } else {
    console.log("🔄 Backup repo already cloned, skipping pull to avoid overwriting session.");
    // ❌ We skip pulling to prevent overwriting live session data.
    // ✅ If you want to enable pulling backups, uncomment below:
    // execSync(`git -C ${REPO_DIR} pull`, { stdio: "inherit" });
  }
}

function gitPush() {
  try {
    console.log("📤 Pushing backup to GitHub...");
    execSync(`git -C ${REPO_DIR} add .`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} commit -m "${COMMIT_MSG}"`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} push`, { stdio: "inherit" });
    console.log("✅ Backup pushed to GitHub");
  } catch (e) {
    if (!e.message.includes("nothing to commit")) {
      console.error("❌ Git push error:", e.message);
    } else {
      console.log("ℹ️ Nothing to commit, backup unchanged.");
    }
  }
}

function copyFiles() {
  const sessionDir = path.resolve(__dirname, "session");
  const dbFile = path.resolve(__dirname, "data.db");

  if (!fs.existsSync(REPO_DIR)) return;

  // ✅ Copy session folder to backup (one-way backup only)
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