import { useEffect, useState } from "react";
import packageJson from "../package.json";

const DEFAULT_SERVER_URL = packageJson.api_base_url || packageJson.apiBaseUrl || "https://atikahjaya.com";

export default function ServerSettings({ onApplied }) {
  const [config, setConfig] = useState({
    serverUrl: DEFAULT_SERVER_URL,
    token: null,
    user: null,
    branch: null,
    autoSync: true
  });

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  async function loadConfig() {
    try {
      setLoading(true);
      const data = await window.posApi.getServerConfig();
      if (data) {
        setConfig(data);
      }
    } catch (err) {
      setStatus(`Gagal memuat konfigurasi server: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  async function handleTest() {
    try {
      setLoading(true);
      setStatus("Menguji koneksi ke Server Web Hosting...");
      setTestResult(null);
      const res = await window.posApi.testServerConnection(config.serverUrl);
      if (res.success) {
        setTestResult({ success: true, message: res.message || "Koneksi berhasil terhubung!" });
        setStatus("✓ Server Web dapat diakses dengan baik.");
      } else {
        setTestResult({ success: false, message: res.error || "Gagal menghubungi server." });
        setStatus(`✗ Koneksi gagal: ${res.error}`);
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message });
      setStatus(`✗ Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!config.serverUrl) {
      setStatus("URL Server Web Hosting wajib diisi.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Menyimpan konfigurasi server...");
      const updated = await window.posApi.saveServerConfig(config);
      setConfig(updated);
      setStatus("✓ Konfigurasi Server Web berhasil disimpan.");
      onApplied?.(updated);
    } catch (err) {
      setStatus(`✗ Gagal menyimpan: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSync() {
    try {
      setSyncLoading(true);
      setSyncStatus("Menyinkronkan transaksi offline ke Web Server...");
      const result = await window.posApi.syncOfflineOrders();
      if (result.success) {
        setSyncStatus(`✓ ${result.message || `${result.synced} transaksi berhasil disinkronisasi!`}`);
      } else {
        setSyncStatus(`✗ Sinkronisasi gagal: ${result.message}`);
      }
    } catch (err) {
      setSyncStatus(`✗ Error sinkron: ${err.message}`);
    } finally {
      setSyncLoading(false);
    }
  }

  return (
    <section className="panel database-panel server-settings-panel">
      <div className="printer-header-row">
        <div>
          <h2>Integrasi Web Hosting Server &amp; API</h2>
          <p className="small-text">
            Hubungkan Desktop POS ke Web POS Hosting untuk sinkronisasi katalog produk, stok cabang, dan penjualan realtime.
          </p>
        </div>
        <div>
          <span className={`status-badge ${testResult?.success ? "connected" : (testResult === null ? "" : "disconnected")}`}>
            {testResult?.success ? "✓ Terhubung ke Web Server" : (testResult === null ? "Status: Siap" : "✗ Gagal Terhubung")}
          </span>
        </div>
      </div>

      <div className="database-form-group">
        <label htmlFor="serverUrl">URL Server Web POS (Hosting / Domain)</label>
        <input
          id="serverUrl"
          type="text"
          placeholder="Contoh: https://atikahjaya.com atau http://localhost/pos"
          value={config.serverUrl || ""}
          onChange={(e) => setConfig((prev) => ({ ...prev, serverUrl: e.target.value }))}
          disabled={loading}
        />
        <p className="small-text" style={{ marginTop: 4 }}>
          Masukkan alamat root website sistem POS tempat API <code>/api/desktop/*</code> berada.
        </p>
      </div>

      {config.branch && (
        <div className="panel branch-info-panel" style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 8, margin: "12px 0" }}>
          <strong>Cabang Aktif:</strong> {config.branch.name || "Cabang Utama"} (ID: {config.branch.id || 1})
          {config.user && (
            <span style={{ marginLeft: 16 }}>
              <strong>Kasir:</strong> {config.user.nama || config.user.username}
            </span>
          )}
        </div>
      )}

      <div className="database-actions" style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={loading}>
          {loading ? "Menguji..." : "Test Koneksi Server"}
        </button>
        <button type="button" className="btn btn-save" onClick={handleSave} disabled={loading} style={{ margin: 0, width: "auto" }}>
          Simpan Konfigurasi Server
        </button>
      </div>

      {status && <div className="status" style={{ marginTop: 12 }}>{status}</div>}

      <hr style={{ margin: "24px 0", border: "0", borderTop: "1px solid #e2e8f0" }} />

      {/* Offline Sync Area */}
      <div className="offline-sync-section">
        <h3>Sinkronisasi Transaksi Offline</h3>
        <p className="small-text">
          Jika transaksi dilakukan saat koneksi internet terputus (mode offline), semua transaksi disimpan secara aman di komputer lokal.
          Klik tombol di bawah untuk menyinkronkan data offline ke server hosting begitu internet aktif.
        </p>
        <button
          type="button"
          className="btn btn-teal"
          onClick={handleManualSync}
          disabled={syncLoading}
          style={{ width: "auto", padding: "10px 20px" }}
        >
          {syncLoading ? "Sedang Menyinkronkan..." : "🔄 Sinkronkan Data Offline Sekarang"}
        </button>
        {syncStatus && <div className="status" style={{ marginTop: 10 }}>{syncStatus}</div>}
      </div>
    </section>
  );
}

