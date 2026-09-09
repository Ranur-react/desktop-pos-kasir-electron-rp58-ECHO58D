const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posApi", {
  getBootstrap: () => ipcRenderer.invoke("pos:get-bootstrap"),
  addTransaction: (payload) => ipcRenderer.invoke("pos:add-transaction", payload),
  printLastReceipt: () => ipcRenderer.invoke("pos:print-last"),
  openDrawer: () => ipcRenderer.invoke("pos:open-drawer"),

  // Custom Order
  getOrders: () => ipcRenderer.invoke("order:get-today"),
  createOrder: (payload) => ipcRenderer.invoke("order:create", payload),
  returOrderItem: (payload) => ipcRenderer.invoke("order:retur", payload),
  getOrderById: (orderId) => ipcRenderer.invoke("order:get-by-id", orderId),
  getOrdersByDateRange: (payload) => ipcRenderer.invoke("order:get-by-date-range", payload),

  // QRIS Statis
  getQrisImage: () => ipcRenderer.invoke("qris:image"),
  printQrisStatic: (payload) => ipcRenderer.invoke("qris:print", payload),

  // Catalog CSV
  getCatalog: () => ipcRenderer.invoke("catalog:get"),
  reloadCatalog: () => ipcRenderer.invoke("catalog:reload"),
  getManualCatalog: () => ipcRenderer.invoke("catalog:get-manual"),
  getCombinedCatalog: () => ipcRenderer.invoke("catalog:get-combined"),

  // Manual Product Management
  listManualProducts: () => ipcRenderer.invoke("manual-product:list"),
  createManualProduct: (payload) => ipcRenderer.invoke("manual-product:create", payload),
  updateManualProduct: (payload) => ipcRenderer.invoke("manual-product:update", payload),
  deleteManualProduct: (id) => ipcRenderer.invoke("manual-product:delete", id),
  deleteManyManualProducts: (ids) => ipcRenderer.invoke("manual-product:delete-many", ids),

  // Web Hosting Server API
  getServerConfig: () => ipcRenderer.invoke("server:get-config"),
  saveServerConfig: (config) => ipcRenderer.invoke("server:save-config", config),
  testServerConnection: (serverUrl) => ipcRenderer.invoke("server:test-connection", serverUrl),
  getOnlineProducts: (params) => ipcRenderer.invoke("catalog:get-online", params),
  getOnlineCustomers: (search) => ipcRenderer.invoke("customers:get-online", search),
  createOnlineCustomer: (payload) => ipcRenderer.invoke("customers:create-online", payload),
  syncOfflineOrders: () => ipcRenderer.invoke("order:sync-offline"),
  getOnlineBootstrap: () => ipcRenderer.invoke("server:get-bootstrap"),

  // Database Configuration
  getDatabaseConfig: () => ipcRenderer.invoke("db:get-config"),
  testDatabaseConnection: (config) => ipcRenderer.invoke("db:test-connection", config),
  saveDatabaseConfig: (config) => ipcRenderer.invoke("db:save-config", config),
  clearDatabaseConfig: () => ipcRenderer.invoke("db:clear-config"),

  // Printer settings
  listPrinters: () => ipcRenderer.invoke("printer:list"),
  setDefaultPrinter: (payload) => ipcRenderer.invoke("printer:set-default", payload),
  getPrinterToggleConfig: () => ipcRenderer.invoke("printer:get-toggle-config"),
  setPrinterToggleConfig: (payload) => ipcRenderer.invoke("printer:set-toggle-config", payload),

  // Auth + Account Management
  getAuthState: () => ipcRenderer.invoke("auth:get-state"),
  setupInitialAccount: (payload) => ipcRenderer.invoke("auth:setup-initial", payload),
  login: (payload) => ipcRenderer.invoke("auth:login", payload),
  logout: () => ipcRenderer.invoke("auth:logout"),
  listAccounts: () => ipcRenderer.invoke("account:list"),
  createAccount: (payload) => ipcRenderer.invoke("account:create", payload),
  changeAccountRole: (payload) => ipcRenderer.invoke("account:change-role", payload),
  changeAccountPassword: (payload) => ipcRenderer.invoke("account:change-password", payload),

  // Backup & Migration (Admin/Database manager only)
  createBackup: (reason) => ipcRenderer.invoke("backup:create", reason),
  listBackups: () => ipcRenderer.invoke("backup:list"),
  restoreBackup: (backupPath) => ipcRenderer.invoke("backup:restore", backupPath),
  getVersion: () => ipcRenderer.invoke("app:get-version"),

  // Store Settings
  getStoreConfig: () => ipcRenderer.invoke("store:get-config"),
  saveStoreConfig: (payload) => ipcRenderer.invoke("store:save-config", payload),
  syncStoreConfig: () => ipcRenderer.invoke("store:sync-config"),
  onlineSyncTransactions: () => ipcRenderer.invoke("order:online-sync"),
  pickStoreImage: () => ipcRenderer.invoke("store:pick-image"),
  pickAppIcon: () => ipcRenderer.invoke("store:pick-icon"),
  setAppIcon: (iconPath) => ipcRenderer.invoke("store:set-app-icon", iconPath),
  getDataPath: () => ipcRenderer.invoke("store:get-data-path"),
  setDataPath: (newPath) => ipcRenderer.invoke("store:set-data-path", newPath),
  pickDataFolder: () => ipcRenderer.invoke("store:pick-folder"),
  previewQrisContent: (content) => ipcRenderer.invoke("qris:preview-content", content),

  // License
  getLicenseState: () => ipcRenderer.invoke("license:get-state"),
  activateLicense: (code) => ipcRenderer.invoke("license:activate", code),
  setLicenseReadOnlyMessage: (message) => ipcRenderer.invoke("license:set-readonly-message", message)
});
