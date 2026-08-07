const path = require("path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
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
  setDefaultPrinterInterface,
  getRuntimeConfig,
  getEnvPath,
  setEnvKey
} = require("./services/printer");
const {
  getTodayOrders,
  createOrder,
  returOrderItem,
  getOrderById,
  getTodayOrdersSummary,
  getOrdersByDateRange
} = require("./services/orderStorage");
const {
  generateQris,
  queryQris,
  makeExternalId
} = require("./services/dokuQris");
const { readCatalogFromAssets } = require("./services/catalogCsv");
const db = require("./services/dbConnection");
const accountAuth = require("./services/accountAuth");
const migration = require("./services/migration");
const licenseService = require("./services/licenseService");

let activeSessionUserId = null;
let hasCheckedLicenseAtStartup = false;

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

async function ensureLicenseAllowsWrite() {
  const licenseState = await licenseService.getLicenseState(app, {
    forceRefresh: !hasCheckedLicenseAtStartup
  });
  hasCheckedLicenseAtStartup = true;
  if (licenseState.isWriteEnabled) {
    return;
  }

  const contact = licenseState.developerContact || {};
  const contactBits = [];
  if (contact.email) contactBits.push(`Email: ${contact.email}`);
  if (contact.whatsapp) contactBits.push(`WhatsApp: ${contact.whatsapp}`);

  const baseMessage = licenseState.readOnlyMessage || "Lisensi aplikasi tidak aktif.";
  const reason = licenseState.reason ? ` ${licenseState.reason}` : "";
  const contactMsg = contactBits.length ? ` Hubungi developer: ${contactBits.join(" | ")}` : "";
  throw new Error(`${baseMessage}${reason}${contactMsg}`);
}

function createWindow() {
  // Use custom app icon from .env if set, otherwise bundled default
  const { nativeImage } = require("electron");
  const fs = require("fs");
  let resolvedIcon = app.isPackaged
    ? path.join(process.resourcesPath, "build", "icon.ico")
    : path.join(app.getAppPath(), "build", "icon.ico");

  try {
    const savedIconPath = getRuntimeConfig && getRuntimeConfig()?.appIconPath;
    if (savedIconPath && fs.existsSync(savedIconPath)) {
      resolvedIcon = savedIconPath;
    }
  } catch {}

  const windowIcon = nativeImage.createFromPath(resolvedIcon);

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 650,
    icon: windowIcon.isEmpty() ? undefined : windowIcon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.maximize();
  win.show();

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
async function runStartupSequence() {
  console.log("[POS] === Startup Sequence Begin ===");
  
  // 1. Run migrations
  console.log("[POS] Step 1: Running data migrations...");
  const migrationResult = migration.runMigrations(app);
  if (!migrationResult.success) {
    console.error("[POS] Migration failed:", migrationResult.error);
    const choice = dialog.showMessageBoxSync({
      type: "error",
      title: "Migration Error",
      message: "Gagal menjalankan pembaruan data aplikasi.",
      detail: migrationResult.error || "Unknown error",
      buttons: ["Keluar", "Coba Lagi"]
    });
    if (choice === 0) {
      app.quit();
      return false;
    }
    // Retry
    return await runStartupSequence();
  }
  if (migrationResult.migrated.length > 0) {
    console.log(`[POS] Migrated to versions: ${migrationResult.migrated.join(" -> ")}`);
  }
  
  // 2. Create backup (pre-startup)
  console.log("[POS] Step 2: Creating startup backup...");
  const backupResult = migration.createBackup(app, "startup");
  if (backupResult.success) {
    console.log(`[POS] Backup created: ${backupResult.backupPath}`);
  } else {
    console.warn(`[POS] Backup skipped: ${backupResult.error}`);
  }
  
  // 3. Initialize database
  console.log("[POS] Step 3: Initializing database...");
  await initializeDatabase();
  
  // 4. Validate critical data
  console.log("[POS] Step 4: Validating critical data...");
  const validationResult = validateCriticalData();
  if (!validationResult.valid) {
    console.warn("[POS] Validation warnings:", validationResult.warnings);
    if (validationResult.critical) {
      const choice = dialog.showMessageBoxSync({
        type: "warning",
        title: "Data Validation Failed",
        message: "Ada masalah dengan data aplikasi.",
        detail: validationResult.warnings.join("\n"),
        buttons: ["Keluar", "Lanjutkan Anyway"]
      });
      if (choice === 0) {
        app.quit();
        return false;
      }
    }
  }
  
  console.log("[POS] === Startup Sequence Complete ===");
  return true;
}

function validateCriticalData() {
  const warnings = [];
  const critical = false;
  
  try {
    // Check if accounts exist
    const accounts = accountAuth.listAccounts(app);
    if (!accounts || accounts.length === 0) {
      warnings.push("Sistem akun belum diinisialisasi. Silakan setup akun admin.");
    }
    
    // Check printer config
    const printerConfig = getPrinterConfig();
    if (!printerConfig) {
      warnings.push("Konfigurasi printer belum tersimpan. Buka tab Printer untuk setup.");
    }
    
    return {
      valid: warnings.length === 0,
      critical,
      warnings
    };
  } catch (err) {
    console.error("[Validation] Error:", err.message);
    return {
      valid: false,
      critical: true,
      warnings: ["Error saat validasi data: " + err.message]
    };
  }
}
app.whenReady().then(async () => {
  // Run startup sequence first (migrations, backups, validation)
  const startupOk = await runStartupSequence();
  if (!startupOk) {
    return; // Startup failed, app will quit
  }
  
  // Create main window
  createWindow();

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
  await ensureLicenseAllowsWrite();
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
      const { printerEnabled } = getRuntimeConfig();
      if (!printerEnabled) {
        printResult = { success: false, message: "Printer dinonaktifkan di pengaturan." };
      } else {
        await printReceipt(tx);
        printResult = {
          success: true,
          message: "Struk tercetak dan laci kas dibuka."
        };
      }
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

  const { printerEnabled } = getRuntimeConfig();
  if (!printerEnabled) {
    return { success: false, message: "Printer dinonaktifkan di pengaturan." };
  }

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

  const { drawerEnabled } = getRuntimeConfig();
  if (!drawerEnabled) {
    return { success: false, message: "Cash drawer dinonaktifkan di pengaturan." };
  }

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
  await ensureLicenseAllowsWrite();
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
    const { printerEnabled } = getRuntimeConfig();
    if (!printerEnabled) {
      printResult = { success: false, message: "Printer dinonaktifkan di pengaturan." };
    } else {
      await printOrderReceipt(order);
      printResult = { success: true, message: "Struk order tercetak." };
    }
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
  await ensureLicenseAllowsWrite();
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
  await ensureLicenseAllowsWrite();
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

ipcMain.handle("order:get-by-date-range", async (_, payload) => {
  ensurePermission("view_order");

  const { from, to } = payload || {};
  if (!from || !to) throw new Error("Tanggal dari/ke wajib diisi.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Format tanggal tidak valid (YYYY-MM-DD).");
  }
  if (from > to) throw new Error("Tanggal awal tidak boleh lebih besar dari tanggal akhir.");

  return getOrdersByDateRange(app, { from, to });
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
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_database");
  return db.testConnection(config);
});

ipcMain.handle("db:save-config", async (_, config) => {
  await ensureLicenseAllowsWrite();
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
  await ensureLicenseAllowsWrite();
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
  await ensureLicenseAllowsWrite();
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
  await ensureLicenseAllowsWrite();
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
  await ensureLicenseAllowsWrite();
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
  await ensureLicenseAllowsWrite();
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

// ── Backup & Migration IPC ──

ipcMain.handle("backup:create", async (_, reason = "manual") => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_database");
  const result = migration.createBackup(app, reason);
  return result;
});

ipcMain.handle("backup:list", async () => {
  ensurePermission("manage_database");
  
  const userData = app.getPath("userData");
  const backupDir = path.join(userData, "backups");
  const fs = require("fs");
  
  try {
    if (!fs.existsSync(backupDir)) {
      return { success: true, backups: [] };
    }
    
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("backup-") && f.endsWith(".json"))
      .sort()
      .reverse()
      .map(f => ({
        filename: f,
        path: path.join(backupDir, f),
        created: fs.statSync(path.join(backupDir, f)).mtime
      }));
    
    return { success: true, backups: files };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("backup:restore", async (_, backupPath) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_database");
  
  if (!backupPath || typeof backupPath !== "string") {
    return { success: false, error: "Invalid backup path" };
  }
  
  // Create pre-restore backup first
  const preRestoreBackup = migration.createBackup(app, "pre-restore");
  if (!preRestoreBackup.success) {
    return { success: false, error: "Failed to create pre-restore backup: " + preRestoreBackup.error };
  }
  
  const result = migration.restoreBackup(app, backupPath);
  if (result.success) {
    return {
      success: true,
      message: `Restored ${result.restored} files. Pre-restore backup: ${preRestoreBackup.backupPath}`,
      restored: result.restored
    };
  } else {
    return { success: false, error: result.error };
  }
});

ipcMain.handle("app:get-version", async () => {
  return {
    appVersion: app.getVersion(),
    dataVersion: migration.getDataVersion(app)
  };
});

// ── Store Settings IPC ──

ipcMain.handle("store:get-config", async () => {
  ensurePermission("manage_printer");
  const fs = require("fs");
  const cfg = getRuntimeConfig();
  const envPath = getEnvPath();
  return {
    storeTitle: cfg.storeTitle,
    storeSubtitle: cfg.storeSubtitle,
    storeAddress: cfg.storeAddress,
    storeWa: cfg.storeWa,
    storeLogoPath: cfg.storeLogoPath,
    printerCharWidth: cfg.printerCharWidth,
    qrisStaticContent: cfg.qrisStaticContent,
    envPath,
    hasLogo: Boolean(cfg.storeLogoPath && fs.existsSync(cfg.storeLogoPath)),
    printerEnabled: cfg.printerEnabled,
    drawerEnabled: cfg.drawerEnabled
  };
});

ipcMain.handle("store:save-config", async (_, payload) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_printer");
  const fieldMap = {
    storeTitle: "STORE_TITLE",
    storeSubtitle: "STORE_SUBTITLE",
    storeAddress: "STORE_ADDRESS",
    storeWa: "STORE_WA",
    printerCharWidth: "PRINTER_CHAR_WIDTH",
    qrisStaticContent: "QRIS_STATIC_CONTENT",
    storeLogoPath: "STORE_LOGO_PATH",
    printerEnabled: "PRINTER_ENABLED",
    drawerEnabled: "DRAWER_ENABLED"
  };
  for (const [field, envKey] of Object.entries(fieldMap)) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, field)) {
      setEnvKey(envKey, String(payload[field] ?? ""));
    }
  }
  return { success: true, envPath: getEnvPath() };
});

ipcMain.handle("store:pick-image", async () => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_printer");
  const result = await dialog.showOpenDialog({
    title: "Pilih Gambar Logo",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "bmp", "gif"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle("store:pick-icon", async () => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_printer");
  const result = await dialog.showOpenDialog({
    title: "Pilih Icon Aplikasi (.ico atau .png)",
    filters: [{ name: "Icons", extensions: ["ico", "png"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle("store:set-app-icon", async (_, iconPath) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_printer");
  const fs = require("fs");
  const { nativeImage } = require("electron");
  if (!iconPath || !fs.existsSync(iconPath)) {
    return { success: false, error: "File icon tidak ditemukan." };
  }
  try {
    const img = nativeImage.createFromPath(iconPath);
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) win.setIcon(img);
    setEnvKey("APP_ICON_PATH", iconPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("store:get-data-path", async () => {
  ensurePermission("manage_database");
  const { resolveDataDir } = require("./services/dataPath");
  return { dataPath: resolveDataDir(app) };
});

ipcMain.handle("store:set-data-path", async (_, newPath) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_database");
  if (!newPath || typeof newPath !== "string") {
    return { success: false, error: "Path tidak valid." };
  }
  const { resetDataDir } = require("./services/dataPath");
  setEnvKey("DATA_PATH", newPath);
  resetDataDir();
  return { success: true };
});

ipcMain.handle("store:pick-folder", async () => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_database");
  const result = await dialog.showOpenDialog({
    title: "Pilih Folder Data POS",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { canceled: false, folderPath: result.filePaths[0] };
});

ipcMain.handle("printer:get-toggle-config", async () => {
  ensurePermission("manage_printer");
  const cfg = getRuntimeConfig();
  return { printerEnabled: cfg.printerEnabled, drawerEnabled: cfg.drawerEnabled };
});

ipcMain.handle("printer:set-toggle-config", async (_, payload) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_printer");
  const { printerEnabled, drawerEnabled } = payload || {};
  if (typeof printerEnabled === "boolean") setEnvKey("PRINTER_ENABLED", String(printerEnabled));
  if (typeof drawerEnabled === "boolean") setEnvKey("DRAWER_ENABLED", String(drawerEnabled));
  return { success: true };
});

ipcMain.handle("qris:preview-content", async (_, content) => {
  if (!content || typeof content !== "string" || !content.trim()) {
    return { imageDataUrl: "", error: "Konten QRIS kosong." };
  }
  const QRCode = require("qrcode");
  try {
    const dataUrl = await QRCode.toDataURL(content.trim(), {
      errorCorrectionLevel: "M",
      width: 256,
      margin: 2
    });
    return { imageDataUrl: dataUrl };
  } catch (err) {
    return { imageDataUrl: "", error: err.message };
  }
});

// ── License IPC ──

ipcMain.handle("license:get-state", async () => {
  return licenseService.getLicenseState(app, { forceRefresh: true });
});

ipcMain.handle("license:activate", async (_, code) => {
  return licenseService.saveLicenseCode(app, code);
});

ipcMain.handle("license:set-readonly-message", async (_, message) => {
  return licenseService.saveReadOnlyMessage(app, message);
});

