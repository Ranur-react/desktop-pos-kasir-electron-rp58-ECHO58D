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
const accountAuth = require("./services/accountAuth");

let activeSessionUserId = null;

function getSessionUser() {
  if (!activeSessionUserId) return null;
  return accountAuth.getAccountById(app, activeSessionUserId);
}

function ensurePermission(permission) {
  if (!accountAuth.isAuthEnabled(app)) {
    return;
  }

  const sessionUser = getSessionUser();
  if (!sessionUser) {
    throw new Error("Silakan login terlebih dahulu.");
  }

  if (!accountAuth.hasPermission(sessionUser, permission)) {
    throw new Error("Akses ditolak. Role akun tidak memiliki izin untuk fitur ini.");
  }
}

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
    if (!config || !config.host || !config.user || !config.database) return;

    const result = await db.initializeConnection(app, config);
    if (result.success) {
      console.log("[POS] Database MySQL terhubung.");
    } else {
      console.warn("[POS] Koneksi database dilewati (MySQL tidak aktif atau config salah):", result.error);
    }
  } catch (err) {
    // Tidak crash — MySQL bersifat opsional, JSON tetap jadi database utama
    console.warn("[POS] Koneksi database dilewati:", err.code || err.message);
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
  ensurePermission("view_kasir");

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
  ensurePermission("create_transaction");

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
  ensurePermission("print_receipt");

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
  ensurePermission("open_drawer");

  await openCashDrawer();
  return {
    success: true,
    message: "Perintah buka laci kas berhasil dikirim."
  };
});

// ── Custom Order IPC ──

ipcMain.handle("order:get-today", async () => {
  ensurePermission("view_order");

  return {
    orders: await getTodayOrders(app),
    summary: await getTodayOrdersSummary(app)
  };
});

ipcMain.handle("order:create", async (_, payload) => {
  ensurePermission("create_order");

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
  ensurePermission("create_order");
  return getQrisImageDataUrl();
});

ipcMain.handle("qris:print", async (_, payload) => {
  ensurePermission("create_order");

  const { amount } = payload || {};
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    throw new Error("Nominal QRIS tidak valid.");
  }
  await printQrisStatic(amountNumber);
  return { success: true, message: "QRIS tercetak." };
});

ipcMain.handle("order:retur", async (_, payload) => {
  ensurePermission("retur_order");

  const { orderId, lineId, reason } = payload || {};
  const order = returOrderItem(app, { orderId, lineId, reason });
  return {
    order,
    orders: await getTodayOrders(app),
    summary: await getTodayOrdersSummary(app)
  };
});

ipcMain.handle("order:get-by-id", async (_, orderId) => {
  ensurePermission("view_order");

  const order = await getOrderById(app, orderId);
  if (!order) throw new Error("Order tidak ditemukan.");
  return order;
});

ipcMain.handle("catalog:get", async () => {
  ensurePermission("view_order");
  return readCatalogFromAssets(app, { forceReload: false });
});

ipcMain.handle("catalog:reload", async () => {
  ensurePermission("view_order");
  return readCatalogFromAssets(app, { forceReload: true });
});

// ── Database Configuration IPC ──

ipcMain.handle("db:get-config", async () => {
  ensurePermission("view_database");

  const config = db.loadConfigFromFile(app);
  return {
    config,
    isConnected: db.isConnected()
  };
});

ipcMain.handle("db:test-connection", async (_, config) => {
  ensurePermission("manage_database");
  return db.testConnection(config);
});

ipcMain.handle("db:save-config", async (_, config) => {
  ensurePermission("manage_database");

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
  ensurePermission("manage_database");

  try {
    await db.closeConnection();
    db.deleteConfigFile(app);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("printer:list", async () => {
  ensurePermission("view_printer");

  return {
    current: getPrinterConfig(),
    printers: listAvailablePrinters()
  };
});

ipcMain.handle("printer:set-default", async (_, payload) => {
  ensurePermission("manage_printer");

  const printerInterface = payload?.printerInterface;
  const current = setDefaultPrinterInterface(printerInterface);
  return {
    success: true,
    message: "Default printer berhasil disimpan.",
    current
  };
});

// ── Account Auth IPC ──

ipcMain.handle("auth:get-state", async () => {
  return accountAuth.buildAuthState(app, getSessionUser());
});

ipcMain.handle("auth:setup-initial", async (_, payload) => {
  const account = accountAuth.setupInitialAccount(app, payload);
  activeSessionUserId = account.id;

  return {
    success: true,
    message: "Akun awal berhasil dibuat.",
    state: accountAuth.buildAuthState(app, getSessionUser())
  };
});

ipcMain.handle("auth:login", async (_, payload) => {
  const account = accountAuth.authenticate(app, payload);
  activeSessionUserId = account.id;

  return {
    success: true,
    message: "Login berhasil.",
    state: accountAuth.buildAuthState(app, getSessionUser())
  };
});

ipcMain.handle("auth:logout", async () => {
  activeSessionUserId = null;
  return {
    success: true,
    message: "Logout berhasil.",
    state: accountAuth.buildAuthState(app, null)
  };
});

ipcMain.handle("account:list", async () => {
  ensurePermission("manage_accounts");
  return {
    accounts: accountAuth.listAccounts(app),
    roles: accountAuth.listRoleOptions()
  };
});

ipcMain.handle("account:create", async (_, payload) => {
  ensurePermission("manage_accounts");

  const account = accountAuth.createAccount(app, payload);
  return {
    success: true,
    message: "Akun berhasil ditambahkan.",
    account,
    accounts: accountAuth.listAccounts(app)
  };
});

ipcMain.handle("account:change-role", async (_, payload) => {
  ensurePermission("manage_accounts");

  const account = accountAuth.changeRole(app, {
    targetAccountId: payload?.accountId,
    role: payload?.role
  });

  return {
    success: true,
    message: "Role akun berhasil diubah.",
    account,
    accounts: accountAuth.listAccounts(app),
    state: accountAuth.buildAuthState(app, getSessionUser())
  };
});

ipcMain.handle("account:change-password", async (_, payload) => {
  const actor = getSessionUser();
  if (!actor) {
    throw new Error("Silakan login terlebih dahulu.");
  }

  const targetAccountId = payload?.accountId || actor.id;
  const account = accountAuth.changePassword(app, {
    actorAccount: actor,
    targetAccountId,
    currentPassword: payload?.currentPassword,
    newPassword: payload?.newPassword
  });

  return {
    success: true,
    message: "Password berhasil diperbarui.",
    account
  };
});
