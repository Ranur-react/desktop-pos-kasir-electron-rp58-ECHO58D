const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function loadDotEnv() {
  const appRoot = app.isPackaged
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, "..", "..");
  const envPath = path.join(appRoot, ".env");

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

function getConfigValue(dotEnv, key, fallback = "") {
  const fromProcess = process.env[key];
  if (typeof fromProcess === "string" && fromProcess.trim()) {
    return fromProcess.trim();
  }

  const fromDotEnv = dotEnv[key];
  if (typeof fromDotEnv === "string" && fromDotEnv.trim()) {
    return fromDotEnv.trim();
  }

  return fallback;
}

const DOT_ENV = loadDotEnv();
const DOKU_BASE_URL = getConfigValue(DOT_ENV, "DOKU_BASE_URL", "https://api-sandbox.doku.com");
const DOKU_CLIENT_ID = getConfigValue(DOT_ENV, "DOKU_CLIENT_ID", "");
const DOKU_CLIENT_SECRET = getConfigValue(DOT_ENV, "DOKU_CLIENT_SECRET", "");
const DOKU_ACCESS_TOKEN = getConfigValue(DOT_ENV, "DOKU_ACCESS_TOKEN", "");
const DOKU_MERCHANT_ID = getConfigValue(DOT_ENV, "DOKU_MERCHANT_ID", "");
const DOKU_TERMINAL_ID = getConfigValue(DOT_ENV, "DOKU_TERMINAL_ID", "A01");
const DOKU_CHANNEL_ID = getConfigValue(DOT_ENV, "DOKU_CHANNEL_ID", "H2H");
const DOKU_POSTAL_CODE = getConfigValue(DOT_ENV, "DOKU_POSTAL_CODE", "");
const DOKU_FEE_TYPE = getConfigValue(DOT_ENV, "DOKU_FEE_TYPE", "");
const DOKU_QRIS_VALID_MINUTES = Number(getConfigValue(DOT_ENV, "DOKU_QRIS_VALID_MINUTES", "15")) || 15;
const DOKU_GET_TOKEN_PATH = getConfigValue(DOT_ENV, "DOKU_GET_TOKEN_PATH", "/authorization/v1/access-token/b2b");
const DOKU_USE_STATIC_TOKEN = ["1", "true", "yes"].includes(
  getConfigValue(DOT_ENV, "DOKU_USE_STATIC_TOKEN", "false").toLowerCase()
);
const DOKU_TOKEN_SIGNATURE_MODE = getConfigValue(DOT_ENV, "DOKU_TOKEN_SIGNATURE_MODE", "RSA_SHA256").toUpperCase();
const DOKU_PRIVATE_KEY = getConfigValue(DOT_ENV, "DOKU_PRIVATE_KEY", "");
const DOKU_PRIVATE_KEY_PATH = getConfigValue(DOT_ENV, "DOKU_PRIVATE_KEY_PATH", "");
const DOKU_SNAP_PREFIX = getConfigValue(DOT_ENV, "DOKU_SNAP_PREFIX", "/snap-adapter");
const DOKU_FEE_TYPE_DEFAULT = getConfigValue(DOT_ENV, "DOKU_FEE_TYPE", "");

let tokenCache = {
  accessToken: "",
  expiresAt: 0
};

function ensureDokuReady() {
  const missing = [];
  if (!DOKU_CLIENT_ID) missing.push("DOKU_CLIENT_ID");
  if (!DOKU_MERCHANT_ID) missing.push("DOKU_MERCHANT_ID");

  if (missing.length > 0) {
    throw new Error(`Konfigurasi DOKU belum lengkap: ${missing.join(", ")}`);
  }

  if (DOKU_USE_STATIC_TOKEN) {
    if (!DOKU_ACCESS_TOKEN) {
      throw new Error("DOKU_USE_STATIC_TOKEN=true tapi DOKU_ACCESS_TOKEN kosong.");
    }
    if (DOKU_ACCESS_TOKEN.startsWith("doku_key_")) {
      throw new Error(
        "DOKU_ACCESS_TOKEN berisi API Key (doku_key_...). Isi dengan B2B Access Token hasil endpoint Get Token SNAP."
      );
    }
  }

  if (!DOKU_USE_STATIC_TOKEN) {
    if (DOKU_TOKEN_SIGNATURE_MODE === "RSA_SHA256") {
      if (!getDokuPrivateKey()) {
        throw new Error("DOKU_PRIVATE_KEY atau DOKU_PRIVATE_KEY_PATH wajib diisi untuk mode RSA_SHA256.");
      }
    } else if (DOKU_TOKEN_SIGNATURE_MODE === "HMAC_SHA256") {
      if (!DOKU_CLIENT_SECRET) {
        throw new Error("DOKU_CLIENT_SECRET wajib diisi untuk mode HMAC_SHA256.");
      }
    } else {
      throw new Error("DOKU_TOKEN_SIGNATURE_MODE tidak valid. Gunakan RSA_SHA256 atau HMAC_SHA256.");
    }
  }
}

function getDokuPrivateKey() {
  if (DOKU_PRIVATE_KEY) {
    return DOKU_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  if (!DOKU_PRIVATE_KEY_PATH) {
    return "";
  }

  const appRoot = app.isPackaged
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, "..", "..");

  const resolved = path.isAbsolute(DOKU_PRIVATE_KEY_PATH)
    ? DOKU_PRIVATE_KEY_PATH
    : path.resolve(appRoot, DOKU_PRIVATE_KEY_PATH);

  if (!fs.existsSync(resolved)) {
    return "";
  }

  return fs.readFileSync(resolved, "utf-8");
}

function toIsoWithOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  const yyyy = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mo}-${dd}T${h}:${m}:${s}${sign}${hh}:${mm}`;
}

function minifyBody(body) {
  return JSON.stringify(body || {});
}

function sha256HexLower(input) {
  return crypto.createHash("sha256").update(input).digest("hex").toLowerCase();
}

function hmacSha512Base64(secret, input) {
  return crypto.createHmac("sha512", secret).update(input).digest("base64");
}

function hmacSha256Base64(secret, input) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64");
}

function rsaSha256Base64(privateKeyPem, input) {
  return crypto.sign("RSA-SHA256", Buffer.from(input), privateKeyPem).toString("base64");
}

function makeExternalId() {
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${Date.now()}${random}`;
}

function buildGenerateBody({ partnerReferenceNo, amountValue }) {
  const now = new Date();
  const validityDate = new Date(now.getTime() + DOKU_QRIS_VALID_MINUTES * 60 * 1000);

  const body = {
    partnerReferenceNo,
    amount: {
      value: Number(amountValue).toFixed(2),
      currency: "IDR"
    },
    merchantId: DOKU_MERCHANT_ID,
    validityPeriod: toIsoWithOffset(validityDate)
  };
  if (DOKU_TERMINAL_ID) body.terminalId = DOKU_TERMINAL_ID;

  const additionalInfo = {};
  if (DOKU_POSTAL_CODE) additionalInfo.postalCode = DOKU_POSTAL_CODE;
  if (DOKU_FEE_TYPE_DEFAULT) additionalInfo.feeType = DOKU_FEE_TYPE_DEFAULT;
  if (Object.keys(additionalInfo).length > 0) {
    body.additionalInfo = additionalInfo;
  }

  return body;
}

function buildB2BTokenSignature(timestamp) {
  const stringToSign = `${DOKU_CLIENT_ID}|${timestamp}`;

  if (DOKU_TOKEN_SIGNATURE_MODE === "RSA_SHA256") {
    return rsaSha256Base64(getDokuPrivateKey(), stringToSign);
  }

  return hmacSha256Base64(DOKU_CLIENT_SECRET, stringToSign);
}

async function requestB2BAccessToken() {
  const timestamp = toIsoWithOffset(new Date());
  const signature = buildB2BTokenSignature(timestamp);

  const url = `${DOKU_BASE_URL}${DOKU_GET_TOKEN_PATH}`;
  const headers = {
    "Content-Type": "application/json",
    "X-CLIENT-KEY": DOKU_CLIENT_ID,
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature
  };
  const reqBody = JSON.stringify({ grantType: "client_credentials" });

  console.log("[DOKU] Get Token Request:");
  console.log("  URL:", url);
  console.log("  X-CLIENT-KEY:", DOKU_CLIENT_ID);
  console.log("  X-TIMESTAMP:", timestamp);
  console.log("  X-SIGNATURE:", signature.substring(0, 30) + "...");
  console.log("  Body:", reqBody);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: reqBody
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  console.log("[DOKU] Get Token Response:", response.status, JSON.stringify(payload));

  if (!response.ok) {
    const msg = payload?.responseMessage || payload?.message || response.statusText;
    throw new Error(`DOKU Get Token HTTP ${response.status}: ${msg}`);
  }

  if (!payload?.accessToken) {
    throw new Error(`DOKU Get Token gagal: ${payload?.responseMessage || "accessToken kosong"}`);
  }

  const expiresInSec = Number(payload.expiresIn || 900);
  const safetyWindowSec = 60;

  tokenCache = {
    accessToken: payload.accessToken,
    expiresAt: Date.now() + Math.max(60, expiresInSec - safetyWindowSec) * 1000
  };

  return tokenCache.accessToken;
}

async function getB2BAccessToken() {
  ensureDokuReady();

  if (DOKU_USE_STATIC_TOKEN && DOKU_ACCESS_TOKEN) {
    return DOKU_ACCESS_TOKEN;
  }

  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  return requestB2BAccessToken();
}

async function postSnap(endpointPath, body) {
  const b2bAccessToken = await getB2BAccessToken();

  const timestamp = toIsoWithOffset(new Date());
  const bodyMinified = minifyBody(body);
  const bodyHashHex = sha256HexLower(bodyMinified);
  const signatureString = `POST:${endpointPath}:${b2bAccessToken}:${bodyHashHex}:${timestamp}`;
  const signature = hmacSha512Base64(DOKU_CLIENT_SECRET, signatureString);

  const url = `${DOKU_BASE_URL}${endpointPath}`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${b2bAccessToken}`,
    "X-PARTNER-ID": DOKU_CLIENT_ID,
    "X-EXTERNAL-ID": makeExternalId(),
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature,
    "CHANNEL-ID": DOKU_CHANNEL_ID
  };

  console.log("[DOKU] postSnap Request:");
  console.log("  URL:", url);
  console.log("  X-TIMESTAMP:", timestamp);
  console.log("  CHANNEL-ID:", DOKU_CHANNEL_ID);
  console.log("  Body:", bodyMinified);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: bodyMinified
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  console.log("[DOKU] postSnap Response:", response.status, JSON.stringify(payload));

  if (!response.ok) {
    const msg = payload?.responseMessage || payload?.message || response.statusText;
    throw new Error(`DOKU HTTP ${response.status}: ${msg}`);
  }

  if (payload?.responseCode && !String(payload.responseCode).startsWith("200")) {
    throw new Error(`DOKU ${payload.responseCode}: ${payload.responseMessage || "Request gagal"}`);
  }

  return payload || {};
}

async function generateQris({ partnerReferenceNo, amountValue }) {
  const endpointPath = `${DOKU_SNAP_PREFIX}/b2b/v1.0/qr/qr-mpm-generate`;
  const body = buildGenerateBody({ partnerReferenceNo, amountValue });
  const result = await postSnap(endpointPath, body);

  if (!result.qrContent) {
    throw new Error("DOKU tidak mengembalikan qrContent.");
  }

  return {
    referenceNo: result.referenceNo || partnerReferenceNo,
    partnerReferenceNo: result.partnerReferenceNo || partnerReferenceNo,
    qrContent: result.qrContent,
    validityPeriod: result.additionalInfo?.validityPeriod || body.validityPeriod,
    raw: result
  };
}

async function queryQris({ originalReferenceNo, originalPartnerReferenceNo }) {
  const endpointPath = `${DOKU_SNAP_PREFIX}/b2b/v1.0/qr/qr-mpm-query`;
  const body = {
    originalReferenceNo,
    originalPartnerReferenceNo,
    merchantId: DOKU_MERCHANT_ID,
    serviceCode: "47"
  };

  const result = await postSnap(endpointPath, body);
  const status = String(result.latestTransactionStatus || "").trim();

  return {
    paid: status === "00",
    latestTransactionStatus: status,
    transactionStatusDesc: result.transactionStatusDesc || "",
    paidTime: result.paidTime || "",
    amount: result.amount || null,
    feeAmount: result.feeAmount || null,
    raw: result
  };
}

module.exports = {
  generateQris,
  queryQris,
  makeExternalId
};
