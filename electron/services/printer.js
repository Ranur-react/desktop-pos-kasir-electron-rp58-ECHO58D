const { printer: ThermalPrinter, types: PrinterTypes } = require("node-thermal-printer");

const PRINTER_INTERFACE = process.env.PRINTER_INTERFACE || "printer:RP58 Printer";
const STORE_NAME = process.env.STORE_NAME || "TOKO ANDA";

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

  printer.alignCenter();
  printer.bold(true);
  printer.println(STORE_NAME);
  printer.bold(false);
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
    storeName: STORE_NAME,
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

  printer.alignCenter();
  printer.bold(true);
  printer.println(STORE_NAME);
  printer.bold(false);
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

module.exports = {
  printReceipt,
  printOrderReceipt,
  openCashDrawer,
  getPrinterConfig
};
