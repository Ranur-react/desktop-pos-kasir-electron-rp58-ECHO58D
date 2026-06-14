const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");
const { printer: ThermalPrinter, types: PrinterTypes } = require("node-thermal-printer");
const QRCode = require("qrcode");
const windowsPrinterDriver = require("./windows-printer-driver");

function getAppRoot() {
  return app.isPackaged
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, "..", "..");
}

function getEnvPath() {
  const { app } = require("electron");
  // In packaged mode, always use AppData (writable, predictable).
  // In dev mode, use app root.
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), ".env");
  }
  return path.join(getAppRoot(), ".env");
}

function loadDotEnv() {
  const envPath = getEnvPath();
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

function resolveLogoPath(logoPathRaw) {
  if (!logoPathRaw) return "";
  if (path.isAbsolute(logoPathRaw)) return logoPathRaw;
  return path.resolve(getAppRoot(), logoPathRaw);
}

function getRuntimeConfig() {
  const dotEnv = loadDotEnv();
  const printerInterface = getConfigValue(dotEnv, "PRINTER_INTERFACE", "printer:RP58 Printer");
  const storeLogoPathRaw = getConfigValue(dotEnv, "STORE_LOGO_PATH", "");

  return {
    printerInterface,
    printerCharWidth: Number(getConfigValue(dotEnv, "PRINTER_CHAR_WIDTH", "32")) || 32,
    storeTitle: getConfigValue(dotEnv, "STORE_TITLE", "Nama Toko"),
    storeSubtitle: getConfigValue(dotEnv, "STORE_SUBTITLE", ""),
    storeAddress: getConfigValue(dotEnv, "STORE_ADDRESS", ""),
    storeWa: getConfigValue(dotEnv, "STORE_WA", ""),
    storeLogoPath: resolveLogoPath(storeLogoPathRaw),
    qrisStaticContent: getConfigValue(dotEnv, "QRIS_STATIC_CONTENT", ""),
    appIconPath: getConfigValue(dotEnv, "APP_ICON_PATH", ""),
    printerEnabled: getConfigValue(dotEnv, "PRINTER_ENABLED", "true") !== "false",
    drawerEnabled: getConfigValue(dotEnv, "DRAWER_ENABLED", "true") !== "false"
  };
}

function setEnvKey(key, value) {
  const envPath = getEnvPath();
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

function resolvePrinterDriver(printerInterface) {
  if (!printerInterface.startsWith("printer:")) {
    return undefined;
  }

  try {
    return require("electron-printer");
  } catch {}

  try {
    return require("printer");
  } catch {}

  if (process.platform === "win32") {
    return windowsPrinterDriver;
  }

  throw new Error("Driver printer belum tersedia. Install salah satu: npm install printer");
}

function createPrinter() {
  const cfg = getRuntimeConfig();
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    width: cfg.printerCharWidth,
    interface: cfg.printerInterface,
    driver: resolvePrinterDriver(cfg.printerInterface),
    options: { timeout: 5000 },
    characterSet: "SLOVENIA",
    removeSpecialCharacters: false,
    lineCharacter: "-"
  });
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function printStoreHeader(printer, cfg) {
  printer.alignCenter();

  if (cfg.storeLogoPath && fs.existsSync(cfg.storeLogoPath)) {
    try {
      await printer.printImage(cfg.storeLogoPath);
      printer.newLine();
    } catch {}
  }

  printer.bold(true);
  printer.println(cfg.storeTitle);
  printer.bold(false);

  if (cfg.storeSubtitle) {
    printer.println(cfg.storeSubtitle);
  }

  if (cfg.storeAddress) {
    if (typeof printer.setTypeFontB === "function") {
      printer.setTypeFontB();
    }
    const compactAddressLine = cfg.storeWa
      ? `${cfg.storeAddress} | WA: ${cfg.storeWa}`
      : cfg.storeAddress;
    printer.println(compactAddressLine);
    if (typeof printer.setTypeFontA === "function") {
      printer.setTypeFontA();
    }
  } else if (cfg.storeWa) {
    printer.println(`WA: ${cfg.storeWa}`);
  }

  printer.newLine();
}

async function printReceipt(tx) {
  const cfg = getRuntimeConfig();
  const printer = createPrinter();
  const connected = await printer.isPrinterConnected();

  if (!connected) {
    throw new Error(`Printer tidak terdeteksi di interface "${cfg.printerInterface}". Cek nama printer/port.`);
  }

  await printStoreHeader(printer, cfg);
  printer.alignCenter();
  printer.println("POS - Bukti Transaksi");
  printer.drawLine();

  printer.alignLeft();
  printer.println(`ID      : ${tx.id}`);
  printer.println(`Waktu   : ${formatDate(tx.createdAt)}`);
  printer.println(`Jenis   : ${tx.type === "in" ? "UANG MASUK" : "UANG KELUAR"}`);
  printer.println(`Nominal : ${formatRupiah(tx.nominal)}`);
  printer.println(`Desk    : ${tx.description || "-"}`);
  printer.drawLine();

  printer.alignCenter();
  printer.println("Terima kasih");
  printer.newLine();

  printer.raw(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  printer.cut();

  const ok = await printer.execute();
  if (!ok) {
    throw new Error("Gagal mengirim data ke printer thermal.");
  }
}

async function printOrderReceipt(order) {
  const cfg = getRuntimeConfig();
  const printer = createPrinter();
  const connected = await printer.isPrinterConnected();

  if (!connected) {
    throw new Error(`Printer tidak terdeteksi di interface "${cfg.printerInterface}". Cek nama printer/port.`);
  }

  await printStoreHeader(printer, cfg);
  printer.alignCenter();
  printer.println("Custom Order Receipt");
  printer.drawLine();

  printer.alignLeft();
  printer.println(`Order  : ${order.id}`);
  printer.println(`Waktu  : ${formatDate(order.createdAt)}`);
  printer.println(`Bayar  : ${order.paymentMethod === "cash" ? "CASH" : "QRIS"}`);
  printer.drawLine();

  for (const item of order.items) {
    if (item.returStatus === "returned") continue;
    printer.println(`${item.title}`);
    printer.println(`  ${item.qty} x ${formatRupiah(item.price)}  = ${formatRupiah(item.lineTotal)}`);
  }

  printer.drawLine();
  printer.bold(true);
  printer.println(`TOTAL  : ${formatRupiah(order.subtotal)}`);
  printer.bold(false);

  if (order.paymentMethod === "cash" && order.cashGiven !== null) {
    printer.println(`Tunai  : ${formatRupiah(order.cashGiven)}`);
    printer.println(`Kembali: ${formatRupiah(order.change)}`);
  }

  printer.drawLine();
  printer.alignCenter();
  printer.println("Terima kasih");
  printer.newLine();

  printer.raw(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  printer.cut();

  const ok = await printer.execute();
  if (!ok) {
    throw new Error("Gagal mengirim data ke printer thermal.");
  }
}

async function getQrisImageDataUrl() {
  const cfg = getRuntimeConfig();
  if (!cfg.qrisStaticContent) {
    return { imageDataUrl: "", qrisContent: "" };
  }

  const dataUrl = await QRCode.toDataURL(cfg.qrisStaticContent, {
    errorCorrectionLevel: "M",
    width: 256,
    margin: 2
  });

  return { imageDataUrl: dataUrl, qrisContent: cfg.qrisStaticContent };
}

async function printQrisStatic(amountValue) {
  const cfg = getRuntimeConfig();
  if (!cfg.qrisStaticContent) {
    throw new Error("QRIS_STATIC_CONTENT belum diisi di .env");
  }

  const tmpFile = path.join(os.tmpdir(), `qris-static-${Date.now()}.png`);
  await QRCode.toFile(tmpFile, cfg.qrisStaticContent, {
    errorCorrectionLevel: "M",
    width: 380,
    margin: 1
  });

  try {
    const printer = createPrinter();
    const connected = await printer.isPrinterConnected();
    if (!connected) {
      throw new Error(`Printer tidak terdeteksi di interface "${cfg.printerInterface}". Cek nama printer/port.`);
    }

    await printStoreHeader(printer, cfg);
    printer.alignCenter();
    printer.bold(true);
    printer.println("QRIS PEMBAYARAN");
    printer.bold(false);
    printer.drawLine();

    try {
      await printer.printImage(tmpFile);
      printer.newLine();
    } catch {
      printer.println("(Gagal cetak gambar QR)");
      printer.newLine();
    }

    printer.alignCenter();
    printer.bold(true);
    printer.println(`Total: ${formatRupiah(amountValue)}`);
    printer.bold(false);
    printer.drawLine();
    printer.println("Scan QRIS untuk bayar");
    printer.newLine();
    printer.cut();

    const ok = await printer.execute();
    if (!ok) {
      throw new Error("Gagal mencetak slip QRIS.");
    }
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }
}

async function openCashDrawer() {
  const cfg = getRuntimeConfig();
  const printer = createPrinter();
  const connected = await printer.isPrinterConnected();

  if (!connected) {
    throw new Error(`Printer tidak terdeteksi di interface "${cfg.printerInterface}". Cek nama printer/port.`);
  }

  printer.raw(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  await printer.execute();
}

function getPrinterConfig() {
  const cfg = getRuntimeConfig();
  return {
    interface: cfg.printerInterface,
    storeTitle: cfg.storeTitle,
    storeSubtitle: cfg.storeSubtitle,
    storeAddress: cfg.storeAddress,
    storeWa: cfg.storeWa,
    hasStoreLogo: Boolean(cfg.storeLogoPath && fs.existsSync(cfg.storeLogoPath)),
    type: "EPSON/ESC-POS"
  };
}

function listAvailablePrinters() {
  const list = windowsPrinterDriver.getPrinters() || [];
  return list.map((p) => ({
    name: p.name,
    interface: `printer:${p.name}`
  }));
}

function setDefaultPrinterInterface(printerInterface) {
  if (!printerInterface || !printerInterface.startsWith("printer:")) {
    throw new Error("Format printer interface tidak valid. Contoh: printer:RP58 Printer");
  }

  setEnvKey("PRINTER_INTERFACE", printerInterface);
  return getPrinterConfig();
}

module.exports = {
  printReceipt,
  printOrderReceipt,
  printQrisStatic,
  openCashDrawer,
  getPrinterConfig,
  getQrisImageDataUrl,
  listAvailablePrinters,
  setDefaultPrinterInterface,
  printQrisSlip: printQrisStatic,
  // Exposed for Store Settings UI
  getRuntimeConfig,
  getEnvPath,
  setEnvKey
};
