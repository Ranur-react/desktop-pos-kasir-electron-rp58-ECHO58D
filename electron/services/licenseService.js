const fs = require("fs");
const path = require("path");
const https = require("https");

const DEFAULT_LICENSE_SOURCE_URL =
  "https://github.com/Ranur-react/desktop-pos-kasir-electron-rp58-ECHO58D/blob/Fedback.jawal.arrow/license.txt";

const DEFAULT_READONLY_MESSAGE =
  "Lisensi aplikasi tidak aktif. Aplikasi berjalan dalam mode baca saja.";

const DEVELOPER_CONTACT = {
  email: "rahmatnur844@gmail.com",
  whatsapp: "+6283182647716"
};

const REMOTE_CACHE_TTL_MS = 5 * 60 * 1000;

const remoteCache = {
  fetchedAt: 0,
  records: null,
  source: "none",
  error: ""
};

function getAppRoot(app) {
  return app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, "..", "..");
}

function getEnvPath(app) {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), ".env");
  }
  return path.join(getAppRoot(app), ".env");
}

function loadDotEnv(app) {
  const envPath = getEnvPath(app);
  const values = {};

  if (!fs.existsSync(envPath)) {
    return values;
  }

  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }

  return values;
}

function setEnvKey(app, key, value) {
  const envPath = getEnvPath(app);
  const lineValue = String(value || "").trim();

  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  }

  let found = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return line;
    }

    const eqIdx = trimmed.indexOf("=");
    const existingKey = trimmed.slice(0, eqIdx).trim();
    if (existingKey === key) {
      found = true;
      return `${key}=${lineValue}`;
    }
    return line;
  });

  if (!found) {
    nextLines.push(`${key}=${lineValue}`);
  }

  fs.writeFileSync(envPath, nextLines.join("\n"), "utf-8");
  process.env[key] = lineValue;
}

function toRawGithubUrl(inputUrl) {
  if (!inputUrl) return "";

  try {
    const url = new URL(inputUrl);
    if (url.hostname !== "github.com") {
      return inputUrl;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    // owner/repo/blob/branch/path...
    if (parts.length >= 5 && parts[2] === "blob") {
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[3];
      const rest = parts.slice(4).join("/");
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest}`;
    }

    return inputUrl;
  } catch {
    return inputUrl;
  }
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });

    req.on("timeout", () => {
      req.destroy(new Error("Request timeout"));
    });

    req.on("error", reject);
  });
}

function parseLicenseLines(text) {
  const rows = String(text || "").split(/\r?\n/);
  const map = new Map();

  for (const raw of rows) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(":").map((p) => p.trim());
    if (parts.length < 2) continue;

    const code = parts[0];
    const status = String(parts[1] || "").toLowerCase();
    const expiresAt = parts[2] || "";

    if (!code) continue;
    map.set(code, { code, status, expiresAt });
  }

  return map;
}

function readLocalLicenseList(app) {
  const candidates = [
    path.join(getAppRoot(app), "license.txt"),
    path.join(app.getAppPath(), "license.txt")
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      // ignore candidate and try the next one
    }
  }

  return "";
}

async function getLicenseRecords(app, { forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && remoteCache.records && now - remoteCache.fetchedAt < REMOTE_CACHE_TTL_MS) {
    return {
      records: remoteCache.records,
      source: remoteCache.source,
      error: remoteCache.error
    };
  }

  const env = loadDotEnv(app);
  const sourceUrl = env.LICENSE_SOURCE_URL || DEFAULT_LICENSE_SOURCE_URL;
  const rawUrl = toRawGithubUrl(sourceUrl);

  try {
    const remoteText = await fetchText(rawUrl);
    const records = parseLicenseLines(remoteText);
    remoteCache.records = records;
    remoteCache.fetchedAt = now;
    remoteCache.source = `remote:${rawUrl}`;
    remoteCache.error = "";
    return { records, source: remoteCache.source, error: "" };
  } catch (err) {
    const localText = readLocalLicenseList(app);
    const records = parseLicenseLines(localText);
    remoteCache.records = records;
    remoteCache.fetchedAt = now;
    remoteCache.source = "local:license.txt";
    remoteCache.error = err.message;
    return { records, source: remoteCache.source, error: err.message };
  }
}

function normalizeStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "active" || s === "suspend" || s === "expired") {
    return s;
  }
  return "unknown";
}

function isDateExpired(expiresAt) {
  if (!expiresAt) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return today > expiresAt;
}

async function getLicenseState(app, { forceRefresh = false } = {}) {
  const env = loadDotEnv(app);
  const code = (env.LICENSE_CODE || "").trim();
  const readOnlyMessage =
    (env.LICENSE_READONLY_MESSAGE || "").trim() || DEFAULT_READONLY_MESSAGE;

  const { records, source, error } = await getLicenseRecords(app, { forceRefresh });

  if (!code) {
    return {
      mode: "read-only",
      isWriteEnabled: false,
      enteredCode: "",
      listed: null,
      reason: "Kode lisensi belum diisi.",
      readOnlyMessage,
      developerContact: DEVELOPER_CONTACT,
      source,
      sourceError: error
    };
  }

  const listed = records.get(code) || null;
  if (!listed) {
    return {
      mode: "read-only",
      isWriteEnabled: false,
      enteredCode: code,
      listed: null,
      reason: "Kode lisensi tidak ditemukan pada daftar developer.",
      readOnlyMessage,
      developerContact: DEVELOPER_CONTACT,
      source,
      sourceError: error
    };
  }

  const status = normalizeStatus(listed.status);
  const expiredByDate = status === "active" && isDateExpired(listed.expiresAt);

  if (status === "active" && !expiredByDate) {
    return {
      mode: "full",
      isWriteEnabled: true,
      enteredCode: code,
      listed: {
        code: listed.code,
        status,
        expiresAt: listed.expiresAt || ""
      },
      reason: "Lisensi aktif.",
      readOnlyMessage,
      developerContact: DEVELOPER_CONTACT,
      source,
      sourceError: error
    };
  }

  let reason = "Lisensi tidak aktif.";
  if (status === "suspend") reason = "Lisensi sedang suspend.";
  if (status === "expired" || expiredByDate) reason = "Lisensi sudah expired.";

  return {
    mode: "read-only",
    isWriteEnabled: false,
    enteredCode: code,
    listed: {
      code: listed.code,
      status: expiredByDate ? "expired" : status,
      expiresAt: listed.expiresAt || ""
    },
    reason,
    readOnlyMessage,
    developerContact: DEVELOPER_CONTACT,
    source,
    sourceError: error
  };
}

async function saveLicenseCode(app, code) {
  const value = String(code || "").trim();
  setEnvKey(app, "LICENSE_CODE", value);
  return getLicenseState(app, { forceRefresh: true });
}

async function saveReadOnlyMessage(app, message) {
  const value = String(message || "").trim();
  setEnvKey(app, "LICENSE_READONLY_MESSAGE", value);
  return getLicenseState(app, { forceRefresh: true });
}

module.exports = {
  getLicenseState,
  saveLicenseCode,
  saveReadOnlyMessage,
  DEVELOPER_CONTACT,
  DEFAULT_READONLY_MESSAGE
};
