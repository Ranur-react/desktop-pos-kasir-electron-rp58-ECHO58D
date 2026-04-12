const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posApi", {
  getBootstrap: () => ipcRenderer.invoke("pos:get-bootstrap"),
  addTransaction: (payload) => ipcRenderer.invoke("pos:add-transaction", payload),
  printLastReceipt: () => ipcRenderer.invoke("pos:print-last"),
  openDrawer: () => ipcRenderer.invoke("pos:open-drawer")
});
