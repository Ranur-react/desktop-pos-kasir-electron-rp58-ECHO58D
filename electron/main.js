const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const {
  getTodayTransactions,
  addTransaction,
  getTodaySummary,
  getLatestTransaction
} = require("./services/storage");
const {
  printReceipt,
  printOrderReceipt,
  printQrisSlip,
  printQrisStatic,
  openCashDrawer,
  getPrinterConfig,
  getQrisImageDataUrl,
  listAvailablePrinters,
  setDefaultPrinterInterface
} = require("./services/printer");
const {
  getTodayOrders,
  createOrder,
  returOrderItem,
  getOrderById,
  getTodayOrdersSummary
} = require("./services/orderStorage");
const {
  generateQris,
  queryQris,
  makeExternalId
} = require("./services/dokuQris");
const { readCatalogFromAssets } = require("./services/catalogCsv");
const db = require("./services/dbConnection");

function createWindow() {
  const windowIcon = app.isPackaged
    ? undefined
    : path.join(app.getAppPath(), "build", "icon.ico");

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 650,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!app.isPackaged && process.env.ELECTRON_START_URL) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

async function initializeDatabase() {
  try {
    const config = db.loadConfigFromFile(app);
    if (config && config.host && config.user && config.database) {
      const result = await db.initializeConnection(app, config);
      if (result.success) {
        console.log("Database connected successfully");
      } else {
        console.warn("Failed to initialize database:", result.error);
      }
    }
  } catch (err) {
    console.error("Error initializing database:", err);
  }
}

app.whenReady().then(() => {
  createWindow();

  // Initialize database if configured
  initializeDatabase();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("pos:get-bootstrap", async () => {
  const transactions = await getTodayTransactions(app);
  const summary = await getTodaySummary(app);
  const printer = getPrinterConfig();

  return {
    transactions,
    summary,
    printer
  };
});

ipcMain.handle("pos:add-transaction", async (_, payload) => {
  const { type, nominal, description, autoPrint = true } = payload || {};

  if (!["in", "out"].includes(type)) {
    throw new Error("Tipe transaksi tidak valid.");
  }

  const nominalNumber = Number(nominal);
  if (!Number.isFinite(nominalNumber) || nominalNumber <= 0) {
    throw new Error("Nominal harus lebih dari 0.");
  }

  const tx = addTransaction(app, {
    type,
    nominal: nominalNumber,
    description: (description || "").trim()
  });

  let printResult = {
    success: false,
    message: "Auto print dinonaktifkan."
  };

  if (autoPrint) {
    try {
      await printReceipt(tx);
      printResult = {
        success: true,
        message: "Struk tercetak dan laci kas dibuka."
      };
    } catch (error) {
      printResult = {
        success: false,
        message: error.message
      };
    }
  }

  return {
    transaction: tx,
    transactions: await getTodayTransactions(app),
    summary: await getTodaySummary(app),
    printResult
  };
});

ipcMain.handle("pos:print-last", async () => {
  const latest = await getLatestTransaction(app);
  if (!latest) {
    throw new Error("Belum ada transaksi hari ini untuk dicetak.");
  }

  await printReceipt(latest);
  return {
    success: true,
    message: "Struk transaksi terakhir tercetak dan laci kas dibuka.",
    transaction: latest
  };
});

ipcMain.handle("pos:open-drawer", async () => {
  await openCashDrawer();
  return {
    success: true,
    message: "Perintah buka laci kas berhasil dikirim."
  };
});

// ── Custom Order IPC ──

ipcMain.handle("order:get-today", async () => {
  return {
    orders: await getTodayOrders(app),
    summary: await getTodayOrdersSummary(app)
  };
});

ipcMain.handle("order:create", async (_, payload) => {
  const { items, paymentMethod, cashGiven, qrisMeta } = payload || {};

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Keranjang kosong.");
  }
  if (!["cash", "qris"].includes(paymentMethod)) {
    throw new Error("Metode pembayaran tidak valid.");
  }

  const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
  if (paymentMethod === "cash") {
    const cash = Number(cashGiven);
    if (!Number.isFinite(cash) || cash < subtotal) {
      throw new Error("Uang cash kurang dari total belanja.");
    }
  } else {
    if (!qrisMeta?.paid) {
      throw new Error("Pembayaran QRIS belum dikonfirmasi.");
    }
  }

  const order = createOrder(app, {
    items,
    paymentMethod,
    cashGiven,
    qrisMeta: paymentMethod === "qris"
      ? { paid: true }
      : null
  });

  let printResult = { success: false, message: "" };
  try {
    await printOrderReceipt(order);
    printResult = { success: true, message: "Struk order tercetak." };
  } catch (err) {
    printResult = { success: false, message: err.message };
  }

  return {
    order,
    orders: await getTodayOrders(app),
    summary: await getTodayOrdersSummary(app),
    printResult
  };
});

ipcMain.handle("qris:image", async () => {
  return getQrisImageDataUrl();
});

ipcMain.handle("qris:print", async (_, payload) => {
  const { amount } = payload || {};
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    throw new Error("Nominal QRIS tidak valid.");
  }
  await printQrisStatic(amountNumber);
  return { success: true, message: "QRIS tercetak." };
});

ipcMain.handle("order:retur", async (_, payload) => {
  const { orderId, lineId, reason } = payload || {};
  const order = returOrderItem(app, { orderId, lineId, reason });
  return {
    order,
    orders: await getTodayOrders(app),
    summary: await getTodayOrdersSummary(app)
  };
});

ipcMain.handle("order:get-by-id", async (_, orderId) => {
  const order = await getOrderById(app, orderId);
  if (!order) throw new Error("Order tidak ditemukan.");
  return order;
});

ipcMain.handle("catalog:get", async () => {
  return readCatalogFromAssets(app, { forceReload: false });
});

ipcMain.handle("catalog:reload", async () => {
  return readCatalogFromAssets(app, { forceReload: true });
});

// ── Database Configuration IPC ──

ipcMain.handle("db:get-config", async () => {
  const config = db.loadConfigFromFile(app);
  return {
    config,
    isConnected: db.isConnected()
  };
});

ipcMain.handle("db:test-connection", async (_, config) => {
  return db.testConnection(config);
});

ipcMain.handle("db:save-config", async (_, config) => {
  try {
    // Save config to file
    db.saveConfigToFile(app, config);
    
    // Initialize connection
    const result = await db.initializeConnection(app, config);
    
    if (result.success) {
      return {
        success: true,
        config,
        isConnected: true
      };
    } else {
      return {
        success: false,
        error: result.error
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle("db:clear-config", async () => {
  try {
    await db.closeConnection();
    db.deleteConfigFile(app);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("printer:list", async () => {
  return {
    current: getPrinterConfig(),
    printers: listAvailablePrinters()
  };
});

ipcMain.handle("printer:set-default", async (_, payload) => {
  const printerInterface = payload?.printerInterface;
  const current = setDefaultPrinterInterface(printerInterface);
  return {
    success: true,
    message: "Default printer berhasil disimpan.",
    current
  };
});
