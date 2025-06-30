// git-sync.js
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const REPO_DIR = path.resolve(__dirname, "backup");
const COMMIT_MSG = "Auto backup session & db";

function gitInit() {
  try {
    execSync(`git -C ${REPO_DIR} pull`, { stdio: "inherit" });
  } catch {
    console.log("Cloning backup repo...");
    execSync(`git clone ${process.env.GITHUB_REPO} ${REPO_DIR}`, { stdio: "inherit" });
  }
}

function gitPush() {
  try {
    execSync(`git -C ${REPO_DIR} add .`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} commit -m "${COMMIT_MSG}"`, { stdio: "inherit" });
    execSync(`git -C ${REPO_DIR} push`, { stdio: "inherit" });
    console.log("✅ Backup pushed to GitHub");
  } catch (e) {
    if (!e.message.includes("nothing to commit")) {
      console.error("Git push error:", e.message);
    }
  }
}

function copyFiles() {
  const sessionDir = path.resolve(__dirname, "session");
  const dbFile = path.resolve(__dirname, "data.db");

  if (!fs.existsSync(REPO_DIR)) return;

  if (fs.existsSync(sessionDir)) {
    fs.cpSync(sessionDir, path.join(REPO_DIR, "session"), { recursive: true, force: true });
  }

  if (fs.existsSync(dbFile)) {
    fs.copyFileSync(dbFile, path.join(REPO_DIR, "data.db"));
  }
}

module.exports = {
  gitInit,
  gitPush,
  copyFiles,
};