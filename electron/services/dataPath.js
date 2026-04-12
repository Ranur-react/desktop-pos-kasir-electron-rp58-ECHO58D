const fs = require("fs");
const path = require("path");

let _dataDir = null;

/**
 * Resolve the data directory from .env DATA_PATH, or fall back to ./pos-data
 * next to the app root (easy to find & sync to OneDrive).
 */
function resolveDataDir(app) {
  if (_dataDir) return _dataDir;

  // 1. Try reading .env from app root
  const appRoot = app.isPackaged
    ? path.dirname(app.getPath("exe"))
    : path.resolve(__dirname, "..", "..");

  const envPath = path.join(appRoot, ".env");
  let envDataPath = "";

  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key === "DATA_PATH" && val) {
        envDataPath = val;
        break;
      }
    }
  }

  // 2. Determine final directory
  if (envDataPath) {
    // Support both absolute and relative (relative to app root)
    _dataDir = path.isAbsolute(envDataPath)
      ? envDataPath
      : path.resolve(appRoot, envDataPath);
  } else {
    // Default: ./pos-data next to the application
    _dataDir = path.join(appRoot, "pos-data");
  }

  // 3. Ensure it exists
  if (!fs.existsSync(_dataDir)) {
    fs.mkdirSync(_dataDir, { recursive: true });
  }

  console.log(`[POS] Data directory: ${_dataDir}`);
  return _dataDir;
}

/** Reset cached dir (for testing or config reload) */
function resetDataDir() {
  _dataDir = null;
}

module.exports = { resolveDataDir, resetDataDir };
