import { useEffect, useState } from "react";

export default function PrinterSettings({ onApplied }) {
  const [printers, setPrinters] = useState([]);
  const [currentInterface, setCurrentInterface] = useState("");
  const [selectedInterface, setSelectedInterface] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const [printerEnabled, setPrinterEnabled] = useState(true);
  const [drawerEnabled, setDrawerEnabled] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [toggleStatus, setToggleStatus] = useState("");

  async function loadPrinters() {
    try {
      setLoading(true);
      setStatus("Memuat daftar printer...");
      const data = await window.posApi.listPrinters();
      setPrinters(data.printers || []);
      setCurrentInterface(data.current?.interface || "");
      setSelectedInterface(data.current?.interface || "");
      setStatus("Daftar printer siap.");
    } catch (err) {
      setStatus(`Gagal memuat printer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadToggleConfig() {
    try {
      const cfg = await window.posApi.getPrinterToggleConfig();
      setPrinterEnabled(cfg.printerEnabled !== false);
      setDrawerEnabled(cfg.drawerEnabled !== false);
    } catch {
      // ignore — defaults stay true
    }
  }

  useEffect(() => {
    loadPrinters().catch(() => {});
    loadToggleConfig().catch(() => {});
  }, []);

  async function applyDefaultPrinter() {
    if (!selectedInterface) {
      setStatus("Pilih printer terlebih dahulu.");
      return;
    }

    try {
      setLoading(true);
      const res = await window.posApi.setDefaultPrinter({
        printerInterface: selectedInterface
      });
      setCurrentInterface(res.current?.interface || selectedInterface);
      setStatus("Default printer berhasil disimpan ke .env.");
      onApplied?.(res.current);
    } catch (err) {
      setStatus(`Gagal menyimpan default printer: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveToggleConfig(nextPrinter, nextDrawer) {
    try {
      setToggleLoading(true);
      setToggleStatus("");
      await window.posApi.setPrinterToggleConfig({
        printerEnabled: nextPrinter,
        drawerEnabled: nextDrawer
      });
      setToggleStatus("Pengaturan disimpan.");
    } catch (err) {
      setToggleStatus(`Gagal menyimpan: ${err.message}`);
    } finally {
      setToggleLoading(false);
    }
  }

  function handlePrinterToggle(e) {
    const val = e.target.checked;
    setPrinterEnabled(val);
    // When printer is off, drawer must also be off
    const nextDrawer = val ? drawerEnabled : false;
    setDrawerEnabled(nextDrawer);
    saveToggleConfig(val, nextDrawer);
  }

  function handleDrawerToggle(e) {
    const val = e.target.checked;
    setDrawerEnabled(val);
    saveToggleConfig(printerEnabled, val);
  }

  return (
    <>
      <section className="panel printer-panel">
        <h2>Aktifkan / Nonaktifkan Fungsi</h2>
        <p className="small-text">
          Matikan printer atau cash drawer jika perangkat tidak terpasang. Pengaturan langsung disimpan ke <code>.env</code>.
        </p>

        <div className="toggle-rows">
          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Printer Thermal</span>
              <span className="toggle-desc">Cetak struk otomatis setelah transaksi / order</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={printerEnabled}
                onChange={handlePrinterToggle}
                disabled={toggleLoading}
              />
              <span className="toggle-slider" />
            </label>
            <span className={`toggle-badge ${printerEnabled ? "toggle-on" : "toggle-off"}`}>
              {printerEnabled ? "Aktif" : "Nonaktif"}
            </span>
          </div>

          <div className={`toggle-row ${!printerEnabled ? "toggle-row-disabled" : ""}`}>
            <div className="toggle-info">
              <span className="toggle-label">Cash Drawer</span>
              <span className="toggle-desc">Buka laci kas otomatis setelah transaksi tunai</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={drawerEnabled}
                onChange={handleDrawerToggle}
                disabled={toggleLoading || !printerEnabled}
              />
              <span className="toggle-slider" />
            </label>
            <span className={`toggle-badge ${drawerEnabled && printerEnabled ? "toggle-on" : "toggle-off"}`}>
              {drawerEnabled && printerEnabled ? "Aktif" : "Nonaktif"}
            </span>
          </div>
        </div>

        {toggleStatus && <div className="status" style={{ marginTop: 10 }}>{toggleStatus}</div>}
        {!printerEnabled && (
          <p className="small-text" style={{ color: "#b45309", marginTop: 8 }}>
            ⚠ Printer dinonaktifkan — struk tidak akan dicetak dan laci kas tidak akan terbuka.
          </p>
        )}
        {printerEnabled && !drawerEnabled && (
          <p className="small-text" style={{ color: "#b45309", marginTop: 8 }}>
            ⚠ Cash Drawer dinonaktifkan — struk tetap tercetak tapi laci kas tidak akan terbuka otomatis.
          </p>
        )}
      </section>

      <section className="panel printer-panel">
        <div className="printer-header-row">
          <h2>Konfigurasi Printer Thermal</h2>
          <button className="btn btn-secondary" onClick={loadPrinters} disabled={loading}>
            Refresh Printer List
          </button>
        </div>

        <p className="small-text">
          Pilih printer thermal default untuk cetak struk. Nilai akan disimpan ke file <code>.env</code> pada
          <code> PRINTER_INTERFACE</code>.
        </p>

        <div className="printer-current-box">
          <strong>Default saat ini:</strong> {currentInterface || "Belum diset"}
        </div>

        <label htmlFor="printerInterface">Pilih Printer</label>
        <select
          id="printerInterface"
          className="printer-select"
          value={selectedInterface}
          onChange={(e) => setSelectedInterface(e.target.value)}
          disabled={loading}
        >
          <option value="">-- Pilih printer --</option>
          {printers.map((p) => (
            <option key={p.interface} value={p.interface}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="printer-actions-row">
          <button className="btn btn-save" onClick={applyDefaultPrinter} disabled={loading || !selectedInterface}>
            Simpan Sebagai Default
          </button>
        </div>

        <div className="status">{status}</div>
        <p className="small-text">
          Jika struk masih ke printer lama, tutup lalu buka kembali aplikasi agar semua sesi printer memakai setting
          terbaru.
        </p>
      </section>
    </>
  );
}
