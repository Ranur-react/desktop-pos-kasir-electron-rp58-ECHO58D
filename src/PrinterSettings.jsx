import { useEffect, useState } from "react";
import { BillPreview } from "./StoreSettings";

export default function PrinterSettings({ onApplied, onStoreApplied }) {
  const [activeTab, setActiveTab] = useState("all"); // "printer" | "receipt" | "all"

  // ── Printer hardware & driver states ──
  const [printers, setPrinters] = useState([]);
  const [currentInterface, setCurrentInterface] = useState("");
  const [selectedInterface, setSelectedInterface] = useState("");
  const [loading, setLoading] = useState(false);
  const [printerStatus, setPrinterStatus] = useState("");
  const [printerStatusType, setPrinterStatusType] = useState("ok");

  const [printerEnabled, setPrinterEnabled] = useState(true);
  const [drawerEnabled, setDrawerEnabled] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [toggleStatus, setToggleStatus] = useState("");

  // ── Store & receipt info states ──
  const [cfg, setCfg] = useState({
    storeTitle: "",
    storeSubtitle: "",
    storeAddress: "",
    storeWa: "",
    printerCharWidth: 32,
    storeLogoPath: "",
    hasLogo: false
  });
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeStatus, setStoreStatus] = useState("");
  const [storeStatusType, setStoreStatusType] = useState("ok");
  const [webSyncLoading, setWebSyncLoading] = useState(false);

  function showPrinterStatus(msg, type = "ok") {
    setPrinterStatus(msg);
    setPrinterStatusType(type);
    setTimeout(() => setPrinterStatus(""), 4000);
  }

  function showStoreStatus(msg, type = "ok") {
    setStoreStatus(msg);
    setStoreStatusType(type);
    setTimeout(() => setStoreStatus(""), 4000);
  }

  // ── Load printer list ──
  async function loadPrinters() {
    try {
      setLoading(true);
      showPrinterStatus("Memuat daftar printer...", "ok");
      const data = await window.posApi.listPrinters();
      setPrinters(data.printers || []);
      setCurrentInterface(data.current?.interface || "");
      setSelectedInterface(data.current?.interface || "");
      showPrinterStatus("Daftar printer siap.", "ok");
    } catch (err) {
      showPrinterStatus(`Gagal memuat printer: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  // ── Load toggle config ──
  async function loadToggleConfig() {
    try {
      const toggleCfg = await window.posApi.getPrinterToggleConfig();
      setPrinterEnabled(toggleCfg.printerEnabled !== false);
      setDrawerEnabled(toggleCfg.drawerEnabled !== false);
    } catch {
      // defaults stay true
    }
  }

  // ── Load store receipt config ──
  async function loadStoreConfig() {
    try {
      setStoreLoading(true);
      const data = await window.posApi.getStoreConfig();
      if (data) {
        setCfg({
          storeTitle: data.storeTitle || "",
          storeSubtitle: data.storeSubtitle || "",
          storeAddress: data.storeAddress || "",
          storeWa: data.storeWa || "",
          printerCharWidth: Number(data.printerCharWidth) || 32,
          storeLogoPath: data.storeLogoPath || "",
          hasLogo: Boolean(data.hasLogo)
        });
      }
    } catch (err) {
      showStoreStatus(`Gagal memuat informasi toko: ${err.message}`, "err");
    } finally {
      setStoreLoading(false);
    }
  }

  useEffect(() => {
    loadPrinters().catch(() => {});
    loadToggleConfig().catch(() => {});
    loadStoreConfig().catch(() => {});
  }, []);

  // ── Set default printer ──
  async function applyDefaultPrinter() {
    if (!selectedInterface) {
      showPrinterStatus("Pilih printer terlebih dahulu.", "err");
      return;
    }

    try {
      setLoading(true);
      const res = await window.posApi.setDefaultPrinter({
        printerInterface: selectedInterface
      });
      setCurrentInterface(res.current?.interface || selectedInterface);
      showPrinterStatus("Default printer berhasil disimpan ke .env.", "ok");
      onApplied?.(res.current);
    } catch (err) {
      showPrinterStatus(`Gagal menyimpan default printer: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  // ── Save toggle config ──
  async function saveToggleConfig(nextPrinter, nextDrawer) {
    try {
      setToggleLoading(true);
      setToggleStatus("");
      await window.posApi.setPrinterToggleConfig({
        printerEnabled: nextPrinter,
        drawerEnabled: nextDrawer
      });
      setToggleStatus("Pengaturan perangkat disimpan.");
      setTimeout(() => setToggleStatus(""), 3000);
    } catch (err) {
      setToggleStatus(`Gagal menyimpan: ${err.message}`);
    } finally {
      setToggleLoading(false);
    }
  }

  function handlePrinterToggle(e) {
    const val = e.target.checked;
    setPrinterEnabled(val);
    const nextDrawer = val ? drawerEnabled : false;
    setDrawerEnabled(nextDrawer);
    saveToggleConfig(val, nextDrawer);
  }

  function handleDrawerToggle(e) {
    const val = e.target.checked;
    setDrawerEnabled(val);
    saveToggleConfig(printerEnabled, val);
  }

  // ── Handle store form change ──
  function handleStoreChange(field, value) {
    setCfg((prev) => ({ ...prev, [field]: value }));
  }

  // ── Save store info ──
  async function saveStoreInfo() {
    setStoreLoading(true);
    try {
      await window.posApi.saveStoreConfig({
        storeTitle: cfg.storeTitle,
        storeSubtitle: cfg.storeSubtitle,
        storeAddress: cfg.storeAddress,
        storeWa: cfg.storeWa,
        printerCharWidth: cfg.printerCharWidth,
        storeLogoPath: cfg.storeLogoPath
      });
      showStoreStatus("✓ Informasi toko & struk berhasil disimpan ke .env.", "ok");
      onStoreApplied?.();
    } catch (err) {
      showStoreStatus(`Gagal menyimpan info toko: ${err.message}`, "err");
    } finally {
      setStoreLoading(false);
    }
  }

  // ── Sync from Web POS ──
  async function syncFromWeb() {
    setWebSyncLoading(true);
    try {
      const res = await window.posApi.syncStoreWebConfig();
      if (res && res.success) {
        showStoreStatus("✓ " + res.message, "ok");
        await loadStoreConfig();
        onStoreApplied?.();
      } else {
        showStoreStatus("Gagal: " + (res?.message || "Unknown error"), "err");
      }
    } catch (err) {
      showStoreStatus(`Gagal sinkron dari Web POS: ${err.message}`, "err");
    } finally {
      setWebSyncLoading(false);
    }
  }

  return (
    <div className="printer-settings-container" style={{ display: "grid", gap: "16px" }}>
      {/* ── Sub-navigation Tabs ── */}
      <div className="store-settings-tabs" style={{ marginBottom: "4px" }}>
        <button
          type="button"
          className={`store-tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          📋 Semua Pengaturan
        </button>
        <button
          type="button"
          className={`store-tab-btn ${activeTab === "printer" ? "active" : ""}`}
          onClick={() => setActiveTab("printer")}
        >
          🖨️ Driver &amp; Perangkat Printer
        </button>
        <button
          type="button"
          className={`store-tab-btn ${activeTab === "receipt" ? "active" : ""}`}
          onClick={() => setActiveTab("receipt")}
        >
          🧾 Informasi Toko &amp; Tampilan Struk
        </button>
      </div>

      {/* ────────────────────────────────────────────────────────── */}
      {/* 1. SECTION: PERANGKAT & DRIVER PRINTER                    */}
      {/* ────────────────────────────────────────────────────────── */}
      {(activeTab === "all" || activeTab === "printer") && (
        <>
          <section className="panel printer-panel">
            <h2>Aktifkan / Nonaktifkan Fungsi</h2>
            <p className="small-text">
              Matikan fungsi printer thermal atau laci kas jika perangkat tidak terpasang pada komputer kasir ini.
            </p>

            <div className="toggle-rows">
              <div className="toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">Printer Thermal</span>
                  <span className="toggle-desc">Cetak struk otomatis setiap transaksi selesai</span>
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
                  <span className="toggle-label">Cash Drawer (Laci Kasir)</span>
                  <span className="toggle-desc">Buka laci kasir otomatis saat menerima pembayaran tunai</span>
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
                ⚠ Printer dinonaktifkan — struk tidak akan dicetak dan laci kas tidak akan terbuka otomatis.
              </p>
            )}
            {printerEnabled && !drawerEnabled && (
              <p className="small-text" style={{ color: "#b45309", marginTop: 8 }}>
                ⚠ Cash Drawer dinonaktifkan — struk tetap tercetak tapi laci kas tidak terbuka otomatis.
              </p>
            )}
          </section>

          <section className="panel printer-panel">
            <div className="printer-header-row">
              <h2>Pilihan Driver Printer Thermal</h2>
              <button className="btn btn-secondary" onClick={loadPrinters} disabled={loading}>
                🔄 Refresh Daftar Printer
              </button>
            </div>

            <p className="small-text">
              Pilih printer thermal yang tersambung untuk mencetak struk transaksi kasir.
            </p>

            <div className="printer-current-box">
              <strong>Printer Default Saat Ini:</strong>{" "}
              <span className="mono" style={{ fontWeight: 700, color: currentInterface ? "#1d4ed8" : "#dc2626" }}>
                {currentInterface || "Belum diset"}
              </span>
            </div>

            <label htmlFor="printerInterface">Pilih Printer dari Sistem:</label>
            <select
              id="printerInterface"
              className="printer-select"
              value={selectedInterface}
              onChange={(e) => setSelectedInterface(e.target.value)}
              disabled={loading}
            >
              <option value="">-- Pilih printer thermal --</option>
              {printers.map((p) => (
                <option key={p.interface} value={p.interface}>
                  {p.name}
                </option>
              ))}
            </select>

            <div className="printer-actions-row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-save"
                onClick={applyDefaultPrinter}
                disabled={loading || !selectedInterface}
              >
                Simpan Sebagai Default Printer
              </button>
            </div>

            {printerStatus && (
              <div
                className={`status ${printerStatusType === "err" ? "status-error" : ""}`}
                style={{ marginTop: 10 }}
              >
                {printerStatus}
              </div>
            )}
          </section>
        </>
      )}

      {/* ────────────────────────────────────────────────────────── */}
      {/* 2. SECTION: INFORMASI TOKO & TAMPILAN STRUK               */}
      {/* ────────────────────────────────────────────────────────── */}
      {(activeTab === "all" || activeTab === "receipt") && (
        <section className="panel printer-panel">
          <div className="printer-header-row">
            <div>
              <h2>Informasi Toko &amp; Tampilan Struk</h2>
              <p className="small-text" style={{ margin: 0 }}>
                Pengaturan teks header, nama cabang, alamat, dan lebar kertas yang dicetak pada struk thermal.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={syncFromWeb}
              disabled={storeLoading || webSyncLoading}
              style={{ borderColor: "#0d9488", color: "#0d9488", fontWeight: 700 }}
              title="Ambil Nama Toko, Nama Cabang, Alamat, No WA, dan Lebar Kertas dari Web POS"
            >
              {webSyncLoading ? "Menyinkronkan..." : "🔄 Sinkronkan Pengaturan dari Web POS"}
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "24px",
              alignItems: "start",
              marginTop: "12px"
            }}
          >
            {/* Form Input Informasi Struk */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="database-form-group">
                <label>Nama Toko (Header Struk)</label>
                <input
                  value={cfg.storeTitle}
                  onChange={(e) => handleStoreChange("storeTitle", e.target.value)}
                  placeholder="Contoh: Atikah Jaya"
                  disabled={storeLoading}
                />
              </div>

              <div className="database-form-group">
                <label>Subtitle / Tagline / Nama Cabang</label>
                <input
                  value={cfg.storeSubtitle}
                  onChange={(e) => handleStoreChange("storeSubtitle", e.target.value)}
                  placeholder="Contoh: BRI-Link Sabana Minang"
                  disabled={storeLoading}
                />
                <span className="small-text">Otomatis terisi nama cabang saat disinkronkan dari Web POS.</span>
              </div>

              <div className="database-form-group">
                <label>Alamat Toko / Cabang</label>
                <input
                  value={cfg.storeAddress}
                  onChange={(e) => handleStoreChange("storeAddress", e.target.value)}
                  placeholder="Contoh: Jl. Merdeka No. 10"
                  disabled={storeLoading}
                />
              </div>

              <div className="database-form-group">
                <label>No. WhatsApp / Kontak Struk</label>
                <input
                  value={cfg.storeWa}
                  onChange={(e) => handleStoreChange("storeWa", e.target.value)}
                  placeholder="Contoh: 0812-3456-7890"
                  disabled={storeLoading}
                />
              </div>

              <div className="database-form-group">
                <label>Lebar Kertas Struk (Karakter per Baris)</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="number"
                    min="20"
                    max="80"
                    value={cfg.printerCharWidth}
                    onChange={(e) => handleStoreChange("printerCharWidth", Number(e.target.value))}
                    disabled={storeLoading}
                    style={{ width: "120px" }}
                  />
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      className={`btn btn-secondary ${cfg.printerCharWidth === 32 ? "btn-save" : ""}`}
                      style={{ padding: "5px 10px", fontSize: "0.82rem" }}
                      onClick={() => handleStoreChange("printerCharWidth", 32)}
                    >
                      58mm (32 Kolom)
                    </button>
                    <button
                      type="button"
                      className={`btn btn-secondary ${cfg.printerCharWidth === 48 ? "btn-save" : ""}`}
                      style={{ padding: "5px 10px", fontSize: "0.82rem" }}
                      onClick={() => handleStoreChange("printerCharWidth", 48)}
                    >
                      80mm (48 Kolom)
                    </button>
                  </div>
                </div>
                <span className="small-text">Standar kertas thermal: 58mm = 32 karakter &bull; 80mm = 48 karakter</span>
              </div>

              <div className="store-actions-row" style={{ marginTop: "8px" }}>
                <button
                  type="button"
                  className="btn btn-save"
                  onClick={saveStoreInfo}
                  disabled={storeLoading || webSyncLoading}
                >
                  {storeLoading ? "Menyimpan..." : "Simpan Pengaturan Struk"}
                </button>
              </div>

              {storeStatus && (
                <div
                  className={`status ${storeStatusType === "err" ? "status-error" : ""}`}
                  style={{ marginTop: 6 }}
                >
                  {storeStatus}
                </div>
              )}
            </div>

            {/* Live Preview Tampilan Struk */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center"
              }}
            >
              <div style={{ width: "100%", marginBottom: "10px", textAlign: "center" }}>
                <h4 style={{ margin: "0 0 4px 0", color: "#334155" }}>
                  👁️ Simulasi Tampilan Struk
                </h4>
                <span className="small-text">
                  Format realtime: lebar kertas {cfg.printerCharWidth || 32} kolom
                </span>
              </div>

              <BillPreview cfg={cfg} charWidth={cfg.printerCharWidth} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
