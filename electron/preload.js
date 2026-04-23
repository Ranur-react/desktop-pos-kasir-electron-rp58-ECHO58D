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

  // QRIS Statis
  getQrisImage: () => ipcRenderer.invoke("qris:image"),
  printQrisStatic: (payload) => ipcRenderer.invoke("qris:print", payload),

  // Catalog CSV
  getCatalog: () => ipcRenderer.invoke("catalog:get"),
  reloadCatalog: () => ipcRenderer.invoke("catalog:reload")
});
