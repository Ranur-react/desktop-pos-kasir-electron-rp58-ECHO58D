const fs = require("fs");
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
const orderStorage = require("./services/orderStorage");
const {
  getTodayOrders,
  createOrder,
  returOrderItem,
  getOrderById,
  getTodayOrdersSummary,
  getOrdersByDateRange,
  syncAllOrdersToDatabase
} = orderStorage;
const {
  generateQris,
  queryQris,
  makeExternalId
} = require("./services/dokuQris");
const { readCatalogFromAssets } = require("./services/catalogCsv");
const manualCatalog = require("./services/manualCatalog");
const db = require("./services/dbConnection");
const accountAuth = require("./services/accountAuth");
const migration = require("./services/migration");
const licenseService = require("./services/licenseService");
const apiService = require("./services/apiService");

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

  // 3b. Hydrate local stores from SQL when local files are empty
  if (db.isConnected()) {
    try {
      await accountAuth.hydrateFromDatabase(app);
      await manualCatalog.hydrateFromDatabase(app);
      // Keep SQL updated from local source when local has data.
      await accountAuth.syncStoreToDatabase(app);
      await manualCatalog.syncAppStoreToDatabase(app);
    } catch (err) {
      console.warn("[POS] Hydration/sync warning:", err.message);
    }
  }
  
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

  const {
    items,
    paymentMethod = "cash",
    cashGiven,
    qrisMeta,
    idpelanggan = 0,
    diskon = 0,
    customerName = "Pelanggan Umum",
    printAction = "hanya_cetak",
    bankAccount = null
  } = payload || {};

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Keranjang kosong.");
  }
  if (!["cash", "qris", "card", "hutang"].includes(paymentMethod)) {
    throw new Error("Metode pembayaran tidak valid.");
  }

  const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
  const totalBayar = Math.max(subtotal - Number(diskon || 0), 0);

  if (paymentMethod === "cash") {
    const cash = Number(cashGiven);
    if (!Number.isFinite(cash) || cash < totalBayar) {
      throw new Error("Uang cash kurang dari total belanja.");
    }
  }

  const sessionUser = getSessionUser();
  const order = await createOrder(app, {
    items,
    paymentMethod,
    cashGiven,
    qrisMeta: paymentMethod === "qris" ? (qrisMeta || { paid: true }) : null,
    idpelanggan,
    diskon,
    customerName,
    cashierName: sessionUser?.displayName || sessionUser?.username || "Kasir",
    printAction,
    bankAccount
  });

  let printResult = { success: false, message: "" };
  try {
    const { printerEnabled } = getRuntimeConfig();
    if (printAction === "tidak_cetak") {
      await openCashDrawer().catch(() => {});
      printResult = { success: true, message: "Transaksi berhasil (tanpa cetak struk)." };
    } else if (!printerEnabled) {
      printResult = { success: false, message: "Printer dinonaktifkan di pengaturan." };
    } else {
      await printOrderReceipt(order);
      printResult = { success: true, message: "Struk order berhasil dicetak dan laci kas dibuka." };
    }
  } catch (err) {
    printResult = { success: false, message: `Gagal cetak struk: ${err.message}` };
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
  const order = await returOrderItem(app, { orderId, lineId, reason });
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

ipcMain.handle("order:online-sync", async () => {
  await ensureLicenseAllowsWrite();
  ensurePermission("view_order");

  if (!db.isConnected()) {
    throw new Error("MySQL belum terhubung. Silakan aktifkan koneksi database terlebih dahulu.");
  }

  return syncAllOrdersToDatabase(app);
});

ipcMain.handle("catalog:get", async () => {
  ensurePermission("view_order");
  return readCatalogFromAssets(app, { forceReload: false });
});

ipcMain.handle("catalog:reload", async () => {
  ensurePermission("view_order");
  return readCatalogFromAssets(app, { forceReload: true });
});

ipcMain.handle("catalog:get-manual", async () => {
  ensurePermission("view_order");
  return manualCatalog.getManualCatalog(app);
});

ipcMain.handle("catalog:get-combined", async () => {
  ensurePermission("view_order");
  const csv = await readCatalogFromAssets(app, { forceReload: false });
  const manual = await manualCatalog.getManualCatalog(app);
  const products = [
    ...(manual.products || []).map((p) => ({ ...p, sourceType: "manual" })),
    ...(csv.products || []).map((p) => ({ ...p, sourceType: "csv" }))
  ];

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "id")
  );

  return {
    products,
    categories,
    sourceFilesCount: (csv.sourceFilesCount || 0) + 1,
    loadedAt: new Date().toISOString(),
    sourceDirectory: "manual+csv"
  };
});

ipcMain.handle("manual-product:list", async () => {
  ensurePermission("view_product");
  return manualCatalog.getManualCatalog(app);
});

ipcMain.handle("manual-product:create", async (_, payload) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_product");
  const product = await manualCatalog.createManualProduct(app, payload || {});
  return {
    success: true,
    message: "Produk manual berhasil ditambahkan.",
    product,
    catalog: await manualCatalog.getManualCatalog(app)
  };
});

ipcMain.handle("manual-product:update", async (_, payload) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_product");
  const product = await manualCatalog.updateManualProduct(app, payload || {});
  return {
    success: true,
    message: "Produk manual berhasil diperbarui.",
    product,
    catalog: await manualCatalog.getManualCatalog(app)
  };
});

ipcMain.handle("manual-product:delete", async (_, id) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_product");
  await manualCatalog.deleteManualProduct(app, id);
  return {
    success: true,
    message: "Produk manual berhasil dihapus.",
    catalog: await manualCatalog.getManualCatalog(app)
  };
});

ipcMain.handle("manual-product:delete-many", async (_, ids) => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_product");
  const result = await manualCatalog.deleteManyManualProducts(app, ids || []);
  return {
    success: true,
    message: `${result.deleted || 0} produk berhasil dihapus.`,
    deleted: result.deleted || 0,
    catalog: await manualCatalog.getManualCatalog(app)
  };
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
      try {
        await accountAuth.hydrateFromDatabase(app);
        await manualCatalog.hydrateFromDatabase(app);
        await accountAuth.syncStoreToDatabase(app);
        await manualCatalog.syncAppStoreToDatabase(app);
      } catch (syncErr) {
        console.warn("[POS] DB sync warning after save-config:", syncErr.message);
      }

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
  let loginSuccess = false;
  let isOnline = false;
  let message = "";
  let apiUser = null;
  let onlineError = "";

  // 1. Try online authentication with Web Server
  try {
    const apiRes = await apiService.login(app, payload?.username, payload?.password);
    if (apiRes && apiRes.status === "success" && apiRes.user) {
      isOnline = true;
      apiUser = apiRes.user;
      const roleMapped = (apiRes.user.role_id === 1 || apiRes.user.role_id === 2) ? "admin" : "cashier";
      const localAcc = accountAuth.upsertLocalUserFromApi(app, {
        id: `api-user-${apiRes.user.id}`,
        username: apiRes.user.username,
        displayName: apiRes.user.nama,
        password: payload?.password,
        role: roleMapped,
        branch: {
          id: apiRes.user.cabang_id,
          name: apiRes.user.cabang_nama
        }
      });
      activeSessionUserId = localAcc.id;
      loginSuccess = true;
      message = `Login berhasil (Online: ${apiRes.user.cabang_nama || "Cabang Utama"}).`;
    } else {
      onlineError = apiRes?.message || "Kredensial salah pada Web Server.";
    }
  } catch (apiErr) {
    onlineError = apiErr.message || "Koneksi ke Web Server gagal.";
    console.warn("[Auth] Online login failed:", onlineError);
  }

  // 2. If online login failed, handle offline / fallback
  if (!loginSuccess) {
    const serverConfig = apiService.getServerConfig(app);
    const hasServerConfigured = Boolean(serverConfig?.serverUrl);

    // If connected to API: ONLY allow local admin to login offline to disconnect / manage
    if (hasServerConfigured) {
      const isLocalAdmin = accountAuth.isLocalAdminCredentials(app, payload);
      if (isLocalAdmin) {
        const account = accountAuth.authenticate(app, payload);
        activeSessionUserId = account.id;
        loginSuccess = true;
        message = "Jaringan Web POS terputus. Login darurat sebagai Admin Lokal berhasil. Anda dapat memutuskan hubungan API di menu Server jika ingin kembali ke offline.";
      } else {
        throw new Error(
          onlineError.includes("Kredensial salah") 
            ? onlineError 
            : `Gagal terhubung ke Web Server: ${onlineError}. Kasir tidak dapat login saat jaringan terputus. Silakan hubungi Admin.`
        );
      }
    } else {
      // Standalone mode without server configured
      const account = accountAuth.authenticate(app, payload);
      activeSessionUserId = account.id;
      loginSuccess = true;
      message = "Login berhasil (Mode Standalone Offline).";
    }
  }

  return {
    success: true,
    mode: isOnline ? "online" : "offline",
    message,
    apiUser,
    state: accountAuth.buildAuthState(app, getSessionUser())
  };
});

ipcMain.handle("auth:logout", async () => {
  activeSessionUserId = null;
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    win.focus();
    win.webContents?.focus();
  }
  return {
    success: true,
    message: "Logout berhasil.",
    state: accountAuth.buildAuthState(app, null)
  };
});

ipcMain.handle("window:focus", async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win && !win.isFocused()) {
    win.focus();
  }
  return true;
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
    csvPath: cfg.csvPath,
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
    csvPath: "CSV_PATH",
    printerCharWidth: "PRINTER_CHAR_WIDTH",
    qrisStaticContent: "QRIS_STATIC_CONTENT",
    storeLogoPath: "STORE_LOGO_PATH",
    printerEnabled: "PRINTER_ENABLED",
    drawerEnabled: "DRAWER_ENABLED"
  };
  const normalized = {};
  for (const [field, envKey] of Object.entries(fieldMap)) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, field)) {
      const value = payload[field];
      normalized[field] = value;
      setEnvKey(envKey, String(value ?? ""));
    }
  }

  if (db.isConnected()) {
    const { syncStoreSettingsToDatabase } = require("./services/dbConnection");
    await syncStoreSettingsToDatabase(app, normalized);
  }

  return { success: true, envPath: getEnvPath() };
});

ipcMain.handle("store:sync-config", async () => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_printer");
  if (!db.isConnected()) {
    throw new Error("MySQL belum terhubung. Silakan aktifkan koneksi database terlebih dahulu.");
  }

  const { syncStoreSettingsToDatabase } = require("./services/dbConnection");
  const cfg = getRuntimeConfig();
  return syncStoreSettingsToDatabase(app, {
    storeTitle: cfg.storeTitle,
    storeSubtitle: cfg.storeSubtitle,
    storeAddress: cfg.storeAddress,
    storeWa: cfg.storeWa,
    csvPath: cfg.csvPath,
    storeLogoPath: cfg.storeLogoPath,
    printerCharWidth: cfg.printerCharWidth,
    qrisStaticContent: cfg.qrisStaticContent,
    printerEnabled: cfg.printerEnabled,
    drawerEnabled: cfg.drawerEnabled
  });
});

async function syncStoreConfigFromWeb(app, storeData) {
  if (!storeData) return { success: false, message: "Data profil toko tidak ditemukan dari Web POS." };

  const { setEnvKey, getRuntimeConfig } = require("./services/printer");
  const { resolveDataDir } = require("./services/dataPath");

  if (storeData.name) {
    setEnvKey("STORE_TITLE", storeData.name);
  }

  const subtitle = storeData.branch_name || storeData.subtitle || "";
  if (subtitle) {
    setEnvKey("STORE_SUBTITLE", subtitle);
  }

  if (storeData.address) {
    setEnvKey("STORE_ADDRESS", storeData.address);
  }

  if (storeData.phone) {
    setEnvKey("STORE_WA", storeData.phone);
  }

  if (storeData.printer_char_width) {
    setEnvKey("PRINTER_CHAR_WIDTH", String(storeData.printer_char_width));
  }

  // Download & sync 1:1 icon to local storage and STORE_LOGO_PATH
  const iconUrl = storeData.icon || storeData.icon_toko;
  let savedLogoPath = null;
  if (iconUrl) {
    try {
      const dataDir = resolveDataDir(app);
      const targetPath = path.join(dataDir, "store-icon-1x1.png");
      const res = await fetch(iconUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(targetPath, buffer);
        setEnvKey("STORE_LOGO_PATH", targetPath);
        savedLogoPath = targetPath;

        // Also mirror into assets folder if accessible
        try {
          const assetsDir = path.resolve(__dirname, "..", "assets");
          if (fs.existsSync(assetsDir)) {
            fs.writeFileSync(path.join(assetsDir, "store-icon-1x1.png"), buffer);
          }
        } catch {}
      }
    } catch (err) {
      console.warn("[POS] Gagal unduh icon 1:1 toko:", err.message);
    }
  }

  return {
    success: true,
    message: "Pengaturan Informasi Toko & Struk berhasil disinkronkan dari Web POS.",
    config: getRuntimeConfig(),
    logoPath: savedLogoPath
  };
}

ipcMain.handle("store:sync-web-config", async () => {
  await ensureLicenseAllowsWrite();
  ensurePermission("manage_printer");
  const bootstrapRes = await apiService.getBootstrap(app);
  if (!bootstrapRes || bootstrapRes.status !== "success" || !bootstrapRes.store) {
    throw new Error("Gagal mengambil konfigurasi toko dari server Web POS.");
  }
  return syncStoreConfigFromWeb(app, bootstrapRes.store);
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

ipcMain.handle("license:get-state", async (_, options = {}) => {
  const forceRefresh = Boolean(options && options.forceRefresh);
  return licenseService.getLicenseState(app, { forceRefresh });
});

ipcMain.handle("license:activate", async (_, code) => {
  return licenseService.saveLicenseCode(app, code);
});

ipcMain.handle("license:set-readonly-message", async (_, message) => {
  return licenseService.saveReadOnlyMessage(app, message);
});

// ── Server & Web POS API IPC ──

ipcMain.handle("server:get-config", async () => {
  return apiService.getServerConfig(app);
});

ipcMain.handle("server:save-config", async (_, newConfig) => {
  const updated = apiService.saveServerConfig(app, newConfig);
  return { success: true, config: updated };
});

ipcMain.handle("server:test-connection", async (_, url) => {
  return apiService.testConnection(app, url);
});

ipcMain.handle("server:disconnect", async () => {
  const cfg = apiService.disconnectServer(app);
  return { success: true, config: cfg, message: "Koneksi ke Server Web POS telah diputuskan. Mode offline aktif." };
});

ipcMain.handle("server:bootstrap", async () => {
  return apiService.getBootstrap(app);
});

ipcMain.handle("server:get-products", async (_, params) => {
  return apiService.getProducts(app, params);
});

ipcMain.handle("server:get-customers", async () => {
  return apiService.getCustomers(app);
});

ipcMain.handle("server:create-customer", async (_, payload) => {
  return apiService.createCustomer(app, payload);
});

ipcMain.handle("server:orders-list", async (_, params) => {
  return apiService.fetchServerOrders(app, params);
});

ipcMain.handle("server:sync-offline", async () => {
  return orderStorage.syncAllOrdersToDatabase(app);
});

ipcMain.handle("orders:clear-all", async () => {
  const { saveTransactions } = require("./services/storage");
  try {
    saveTransactions(app, []);
  } catch {}
  return orderStorage.clearAllOrders(app);
});

// Aliases for backward compatibility
ipcMain.handle("catalog:get-online", async (_, params) => apiService.getProducts(app, params));
ipcMain.handle("customers:get-online", async (_, search) => apiService.getCustomers(app, search));
ipcMain.handle("customers:create-online", async (_, payload) => apiService.createCustomer(app, payload));
ipcMain.handle("order:sync-offline", async () => orderStorage.syncAllOrdersToDatabase(app));


