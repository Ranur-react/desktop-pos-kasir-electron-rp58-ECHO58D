const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");
const { printer: ThermalPrinter, types: PrinterTypes } = require("node-thermal-printer");
const QRCode = require("qrcode");

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
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
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
const PRINTER_INTERFACE = getConfigValue(DOT_ENV, "PRINTER_INTERFACE", "printer:RP58 Printer");
const PRINTER_CHAR_WIDTH = Number(getConfigValue(DOT_ENV, "PRINTER_CHAR_WIDTH", "32")) || 32;
const STORE_TITLE = getConfigValue(DOT_ENV, "STORE_TITLE", "Nama Toko");
const STORE_SUBTITLE = getConfigValue(DOT_ENV, "STORE_SUBTITLE", "");
const STORE_ADDRESS = getConfigValue(DOT_ENV, "STORE_ADDRESS", "");
const STORE_WA = getConfigValue(DOT_ENV, "STORE_WA", "");
const STORE_LOGO_PATH_RAW = getConfigValue(DOT_ENV, "STORE_LOGO_PATH", "");
const QRIS_STATIC_CONTENT = getConfigValue(DOT_ENV, "QRIS_STATIC_CONTENT", "");

function resolveLogoPath(logoPathRaw) {
  if (!logoPathRaw) {
    return "";
  }

  if (path.isAbsolute(logoPathRaw)) {
    return logoPathRaw;
  }

  const appRoot = app.isPackaged
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, "..", "..");
  return path.resolve(appRoot, logoPathRaw);
}

const STORE_LOGO_PATH = resolveLogoPath(STORE_LOGO_PATH_RAW);


async function printStoreHeader(printer) {
  printer.alignCenter();

  if (STORE_LOGO_PATH && fs.existsSync(STORE_LOGO_PATH)) {
    try {
      await printer.printImage(STORE_LOGO_PATH);
      printer.newLine();
    } catch {
      // Skip logo if image format/path is not supported by printer library.
    }
  }

  printer.bold(true);
  printer.println(STORE_TITLE);
  printer.bold(false);

  if (STORE_SUBTITLE) {
    printer.println(STORE_SUBTITLE);
  }
  if (STORE_ADDRESS) {
    // Use Font B for a smaller address line when supported by the printer.
    if (typeof printer.setTypeFontB === "function") {
      printer.setTypeFontB();
    }
    const compactAddressLine = STORE_WA
      ? `${STORE_ADDRESS} | WA: ${STORE_WA}`
      : STORE_ADDRESS;
    printer.println(compactAddressLine);
    if (typeof printer.setTypeFontA === "function") {
      printer.setTypeFontA();
    }
  } else if (STORE_WA) {
    printer.println(`WA: ${STORE_WA}`);
  }

  // Add breathing space before section titles like POS/Custom Order Receipt.
  printer.newLine();
}

function resolvePrinterDriver() {
  if (!PRINTER_INTERFACE.startsWith("printer:")) {
    return undefined;
  }

  try {
    return require("electron-printer");
  } catch {
    // Package ini sering tidak kompatibel dengan Electron modern.
  }

  try {
    return require("printer");
  } catch {
    // Fallback tanpa native addon untuk Windows.
  }

  if (process.platform === "win32") {
    return require("./windows-printer-driver");
  }

  throw new Error(
    "Driver printer belum tersedia. Install salah satu: npm install printer"
  );
}

function createPrinter() {
  const driver = resolvePrinterDriver();

  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    width: PRINTER_CHAR_WIDTH,
    interface: PRINTER_INTERFACE,
    driver,
    options: {
      timeout: 5000
    },
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

async function printReceipt(tx) {
  const printer = createPrinter();

  const connected = await printer.isPrinterConnected();
  if (!connected) {
    throw new Error(
      `Printer tidak terdeteksi di interface \"${PRINTER_INTERFACE}\". Cek nama printer/port.`
    );
  }

  await printStoreHeader(printer);
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

  // Perintah standar kick cash drawer (pin 2, pulse 120/240)
  printer.raw(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  printer.cut();

  const ok = await printer.execute();
  if (!ok) {
    throw new Error("Gagal mengirim data ke printer thermal.");
  }
}

async function openCashDrawer() {
  const printer = createPrinter();
  const connected = await printer.isPrinterConnected();

  if (!connected) {
    throw new Error(
      `Printer tidak terdeteksi di interface \"${PRINTER_INTERFACE}\". Cek nama printer/port.`
    );
  }

  printer.raw(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  await printer.execute();
}

function getPrinterConfig() {
  return {
    interface: PRINTER_INTERFACE,
    storeTitle: STORE_TITLE,
    storeSubtitle: STORE_SUBTITLE,
    storeAddress: STORE_ADDRESS,
    storeWa: STORE_WA,
    hasStoreLogo: Boolean(STORE_LOGO_PATH && fs.existsSync(STORE_LOGO_PATH)),
    type: "EPSON/ESC-POS"
  };
}

async function printOrderReceipt(order) {
  const printer = createPrinter();

  const connected = await printer.isPrinterConnected();
  if (!connected) {
    throw new Error(
      `Printer tidak terdeteksi di interface "${PRINTER_INTERFACE}". Cek nama printer/port.`
    );
  }

  await printStoreHeader(printer);
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
  if (!QRIS_STATIC_CONTENT) {
    return { imageDataUrl: "", qrisContent: "" };
  }
  const dataUrl = await QRCode.toDataURL(QRIS_STATIC_CONTENT, {
    errorCorrectionLevel: "M",
    width: 256,
    margin: 2
  });
  return { imageDataUrl: dataUrl, qrisContent: QRIS_STATIC_CONTENT };
}

async function printQrisStatic(amountValue) {
  if (!QRIS_STATIC_CONTENT) {
    throw new Error("QRIS_STATIC_CONTENT belum diisi di .env");
  }

  // Generate QR code as temporary PNG file
  const tmpFile = path.join(os.tmpdir(), `qris-static-${Date.now()}.png`);
  await QRCode.toFile(tmpFile, QRIS_STATIC_CONTENT, {
    errorCorrectionLevel: "M",
    width: 200,
    margin: 2
  });

  try {
    const printer = createPrinter();
    const connected = await printer.isPrinterConnected();
    if (!connected) {
      throw new Error(`Printer tidak terdeteksi di interface "${PRINTER_INTERFACE}". Cek nama printer/port.`);
    }

    await printStoreHeader(printer);
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
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = {
  printReceipt,
  printOrderReceipt,
  printQrisStatic,
  openCashDrawer,
  getPrinterConfig,
  getQrisImageDataUrl
};
