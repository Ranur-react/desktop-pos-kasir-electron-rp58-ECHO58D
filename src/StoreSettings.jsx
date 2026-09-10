import { useEffect, useRef, useState } from "react";

const DEFAULT_CHAR_WIDTH = 32;

function BillPreview({ cfg, charWidth }) {
  const w = Math.max(20, Math.min(80, Number(charWidth) || DEFAULT_CHAR_WIDTH));

  function line(char = "-") {
    return char.repeat(w);
  }

  function padBetween(left, right) {
    const gap = w - left.length - right.length;
    return left + " ".repeat(Math.max(1, gap)) + right;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("id-ID", { dateStyle: "medium" });
  const timeStr = now.toLocaleTimeString("id-ID", { timeStyle: "short" });

  const rows = [];

  // Logo placeholder
  if (cfg.storeLogoPath && cfg.hasLogo) {
    rows.push({ type: "logo" });
  }

  // Header
  rows.push({ type: "bold", text: cfg.storeTitle || "Nama Toko" });
  if (cfg.storeSubtitle) rows.push({ type: "text", text: cfg.storeSubtitle });
  if (cfg.storeAddress || cfg.storeWa) {
    const addrLine = cfg.storeWa
      ? `${cfg.storeAddress || ""}${cfg.storeAddress ? " | " : ""}WA: ${cfg.storeWa}`
      : cfg.storeAddress;
    rows.push({ type: "small", text: addrLine });
  }
  rows.push({ type: "text", text: "" });

  rows.push({ type: "title", text: "Struk Pembayaran" });
  rows.push({ type: "divider" });

  rows.push({ type: "text", text: `Order  : ORD-DEMO-0001` });
  rows.push({ type: "text", text: `Waktu  : ${dateStr} ${timeStr}` });
  rows.push({ type: "text", text: `Bayar  : CASH` });
  rows.push({ type: "divider" });

  const items = [
    { title: "Contoh Produk A", qty: 2, price: 15000, lineTotal: 30000 },
    { title: "Contoh Produk B", qty: 1, price: 25000, lineTotal: 25000 }
  ];
  for (const item of items) {
    rows.push({ type: "text", text: item.title });
    rows.push({
      type: "text",
      text: `  ${item.qty} x Rp${item.price.toLocaleString("id-ID")}  = Rp${item.lineTotal.toLocaleString("id-ID")}`
    });
  }

  rows.push({ type: "divider" });
  rows.push({ type: "bold", text: padBetween("TOTAL", "Rp55.000") });
  rows.push({ type: "text", text: padBetween("Tunai", "Rp60.000") });
  rows.push({ type: "text", text: padBetween("Kembali", "Rp5.000") });
  rows.push({ type: "divider" });
  rows.push({ type: "center", text: "Terima kasih" });
  rows.push({ type: "text", text: "" });
  rows.push({ type: "center", text: "* * *" });

  return (
    <div className="bill-preview-wrap">
      <div className="bill-preview-paper" style={{ width: `${w * 8}px`, minWidth: "180px", maxWidth: "100%" }}>
        {rows.map((row, i) => {
          if (row.type === "logo") {
            return (
              <div key={i} className="bill-logo-placeholder">
                [LOGO]
              </div>
            );
          }
          if (row.type === "divider") {
            return (
              <div key={i} className="bill-row bill-mono">
                {line()}
              </div>
            );
          }
          if (row.type === "bold") {
            return (
              <div key={i} className="bill-row bill-mono bill-bold bill-center">
                {row.text}
              </div>
            );
          }
          if (row.type === "title") {
            return (
              <div key={i} className="bill-row bill-mono bill-center">
                {row.text}
              </div>
            );
          }
          if (row.type === "center") {
            return (
              <div key={i} className="bill-row bill-mono bill-center">
                {row.text}
              </div>
            );
          }
          if (row.type === "small") {
            return (
              <div key={i} className="bill-row bill-mono bill-small bill-center">
                {row.text}
              </div>
            );
          }
          return (
            <div key={i} className="bill-row bill-mono">
              {row.text || "\u00a0"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StoreSettings({ onApplied, licenseState, onLicenseStateChanged, appReadOnly = false }) {
  const [activeSection, setActiveSection] = useState("info");

  const [cfg, setCfg] = useState({
    storeTitle: "",
    storeSubtitle: "",
    storeAddress: "",
    storeWa: "",
    storeLogoPath: "",
    printerCharWidth: DEFAULT_CHAR_WIDTH,
    qrisStaticContent: "",
    envPath: "",
    hasLogo: false
  });

  const [dataPath, setDataPath] = useState("");
  const [csvPath, setCsvPath] = useState("");
  const [appIconPath, setAppIconPath] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState(""); // "ok" | "err" | ""

  // QRIS test state
  const [qrisTestInput, setQrisTestInput] = useState("");
  const [qrisPreviewUrl, setQrisPreviewUrl] = useState("");
  const [qrisLoading, setQrisLoading] = useState(false);
  const [qrisPrintLoading, setQrisPrintLoading] = useState(false);

  const [licenseCodeInput, setLicenseCodeInput] = useState("");
  const [readonlyMessageInput, setReadonlyMessageInput] = useState("");
  const [licenseSaving, setLicenseSaving] = useState(false);
  const [licenseRefreshing, setLicenseRefreshing] = useState(false);
  const [webSyncLoading, setWebSyncLoading] = useState(false);

  const qrisDebounceRef = useRef(null);

  function showStatus(msg, type = "ok") {
    setStatus(msg);
    setStatusType(type);
    setTimeout(() => setStatus(""), 4000);
  }

  async function syncFromWeb() {
    setWebSyncLoading(true);
    try {
      const res = await window.posApi.syncStoreWebConfig();
      if (res && res.success) {
        showStatus("✓ " + res.message, "ok");
        await loadConfig();
        onApplied?.();
      } else {
        showStatus("Gagal: " + (res?.message || "Unknown error"), "err");
      }
    } catch (err) {
      showStatus(`Gagal sinkron dari Web POS: ${err.message}`, "err");
    } finally {
      setWebSyncLoading(false);
    }
  }

  useEffect(() => {
    setLicenseCodeInput(licenseState?.enteredCode || "");
    setReadonlyMessageInput(licenseState?.readOnlyMessage || "");
  }, [licenseState]);

  useEffect(() => {
    if (appReadOnly && activeSection !== "license") {
      setActiveSection("license");
    }
  }, [appReadOnly, activeSection]);

  async function loadConfig() {
    setLoading(true);
    try {
      const data = await window.posApi.getStoreConfig();
      setCfg(data);
      setQrisTestInput(data.qrisStaticContent || "");
      setCsvPath(data.csvPath || "");

      const dp = await window.posApi.getDataPath();
      setDataPath(dp.dataPath || "");
    } catch (err) {
      showStatus(`Gagal memuat konfigurasi: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  // Auto-preview QRIS when input changes
  useEffect(() => {
    if (qrisDebounceRef.current) clearTimeout(qrisDebounceRef.current);
    if (!qrisTestInput.trim()) {
      setQrisPreviewUrl("");
      return;
    }
    qrisDebounceRef.current = setTimeout(async () => {
      setQrisLoading(true);
      try {
        const res = await window.posApi.previewQrisContent(qrisTestInput);
        setQrisPreviewUrl(res.imageDataUrl || "");
      } catch {
        setQrisPreviewUrl("");
      } finally {
        setQrisLoading(false);
      }
    }, 500);
  }, [qrisTestInput]);

  function handleChange(field, value) {
    setCfg((prev) => ({ ...prev, [field]: value }));
  }

  async function refreshLicenseState() {
    setLicenseRefreshing(true);
    try {
      const state = await window.posApi.getLicenseState();
      onLicenseStateChanged?.(state);
      showStatus("Status lisensi diperbarui.", "ok");
    } catch (err) {
      showStatus(`Gagal memuat lisensi: ${err.message}`, "err");
    } finally {
      setLicenseRefreshing(false);
    }
  }

  async function activateLicense() {
    if (!licenseCodeInput.trim()) {
      showStatus("Kode lisensi wajib diisi.", "err");
      return;
    }

    setLicenseSaving(true);
    try {
      const state = await window.posApi.activateLicense(licenseCodeInput.trim());
      onLicenseStateChanged?.(state);
      if (state.isWriteEnabled) {
        showStatus("Lisensi aktif. Semua fitur sudah terbuka.", "ok");
      } else {
        showStatus(`Lisensi belum aktif: ${state.reason}`, "err");
      }
    } catch (err) {
      showStatus(`Gagal menyimpan lisensi: ${err.message}`, "err");
    } finally {
      setLicenseSaving(false);
    }
  }

  async function saveReadonlyMessage() {
    setLicenseSaving(true);
    try {
      const state = await window.posApi.setLicenseReadOnlyMessage(readonlyMessageInput);
      onLicenseStateChanged?.(state);
      showStatus("Pesan read-only berhasil disimpan.", "ok");
    } catch (err) {
      showStatus(`Gagal simpan pesan read-only: ${err.message}`, "err");
    } finally {
      setLicenseSaving(false);
    }
  }

  async function saveStoreInfo() {
    setLoading(true);
    try {
      await window.posApi.saveStoreConfig({
        storeTitle: cfg.storeTitle,
        storeSubtitle: cfg.storeSubtitle,
        storeAddress: cfg.storeAddress,
        storeWa: cfg.storeWa,
        printerCharWidth: cfg.printerCharWidth,
        storeLogoPath: cfg.storeLogoPath
      });
      showStatus("Informasi toko berhasil disimpan ke .env", "ok");
      onApplied?.();
    } catch (err) {
      showStatus(`Gagal menyimpan: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  async function saveQrisConfig() {
    setLoading(true);
    try {
      await window.posApi.saveStoreConfig({ qrisStaticContent: qrisTestInput });
      setCfg((prev) => ({ ...prev, qrisStaticContent: qrisTestInput }));
      showStatus("QRIS_STATIC_CONTENT berhasil disimpan ke .env", "ok");
      onApplied?.();
    } catch (err) {
      showStatus(`Gagal menyimpan QRIS: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  async function pickLogo() {
    try {
      const res = await window.posApi.pickStoreImage();
      if (!res.canceled) {
        setCfg((prev) => ({ ...prev, storeLogoPath: res.filePath, hasLogo: true }));
        showStatus(`Logo dipilih: ${res.filePath}`, "ok");
      }
    } catch (err) {
      showStatus(`Gagal pilih gambar: ${err.message}`, "err");
    }
  }

  async function pickIcon() {
    try {
      const res = await window.posApi.pickAppIcon();
      if (!res.canceled) {
        setAppIconPath(res.filePath);
        showStatus(`Icon dipilih: ${res.filePath}`, "ok");
      }
    } catch (err) {
      showStatus(`Gagal pilih icon: ${err.message}`, "err");
    }
  }

  async function applyAppIcon() {
    if (!appIconPath) {
      showStatus("Pilih file icon terlebih dahulu.", "err");
      return;
    }
    setLoading(true);
    try {
      const res = await window.posApi.setAppIcon(appIconPath);
      if (res.success) {
        showStatus("Icon aplikasi berhasil diubah dan disimpan ke .env", "ok");
        onApplied?.();
      } else {
        showStatus(`Gagal: ${res.error}`, "err");
      }
    } catch (err) {
      showStatus(`Gagal: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  async function pickDataFolder() {
    try {
      const res = await window.posApi.pickDataFolder();
      if (!res.canceled) {
        setDataPath(res.folderPath);
        showStatus(`Folder dipilih: ${res.folderPath}`, "ok");
      }
    } catch (err) {
      showStatus(`Gagal pilih folder: ${err.message}`, "err");
    }
  }

  async function pickCsvFolder() {
    try {
      const res = await window.posApi.pickDataFolder();
      if (!res.canceled) {
        setCsvPath(res.folderPath);
        showStatus(`Folder CSV dipilih: ${res.folderPath}`, "ok");
      }
    } catch (err) {
      showStatus(`Gagal pilih folder CSV: ${err.message}`, "err");
    }
  }

  async function saveDataPath() {
    if (!dataPath.trim()) {
      showStatus("Path lokasi JSON tidak boleh kosong.", "err");
      return;
    }
    if (!csvPath.trim()) {
      showStatus("Path lokasi CSV tidak boleh kosong.", "err");
      return;
    }
    setLoading(true);
    try {
      const dataPathRes = await window.posApi.setDataPath(dataPath);
      if (!dataPathRes.success) {
        showStatus(`Gagal: ${dataPathRes.error}`, "err");
        return;
      }

      await window.posApi.saveStoreConfig({ csvPath });
      if (dataPathRes.success) {
        showStatus("DATA_PATH dan CSV_PATH berhasil disimpan. Restart aplikasi untuk mengaktifkan.", "ok");
        onApplied?.();
      } else {
        showStatus("Gagal menyimpan pengaturan Data Path.", "err");
      }
    } catch (err) {
      showStatus(`Gagal: ${err.message}`, "err");
    } finally {
      setLoading(false);
    }
  }

  async function testPrintQris() {
    if (!qrisTestInput.trim()) {
      showStatus("Isi konten QRIS terlebih dahulu.", "err");
      return;
    }
    setQrisPrintLoading(true);
    try {
      await window.posApi.printQrisStatic({ amount: 1 });
      showStatus("Slip QRIS berhasil dicetak ke printer.", "ok");
    } catch (err) {
      showStatus(`Gagal cetak QRIS: ${err.message}`, "err");
    } finally {
      setQrisPrintLoading(false);
    }
  }

  const sections = [
    { key: "license", label: "🔐 License" },
    { key: "info", label: "🏪 Info Toko" },
    { key: "logo", label: "🖼 Logo & Icon" },
    { key: "qris", label: "💳 QRIS" },
    { key: "bill", label: "🧾 Preview Struk" },
    { key: "data", label: "📁 Data Path" }
  ];

  return (
    <section className="panel store-settings-panel">
      <div className="store-settings-header">
        <h2>⚙️ Pengaturan Toko</h2>
        <p className="small-text">
          Semua perubahan disimpan ke file <code>.env</code> di:{" "}
          <span className="env-path-badge">{cfg.envPath || "..."}</span>
        </p>
      </div>

      <div className="store-settings-tabs">
        {sections.map((s) => (
          <button
            key={s.key}
            className={`store-tab-btn ${activeSection === s.key ? "store-tab-active" : ""}`}
            disabled={appReadOnly && s.key !== "license"}
            onClick={() => setActiveSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {appReadOnly && (
        <div className="license-readonly-alert">
          <strong>Mode Read-Only aktif.</strong> {licenseState?.readOnlyMessage || "Lisensi tidak aktif."}
          <div className="small-text" style={{ marginTop: "6px" }}>
            Hubungi developer: {licenseState?.developerContact?.email || "-"} | {licenseState?.developerContact?.whatsapp || "-"}
          </div>
        </div>
      )}

      {/* ──── LICENSE ──── */}
      {activeSection === "license" && (
        <div className="store-section">
          <h3>Aktivasi License</h3>
          <p className="small-text">
            Masukkan kode license dari developer. Format daftar license: <code>KODE:status[:YYYY-MM-DD]</code>.
          </p>

          <div className="database-form-group">
            <label>Kode License (LICENSE_CODE)</label>
            <input
              value={licenseCodeInput}
              onChange={(e) => setLicenseCodeInput(e.target.value)}
              placeholder="Contoh: CLirU4Ur33RN"
              disabled={licenseSaving}
            />
          </div>

          <div className="store-actions-row">
            <button className="btn btn-save" onClick={activateLicense} disabled={licenseSaving || !licenseCodeInput.trim()}>
              {licenseSaving ? "Menyimpan..." : "Simpan & Validasi License"}
            </button>
            <button className="btn btn-secondary" onClick={refreshLicenseState} disabled={licenseRefreshing || licenseSaving}>
              {licenseRefreshing ? "Memuat..." : "Refresh Status"}
            </button>
          </div>

          <div className="license-state-box">
            <div>
              <strong>Status:</strong>{" "}
              {licenseState?.isWriteEnabled ? "ACTIVE (Full Feature)" : "NOT ACTIVE (Read-Only)"}
            </div>
            <div><strong>Alasan:</strong> {licenseState?.reason || "-"}</div>
            <div><strong>Kode Saat Ini:</strong> <span className="mono">{licenseState?.enteredCode || "-"}</span></div>
            <div><strong>Status di Daftar:</strong> {licenseState?.listed?.status || "-"}</div>
            <div><strong>Berlaku Sampai:</strong> {licenseState?.listed?.expiresAt || "-"}</div>
          </div>

          <hr className="store-divider" />

          <h3>Pesan Mode Read-Only</h3>
          <p className="small-text">
            Pesan ini tampil ketika license tidak aktif. Kontak developer default:
            <br />
            Email: <strong>{licenseState?.developerContact?.email || "rahmatnur844@gmail.com"}</strong>
            <br />
            WhatsApp: <strong>{licenseState?.developerContact?.whatsapp || "+6283182647716"}</strong>
          </p>

          <div className="database-form-group">
            <label>Pesan Read-Only (LICENSE_READONLY_MESSAGE)</label>
            <textarea
              className="qris-input"
              rows={3}
              value={readonlyMessageInput}
              onChange={(e) => setReadonlyMessageInput(e.target.value)}
              placeholder="Contoh: License tidak aktif, hubungi developer untuk aktivasi"
              disabled={licenseSaving}
            />
          </div>

          <div className="store-actions-row">
            <button className="btn btn-save" onClick={saveReadonlyMessage} disabled={licenseSaving}>
              Simpan Pesan Read-Only
            </button>
          </div>
        </div>
      )}

      {/* ──── INFO TOKO ──── */}
      {activeSection === "info" && (
        <div className="store-section">
          <h3>Informasi Toko &amp; Struk</h3>
          <p className="small-text">
            Informasi ini tampil di header struk yang dicetak ke printer thermal.
          </p>

          <div className="form-row">
            <div className="database-form-group">
              <label>Nama Toko (STORE_TITLE)</label>
              <input
                value={cfg.storeTitle}
                onChange={(e) => handleChange("storeTitle", e.target.value)}
                placeholder="Contoh: Warung Budi"
                disabled={loading}
              />
            </div>
            <div className="database-form-group">
              <label>Subtitle / Tagline (STORE_SUBTITLE)</label>
              <input
                value={cfg.storeSubtitle}
                onChange={(e) => handleChange("storeSubtitle", e.target.value)}
                placeholder="Contoh: Kedai Kopi &amp; Snack"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="database-form-group">
              <label>Alamat (STORE_ADDRESS)</label>
              <input
                value={cfg.storeAddress}
                onChange={(e) => handleChange("storeAddress", e.target.value)}
                placeholder="Contoh: Jl. Merdeka No. 1, Jakarta"
                disabled={loading}
              />
            </div>
            <div className="database-form-group">
              <label>No. WhatsApp (STORE_WA)</label>
              <input
                value={cfg.storeWa}
                onChange={(e) => handleChange("storeWa", e.target.value)}
                placeholder="Contoh: 0812-3456-7890"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="database-form-group" style={{ maxWidth: "200px" }}>
              <label>Lebar Kertas (PRINTER_CHAR_WIDTH)</label>
              <input
                type="number"
                min="20"
                max="80"
                value={cfg.printerCharWidth}
                onChange={(e) => handleChange("printerCharWidth", Number(e.target.value))}
                disabled={loading}
              />
              <span className="small-text">32 = 58mm &bull; 48 = 80mm</span>
            </div>
          </div>

          <div className="store-actions-row">
            <button className="btn btn-save" onClick={saveStoreInfo} disabled={loading || webSyncLoading}>
              Simpan Info Toko
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={syncFromWeb}
              disabled={loading || webSyncLoading}
              style={{ borderColor: "#0d9488", color: "#0d9488", fontWeight: 700 }}
              title="Ambil Profil Toko, Alamat, No WA, Subtitle, dan Lebar Kertas dari Web POS"
            >
              {webSyncLoading ? "Menyinkronkan..." : "🔄 Sinkronkan Pengaturan dari Web POS"}
            </button>
          </div>
        </div>
      )}

      {/* ──── LOGO & ICON ──── */}
      {activeSection === "logo" && (
        <div className="store-section">
          <h3>Logo Toko (STORE_LOGO_PATH)</h3>
          <p className="small-text">
            Gambar logo dicetak di bagian atas struk sebelum nama toko.
            Gunakan file PNG transparan, lebar ~200px, tinggi ~80px.
          </p>

          <div className="logo-picker-row">
            <input
              className="path-input"
              value={cfg.storeLogoPath}
              onChange={(e) => handleChange("storeLogoPath", e.target.value)}
              placeholder="Path file logo (kosongkan jika tidak pakai logo)"
              disabled={loading}
            />
            <button className="btn btn-secondary" onClick={pickLogo} disabled={loading}>
              Pilih File...
            </button>
          </div>

          {cfg.storeLogoPath && cfg.hasLogo && (
            <div className="logo-preview-box">
              <img
                src={`file:///${cfg.storeLogoPath.replace(/\\/g, "/")}`}
                alt="Logo Preview"
                className="logo-preview-img"
              />
            </div>
          )}

          <div className="store-actions-row" style={{ marginTop: "16px" }}>
            <button className="btn btn-save" onClick={saveStoreInfo} disabled={loading || webSyncLoading}>
              Simpan Logo Path
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={syncFromWeb}
              disabled={loading || webSyncLoading}
              style={{ borderColor: "#0d9488", color: "#0d9488", fontWeight: 700 }}
              title="Unduh dan pasang Icon Toko 1:1 dari Web POS sebagai logo struk"
            >
              {webSyncLoading ? "Mengunduh..." : "🔄 Sinkronkan Icon 1:1 dari Web POS"}
            </button>
            {cfg.storeLogoPath && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  handleChange("storeLogoPath", "");
                  handleChange("hasLogo", false);
                }}
                disabled={loading || webSyncLoading}
              >
                Hapus Logo
              </button>
            )}
          </div>

          <hr className="store-divider" />

          <h3>Icon Aplikasi (APP_ICON_PATH)</h3>
          <p className="small-text">
            Ganti icon yang tampil di titlebar jendela dan taskbar Windows.
            Gunakan file <code>.ico</code> (rekomendasi 256×256) atau <code>.png</code>.
            Perubahan langsung aktif tanpa restart.
          </p>

          <div className="logo-picker-row">
            <input
              className="path-input"
              value={appIconPath}
              onChange={(e) => setAppIconPath(e.target.value)}
              placeholder="Path file icon (.ico atau .png)"
              disabled={loading}
            />
            <button className="btn btn-secondary" onClick={pickIcon} disabled={loading}>
              Pilih File...
            </button>
          </div>

          {appIconPath && (
            <div className="logo-preview-box">
              <img
                src={`file:///${appIconPath.replace(/\\/g, "/")}`}
                alt="Icon Preview"
                className="logo-preview-img"
                style={{ maxWidth: "64px" }}
              />
            </div>
          )}

          <div className="store-actions-row" style={{ marginTop: "12px" }}>
            <button
              className="btn btn-save"
              onClick={applyAppIcon}
              disabled={loading || !appIconPath}
            >
              Terapkan Icon Sekarang
            </button>
          </div>
        </div>
      )}

      {/* ──── QRIS ──── */}
      {activeSection === "qris" && (
        <div className="store-section">
          <h3>QRIS Statis (QRIS_STATIC_CONTENT)</h3>
          <p className="small-text">
            Tempel isi string QRIS statis kamu di sini (bukan URL gambar, tapi konten raw QRIS).
            Konten ini di-encode menjadi QR code saat kasir pilih metode bayar QRIS.
          </p>

          <div className="database-form-group">
            <label>Konten QRIS (QRIS_STATIC_CONTENT)</label>
            <textarea
              className="qris-input"
              rows={5}
              value={qrisTestInput}
              onChange={(e) => setQrisTestInput(e.target.value)}
              placeholder="Tempel konten QRIS string di sini..."
              disabled={loading}
            />
          </div>

          <div className="qris-preview-area">
            {qrisLoading && <div className="qris-loading-text">Membuat QR Code...</div>}
            {!qrisLoading && qrisPreviewUrl && (
              <div className="qris-preview-box">
                <p className="small-text">Preview QR Code:</p>
                <img src={qrisPreviewUrl} alt="QRIS QR Preview" className="qris-preview-img" />
                <p className="small-text qris-check-text">
                  ✅ Konten valid — QR berhasil di-generate
                </p>
              </div>
            )}
            {!qrisLoading && !qrisPreviewUrl && qrisTestInput.trim() && (
              <div className="qris-error-box">Gagal generate QR — cek konten QRIS.</div>
            )}
            {!qrisTestInput.trim() && (
              <div className="qris-empty-box">Isi konten QRIS di atas untuk melihat preview.</div>
            )}
          </div>

          <div className="store-actions-row">
            <button
              className="btn btn-save"
              onClick={saveQrisConfig}
              disabled={loading || !qrisTestInput.trim()}
            >
              Simpan QRIS ke .env
            </button>
            <button
              className="btn btn-secondary"
              onClick={testPrintQris}
              disabled={qrisPrintLoading || !qrisTestInput.trim()}
            >
              {qrisPrintLoading ? "Mencetak..." : "🖨 Uji Cetak QRIS"}
            </button>
          </div>

          <div className="small-text" style={{ marginTop: "12px", color: "#888" }}>
            Tombol "Uji Cetak QRIS" akan mencetak slip ke printer yang sedang aktif dengan nominal Rp 1.
          </div>
        </div>
      )}

      {/* ──── BILL PREVIEW ──── */}
      {activeSection === "bill" && (
        <div className="store-section">
          <h3>Preview Struk Dummy</h3>
          <p className="small-text">
            Simulasi tampilan struk thermal berdasarkan pengaturan toko saat ini.
            Lebar karakter: <strong>{cfg.printerCharWidth}</strong> ({cfg.printerCharWidth <= 32 ? "58mm" : "80mm"}).
          </p>

          <BillPreview cfg={cfg} charWidth={cfg.printerCharWidth} />

          <p className="small-text" style={{ marginTop: "16px", color: "#888" }}>
            Catatan: Preview ini adalah simulasi berbasis teks. Hasil cetak aktual di thermal printer
            bergantung pada model printer, driver, dan font bawaan printer.
          </p>
        </div>
      )}

      {/* ──── DATA PATH ──── */}
      {activeSection === "data" && (
        <div className="store-section">
          <h3>Pengaturan Data Path</h3>
          <p className="small-text">
            Perubahan baru aktif setelah restart aplikasi.{" "}
            <strong>Pastikan folder tujuan sudah ada dan bisa diakses.</strong>
          </p>
          {/* <p className="small-text">
            Pengaturan folder tempat semua file JSON transaksi, order, dan data harian disimpan.
            Perubahan baru aktif setelah restart aplikasi.{" "}
            <strong>Pastikan folder tujuan sudah ada dan bisa diakses.</strong>
          </p> */}

          {/* <div className="database-form-group">
            <label>Path Folder Data Aktif</label>
            <div className="printer-current-box">{dataPath || "Belum terdeteksi"}</div>
          </div> */}

          <div className="database-form-group">
            <label>1. Lokasi folder JSON</label>
            <span className="small-text">
              Pengaturan folder tempat semua file JSON transaksi, order, dan data harian disimpan.{" "}
            </span>
            <div className="logo-picker-row">
              <input
                className="path-input"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
                placeholder="Contoh: C:\POS\data atau path absolut lainnya"
                disabled={loading}
              />
              <button className="btn btn-secondary" onClick={pickDataFolder} disabled={loading}>
                Browse...
              </button>
            </div>
            <span className="small-text">
              Biarkan kosong untuk menggunakan folder default:{" "}
              <code>AppData\Roaming\Barangmudo POS\pos-data</code>
            </span>
          </div>

          <div className="database-form-group">
            <label>2. Lokasi CSV</label>
            <span className="small-text">
              Pengaturan lokasi file CSV sumber data hasil export dari Shopify katalog produk diambil untuk impor ke aplikasi.{" "}
            </span>
            <div className="logo-picker-row">
              <input
                className="path-input"
                value={csvPath}
                onChange={(e) => setCsvPath(e.target.value)}
                placeholder="Contoh: C:\POS\csv atau path absolut lainnya"
                disabled={loading}
              />
              <button className="btn btn-secondary" onClick={pickCsvFolder} disabled={loading}>
                Browse...
              </button>
            </div>
            <span className="small-text">
              Biarkan kosong untuk menggunakan folder default:{" "}
              <code>C:\Program Files\Barangmudo POS\resources\assets</code>
            </span>
          </div>

          <div className="store-actions-row" style={{ marginTop: "12px" }}>
            <button className="btn btn-save" onClick={saveDataPath} disabled={loading || !dataPath.trim() || !csvPath.trim()}>
              Simpan &amp; Restart Diperlukan
            </button>
          </div>
        </div>

        
      )}

      {/* Status bar */}
      {status && (
        <div className={`status ${statusType === "err" ? "status-error" : ""}`}>
          {statusType === "ok" ? "✓ " : "✗ "}{status}
        </div>
      )}
    </section>
  );
}
