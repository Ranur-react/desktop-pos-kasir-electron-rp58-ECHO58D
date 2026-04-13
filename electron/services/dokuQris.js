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

function ensureDokuReady() {
  const missing = [];
  if (!DOKU_CLIENT_ID) missing.push("DOKU_CLIENT_ID");
  if (!DOKU_CLIENT_SECRET) missing.push("DOKU_CLIENT_SECRET");
  if (!DOKU_ACCESS_TOKEN) missing.push("DOKU_ACCESS_TOKEN");
  if (!DOKU_MERCHANT_ID) missing.push("DOKU_MERCHANT_ID");

  if (missing.length > 0) {
    throw new Error(`Konfigurasi DOKU belum lengkap: ${missing.join(", ")}`);
  }
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

function makeExternalId() {
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${Date.now()}${random}`;
}

function buildGenerateBody({ partnerReferenceNo, amountValue }) {
  const now = new Date();
  const validityDate = new Date(now.getTime() + DOKU_QRIS_VALID_MINUTES * 60 * 1000);

  const additionalInfo = {};
  if (DOKU_POSTAL_CODE) additionalInfo.postalCode = DOKU_POSTAL_CODE;
  if (DOKU_FEE_TYPE) additionalInfo.feeType = DOKU_FEE_TYPE;

  return {
    partnerReferenceNo,
    amount: {
      value: Number(amountValue).toFixed(2),
      currency: "IDR"
    },
    merchantId: DOKU_MERCHANT_ID,
    terminalId: DOKU_TERMINAL_ID,
    validityPeriod: toIsoWithOffset(validityDate),
    additionalInfo
  };
}

async function postSnap(endpointPath, body) {
  ensureDokuReady();

  const timestamp = toIsoWithOffset(new Date());
  const bodyMinified = minifyBody(body);
  const bodyHashHex = sha256HexLower(bodyMinified);
  const signatureString = `POST:${endpointPath}:${DOKU_ACCESS_TOKEN}:${bodyHashHex}:${timestamp}`;
  const signature = hmacSha512Base64(DOKU_CLIENT_SECRET, signatureString);

  const response = await fetch(`${DOKU_BASE_URL}${endpointPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${DOKU_ACCESS_TOKEN}`,
      "X-PARTNER-ID": DOKU_CLIENT_ID,
      "X-EXTERNAL-ID": makeExternalId(),
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": signature,
      "CHANNEL-ID": DOKU_CHANNEL_ID
    },
    body: bodyMinified
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

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
  const endpointPath = "/snap-adapter/b2b/v1.0/qr/qr-mpm-generate";
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
  const endpointPath = "/snap-adapter/b2b/v1.0/qr/qr-mpm-query";
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
